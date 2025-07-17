const fs = require('fs');
const path = require('path');

/**
 * 初始化Git仓库
 * 创建.git目录和必要的子目录结构
 */
function initCommand() {
  try {
    // 创建.git目录
    const gitDir = path.join(process.cwd(), '.git');
    if (!fs.existsSync(gitDir)) {
      fs.mkdirSync(gitDir);
    }

    // 创建必要的子目录
    const subdirs = ['objects', 'refs', 'refs/heads', 'refs/tags'];
    subdirs.forEach(subdir => {
      const subdirPath = path.join(gitDir, subdir);
      if (!fs.existsSync(subdirPath)) {
        fs.mkdirSync(subdirPath, { recursive: true });
      }
    });

    // 创建HEAD文件，指向master分支
    const headPath = path.join(gitDir, 'HEAD');
    if (!fs.existsSync(headPath)) {
      fs.writeFileSync(headPath, 'ref: refs/heads/master\n');
    }

    console.log('Initialized git repository');
  } catch (error) {
    throw new Error(`初始化Git仓库失败: ${error.message}`);
  }
}

module.exports = { initCommand }; 
