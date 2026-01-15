function escapeRegExp(input: string): string {
  return (input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isAsciiWord(input: string): boolean {
  return /^[A-Za-z0-9_]+$/.test((input || '').trim());
}

/**
 * 从一行文本中移除已执行的快捷指令 token（仅 start/end）：
 * - 支持用户自定义关键字（startKeywords / endKeywords）
 * - 支持 token 形态：@start、@Start、@开始、@end、@结束、@end(x)、@start:xxx 等
 * - 保留原有缩进（例如列表/引用缩进）
 */
export function stripStartEndDirectiveTokensFromLine(
  line: string,
  options: {
    stripStart: boolean;
    stripEnd: boolean;
    startKeywords: string[];
    endKeywords: string[];
  }
): string {
  const raw = line || '';
  const indentMatch = raw.match(/^(\s*)/);
  const indent = indentMatch?.[1] ?? '';
  let rest = raw.slice(indent.length);

  const removeTokens = (keywords: string[]) => {
    for (const kw0 of keywords || []) {
      const kw = (kw0 || '').trim();
      if (!kw) continue;
      const escaped = escapeRegExp(kw);
      const token = `@${escaped}(?=[:(]|\\s|$)[^\\s]*`;
      const flags = isAsciiWord(kw) ? 'gi' : 'g';
      rest = rest.replace(new RegExp(`(?:^|\\s+)${token}`, flags), '');
    }
  };

  if (options.stripStart) {
    removeTokens(options.startKeywords);
  }
  if (options.stripEnd) {
    removeTokens(options.endKeywords);
  }

  rest = rest.replace(/^\s+/, '').replace(/\s{2,}/g, ' ').trimEnd();
  return indent + rest;
}

