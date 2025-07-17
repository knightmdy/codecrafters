// 引入所需模块
const { open } = require('fs/promises');
const path = require('path');
const { parseSelectCommand } = require('./sqlparser.js');
const readVarInt = require('./varint');
const { parseColumns } = require('./sqlparser');

// 数据库头部大小（字节）
const DATABASE_HEADER_SIZE = 100;
// 是否开启调试模式
const DEBUG_MODE = process.env.DEBUG_MODE;

/**
 * 获取页面头部大小
 * @param {number} pageType 页面类型
 * @returns {number} 页面头部大小
 */
function getPageHeaderSize(pageType) {
  if (pageType === 13 || pageType === 10) {
    return 8;
  } else if (pageType === 2 || pageType === 5) {
    return 12;
  }
  throw new Error(`invalid page type: ${pageType}`);
}

/**
 * 读取数据库头部信息，获取页大小和页数
 * @param {FileHandle} fileHandle 文件句柄
 * @returns {Object} { pageSize, numberOfPages }
 */
async function readDatabaseHeader(fileHandle) {
  const { buffer } = await fileHandle.read({
    length: DATABASE_HEADER_SIZE,
    position: 0,
    buffer: Buffer.alloc(DATABASE_HEADER_SIZE),
  });
  const pageSize = buffer.readUInt16BE(16);
  const numberOfPages = buffer.readUInt32BE(28);
  logDebug('readDatabaseHeader', { pageSize, numberOfPages });
  return { pageSize, numberOfPages };
}

/**
 * 读取单元格中的值
 * @param {Buffer} buffer 数据缓冲区
 * @param {number} cursor 当前游标
 * @param {number} serialType 序列化类型
 * @returns {Object} { value, newCursor }
 */
function readValue(buffer, cursor, serialType) {
  if ([0, 8, 9, 12, 13].includes(serialType)) return { value: null, newCursor: cursor };
  if (serialType > 12) {
    const dataTypeSize = (serialType - (serialType % 2 === 0 ? 12 : 13)) / 2;
    const value = buffer.subarray(cursor, cursor + dataTypeSize);
    const newCursor = cursor + dataTypeSize;
    if (serialType % 2 === 0) {
      return { value, newCursor };
    }
    return { value: value.toString('utf8'), newCursor };
  }
  if (serialType === 1) return { value: buffer.readInt8(cursor), newCursor: cursor + 1 };
  if (serialType === 2) return { value: buffer.readUInt16BE(cursor), newCursor: cursor + 2 };
  if (serialType === 3) return { value: buffer.readUIntBE(cursor, 3), newCursor: cursor + 3 };
  if (serialType === 4) return { value: buffer.readUInt32BE(cursor), newCursor: cursor + 4 };
  if (serialType === 5) return { value: buffer.readUIntBE(cursor, 6), newCursor: cursor + 6 };
  if ([6, 7].includes(serialType)) return { value: buffer.readBigUInt64BE(cursor), newCursor: cursor + 8 };
  throw new Error(`Unknown serial type: ${serialType}`);
}

/**
 * 解析一条记录
 * @param {Buffer} buffer 数据缓冲区
 * @param {string[]} columns 列名数组
 * @returns {Map} 记录映射
 */
function parseRecord(buffer, columns) {
  const serialType = new Map();
  const { bytesRead } = readVarInt(buffer, 0);
  let cursor = bytesRead;
  for (const column of columns) {
    const { value, bytesRead } = readVarInt(buffer, cursor);
    cursor += bytesRead;
    serialType.set(column, value);
  }
  const record = new Map();
  for (const column of columns) {
    const { value, newCursor } = readValue(buffer, cursor, serialType.get(column));
    record.set(column, value);
    cursor = newCursor;
  }
  logDebug('parseRecord', { buffer, serialType, record });
  return record;
}

/**
 * 解析表结构（schema）
 * @param {Buffer} buffer 数据缓冲区
 * @returns {Map} 表结构映射
 */
function parseTableSchema(buffer) {
  const schemaColumns = ['schemaType', 'schemaName', 'tableName', 'rootPage', 'schemaBody'];
  return parseRecord(buffer, schemaColumns);
}

