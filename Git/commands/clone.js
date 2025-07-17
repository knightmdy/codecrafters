const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

/**
 * 克隆Git仓库
 * @param [object Object]string} repoUrl - 仓库URL
 * @param {string} targetDir - 目标目录（可选）
 */
function cloneCommand(repoUrl, targetDir = null) {
  try {
    // 解析仓库URL
    const { hostname, pathname, protocol } = parseRepoUrl(repoUrl);
    
    // 确定目标目录
    const finalTargetDir = targetDir || extractRepoName(pathname);
    
    // 创建目标目录
    if (!fs.existsSync(finalTargetDir)) {
      fs.mkdirSync(finalTargetDir, { recursive: true });
    }
    
    // 初始化Git仓库
    initGitRepository(finalTargetDir);
    
    // 获取远程引用信息
    const refs = getRemoteRefs(hostname, pathname, protocol);
    
    // 获取默认分支
    const defaultBranch = refs.HEAD || 'master';
    const latestCommit = refs[defaultBranch];
    
    if (!latestCommit) {
      throw new Error('无法获取最新的commit信息');
    }
    
    // 下载并写入commit对象
    const commitData = downloadObject(hostname, pathname, latestCommit, protocol);
    writeGitObject(finalTargetDir, latestCommit, commitData);
    
    // 解析commit对象并下载tree
    const commitContent = parseCommitObject(commitData);
    downloadTreeRecursively(finalTargetDir, hostname, pathname, commitContent.tree, protocol);
    
    // 更新HEAD引用
    updateHeadRef(finalTargetDir, defaultBranch, latestCommit);
    
    console.log(`已成功克隆仓库到 ${finalTargetDir}`);
    console.log(`最新commit: ${latestCommit}`);
    
  } catch (error) {
    throw new Error(`克隆仓库失败: ${error.message}`);
  }
}

/**
 * 解析仓库URL
 * @param {string} url - 仓库URL
 * @returns {Object} 解析结果
 */
function parseRepoUrl(url) {
  // 移除.git后缀
  const cleanUrl = url.replace(/\.git$/, '');
  
  // 解析协议和路径
  let protocol = 'https';
  let pathname = cleanUrl;
  
  if (cleanUrl.startsWith('http://')) {
    protocol = 'http';
    pathname = cleanUrl.substring(7);
  } else if (cleanUrl.startsWith('https://')) {
    protocol = 'https';
    pathname = cleanUrl.substring(8);
  }
  
  // 提取主机名和路径
  const slashIndex = pathname.indexOf('/');
  if (slashIndex === -1) {
    throw new Error('无效的仓库URL格式');
  }
  
  const hostname = pathname.substring(0, slashIndex);
  const repoPath = pathname.substring(slashIndex);
  
  return { hostname, pathname: repoPath, protocol };
}

/**
 * 从路径中提取仓库名称
 * @param[object Object]string} pathname - 路径
 * @returns {string} 仓库名称
 */
function extractRepoName(pathname) {
  const parts = pathname.split('/');
  return parts[parts.length - 1];
}

/**
 * 初始化Git仓库
 * @param {string} targetDir - 目标目录
 */
function initGitRepository(targetDir) {
  const gitDir = path.join(targetDir, '.git');
  
  // 创建.git目录结构
  const subdirs = ['objects', 'refs', 'refs/heads', 'refs/tags'];
  subdirs.forEach(subdir => {
    const subdirPath = path.join(gitDir, subdir);
    if (!fs.existsSync(subdirPath)) {
      fs.mkdirSync(subdirPath, { recursive: true });
    }
  });
}

/**
 * 获取远程仓库的引用信息
 * @param[object Object]string} hostname - 主机名
 * @param[object Object]string} pathname - 路径
 * @param[object Object]string} protocol - 协议
 * @returns {Object} 引用信息
 */
