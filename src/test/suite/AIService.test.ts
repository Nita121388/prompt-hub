import * as assert from 'assert';
import * as vscode from 'vscode';
import { AIService } from '../../services/AIService';

suite('AIService 测试', () => {
  const originalFetch = (globalThis as any).fetch;
  const originalShowInputBox = vscode.window.showInputBox;
  const originalShowWarningMessage = vscode.window.showWarningMessage;

  teardown(() => {
    (globalThis as any).fetch = originalFetch;
    (vscode.window as any).showInputBox = originalShowInputBox;
    (vscode.window as any).showWarningMessage = originalShowWarningMessage;
  });

  test('应从旧版 apiKey 读取并迁移到 provider 分桶 key', async () => {
    const secrets = new Map<string, string>([['ai.apiKey', 'legacy-key']]);
    const stored: Array<{ key: string; value: string }> = [];

    const mockConfigService: any = {
      get: (key: string, defaultValue?: any) => {
        if (key === 'ai.provider') return 'openai';
        if (key === 'ai.baseUrl') return 'https://api.openai.com/v1';
        if (key === 'ai.model') return ''; // 走默认模型
        return defaultValue;
      },
      getSecret: async (key: string) => secrets.get(key),
      storeSecret: async (key: string, value: string) => {
        secrets.set(key, value);
        stored.push({ key, value });
      },
    };

    let calledUrl = '';
    (globalThis as any).fetch = async (url: string) => {
      calledUrl = url;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          choices: [{ message: { content: '{"name":"测试标题","emoji":"🔥"}' } }],
        }),
      };
    };

    // 避免测试弹窗
    (vscode.window as any).showInputBox = async () => {
      throw new Error('测试不应触发输入框');
    };
    (vscode.window as any).showWarningMessage = async () => undefined;

    const ai = new AIService(mockConfigService);
    const meta = await ai.generateMeta('这是一个测试内容');

    assert.deepStrictEqual(meta, { name: '测试标题', emoji: '🔥' });
    assert.ok(calledUrl.includes('/chat/completions'), 'URL 应包含 /chat/completions');
    assert.ok(
      stored.some((s) => s.key === 'ai.apiKey.openai' && s.value === 'legacy-key'),
      '应将旧 key 迁移写入 ai.apiKey.openai'
    );
  });

  test('批量生成元信息应按 id 返回结果', async () => {
    const secrets = new Map<string, string>([['ai.apiKey.openai', 'key']]);

    const mockConfigService: any = {
      get: (key: string, defaultValue?: any) => {
        if (key === 'ai.provider') return 'openai';
        if (key === 'ai.baseUrl') return 'https://api.openai.com/v1';
        if (key === 'ai.model') return '';
        if (key === 'ai.batchDelayMs') return 0;
        return defaultValue;
      },
      getSecret: async (key: string) => secrets.get(key),
      storeSecret: async (key: string, value: string) => {
        secrets.set(key, value);
      },
    };

    let fetchCalls = 0;
    (globalThis as any).fetch = async () => {
      fetchCalls += 1;
      const content = fetchCalls === 1 ? '{"name":"标题A","emoji":"🅰️"}' : '{"name":"标题B","emoji":"🅱️"}';
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          choices: [{ message: { content } }],
        }),
      };
    };

    (vscode.window as any).showInputBox = async () => {
      throw new Error('测试不应触发输入框');
    };
    (vscode.window as any).showWarningMessage = async () => undefined;

    const ai = new AIService(mockConfigService);
    const results = await ai.generateMetaBatch([
      { id: 'a', content: '内容A' },
      { id: 'b', content: '内容B' },
    ]);

    assert.deepStrictEqual(results, [
      { id: 'a', name: '标题A', emoji: '🅰️' },
      { id: 'b', name: '标题B', emoji: '🅱️' },
    ]);
    assert.strictEqual(fetchCalls, 2, '应调用两次 fetch（逐条请求）');
  });

  test('未配置 provider 时不应发起请求', async () => {
    const mockConfigService: any = {
      get: (_key: string, defaultValue?: any) => defaultValue,
      getSecret: async () => undefined,
      storeSecret: async () => {},
    };

    let called = false;
    (globalThis as any).fetch = async () => {
      called = true;
      throw new Error('不应调用');
    };

    (vscode.window as any).showWarningMessage = async () => undefined;

    const ai = new AIService(mockConfigService);
    const meta = await ai.generateMeta('content');

    assert.deepStrictEqual(meta, {});
    assert.strictEqual(called, false, '未配置 provider 时不应调用 fetch');
  });
});
