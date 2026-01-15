import * as assert from 'assert';
import { appendSupplementToTaskBlock } from '../../utils/DailyLogTaskSupplement';

suite('DailyLogTaskSupplement Test Suite', () => {
  test('should create supplement section under task block', () => {
    const md = [
      '# 2026-01-15｜工作日志',
      '',
      '## 计时任务',
      '<!-- otter:tasks -->',
      '',
      '### 2026-01-15 09:42 调研智能客服 --- <!-- otter-task:id=aaa -->',
      '',
      '2026-01-15 09:42 调研智能客服',
      '',
      '### 2026-01-15 08:00 另一个任务 --- <!-- otter-task:id=bbb -->',
      '',
      '2026-01-15 08:00 另一个任务',
      '',
    ].join('\n');

    const next = appendSupplementToTaskBlock(md, 'aaa', 'line1\nline2');

    assert.ok(next.includes('#### 补充'));
    assert.ok(next.includes('```text\nline1\nline2\n```'));

    const idxA = next.indexOf('<!-- otter-task:id=aaa -->');
    const idxSupplement = next.indexOf('#### 补充');
    const idxB = next.indexOf('<!-- otter-task:id=bbb -->');

    assert.ok(idxA >= 0);
    assert.ok(idxB >= 0);
    assert.ok(idxSupplement > idxA);
    assert.ok(idxSupplement < idxB);
  });

  test('should append into existing supplement section before next heading', () => {
    const md = [
      '### 2026-01-15 09:42 调研智能客服 --- <!-- otter-task:id=aaa -->',
      '',
      '2026-01-15 09:42 调研智能客服',
      '',
      '#### 补充',
      '',
      '```text',
      'old',
      '```',
      '',
      '#### 结果',
      '- ok',
      '',
      '### 2026-01-15 08:00 另一个任务 --- <!-- otter-task:id=bbb -->',
      '',
      '2026-01-15 08:00 另一个任务',
      '',
    ].join('\n');

    const next = appendSupplementToTaskBlock(md, 'aaa', 'new');

    const idxNew = next.indexOf('```text\nnew\n```');
    const idxResult = next.indexOf('#### 结果');
    assert.ok(idxNew >= 0);
    assert.ok(idxResult >= 0);
    assert.ok(idxNew < idxResult);
  });

  test('should use longer fence when content contains ```', () => {
    const md = [
      '### 2026-01-15 09:42 调研智能客服 --- <!-- otter-task:id=aaa -->',
      '',
      '2026-01-15 09:42 调研智能客服',
      '',
      '### 2026-01-15 08:00 另一个任务 --- <!-- otter-task:id=bbb -->',
      '',
      '2026-01-15 08:00 另一个任务',
      '',
    ].join('\n');

    const next = appendSupplementToTaskBlock(md, 'aaa', 'contains ``` fence');
    assert.ok(next.includes('````text\ncontains ``` fence\n````'));
  });
});

