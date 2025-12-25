import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { MarkdownMirrorService } from '../../services/MarkdownMirrorService';
import { Prompt } from '../../types/Prompt';

suite('MarkdownMirrorService Test Suite', () => {
  class InMemoryStorage {
    private prompts: Prompt[] = [];

    list(): Prompt[] {
      return [...this.prompts];
    }

    getById(id: string): Prompt | undefined {
      return this.prompts.find((p) => p.id === id);
    }

    async replaceId(oldId: string, newId: string): Promise<void> {
      if (oldId === newId) return;
      if (this.getById(newId)) throw new Error(`ID "${newId}" 已存在`);
      const idx = this.prompts.findIndex((p) => p.id === oldId);
      if (idx === -1) throw new Error(`ID "${oldId}" 不存在`);
      this.prompts[idx] = { ...this.prompts[idx], id: newId };
    }

    async add(prompt: Prompt): Promise<void> {
      if (this.prompts.some((p) => p.id === prompt.id)) {
        throw new Error(`Prompt ID "${prompt.id}" 已存在`);
      }
      if (this.prompts.some((p) => p.name === prompt.name)) {
        throw new Error(`Prompt 名称 "${prompt.name}" 已存在`);
      }
      this.prompts.push(prompt);
    }

    async update(prompt: Prompt): Promise<void> {
      const idx = this.prompts.findIndex((p) => p.id === prompt.id);
      if (idx === -1) throw new Error(`Prompt ID "${prompt.id}" 不存在`);
      if (this.prompts.some((p) => p.id !== prompt.id && p.name === prompt.name)) {
        throw new Error(`Prompt 名称 "${prompt.name}" 已存在`);
      }
      this.prompts[idx] = prompt;
    }
  }

  class MockConfig {
    constructor(private readonly storagePath: string) {}

    getStoragePath(): string {
      return this.storagePath;
    }

    get<T>(key: string, defaultValue: T): T {
      if (key === 'markdown.enableMirror') return true as T;
      return defaultValue;
    }
  }

  test('should create prompt using id from frontmatter', async () => {
    const storagePath = path.join('test', 'prompt-storage');
    const filePath = path.join(storagePath, 'custom.md');

    const storage = new InMemoryStorage() as any;
    const config = new MockConfig(storagePath) as any;
    const service = new MarkdownMirrorService(storage, config);

    const idInFile = 'test-frontmatter-id';
    const text = ['---', `id: ${idInFile}`, 'type: prompt', '---', '', '# 我的标题', '', '正文'].join('\n');

    const doc: vscode.TextDocument = {
      uri: vscode.Uri.file(filePath),
      fileName: filePath,
      languageId: 'markdown',
      getText: () => text,
    } as any;

    await (service as any).onDidSave(doc);

    const created = storage.getById(idInFile);
    assert.ok(created, '应使用 frontmatter 的 id 创建 Prompt');
    assert.strictEqual(created?.name, '我的标题');
    assert.strictEqual(created?.sourceFile, filePath);
  });

  test('should repair id mismatch by sourceFile and then update', async () => {
    const storagePath = path.join('test', 'prompt-storage');
    const filePath = path.join(storagePath, 'custom.md');

    const storage = new InMemoryStorage() as any;
    const config = new MockConfig(storagePath) as any;
    const service = new MarkdownMirrorService(storage, config);

    await storage.add({
      id: 'old-id',
      name: '旧标题',
      emoji: undefined,
      content: '旧正文',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceFile: filePath,
      tags: [],
    });

    const idInFile = 'new-id';
    const text = ['---', `id: ${idInFile}`, 'type: prompt', '---', '', '# 新标题', '', '新正文'].join('\n');

    const doc: vscode.TextDocument = {
      uri: vscode.Uri.file(filePath),
      fileName: filePath,
      languageId: 'markdown',
      getText: () => text,
    } as any;

    await (service as any).onDidSave(doc);

    assert.ok(!storage.getById('old-id'), '旧ID应被替换');
    const updated = storage.getById(idInFile);
    assert.ok(updated, '应修复为文件内ID并更新同一条 Prompt');
    assert.strictEqual(updated?.name, '新标题');
    assert.strictEqual(updated?.content, '新正文');
  });
});

