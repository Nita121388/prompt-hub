import * as assert from 'assert';
import {
  buildEndKeywordMatcher,
  containsEndKeyword,
  extractCandidateTitleFromEndText,
  formatDurationPrecise,
  parseDailyLog,
} from '../../utils/DailyLogTaskParser';

suite('DailyLogTaskParser Test Suite', () => {
  test('should match english end keyword by word boundary', () => {
    const patterns = buildEndKeywordMatcher(['end', 'over', '结束']);

    assert.strictEqual(containsEndKeyword('please end this task', patterns), true);
    assert.strictEqual(containsEndKeyword('please End this task', patterns), true);
    assert.strictEqual(containsEndKeyword('bend the wire', patterns), false);
    assert.strictEqual(containsEndKeyword('over and out', patterns), true);
    assert.strictEqual(containsEndKeyword('任务结束 -->', patterns), true);
  });

  test('should extract candidate title from end text', () => {
    const patterns = buildEndKeywordMatcher(['end', '结束', 'over']);
    const text = '2026-01-14 10:11:08 自动校准-技术支持 结束 -->';
    const title = extractCandidateTitleFromEndText(text, patterns);
    assert.strictEqual(title, '自动校准-技术支持');
  });

  test('should parse tasks with start and end markers', () => {
    const md = [
      '# 2026-01-14 08:20:05 自动校准-技术支持 --- <!-- otter-task:id=abc -->',
      '',
      '2026-01-14 08:20:05 自动校准-技术支持',
      '',
      '2026-01-14 10:11:08',
      '',
      '2026-01-14 10:11:08 自动校准-技术支持 结束 --> (1h 51m 3s) <!-- otter-task:id=abc -->',
      '',
    ].join('\n');

    const parsed = parseDailyLog(md);
    assert.strictEqual(parsed.tasks.length, 1);
    assert.strictEqual(parsed.tasks[0].id, 'abc');
    assert.strictEqual(parsed.tasks[0].title, '自动校准-技术支持');
    assert.ok(parsed.tasks[0].start);
    assert.ok(parsed.tasks[0].end);
    assert.strictEqual(parsed.tasks[0].start.getSeconds(), 5);
    assert.strictEqual(parsed.tasks[0].end?.getSeconds(), 8);
  });

  test('should format duration precise to seconds', () => {
    assert.strictEqual(formatDurationPrecise(5_000), '5s');
    assert.strictEqual(formatDurationPrecise(65_000), '1m 5s');
    assert.strictEqual(formatDurationPrecise(2 * 3600_000 + 5_000), '2h 0m 5s');
  });
});
