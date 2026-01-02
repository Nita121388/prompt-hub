import * as assert from 'assert';
import { extractJsonArray } from '../../utils/JsonExtract';

suite('JsonExtract 测试', () => {
  test('应解析纯 JSON 数组', () => {
    const parsed = extractJsonArray<{ id: string; name: string; emoji: string }>(
      '[{"id":"1","name":"标题","emoji":"🔥"}]'
    );
    assert.deepStrictEqual(parsed, [{ id: '1', name: '标题', emoji: '🔥' }]);
  });

  test('应解析 Markdown code fence 包裹的 JSON 数组', () => {
    const parsed = extractJsonArray<{ id: string }>('```json\n[{"id":"1"}]\n```');
    assert.deepStrictEqual(parsed, [{ id: '1' }]);
  });

  test('应从前后有噪声文本中提取 JSON 数组', () => {
    const parsed = extractJsonArray<{ id: string }>('前缀说明\n[{"id":"1"},{"id":"2"}]\n后缀说明');
    assert.deepStrictEqual(parsed, [{ id: '1' }, { id: '2' }]);
  });
});
