/**
 * Git命令行工具主程序
 * 实现基本的Git操作功能，包括初始化、对象操作、提交和克隆
 * 
 * 支持的命令：
 * - init: 初始化Git仓库
 * - cat-file: 读取Git对象内容
 * - hash-object: 创建blob对象
 * - ls-tree: 列出tree对象内容
 * - write-tree: 创建tree对象
 * - commit-tree: 创建commit对象
 * - clone: 克隆远程仓库
 */

// 导入所有命令模块
const { initCommand } = require("./commands/init");
const { catFileCommand } = require("./commands/catFile");
const { hashObjectCommand } = require("./commands/hashObject");
const { lsTreeCommand } = require("./commands/lsTree");
const { writeTreeCommand } = require("./commands/writeTree");
const { commitTreeCommand } = require("./commands/commitTree");
const { cloneCommand } = require("./commands/clone");

// 调试日志输出
console.error("Git命令行工具启动，日志信息将显示在这里！");

/**
 * 主程序入口
 * 解析命令行参数并执行相应的Git命令
 */
function main() {
  // 获取要执行的命令
  const command = process.argv[2];

  // 验证命令参数
  if (!command) {
    console.error("错误: 请指定要执行的Git命令");
    console.error("支持的命令: init, cat-file, hash-object, ls-tree, write-tree, commit-tree, clone");
    process.exit(1);
  }

  try {
    // 根据命令执行相应的操作
    switch (command) {
      case "init":
        executeInitCommand();
        break;
      
      case "cat-file":
        executeCatFileCommand();
        break;
      
      case "hash-object":
        executeHashObjectCommand();
        break;
      
      case "ls-tree":
        executeLsTreeCommand();
        break;
      
      case "write-tree":
        executeWriteTreeCommand();
        break;
      
      case "commit-tree":
        executeCommitTreeCommand();
        break;
      
      case "clone":
        executeCloneCommand();
        break;
      
      default:
        throw new Error(`未知命令: ${command}`);
    }
  } catch (error) {
    // 统一的错误处理
    console.error(`执行命令 '${command}' 时发生错误: ${error.message}`);
    process.exit(1);
  }
}

/**
 * 执行初始化命令
 */
function executeInitCommand() {
  initCommand();
}

/**
 * 执行cat-file命令
 * 格式: cat-file -p <object_hash>
 */
function executeCatFileCommand() {
  // 验证参数格式
  if (process.argv[3] !== "-p" || process.argv.length <= 4) {
    throw new Error("用法: cat-file -p <object_hash>");
  }

  const objectHash = process.argv[4];
  if (!objectHash) {
    throw new Error("请提供对象哈希值");
  }

  catFileCommand(objectHash);
}

/**
 * 执行hash-object命令
 * 格式: hash-object [-w] <file_path>
 */
function executeHashObjectCommand() {
  let writeObject = false;
  let filePathIndex = 3;

  // 检查是否包含-w选项
  if (process.argv[3] === "-w") {
    writeObject = true;
    filePathIndex = 4;
  }

  const filePath = process.argv[filePathIndex];
  if (!filePath) {
    throw new Error("用法: hash-object [-w] <file_path>");
  }

  hashObjectCommand(filePath, writeObject);
}

/**
 * 执行ls-tree命令
 * 格式: ls-tree [--name-only] <tree_hash>
 */
function executeLsTreeCommand() {
  let nameOnly = false;
  let treeHashIndex = 3;
  // 检查是否包含--name-only选项
  if (process.argv[3] === "--name-only") {
    nameOnly = true;
    treeHashIndex = 4;
  }

  const treeHash = process.argv[treeHashIndex];
  if (!treeHash) {
    throw new Error("用法: ls-tree [--name-only] <tree_hash>");
  }

  lsTreeCommand(treeHash, nameOnly);
}

/**
 * 执行write-tree命令
 * 格式: write-tree
 */
function executeWriteTreeCommand() {
  // write-tree命令不需要额外参数
  const treeSha = writeTreeCommand();
  console.log(treeSha);
}

/**
 * 执行commit-tree命令
 * 格式: commit-tree <tree_sha> -p <commit_sha> -m <message>
 */
function executeCommitTreeCommand() {
  const treeShaArg = process.argv[3];
  const parentFlagIndex = process.argv.indexOf("-p");
  const messageFlagIndex = process.argv.indexOf("-m");

  // 验证参数完整性
  if (!treeShaArg || parentFlagIndex === -1 || messageFlagIndex === -1 ||
      parentFlagIndex + 1 >= process.argv.length || messageFlagIndex + 1 >= process.argv.length) {
    throw new Error("用法: commit-tree <tree_sha> -p <commit_sha> -m <message>");
  }

  const parentShaArg = process.argv[parentFlagIndex + 1];
  // 合并消息部分（支持包含空格的提交消息）
  const messageArg = process.argv.slice(messageFlagIndex + 1).join(' ');

  const commitSha = commitTreeCommand(treeShaArg, parentShaArg, messageArg);
  console.log(commitSha);
}

/**
 * 执行clone命令
 * 格式: clone <repository_url> [directory]
 */
function executeCloneCommand() {
  const repoUrl = process.argv[3];
  const targetDir = process.argv[4]; // 可选的目标目录

  if (!repoUrl) {
    throw new Error("用法: clone <repository_url> [directory]");
  }

  cloneCommand(repoUrl, targetDir);
}

// 启动主程序
if (require.main === module) {
  main();
}

module.exports = { main };