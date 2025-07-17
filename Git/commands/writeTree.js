const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

/**
 * 创建Git tree对象
 * 扫描当前目录并创建包含所有文件的tree对象
 * @returns {string} tree对象的SHA1哈希值
 */
function writeTreeCommand() {
  try {
    // 获取当前工作目录
    const currentDir = process.cwd();
    
    // 扫描目录并构建tree条目
    const entries = scanDirectory(currentDir);
    
    // 按名称排序条目（Git要求）
    entries.sort((a, b) => a.name.localeCompare(b.name));
    
    // 构建tree对象内容
    const treeContent = buildTreeContent(entries);
    
    // 计算哈希值
    const header = `tree ${treeContent.length}`;
    const gitObject = `${header}\0${treeContent}`;
    const hash = crypto.createHash('sha1').update(gitObject).digest('hex');
    
    // 写入对象到.git/objects
    writeGitObject(hash, gitObject);
    
    return hash;
  } catch (error) {
    throw new Error(`创建tree对象失败: ${error.message}`);
  }
}

/**
 * 扫描目录并收集文件信息
 * @param {string} dirPath - 要扫描的目录路径
 * @returns {Array} 文件条目数组
 */
function scanDirectory(dirPath) {
  const entries = [];
  const gitDir = path.join(process.cwd(), '.git');
  try {
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      // 跳过.git目录
      if (item === '.git') continue;
      
      const itemPath = path.join(dirPath, item);
      const stat = fs.statSync(itemPath);
      
      if (stat.isFile()) { // 处理文件
        const content = fs.readFileSync(itemPath);
        const fileHeader = `blob ${content.length}`;
        const fileObject = `${fileHeader}\0${content}`;
        const fileHash = crypto.createHash('sha1').update(fileObject).digest('hex');
        
        // 写入blob对象
        writeGitObject(fileHash, fileObject);
        
        entries.push({
          mode: 100644, // 普通文件模式
          hash: fileHash,
          name: item
        });
      } else if (stat.isDirectory()) { // 递归处理子目录
        const subTreeHash = writeTreeCommandRecursive(itemPath);
        entries.push({
          mode: 40000, // 目录模式
          hash: subTreeHash,
          name: item
        });
      }
    }
  } catch (error) {
    throw new Error(`扫描目录失败: ${error.message}`);
  }
  
  return entries;
}

/**
 * 递归创建tree对象（用于子目录）
 * @param {string} dirPath - 目录路径
 * @returns {string} tree对象的哈希值
 */
function writeTreeCommandRecursive(dirPath) {
  const entries = [];
  try {
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stat = fs.statSync(itemPath);
      
      if (stat.isFile()) {
        const content = fs.readFileSync(itemPath);
        const fileHeader = `blob ${content.length}`;
        const fileObject = `${fileHeader}\0${content}`;
        const fileHash = crypto.createHash('sha1').update(fileObject).digest('hex');
        
        writeGitObject(fileHash, fileObject);
        
        entries.push({
          mode: '100644',
          hash: fileHash,
          name: item
        });
      } else if (stat.isDirectory()) {
        const subTreeHash = writeTreeCommandRecursive(itemPath);
        entries.push({
          mode: 40000,
          hash: subTreeHash,
          name: item
        });
      }
    }
    
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const treeContent = buildTreeContent(entries);
    const header = `tree ${treeContent.length}`;
    const gitObject = `${header}\0${treeContent}`;
    const hash = crypto.createHash('sha1').update(gitObject).digest('hex');
    
    writeGitObject(hash, gitObject);
    return hash;
  } catch (error) {
    throw new Error(`递归创建tree对象失败: ${error.message}`);
  }
}

/**
 * 构建tree对象的内容
 * @param {Array} entries - 条目数组
 * @returns {Buffer} tree对象的内容
 */
function buildTreeContent(entries) {
  const parts = [];
  
  for (const entry of entries) {
    // 构建条目格式: mode name\0hash
    const entryStr = `${entry.mode} ${entry.name}`;
    const entryBuffer = Buffer.from(entryStr, 'utf8');
    const hashBuffer = Buffer.from(entry.hash, 'hex');
    parts.push(entryBuffer);
    parts.push(Buffer.from([0])); // null字节
    parts.push(hashBuffer);
  }
  
  return Buffer.concat(parts);
}

/**
 * 将Git对象写入.git/objects目录
 * @param {string} hash - 对象的SHA1哈希值
 * @param {string|Buffer} content - 对象内容
 */
function writeGitObject(hash, content) {
  try {
    const objectsDir = path.join(process.cwd(), '.git', 'objects');
    const subdir = hash.substring(0, 2);
    const filename = hash.substring(2);
    
    // 创建子目录
    const subdirPath = path.join(objectsDir, subdir);
    if (!fs.existsSync(subdirPath)) {
      fs.mkdirSync(subdirPath, { recursive: true });
    }
    
    // 压缩并写入对象
    const compressed = zlib.deflateSync(content);
    const objectPath = path.join(subdirPath, filename);
    fs.writeFileSync(objectPath, compressed);
  } catch (error) {
    throw new Error(`写入Git对象失败: ${error.message}`);
  }
}

module.exports = { writeTreeCommand }; 