/**
 * 读取单元格内容
 * @param {number} pageType 页面类型
 * @param {Buffer} buffer 数据缓冲区
 * @param {number} cellPointer 单元格指针
 * @returns {Object} { record, rowId }
 */
function readCell(pageType, buffer, cellPointer) {
  let cursor = cellPointer;
  const { value: recordSize, bytesRead } = readVarInt(buffer, cursor);
  cursor += bytesRead;
  let rowId;
  if (pageType === 0x0d || pageType === 0x05) {
    const { value, bytesRead: rowIdBytesRead } = readVarInt(buffer, cursor);
    rowId = value;
    cursor += rowIdBytesRead;
  }
  const startOfRecord = cursor;
  const endOfRecord = startOfRecord + recordSize;
  const record = buffer.subarray(startOfRecord, endOfRecord);
  logDebug('readCell', {
    pageType,
    cellPointer,
    recordSize,
    bytesRead,
    rowId,
    first10Bytes: record.subarray(0, 10),
    record: record.toString('utf8'),
  });
  return { record, rowId };
}

/**
 * 对行数据应用 WHERE 过滤条件
 * @param {Map[]} rows 行数据
 * @param {Array} whereClause 过滤条件
 * @returns {Map[]} 过滤后的行
 */
function applyFilter(rows, whereClause) {
  if (whereClause.length === 0) {
    return rows;
  }
  const [filterColumn, filterValue] = whereClause[0];
  return rows.filter((row) => {
    return row.get(filterColumn) === filterValue;
  });
}

/**
 * 调试日志输出
 */
function logDebug(...message) {
  if (DEBUG_MODE) {
    console.log(...message);
  }
}

/**
 * 解析表叶子页，获取所有行数据
 */
function parseTableLeafPage(pageType, numberOfCells, buffer, columns, identityColumn) {
  let cursor = getPageHeaderSize(pageType);
  const rows = [];
  for (let i = 0; i < numberOfCells; i++) {
    const cellPointer = buffer.readUInt16BE(cursor);
    const { record, rowId } = readCell(pageType, buffer, cellPointer);
    const row = parseRecord(record, columns);
    if (identityColumn) {
      row.set(identityColumn, rowId);
    }
    rows.push(row);
    cursor += 2;
  }
  return rows;
}

/**
 * 解析表内部页，递归获取所有子页指针
 */
function parseTableInteriorPage(pageType, numberOfCells, buffer) {
  let cursor = getPageHeaderSize(pageType);
  const childPointers = [];
  for (let i = 0; i < numberOfCells; i++) {
    const cellPointer = buffer.readUInt16BE(cursor);
    const childPointer = buffer.readUInt32BE(cellPointer);
    childPointers.push(childPointer);
    cursor += 2;
  }
  logDebug('parseTableInteriorPage', { childPointers });
  return childPointers;
}

/**
 * 读取表的所有行（全表扫描）
 * @param {FileHandle} fileHandle 文件句柄
 * @param {number} page 页码
 * @param {number} pageSize 页大小
 * @param {string[]} columns 列名
 * @param {string} identityColumn 主键列名
 * @returns {Promise<Map[]>} 行数据
 */
async function readTableRows(fileHandle, page, pageSize, columns, identityColumn) {
  const offset = (page - 1) * pageSize;
  const { buffer } = await fileHandle.read({
    length: pageSize,
    position: offset,
    buffer: Buffer.alloc(pageSize),
  });
  logDebug('readTableRows', { page, offset, pageSize });
  const pageType = buffer.readInt8(0);
  const startOfFreeBlock = buffer.readUInt16BE(1);
  const numberOfCells = buffer.readUInt16BE(3);
  const startOfCellContentArea = buffer.readUInt16BE(5);
  const rightMostPointer = pageType === 0x02 || pageType === 0x05 ? buffer.readUInt32BE(8) : undefined;
  logDebug('readTableRows', {
    pageType,
    startOfFreeBlock,
    numberOfCells,
    startOfCellContentArea,
    rightMostPointer,
  });
  if (pageType === 0x0d) {
    // 叶子页，直接解析所有行
    return parseTableLeafPage(pageType, numberOfCells, buffer, columns, identityColumn);
  } else if (pageType === 0x05) {
    // 内部页，递归读取子页
    const rows = [];
    const childPointers = parseTableInteriorPage(pageType, numberOfCells, buffer);
    for (const childPointer of childPointers) {
      rows.push(...(await readTableRows(fileHandle, childPointer, pageSize, columns, identityColumn)));
    }
    return rows;
  }
  throw new Error(`Unknown page type: ${pageType}`);
}

