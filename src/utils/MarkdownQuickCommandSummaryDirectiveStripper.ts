function isAsciiWord(input: string): boolean {
  return /^[A-Za-z0-9_]+$/.test((input || '').trim());
}

function getDirectiveBaseToken(token: string): string {
  const t = (token || '').trim();
  if (!t.startsWith('@')) return t;
  const m = t.match(/^@[^:(\s]+/);
  return m ? m[0] : t;
}

function matchKeyword(baseTokenWithAt: string, keywords: string[]): boolean {
  const raw = (baseTokenWithAt || '').trim();
  if (!raw.startsWith('@')) return false;
  const normalized = raw.slice(1);
  return (keywords || []).some((k0) => {
    const k = (k0 || '').trim();
    if (!k) return false;
    if (isAsciiWord(k)) return k.toLowerCase() === normalized.toLowerCase();
    return k === normalized;
  });
}

/**
 * 从一行文本中移除用于 @summary 的指令 token：
 * - @summary、@today、@filename 及其参数（直到下一个 @xxx 或行末）
 * - 支持用户自定义关键字集合（summary/today/filename）
 * - 保留原有缩进（例如列表/引用缩进）
 */
export function stripSummaryDirectiveTokensFromLine(
  line: string,
  options: { summaryKeywords: string[]; todayKeywords: string[]; filenameKeywords: string[] }
): string {
  const raw = line || '';
  const indentMatch = raw.match(/^(\s*)/);
  const indent = indentMatch?.[1] ?? '';
  const rest = raw.slice(indent.length);

  const tokens = (rest || '').trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];

  let skippingFilenameArg = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i] || '';

    if (skippingFilenameArg) {
      if (t.startsWith('@')) {
        skippingFilenameArg = false;
        i -= 1;
        continue;
      }
      continue;
    }

    if (!t.startsWith('@')) {
      out.push(t);
      continue;
    }

    const base = getDirectiveBaseToken(t);
    if (matchKeyword(base, options.summaryKeywords)) {
      continue;
    }
    if (matchKeyword(base, options.todayKeywords)) {
      continue;
    }
    if (matchKeyword(base, options.filenameKeywords)) {
      skippingFilenameArg = true;
      continue;
    }

    // 其他 @xxx（例如 @time）不在本次范围，保留
    out.push(t);
  }

  const joined = out.join(' ').replace(/\s{2,}/g, ' ').trimEnd();
  return indent + joined;
}

/**
 * 将“执行结果标签”追加到行尾括号中：
 * - 若行尾已有 `(xxx)` 则变为 `(xxx; tag)`
 * - 若不存在则追加 ` (tag)`
 * - 若已存在 tag 则不重复追加
 */
export function appendResultTag(line: string, tag: string): string {
  const t = (tag || '').trim();
  if (!t) return line;

  const raw = line || '';
  const m = raw.match(/^(.*?)(\s*\(\s*([^)]+?)\s*\)\s*)$/u);
  if (!m) {
    const base = raw.trimEnd();
    return base ? `${base} (${t})` : `(${t})`;
  }

  const prefix = (m[1] || '').trimEnd();
  const existing = (m[3] || '').trim();
  const parts = existing
    .split(/\s*;\s*/g)
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.some((x) => x === t)) return `${prefix} (${existing})`;

  return `${prefix} (${[...parts, t].join('; ')})`;
}
