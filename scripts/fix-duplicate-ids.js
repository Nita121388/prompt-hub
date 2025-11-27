#!/usr/bin/env node
/**
 * 修复Markdown文件中的重复ID标记
 *
 * 问题: 由于之前的bug，每次保存都会追加新的ID标记
 * 解决: 扫描所有Markdown文件，保留第一个ID，删除重复的
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 存储路径（可以从配置读取，这里使用默认值）
const STORAGE_PATH = path.join(os.homedir(), '.prompt-hub');

/**
 * 修复单个Markdown文件
 */
function fixMarkdownFile(filePath) {
  console.log(`\n处理文件: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // 查找所有ID标记行
  const idLines = [];
  lines.forEach((line, index) => {
    const match = line.match(/<!--\s*PromptHub:id=([\w-]+)\s*-->/i);
    if (match) {
      idLines.push({
        lineIndex: index,
        id: match[1],
        line: line
      });
    }
  });

  if (idLines.length === 0) {
    console.log('  ❌ 未找到ID标记');
    return false;
  }

  if (idLines.length === 1) {
    console.log('  ✅ 只有一个ID标记，无需修复');
    return false;
  }

  console.log(`  ⚠️  找到 ${idLines.length} 个ID标记:`);
  idLines.forEach((item, i) => {
    console.log(`    ${i + 1}. 第${item.lineIndex + 1}行: ${item.id}`);
  });

  // 保留第一个ID，删除其他所有ID行
  const firstId = idLines[0];
  const toRemove = idLines.slice(1).map(item => item.lineIndex);

  console.log(`  🔧 保留第一个ID: ${firstId.id}`);
  console.log(`  🗑️  删除 ${toRemove.length} 个重复ID`);

  // 重建文件内容
  const newLines = lines.filter((line, index) => !toRemove.includes(index));
  const newContent = newLines.join('\n');

  // 写回文件
  fs.writeFileSync(filePath, newContent, 'utf-8');
  console.log('  ✅ 文件已修复');

  return true;
}

/**
 * 扫描目录中的所有Markdown文件
 */
function scanDirectory(dir) {
  console.log(`\n扫描目录: ${dir}\n`);

  if (!fs.existsSync(dir)) {
    console.error(`❌ 目录不存在: ${dir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dir);
  let fixedCount = 0;
  let totalFiles = 0;

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isFile() && file.toLowerCase().endsWith('.md')) {
      totalFiles++;
      if (fixMarkdownFile(filePath)) {
        fixedCount++;
      }
    }
  });

  console.log(`\n${'='.repeat(50)}`);
  console.log(`扫描完成！`);
  console.log(`  总计: ${totalFiles} 个Markdown文件`);
  console.log(`  修复: ${fixedCount} 个文件`);
  console.log(`  跳过: ${totalFiles - fixedCount} 个文件（无需修复）`);
  console.log('='.repeat(50));
}

// 主程序
const targetDir = process.argv[2] || STORAGE_PATH;

console.log('='.repeat(50));
console.log('修复Markdown文件中的重复ID标记');
console.log('='.repeat(50));

scanDirectory(targetDir);

console.log('\n✨ 完成！');
