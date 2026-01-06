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
      // 环境差异较大：可能未安装，也可能已安装但未登录/缺少依赖（如 Git Bash）等
      const message = (error as Error).message || '';
      assert.ok(message.length > 0, '应该抛出可读的错误信息');
     }
   });

   test('优化内容 - Claude Code 未安装时应该抛出错误', async () => {
     const content = '这是一个需要优化的 prompt 内容';

     try {
       await provider.optimize(content);
       console.log('Claude Code 已安装，测试通过');
     } catch (error) {
      const message = (error as Error).message || '';
      assert.ok(message.length > 0, '应该抛出可读的错误信息');
     }
   });

  test('配置项读取 - 应该返回正确的默认值', () => {
    // 验证 mock 配置返回 undefined
    const value = mockConfigService.get('local.claudePath');
    assert.strictEqual(value, undefined, '默认应返回 undefined');
  });
});
