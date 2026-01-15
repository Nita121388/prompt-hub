/**
 * 今日日志任务“补充内容”写入工具：
 * - 通过 taskId 定位任务开始标题块
 * - 在该块内创建/追加 `#### 补充` 小节
 * - 以 ```text 代码块原样追加，避免破坏 Markdown
 */

export function appendSupplementToTaskBlock(
  dailyLogText: string,
  taskId: string,
  supplementText: string
): string {
  const content = normalizeAppendContent(supplementText);
  if (!content.trim()) {
    throw new Error('补充内容不能为空');
  }

  const marker = `<!-- otter-task:id=${taskId} -->`;
  const lines = (dailyLogText || '').split(/\r?\n/);

  const startHeadingIndex = lines.findIndex((l) => l.includes(marker) && l.trimStart().startsWith('#'));
  if (startHeadingIndex < 0) {
    throw new Error('未找到该任务的开始标记，可能任务已被手动改写或不在今日日志中。');
  }

  const isTaskStartHeadingLine = (l: string): boolean => l.trimStart().startsWith('#') && l.includes('otter-task:id=');
  const nextTaskHeadingIndex = (() => {
    for (let i = startHeadingIndex + 1; i < lines.length; i += 1) {
      if (isTaskStartHeadingLine(lines[i] || '')) return i;
    }
    return -1;
  })();

  const blockEnd = nextTaskHeadingIndex >= 0 ? nextTaskHeadingIndex : lines.length;
  const supplementHeadingRe = /^\s*####\s+补充\s*$/u;
  const headingBoundaryRe = /^\s*#{1,4}\s+\S/u;

  let supplementHeadingIndex = -1;
  for (let i = startHeadingIndex + 1; i < blockEnd; i += 1) {
    if (supplementHeadingRe.test(lines[i] || '')) {
      supplementHeadingIndex = i;
      break;
    }
  }

  const fence = pickCodeFence(content);
  const payloadLines = [`${fence}text`, ...content.split('\n'), fence];

  let insertAt = blockEnd;
  let insertLines: string[] = [];

  if (supplementHeadingIndex >= 0) {
    // 追加到“补充”小节末尾：遇到下一个 heading（<= ####）即视为小节结束
    let sectionEnd = blockEnd;
    for (let i = supplementHeadingIndex + 1; i < blockEnd; i += 1) {
      if (headingBoundaryRe.test(lines[i] || '')) {
        sectionEnd = i;
        break;
      }
    }
    insertAt = sectionEnd;
    insertLines = ['', ...payloadLines, ''];
  } else {
    insertAt = blockEnd;
    insertLines = ['', '#### 补充', '', ...payloadLines, ''];
  }

  const nextLines = [...lines.slice(0, insertAt), ...insertLines, ...lines.slice(insertAt)];
  return nextLines.join('\n');
}

function normalizeAppendContent(text: string): string {
  return (text || '').replace(/\r\n/g, '\n').trimEnd();
}

function pickCodeFence(text: string): string {
  const t = text || '';
  let fence = '```';
  for (let i = 0; i < 10; i += 1) {
    if (!t.includes(fence)) return fence;
    fence += '`';
  }
  // 极端情况下：回退到 ~~~，避免与反引号冲突
  return '~~~';
}

