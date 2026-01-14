import * as assert from 'assert';
import {
  formatDateTime,
  parseTimeCommandLine,
  renderInlineTimeTokens,
  renderTimeCommandLine,
} from '../../utils/TimeCommand';

suite('TimeCommand Test Suite', () => {
  test('should format date time with tokens', () => {
    const d = new Date('2026-01-13T02:03:04.000Z');
    // 注意：这里不测时区换算，只验证替换规则本身
    assert.strictEqual(formatDateTime(d, 'YYYY-MM-DD HH:mm:ss').includes('2026-01-13'), true);
  });

  test('should parse @time format=HH:mm', () => {
    const parsed = parseTimeCommandLine('> @time format=HH:mm TODO');
    assert.ok(parsed);
    assert.strictEqual(parsed!.format, 'HH:mm');
    assert.strictEqual(parsed!.trailingText, 'TODO');
  });

  test('should parse @timeformat=HH:mm', () => {
    const parsed = parseTimeCommandLine('> @timeformat=HH:mm TODO');
    assert.ok(parsed);
    assert.strictEqual(parsed!.format, 'HH:mm');
    assert.strictEqual(parsed!.trailingText, 'TODO');
  });

  test('should parse @Time (case-insensitive)', () => {
    const parsed = parseTimeCommandLine('> @Time format=HH:mm TODO');
    assert.ok(parsed);
    assert.strictEqual(parsed!.format, 'HH:mm');
    assert.strictEqual(parsed!.trailingText, 'TODO');
  });

  test('should parse with spaces and Chinese keyword', () => {
    const parsed = parseTimeCommandLine('> @ \u65f6\u95f4 format = HH:mm TODO');
    assert.ok(parsed);
    assert.strictEqual(parsed!.format, 'HH:mm');
    assert.strictEqual(parsed!.trailingText, 'TODO');
  });

  test('should not parse @timer', () => {
    const parsed = parseTimeCommandLine('> @timer format=HH:mm TODO');
    assert.strictEqual(parsed, null);
  });

  test('should render command line and keep trailing text', () => {
    const d = new Date('2026-01-13T12:34:56.000Z');
    const out = renderTimeCommandLine('> @time format=HH:mm TODO', d, 'YYYY-MM-DD HH:mm');
    assert.ok(out);
    assert.ok(out!.startsWith('> '));
    assert.ok(out!.includes('TODO'));
    assert.ok(!out!.includes('@time'));
  });

  test('should render inline @time tokens and keep rest of line', () => {
    const d = new Date(2026, 0, 13, 14, 1, 2);
    const out = renderInlineTimeTokens('# @time 我的内容XXXX', d, 'YYYY-MM-DD HH:mm');
    assert.strictEqual(out, '# 2026-01-13 14:01 我的内容XXXX');
  });

  test('should render all inline tokens (case-insensitive + Chinese + spaces)', () => {
    const d = new Date(2026, 0, 13, 14, 1, 2);
    const out = renderInlineTimeTokens('# @time A @Time B @ \u65f6\u95f4 C', d, 'YYYY-MM-DD HH:mm');
    assert.ok(out);
    assert.strictEqual((out!.match(/2026-01-13 14:01/g) || []).length, 3);
  });

  test('should not render inside inline code spans and escaped tokens', () => {
    const d = new Date(2026, 0, 13, 14, 1, 2);
    const out = renderInlineTimeTokens('# `@time` \\\\@time @time', d, 'YYYY-MM-DD HH:mm');
    assert.ok(out);
    assert.ok(out!.includes('`@time`'));
    assert.ok(out!.includes('\\\\@time'));
    assert.ok(out!.includes('2026-01-13 14:01'));
  });
});
