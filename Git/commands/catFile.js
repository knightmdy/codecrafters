const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * 读取并显示Git对象内容
 * @param {string} objectHash - Git对象的SHA1哈希值
 */
function catFileCommand(objectHash) {
  try {
    // 验证哈希值格式
    if (!/^[a-f0-9]{40}$/.test(objectHash)) {
      throw new Error('无效的对象哈希值格式');
    }

    // 构建对象文件路径
    const objectsDir = path.join(process.cwd(), '.git', 'objects');
    const objectPath = path.join(objectsDir, objectHash.substring(0, 2), objectHash.substring(2));

    // 检查对象文件是否存在
    if (!fs.existsSync(objectPath)) {
      throw new Error(`对象 ${objectHash} 不存在`);
    }

    // 读取并解压缩对象内容
    const compressedData = fs.readFileSync(objectPath);
    const decompressedData = require('zlib').inflateSync(compressedData);
    
    // 解析对象格式
    const content = decompressedData.toString('utf8');
    const nullIndex = content.indexOf('\0');
    
    if (nullIndex === -1) {
      throw new Error('无效的Git对象格式');
    }

    const header = content.substring(0, nullIndex);
    const body = content.substring(nullIndex + 1);

    // 解析对象类型和大小
    const [type, size] = header.split(' ');    
    if (!size || isNaN(parseInt(size))) {
      throw new Error('无效的对象头部信息');
    }

    // 输出对象内容
    console.log(body);
  } catch (error) {
    throw new Error(`读取对象失败: ${error.message}`);
  }
}

module.exports = { catFileCommand }; 