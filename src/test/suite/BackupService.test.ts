import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { BackupService } from '../../services/BackupService';
import { ConfigurationService } from '../../services/ConfigurationService';

suite('BackupService Test Suite', () => {
  class MockConfigurationService {
    constructor(private readonly storagePath: string) {}

    getStoragePath(): string {
      return this.storagePath;
    }

    get<T>(_key: string, defaultValue: T): T {
      return defaultValue;
    }
  }

  const makeTempDir = async (): Promise<string> => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'otter-backup-test-'));
    return root;
  };

  test('should create backup snapshot and ignore existing backup dirs', async () => {
    const root = await makeTempDir();
    const storagePath = path.join(root, 'storage');
    await fs.mkdir(storagePath, { recursive: true });

    // 模拟存储内容
    await fs.writeFile(
      path.join(storagePath, 'prompts.json'),
      JSON.stringify({ version: '1.0.0', prompts: [], usageLogs: [] }, null, 2),
      'utf-8'
    );
    await fs.writeFile(path.join(storagePath, 'notes.txt'), 'hello', 'utf-8');
    await fs.mkdir(path.join(storagePath, 'assets'), { recursive: true });
    await fs.writeFile(path.join(storagePath, 'assets', 'a.txt'), 'asset', 'utf-8');

    // 已有备份目录（应被跳过）
    const oldBackup = path.join(storagePath, '.otter-backup-20000101-000000');
    await fs.mkdir(oldBackup, { recursive: true });
    await fs.writeFile(path.join(oldBackup, 'should-not-copy.txt'), 'x', 'utf-8');

    const config = new MockConfigurationService(storagePath) as unknown as ConfigurationService;
    const service = new BackupService(config);

    const backup = await service.createBackup();

    // 备份目录应存在且包含关键文件
    const backupPrompts = await fs.readFile(path.join(backup.backupDir, 'prompts.json'), 'utf-8');
    assert.ok(backupPrompts.includes('"prompts"'));
    assert.strictEqual(await fs.readFile(path.join(backup.backupDir, 'notes.txt'), 'utf-8'), 'hello');
    assert.strictEqual(
      await fs.readFile(path.join(backup.backupDir, 'assets', 'a.txt'), 'utf-8'),
      'asset'
    );

    // 不应把旧备份目录一起拷贝进来
    await assert.rejects(
      fs.readFile(path.join(backup.backupDir, '.otter-backup-20000101-000000', 'should-not-copy.txt'), 'utf-8')
    );
  });
});