/**
 * 读取所有表的 schema 信息
 */
async function readTableSchemas(fileHandle, pageSize) {
  const { buffer } = await fileHandle.read({
    length: pageSize,
    position: 0,
    buffer: Buffer.alloc(pageSize),
  });
  const offset = DATABASE_HEADER_SIZE; // 跳过数据库头部
  const pageType = buffer.readInt8(offset);
  const numberOfCells = buffer.readUInt16BE(3 + offset);
  const pageHeaderSize = getPageHeaderSize(pageType);
  let cursor = pageHeaderSize + offset;
  const tables = [];
  for (let i = 0; i < numberOfCells; i++) {
    const cellPointer = buffer.readUInt16BE(cursor);
    const { record } = readCell(pageType, buffer, cellPointer);
    const table = parseTableSchema(record);
    tables.push(table);
    cursor += 2;
  }
  return tables;
}

/**
 * 格式化输出表名列表
 */
function filterAndFormatListOfTables(tables) {
  return tables
    .map((table) => table.get('tableName'))
    .filter((tableName) => tableName !== 'sqlite_sequence')
    .sort()
    .join(' ');
}

/**
 * 投影输出指定列
 */
function projectTableRows(rows, queryColumns) {
  return rows.map((row) => queryColumns.map((queryColumn) => row.get(queryColumn)).join('|'));
}

/**
 * 处理 SELECT 查询命令
 * 支持 count、列投影、where 过滤、全表扫描
 */
async function handleSelectCommand(command, fileHandle, pageSize, tables) {
  const { queryColumns, queryTableName, whereClause } = parseSelectCommand(command);
  const table = tables.find((table) => table.get('tableName') === queryTableName);
  if (!table) {
    throw new Error(`Table ${queryTableName} not found`);
  }
  const { columns, identityColumn } = parseColumns(table.get('schemaBody'));
  const rows = await readTableRows(fileHandle, table.get('rootPage'), pageSize, columns, identityColumn);
  const filteredRows = applyFilter(rows, whereClause);
  if (queryColumns[0] === 'count(*)') {
    // 计数功能
    console.log(filteredRows.length);
  } else {
    // 列投影与多列输出
    const result = projectTableRows(filteredRows, queryColumns);
    console.log(result.join('\n'));
  }
}

/**
 * 主程序入口
 * 支持：
 * 1. 打印数据库页大小和表数量（.dbinfo）
 * 2. 打印所有表名（.tables）
 * 3. 执行 SELECT 查询
 */
async function main() {
  if (DEBUG_MODE) {
    console.log('Debug mode enabled');
  }
  const databaseFile = process.argv[2];
  const command = process.argv[3];
  let fileHandle;
  try {
    const filePath = path.join(process.cwd(), databaseFile);
    fileHandle = await open(filePath, 'r');
    const { pageSize } = await readDatabaseHeader(fileHandle);
    const tables = await readTableSchemas(fileHandle, pageSize);
    if (command === '.dbinfo') {
      // 打印数据库页大小和表数量
      console.log(`database page size: ${pageSize}`);
      console.log(`number of tables: ${tables.length}`);
    } else if (command === '.tables') {
      // 打印所有表名
      const userTables = filterAndFormatListOfTables(tables);
      console.log(userTables);
    } else if (command.toUpperCase().startsWith('SELECT')) {
      // 处理 SELECT 查询
      await handleSelectCommand(command, fileHandle, pageSize, tables);
    }
  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    if (fileHandle) {
      await fileHandle.close();
    }
  }
}

// 程序入口
main();