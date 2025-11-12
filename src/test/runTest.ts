import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    // 扩展开发路径
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');

    // 测试运行路径
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // 下载 VS Code，解压并运行测试
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        '--disable-extensions', // 禁用其他扩展
        '--no-sandbox',
      ],
    });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();
