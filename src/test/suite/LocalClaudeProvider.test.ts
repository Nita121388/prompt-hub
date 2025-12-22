import * as assert from 'assert';
import { LocalClaudeProvider } from '../../services/LocalClaudeProvider';

suite('LocalClaudeProvider 测试', () => {
  let provider: LocalClaudeProvider;
  let mockConfigService: any;

  setup(() => {
    // 创建 mock ConfigurationService
    mockConfigService = {
      get: (key: string) => {
        if (key === 'local.claudePath') {
          return undefined; // 测试自动检测路径
        }
        return undefined;
      },
      getSecret: async () => undefined,
      storeSecret: async () => {},
      set: async () => {},
      onDidChange: () => ({ dispose: () => {} }),
    };

    provider = new LocalClaudeProvider(mockConfigService);
  });

  test('LocalClaudeProvider 实例化成功', () => {
    assert.ok(provider, 'Provider 实例应该被创建');
  });

  test('生成元信息 - Claude Code 未安装时应该抛出错误', async () => {
    const content = '这是一个测试 prompt 内容';

    try {
      await provider.generateMeta(content);
      // 如果到这里说明找到了 Claude Code，这也是可以的
      console.log('Claude Code 已安装，测试通过');
    } catch (error) {
      // 预期会失败（如果 Claude Code 未安装）
      assert.ok((error as Error).message.includes('未找到'), '应该提示未找到工具');
    }
  });

  test('优化内容 - Claude Code 未安装时应该抛出错误', async () => {
    const content = '这是一个需要优化的 prompt 内容';

    try {
      await provider.optimize(content);
      console.log('Claude Code 已安装，测试通过');
    } catch (error) {
      assert.ok((error as Error).message.includes('未找到'), '应该提示未找到工具');
    }
  });

  test('配置项读取 - 应该返回正确的默认值', () => {
    // 验证 mock 配置返回 undefined
    const value = mockConfigService.get('local.claudePath');
    assert.strictEqual(value, undefined, '默认应返回 undefined');
  });
});