function getRemoteRefs(hostname, pathname, protocol) {
  const refsUrl = `${protocol}://${hostname}${pathname}/info/refs?service=git-upload-pack`;
  
  return new Promise((resolve, reject) => {
    const client = protocol === 'https' ? https : http;
    
    const req = client.get(refsUrl, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const refs = parseRefs(data);
          resolve(refs);
        } catch (error) {
          reject(error);
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

/**
 * 解析引用信息
 * @param {string} data - 原始数据
 * @returns {Object} 解析后的引用
 */
function parseRefs(data) {
  const refs = {};
  const lines = data.split('\n');
  
  for (const line of lines) {
    if (line.startsWith('refs/')) {
      const [hash, ref] = line.split('\t');
      if (hash && ref) {
        refs[ref] = hash;
      }
    }
  }
  
  return refs;
}

/**
 * 下载Git对象
 * @param[object Object]string} hostname - 主机名
 * @param[object Object]string} pathname - 路径
 * @param {string} hash - 对象哈希
 * @param[object Object]string} protocol - 协议
 * @returns {Buffer} 对象数据
 */
function downloadObject(hostname, pathname, hash, protocol) {
  const objectUrl = `${protocol}://${hostname}${pathname}/objects/${hash.substring(0, 2)}/${hash.substring(2)}`;
  
  return new Promise((resolve, reject) => {
    const client = protocol === 'https' ? https : http;
    
    const req = client.get(objectUrl, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`下载对象失败: ${res.statusCode}`));
        return;
      }
      
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer);
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

/**
 * 写入Git对象
 * @param {string} targetDir - 目标目录
 * @param {string} hash - 对象哈希
 * @param {Buffer} data - 对象数据
 */
function writeGitObject(targetDir, hash, data) {
  const objectsDir = path.join(targetDir, '.git', 'objects');
  const subdir = hash.substring(0, 2);
  const filename = hash.substring(2);
  
  const subdirPath = path.join(objectsDir, subdir);
  if (!fs.existsSync(subdirPath)) {
    fs.mkdirSync(subdirPath, { recursive: true });
  }
  
  const objectPath = path.join(subdirPath, filename);
  fs.writeFileSync(objectPath, data);
}

/**
 * 解析commit对象
 * @param {Buffer} data - commit对象数据
 * @returns {Object} 解析结果
 */
function parseCommitObject(data) {
  const content = data.toString('utf8');
  const nullIndex = content.indexOf('\0');
  if (nullIndex === -1) {
    throw new Error('无效的commit对象格式');
  }
  
  const body = content.substring(nullIndex + 1);
  const lines = body.split('\n');
  
  const result = {};
  for (const line of lines) {
    if (line.startsWith('tree ')) {
      result.tree = line.substring(5);
    } else if (line.startsWith('parent ')) {
      if (!result.parents) result.parents = [];
      result.parents.push(line.substring(7));
    } else if (line.startsWith('author ') || line.startsWith('committer ')) {
      // 跳过author和committer行
    } else if (line.trim() && !line.startsWith('tree ') && !line.startsWith('parent ')) {
      result.message = line.trim();
      break;
    }
  }
  
  return result;
}

/**
 * 递归下载tree对象
 * @param {string} targetDir - 目标目录
 * @param[object Object]string} hostname - 主机名
 * @param[object Object]string} pathname - 路径
 * @param[object Object]string} treeHash - tree哈希
 * @param[object Object]string} protocol - 协议
 */
function downloadTreeRecursively(targetDir, hostname, pathname, treeHash, protocol) {
  const treeData = downloadObject(hostname, pathname, treeHash, protocol);
  writeGitObject(targetDir, treeHash, treeData);
  
  const entries = parseTreeEntries(treeData);
  
  for (const entry of entries) {
    if (entry.type === 'tree') {
      downloadTreeRecursively(targetDir, hostname, pathname, entry.hash, protocol);
    } else if (entry.type === 'blob') {
      const blobData = downloadObject(hostname, pathname, entry.hash, protocol);
      writeGitObject(targetDir, entry.hash, blobData);
    }
  }
}

/**
 * 解析tree条目
 * @param {Buffer} data - tree对象数据
 * @returns {Array} 条目数组
 */
function parseTreeEntries(data) {
  const content = data.toString('utf8');
  const nullIndex = content.indexOf('\0');
  if (nullIndex === -1) {
    throw new Error('无效的tree对象格式');
  }
  
  const body = content.substring(nullIndex + 1);
  const entries = [];
  let offset = 0;
  
  while (offset < body.length) {
    const modeEnd = body.indexOf(' ', offset);
    if (modeEnd === -1) break;
    
    const nameEnd = body.indexOf('\0', modeEnd);
    if (nameEnd === -1) break;
    
    const mode = body.substring(offset, modeEnd);
    const name = body.substring(modeEnd + 1, nameEnd);
    
    const hashStart = nameEnd + 1;
    const hashEnd = hashStart + 20;
    if (hashEnd > body.length) break;
    
    const hashBuffer = body.substring(hashStart, hashEnd);
    const hash = hashBuffer.toString('hex');
    
    let type = 'blob';
    if (mode.startsWith('4000')) {
      type = 'tree';
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

/**
 * 更新HEAD引用
 * @param {string} targetDir - 目标目录
 * @param {string} branch - 分支名
 * @param {string} commitHash - commit哈希
 */
function updateHeadRef(targetDir, branch, commitHash) {
  const headPath = path.join(targetDir, '.git', 'HEAD');
  const refPath = path.join(targetDir, '.git', 'refs', 'heads', branch);
  
  fs.writeFileSync(headPath, `ref: refs/heads/${branch}\n`);
  fs.writeFileSync(refPath, `${commitHash}\n`);
}

module.exports = { cloneCommand }; 