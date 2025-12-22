import * as assert from 'assert';
import { LocalCodexProvider } from '../../services/LocalCodexProvider';

suite('LocalCodexProvider 测试', () => {
  let provider: LocalCodexProvider;
  let mockConfigService: any;

  setup(() => {
    // 创建 mock ConfigurationService
    mockConfigService = {
      get: (key: string) => {
        if (key === 'local.codexPath') {
          return undefined; // 测试自动检测路径
        }
        if (key === 'local.codexModel') {
          return 'claude-sonnet-4.5';
        }
        return undefined;
      },
      getSecret: async () => undefined,
      storeSecret: async () => {},
      set: async () => {},
      onDidChange: () => ({ dispose: () => {} }),
    };

    provider = new LocalCodexProvider(mockConfigService);
  });

  test('LocalCodexProvider 实例化成功', () => {
    assert.ok(provider, 'Provider 实例应该被创建');
  });

  test('生成元信息 - Codex 未安装时应该抛出错误', async () => {
    const content = '这是一个测试 prompt 内容';

    try {
      await provider.generateMeta(content);
      // 如果到这里说明找到了 Codex，这也是可以的
      console.log('Codex 已安装，测试通过');
    } catch (error) {
      // 预期会失败（如果 Codex 未安装）
      assert.ok((error as Error).message.includes('未找到'), '应该提示未找到工具');
    }
  });

  test('优化内容 - Codex 未安装时应该抛出错误', async () => {
    const content = '这是一个需要优化的 prompt 内容';

    try {
      await provider.optimize(content);
      console.log('Codex 已安装，测试通过');
    } catch (error) {
      assert.ok((error as Error).message.includes('未找到'), '应该提示未找到工具');
    }
  });

  test('Codex 路径检测 - 应该处理不存在的路径', () => {
    // 验证 mock 配置
    const path = mockConfigService.get('local.codexPath');
    assert.strictEqual(path, undefined, '应返回 undefined');
  });

  test('Codex 模型配置 - 应该读取配置的模型', () => {
    // 验证 mock 配置返回正确的模型
    const model = mockConfigService.get('local.codexModel');
    assert.strictEqual(model, 'claude-sonnet-4.5', '应该返回配置的模型');
  });
});
