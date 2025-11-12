import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
  // 创建 Mocha 测试实例
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    timeout: 10000, // 10秒超时
  });

  const testsRoot = path.resolve(__dirname, '..');

  // 查找所有测试文件
  const files = await glob('**/**.test.js', { cwd: testsRoot });

  // 添加测试文件到 Mocha
  files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

  return new Promise((resolve, reject) => {
    try {
      // 运行测试
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.error(err);
      reject(err);
    }
  });
}
