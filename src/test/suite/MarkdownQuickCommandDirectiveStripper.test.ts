import * as assert from 'assert';
import { stripStartEndDirectiveTokensFromLine } from '../../utils/MarkdownQuickCommandDirectiveStripper';

suite('MarkdownQuickCommandDirectiveStripper Test Suite', () => {
  test('should strip @start and keep indentation', () => {
    const line = '  - 2026-01-15 09:42 调研智能客服 @start';
    const next = stripStartEndDirectiveTokensFromLine(line, {
      stripStart: true,
      stripEnd: false,
      startKeywords: ['start', 'begin', '开始'],
      endKeywords: ['end', 'over', 'stop', '结束'],
    });
    assert.strictEqual(next, '  - 2026-01-15 09:42 调研智能客服');
  });

  test('should strip configured chinese keywords', () => {
    const line = '2026-01-15 09:42 调研智能客服 @开始 @结束';
    const next = stripStartEndDirectiveTokensFromLine(line, {
      stripStart: true,
      stripEnd: true,
      startKeywords: ['开始'],
      endKeywords: ['结束'],
    });
    assert.strictEqual(next, '2026-01-15 09:42 调研智能客服');
  });

  test('should be case-insensitive for ascii keywords and strip token suffix', () => {
    const line = '任务A @Start:xx @EnD(done)';
    const next = stripStartEndDirectiveTokensFromLine(line, {
      stripStart: true,
      stripEnd: true,
      startKeywords: ['start'],
      endKeywords: ['end'],
    });
    assert.strictEqual(next, '任务A');
  });
});

