import * as assert from 'assert';
import { appendResultTag } from '../../utils/MarkdownQuickCommandSummaryDirectiveStripper';

suite('MarkdownQuickCommand Summary Mark Test Suite', () => {
  test('should append (已总结) when no existing result', () => {
    assert.strictEqual(appendResultTag('2026-01-15 @summary @today', '已总结'), '2026-01-15 @summary @today (已总结)');
  });

  test('should merge into existing result parentheses', () => {
    assert.strictEqual(
      appendResultTag('2026-01-15 09:42 调研智能客服 (已开始)', '已总结'),
      '2026-01-15 09:42 调研智能客服 (已开始; 已总结)'
    );
  });

  test('should not duplicate existing tag', () => {
    assert.strictEqual(
      appendResultTag('x (已总结)', '已总结'),
      'x (已总结)'
    );
  });
});

