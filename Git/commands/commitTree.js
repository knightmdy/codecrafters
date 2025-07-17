const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

/**
 * 创建Git commit对象
 * @param {string} treeSha - tree对象的SHA1哈希值
 * @param {string} parentSha - 父commit对象的SHA1哈希值
 * @param {string} message - commit消息
 * @returns {string} commit对象的SHA1哈希值
 */
function commitTreeCommand(treeSha, parentSha, message) {
  try {
    // 验证参数
    if (!treeSha || !parentSha || !message) {
      throw new Error('缺少必要参数: tree SHA, parent SHA, 或 commit消息');
    }

    // 验证tree对象是否存在
    if (!objectExists(treeSha)) {
      throw new Error(`tree对象 ${treeSha} 不存在`);
    }

    // 验证父commit对象是否存在
    if (!objectExists(parentSha)) {
      throw new Error(`父commit对象 ${parentSha} 不存在`);
    }

    // 获取当前时间戳
    const now = new Date();
    const timestamp = Math.floor(now.getTime() / 1000);
    const timezone = now.getTimezoneOffset() / -60; // 转换为小时偏移
    const timezoneStr = `${timezone >= 0 ? '+' : ''}${timezone.toString().padStart(2, '0')}`;

    // 构建commit对象内容
    const author = 'Your Name <your.email@example.com>';
    const committer = 'Your Name <your.email@example.com>';
    
    const commitContent = [
      `tree ${treeSha}`,
      `parent ${parentSha}`,
      `author ${author} ${timestamp} ${timezoneStr}`,
      `committer ${committer} ${timestamp} ${timezoneStr}`,
      
      message
    ].join('\n');

    // 计算哈希值
    const header = `commit ${commitContent.length}`;
    const gitObject = `${header}\0${commitContent}`;
    const hash = crypto.createHash('sha1').update(gitObject).digest('hex');

    // 写入对象到.git/objects
    writeGitObject(hash, gitObject);

    return hash;
  } catch (error) {
    throw new Error(`创建commit对象失败: ${error.message}`);
  }
}

/**
 * 检查Git对象是否存在
 * @param {string} hash - 对象的SHA1
 * @returns {boolean} 对象是否存在
 */
function objectExists(hash) {
  try {
    const objectsDir = path.join(process.cwd(), '.git', 'objects');
    const objectPath = path.join(objectsDir, hash.substring(0, 2), hash.substring(2));
    return fs.existsSync(objectPath);
  } catch (error) {
    return false;
  }
}

/**
 * 将Git对象写入.git/objects目录
 * @param {string} hash - 对象的SHA1哈希值
 * @param {string} content - 对象内容
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

module.exports = { commitTreeCommand }; 