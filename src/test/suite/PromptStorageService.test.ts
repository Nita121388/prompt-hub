import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PromptStorageService } from '../../services/PromptStorageService';
import { ConfigurationService } from '../../services/ConfigurationService';
import { Prompt } from '../../types/Prompt';

suite('PromptStorageService Test Suite', () => {
  let storageService: PromptStorageService;
  let mockConfigService: any;
  let testStoragePath: string;
  let testStorageFile: string;

  // 创建 mock ConfigurationService
  class MockConfigurationService {
    private config: Map<string, any> = new Map([
      ['storage.autoCreate', true],
    ]);

    get<T>(key: string, defaultValue: T): T {
      return this.config.has(key) ? this.config.get(key) : defaultValue;
    }

    getStoragePath(): string {
      return testStoragePath;
    }
  }

  // 在测试前设置
  setup(async () => {
    // 创建临时测试目录
    const tmpDir = os.tmpdir();
    testStoragePath = path.join(tmpDir, `prompt-hub-test-${Date.now()}`);
    testStorageFile = path.join(testStoragePath, 'prompts.json');

    mockConfigService = new MockConfigurationService();
    storageService = new PromptStorageService(mockConfigService as any);
  });

  // 测试后清理
  teardown(async () => {
    try {
      // 删除测试目录
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  suite('initialize', () => {
    test('should create storage directory if not exists', async () => {
      await storageService.initialize();

      const stats = await fs.stat(testStoragePath);
      assert.ok(stats.isDirectory(), 'Storage directory should be created');
    });

    test('should create empty prompts.json if not exists', async () => {
      await storageService.initialize();

      const content = await fs.readFile(testStorageFile, 'utf-8');
      const data = JSON.parse(content);

      assert.strictEqual(data.version, '1.0.0');
      assert.ok(Array.isArray(data.prompts));
      assert.strictEqual(data.prompts.length, 0);
    });

    test('should import markdown prompts under storage path', async () => {
      await fs.mkdir(testStoragePath, { recursive: true });
      const mdPath = path.join(testStoragePath, 'import-me.md');
      const mdContent = [
        '---',
        'id: md-1',
        'type: prompt',
        'tags: [test]',
        '---',
        '',
        '# 测试导入',
        '',
        '这里是正文内容',
        '',
      ].join('\n');
      await fs.writeFile(mdPath, mdContent, 'utf-8');

      await storageService.initialize();
      const prompts = storageService.list();

      assert.strictEqual(prompts.length, 1);
      assert.strictEqual(prompts[0].id, 'md-1');
      assert.strictEqual(prompts[0].name, '测试导入');
      assert.strictEqual(prompts[0].sourceFile, mdPath);
    });

    test('should load existing prompts.json', async () => {
      // 先初始化
      await storageService.initialize();

      // 添加一个 prompt
      const prompt: Prompt = {
        id: 'test-1',
        name: 'Test Prompt',
        content: 'Test content',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storageService.add(prompt);

      // 创建新的服务实例来测试加载
      const newService = new PromptStorageService(mockConfigService as any);
      await newService.initialize();

      const prompts = newService.list();
      assert.strictEqual(prompts.length, 1);
      assert.strictEqual(prompts[0].id, 'test-1');
    });

    test('should import new markdown files without duplicating existing prompts', async () => {
      await storageService.initialize();

      const prompt: Prompt = {
        id: 'json-1',
        name: 'From JSON',
        content: 'json prompt',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await storageService.add(prompt);

      const mdPath = path.join(testStoragePath, 'another.md');
      const mdContent = ['# 另一个', '', '这是新增的 Markdown Prompt', ''].join('\n');
      await fs.writeFile(mdPath, mdContent, 'utf-8');

      const newService = new PromptStorageService(mockConfigService as any);
      await newService.initialize();

      const prompts = newService.list();
      assert.strictEqual(prompts.length, 2);
      assert.ok(prompts.find((p) => p.sourceFile === mdPath));
      assert.ok(prompts.find((p) => p.id === 'json-1'));
    });
  });

  suite('CRUD operations', () => {
    setup(async () => {
      await storageService.initialize();
    });

    test('should add new prompt', async () => {
      const prompt: Prompt = {
        id: 'test-1',
        name: 'Test Prompt',
        emoji: '📝',
        content: 'Test content',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: ['test', 'demo'],
      };

      await storageService.add(prompt);

      const prompts = storageService.list();
      assert.strictEqual(prompts.length, 1);
      assert.strictEqual(prompts[0].id, 'test-1');
      assert.strictEqual(prompts[0].name, 'Test Prompt');
    });

    test('should reject duplicate names', async () => {
      const prompt1: Prompt = {
        id: 'test-1',
        name: 'Duplicate Name',
        content: 'Content 1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const prompt2: Prompt = {
        id: 'test-2',
        name: 'Duplicate Name',
        content: 'Content 2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storageService.add(prompt1);

      await assert.rejects(
        async () => await storageService.add(prompt2),
        /已存在/,
        'Should reject duplicate names'
      );
    });

    test('should get prompt by id', async () => {
      const prompt: Prompt = {
        id: 'test-1',
        name: 'Test Prompt',
        content: 'Test content',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storageService.add(prompt);

      const retrieved = storageService.getById('test-1');
      assert.ok(retrieved);
      assert.strictEqual(retrieved?.id, 'test-1');
      assert.strictEqual(retrieved?.name, 'Test Prompt');
    });

    test('should return undefined for non-existent id', () => {
      const retrieved = storageService.getById('non-existent');
      assert.strictEqual(retrieved, undefined);
    });

    test('should update existing prompt', async () => {
      const prompt: Prompt = {
        id: 'test-1',
        name: 'Original Name',
        content: 'Original content',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storageService.add(prompt);

      const updated: Prompt = {
        ...prompt,
        name: 'Updated Name',
        content: 'Updated content',
      };

      await storageService.update(updated);

      const retrieved = storageService.getById('test-1');
      assert.strictEqual(retrieved?.name, 'Updated Name');
      assert.strictEqual(retrieved?.content, 'Updated content');
    });

    test('should reject update with non-existent id', async () => {
      const prompt: Prompt = {
        id: 'non-existent',
        name: 'Test',
        content: 'Content',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await assert.rejects(
        async () => await storageService.update(prompt),
        /不存在/,
        'Should reject update with non-existent id'
      );
    });

    test('should remove prompt', async () => {
      const prompt: Prompt = {
        id: 'test-1',
        name: 'Test Prompt',
        content: 'Test content',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storageService.add(prompt);
      assert.strictEqual(storageService.list().length, 1);

      const removed = await storageService.remove('test-1');
      assert.ok(removed);
      assert.strictEqual(removed?.id, 'test-1');
      assert.strictEqual(storageService.list().length, 0);
    });

    test('should return undefined when removing non-existent prompt', async () => {
      const removed = await storageService.remove('non-existent');
      assert.strictEqual(removed, undefined);
    });
  });

  suite('search', () => {
    setup(async () => {
      await storageService.initialize();

      // 添加测试数据
      const prompts: Prompt[] = [
        {
          id: '1',
          name: 'JavaScript Tutorial',
          content: 'Learn JavaScript basics',
          tags: ['programming', 'javascript'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: '2',
          name: 'Python Guide',
          content: 'Python programming guide',
          tags: ['programming', 'python'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: '3',
          name: 'React Components',
          content: 'Building React components with JavaScript',
          tags: ['react', 'javascript'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      for (const prompt of prompts) {
        await storageService.add(prompt);
      }
    });

    test('should search by name', () => {
      const results = storageService.search('JavaScript');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].name, 'JavaScript Tutorial');
    });

    test('should search by content', () => {
      const results = storageService.search('guide');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].name, 'Python Guide');
    });

    test('should search by tags', () => {
      const results = storageService.search('python');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].name, 'Python Guide');
    });

    test('should be case-insensitive', () => {
      const results = storageService.search('JAVASCRIPT');
      assert.ok(results.length > 0);
    });

    test('should return empty array for no matches', () => {
      const results = storageService.search('nonexistent');
      assert.strictEqual(results.length, 0);
    });

    test('should find multiple matches', () => {
      const results = storageService.search('javascript');
      assert.strictEqual(results.length, 2); // JavaScript Tutorial and React Components
    });
  });

  suite('list', () => {
    test('should return empty array initially', async () => {
      await storageService.initialize();
      const prompts = storageService.list();
      assert.ok(Array.isArray(prompts));
      assert.strictEqual(prompts.length, 0);
    });

    test('should return copy of prompts array', async () => {
      await storageService.initialize();

      const prompt: Prompt = {
        id: 'test-1',
        name: 'Test',
        content: 'Content',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storageService.add(prompt);

      const list1 = storageService.list();
      const list2 = storageService.list();

      assert.notStrictEqual(list1, list2, 'Should return different array instances');
      assert.deepStrictEqual(list1, list2, 'Should have same content');
    });
  });

  suite('events', () => {
    test('should fire change event on add', async () => {
      await storageService.initialize();

      let eventFired = false;
      storageService.onDidChangePrompts(() => {
        eventFired = true;
      });

      const prompt: Prompt = {
        id: 'test-1',
        name: 'Test',
        content: 'Content',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storageService.add(prompt);

      // 给事件触发一点时间
      await new Promise(resolve => setTimeout(resolve, 10));

      assert.ok(eventFired, 'Change event should be fired');
    });
  });
});
