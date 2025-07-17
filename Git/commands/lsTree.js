const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * 列出Git tree对象的内容
 * @param[object Object]string} treeHash - tree对象的SHA1哈希值
 * @param {boolean} nameOnly - 是否只显示文件名
 */
function lsTreeCommand(treeHash, nameOnly = false) {
  try {
    // 验证哈希值格式
    if (!/^[a-f0-9]{40}$/.test(treeHash)) {
      throw new Error('无效的tree哈希值格式');
    }

    // 构建对象文件路径
    const objectsDir = path.join(process.cwd(), '.git', 'objects');
    const objectPath = path.join(objectsDir, treeHash.substring(0, 2), treeHash.substring(2));

    // 检查对象文件是否存在
    if (!fs.existsSync(objectPath)) {
      throw new Error(`tree对象 ${treeHash} 不存在`);
    }

    // 读取并解压缩对象内容
    const compressedData = fs.readFileSync(objectPath);
    const decompressedData = zlib.inflateSync(compressedData);
    
    // 解析对象格式
    const content = decompressedData.toString('utf8');
    const nullIndex = content.indexOf('\0');
    
    if (nullIndex === -1) {
      throw new Error('无效的Git对象格式');
    }

    const header = content.substring(0, nullIndex);
    const body = content.substring(nullIndex + 1);

    // 验证是否为tree对象
    const [type, size] = header.split(' ');
    if (type !== 'tree') {
      throw new Error('指定的对象不是tree类型');
    }

    // 解析tree对象内容
    const entries = parseTreeEntries(body);
    
    // 输出结果
    entries.forEach(entry => {
      if (nameOnly) {
        console.log(entry.name);
      } else {
        console.log(`${entry.mode} ${entry.type} ${entry.hash} ${entry.name}`);
      }
    });
  } catch (error) {
    throw new Error(`读取tree对象失败: ${error.message}`);
  }
}

/**
 * 解析tree对象的条目
 * @param {Buffer} body - tree对象的主体内容
 * @returns {Array} 解析后的条目数组
 */
function parseTreeEntries(body) {
  const entries = [];
  let offset = 0;
  
  while (offset < body.length) {
    // 查找模式结束位置
    const modeEnd = body.indexOf(' ', offset);
    if (modeEnd === -1) break;
    
    // 查找文件名结束位置
    const nameEnd = body.indexOf('\0', modeEnd);
    if (nameEnd === -1) break;
    
    // 提取模式
    const mode = body.substring(offset, modeEnd);
    
    // 提取文件名
    const name = body.substring(modeEnd + 1, nameEnd);
    
    // 提取哈希值（20字节）
    const hashStart = nameEnd + 1;
    const hashEnd = hashStart + 20;
    if (hashEnd > body.length) break;
    
    const hashBuffer = body.substring(hashStart, hashEnd);
    const hash = hashBuffer.toString('hex');
    
    // 确定对象类型
    let type = 'blob';
    if (mode.startsWith('4000')) {
      type = 'tree';
    } else if (mode.startsWith('12000')) {
      type = 'blob';
    } else if (mode.startsWith('16000')) {
      type = 'commit';
    }
    
    entries.push({
      mode: mode,
      type: type,
      hash: hash,
      name: name
    });
    
    offset = hashEnd;
  }
  
  return entries;
}

module.exports = { lsTreeCommand }; 