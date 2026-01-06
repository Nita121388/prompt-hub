import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    // 某些环境（例如 Electron/CLI 工具链）会设置 ELECTRON_RUN_AS_NODE=1，
    // 会导致 VS Code 的 Code.exe 以 Node 模式启动，从而不识别 VS Code 的启动参数。
    // 运行扩展测试前必须清理该变量。
    delete process.env.ELECTRON_RUN_AS_NODE;
    delete process.env.VSCODE_DEV;

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
