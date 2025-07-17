const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

/**
 * 创建Git blob对象
 * @param {string} filePath - 文件路径
 * @param {boolean} writeObject - 是否写入对象到.git/objects目录
 * @returns {string} 对象的SHA1哈希值
 */
function hashObjectCommand(filePath, writeObject = false) {
  try {
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件 ${filePath} 不存在`);
    }

    // 读取文件内容
    const content = fs.readFileSync(filePath);
    
    // 构建Git对象格式
    const header = `blob ${content.length}`;
    const gitObject = `${header}\0${content}`;
    
    // 计算SHA1哈希值
    const hash = crypto.createHash('sha1').update(gitObject).digest('hex');
    
    // 如果需要写入对象
    if (writeObject) {
      writeGitObject(hash, gitObject);
    }
    
    // 输出哈希值
    console.log(hash);
    return hash;
  } catch (error) {
    throw new Error(`创建blob对象失败: ${error.message}`);
  }
}

/**
 * 将Git对象写入.git/objects目录
 * @param {string} hash - 对象的SHA1哈希值
 * @param {Buffer} content - 对象内容
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

module.exports = { hashObjectCommand }; 