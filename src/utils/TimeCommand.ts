export interface ParsedTimeCommandLine {
  indent: string;
  format?: string;
  trailingText: string;
}

export function formatDateTime(date: Date, pattern: string): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const map: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: pad2(date.getMonth() + 1),
    DD: pad2(date.getDate()),
    HH: pad2(date.getHours()),
    mm: pad2(date.getMinutes()),
    ss: pad2(date.getSeconds()),
  };

  return (pattern || '')
    .replace(/YYYY/g, map.YYYY)
    .replace(/MM/g, map.MM)
    .replace(/DD/g, map.DD)
    .replace(/HH/g, map.HH)
    .replace(/mm/g, map.mm)
    .replace(/ss/g, map.ss);
}

/**
 * 解析 Markdown 引用块时间命令：
 * - > @time format=HH:mm TODO
 * - > @timeformat=HH:mm TODO
 * - > @时间 format=YYYY-MM-DD HH:mm
 */
function startsWithIgnoreCase(haystack: string, index: number, needle: string): boolean {
  return haystack.slice(index, index + needle.length).toLowerCase() === needle.toLowerCase();
}

function findInlineCodeSpans(line: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let i = 0;

  while (i < line.length) {
    if (line[i] !== '`') {
      i += 1;
      continue;
    }

    const start = i;
    let tickCount = 1;
    while (i + tickCount < line.length && line[i + tickCount] === '`') tickCount += 1;
    const fence = '`'.repeat(tickCount);
    const close = line.indexOf(fence, start + tickCount);
    if (close === -1) break;

    spans.push({ start, end: close + tickCount });
    i = close + tickCount;
  }

  return spans;
}

function tryParseInlineTimeDirective(
  text: string,
  startAt: number
): { end: number; format?: string } | null {
  if (text[startAt] !== '@') return null;
  if (startAt > 0 && text[startAt - 1] === '\\') return null;

  let i = startAt + 1;
  while (i < text.length && /\s/.test(text[i])) i += 1;

  let afterKeyword = -1;
  if (startsWithIgnoreCase(text, i, 'time')) {
    afterKeyword = i + 4;
    const next = text[afterKeyword] ?? '';
    if (next && /[A-Za-z0-9_]/.test(next) && !startsWithIgnoreCase(text, afterKeyword, 'format'))
      return null;
  } else if (text.startsWith('\u65f6\u95f4', i)) {
    afterKeyword = i + 2;
    const next = text[afterKeyword] ?? '';
    if (next && !/\s/.test(next) && !startsWithIgnoreCase(text, afterKeyword, 'format')) return null;
  } else {
    return null;
  }

  let j = afterKeyword;
  while (j < text.length && /\s/.test(text[j])) j += 1;

  if (!startsWithIgnoreCase(text, j, 'format')) {
    return { end: afterKeyword };
  }

  let k = j + 'format'.length;
  while (k < text.length && /\s/.test(text[k])) k += 1;
  if (text[k] !== '=') return { end: afterKeyword };
  k += 1;
  while (k < text.length && /\s/.test(text[k])) k += 1;

  const first = text[k];
  if (first === '"' || first === "'") {
    const endQuote = text.indexOf(first, k + 1);
    if (endQuote === -1) return { end: afterKeyword };
    const format = text.slice(k + 1, endQuote);
    return { end: endQuote + 1, format };
  }

  const m = text.slice(k).match(/^(\S+)/);
  if (!m) return { end: afterKeyword };
  return { end: k + m[1].length, format: m[1] };
}

/**
 * 行内时间 Token 渲染：精确替换 @time/@时间（支持大小写与空格），不改写整行。
 * 示例：# @time 我的内容 -> # 2026-01-13 14:01 我的内容
 */
export function renderInlineTimeTokens(
  line: string,
  date: Date,
  defaultFormat: string
): string | null {
  const raw = line || '';
  if (!raw.includes('@')) return null;

  const codeSpans = findInlineCodeSpans(raw);
  let spanIndex = 0;
  const currentSpan = () => codeSpans[spanIndex];

  let out = '';
  let changed = false;
  let pos = 0;

  while (pos < raw.length) {
    const span = currentSpan();
    if (span && pos === span.start) {
      out += raw.slice(span.start, span.end);
      pos = span.end;
      spanIndex += 1;
      continue;
    }

    if (raw[pos] !== '@') {
      out += raw[pos];
      pos += 1;
      continue;
    }

    const parsed = tryParseInlineTimeDirective(raw, pos);
    if (!parsed) {
      out += raw[pos];
      pos += 1;
      continue;
    }

    const fmt = parsed.format && parsed.format.trim() ? parsed.format.trim() : defaultFormat;
    out += formatDateTime(date, fmt);
    pos = parsed.end;
    changed = true;
  }

  return changed ? out : null;
}

export function parseTimeCommandLine(line: string): ParsedTimeCommandLine | null {
  const raw = line || '';
  const base = raw.match(/^(\s*)>\s*@\s*(.*)$/);
  if (!base) return null;

  const indent = base[1] || '';
  const afterAt = base[2] || '';

  let restRaw = '';
  if (afterAt.toLowerCase().startsWith('time')) {
    restRaw = afterAt.slice('time'.length);
    // 避免误匹配：@timer / @timezone 等
    if (restRaw && !/^\s/.test(restRaw) && !/^format/i.test(restRaw)) return null;
  } else if (afterAt.startsWith('\u65f6\u95f4')) {
    restRaw = afterAt.slice('\u65f6\u95f4'.length);
    // 避免误匹配：@时间戳 等
    if (restRaw && !/^\s/.test(restRaw) && !/^format/i.test(restRaw)) return null;
  } else {
    return null;
  }

  let rest = restRaw.trimStart();
  let format: string | undefined;

  const fmtMatch = rest.match(/^format\s*=\s*(.*)$/i);
  if (fmtMatch) {
    rest = fmtMatch[1] ?? '';
    const first = rest[0];
    if (first === '"' || first === "'") {
      const end = rest.indexOf(first, 1);
      if (end > 0) {
        format = rest.slice(1, end);
        rest = rest.slice(end + 1);
      } else {
        // 未闭合引号：当作没有 format，整体回退到 trailingText
        rest = `format=${first}${rest.slice(1)}`;
      }
    } else {
      const m = rest.match(/^(\S+)(.*)$/);
      if (m) {
        format = m[1];
        rest = m[2] || '';
      }
    }
  }

  const trailingText = rest.trimStart();
  return { indent, format, trailingText };
}

export function renderTimeCommandLine(
  line: string,
  date: Date,
  defaultFormat: string
): string | null {
  const parsed = parseTimeCommandLine(line);
  if (!parsed) return null;
  const fmt = parsed.format && parsed.format.trim() ? parsed.format.trim() : defaultFormat;
  const ts = formatDateTime(date, fmt);
  const tail = parsed.trailingText ? ` ${parsed.trailingText}` : '';
  return `${parsed.indent}> ${ts}${tail}`;
}
