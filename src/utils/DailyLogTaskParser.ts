import Fuse from 'fuse.js';

export interface DailyTask {
  id: string;
  title: string;
  start: Date;
  end?: Date;
  durationMs?: number;
  startLine: number;
}

export interface ParsedDailyLog {
  tasks: DailyTask[];
  lines: string[];
}

const TASK_ID_RE = /<!--\s*otter-task:id=([A-Za-z0-9_-]+)\s*-->/;
// 支持到秒：YYYY-MM-DD HH:mm 或 YYYY-MM-DD HH:mm:ss
const TS_RE = /\b(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?\b/;

export function parseDailyLog(text: string): ParsedDailyLog {
  const lines = (text || '').split(/\r?\n/);
  const starts = new Map<string, { line: number; start: Date; title: string }>();
  const ends = new Map<string, { end: Date }>();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const id = extractTaskId(line);
    if (!id) continue;

    const ts = extractTimestamp(line);
    if (!ts) continue;

    if (line.trimStart().startsWith('#')) {
      const title = extractTitleFromStartHeading(line, ts.raw) ?? '';
      starts.set(id, { line: i, start: ts.date, title });
      continue;
    }

    // 结束行通常不是标题，但会带 id
    ends.set(id, { end: ts.date });
  }

  const tasks: DailyTask[] = [];
  for (const [id, s] of starts.entries()) {
    const e = ends.get(id);
    const durationMs = e ? Math.max(0, e.end.getTime() - s.start.getTime()) : undefined;
    tasks.push({
      id,
      title: s.title,
      start: s.start,
      end: e?.end,
      durationMs,
      startLine: s.line,
    });
  }

  tasks.sort((a, b) => b.start.getTime() - a.start.getTime());
  return { tasks, lines };
}

export function extractTaskId(line: string): string | undefined {
  const m = (line || '').match(TASK_ID_RE);
  return m?.[1];
}

export function extractTimestamp(line: string): { date: Date; raw: string } | undefined {
  const m = (line || '').match(TS_RE);
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] ? Number(m[6]) : 0;

  const raw = m[0];
  const dt = new Date(year, month - 1, day, hour, minute, second, 0);
  if (Number.isNaN(dt.getTime())) return undefined;
  return { date: dt, raw };
}

export function formatDurationCompact(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatDurationPrecise(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

export function normalizeForMatch(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

export function buildEndKeywordMatcher(keywords: string[]): RegExp[] {
  const list = (keywords || []).map((k) => (k || '').trim()).filter(Boolean);
  const patterns: RegExp[] = [];

  for (const k of list) {
    // 纯英文/数字/下划线：按单词边界匹配（大小写不敏感）
    if (/^[A-Za-z0-9_]+$/.test(k)) {
      patterns.push(new RegExp(`\\b${escapeRegExp(k)}\\b`, 'gi'));
    } else {
      // 含中文等：普通包含匹配（大小写不敏感没有意义）
      patterns.push(new RegExp(escapeRegExp(k), 'g'));
    }
  }

  return patterns;
}

export function containsEndKeyword(text: string, keywordPatterns: RegExp[]): boolean {
  const t = normalizeForMatch(text);
  if (!t) return false;
  return keywordPatterns.some((re) => {
    re.lastIndex = 0;
    return re.test(t);
  });
}

export function extractCandidateTitleFromEndText(text: string, keywordPatterns: RegExp[]): string {
  let t = normalizeForMatch(text);
  if (!t) return '';

  // 去掉时间戳
  t = t.replace(/\b\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\b/g, ' ');

  // 去掉结束关键字（英文用边界，中文直接替换）
  for (const re of keywordPatterns) {
    t = t.replace(re, ' ');
  }

  // 常见符号清理
  t = t
    .replace(/^@+\s*/g, ' ')
    .replace(/-+>/g, ' ')
    .replace(/→|=>/g, ' ')
    .replace(/[()（）\[\]【】]/g, ' ')
    .replace(/[#*_`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return t;
}

export function fuzzyPickTaskByTitle(running: DailyTask[], candidateTitle: string): DailyTask[] {
  const c = normalizeForMatch(candidateTitle);
  if (!c) return [];
  if (!running.length) return [];

  // 先做快速包含
  const exact = running.find((t) => normalizeForMatch(t.title) === c);
  if (exact) return [exact];

  const fuse = new Fuse(running, {
    keys: ['title'],
    includeScore: true,
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const results = fuse.search(c).slice(0, 5);
  if (!results.length) return [];

  // 置信度足够则直接返回 1 个；否则返回 Top N 供上层弹窗选择
  if (results.length === 1) return [results[0].item];
  const best = results[0];
  const second = results[1];
  const bestScore = best.score ?? 1;
  const secondScore = second?.score ?? 1;

  const confident = bestScore <= 0.2 || (bestScore <= 0.3 && secondScore - bestScore >= 0.15);
  if (confident) return [best.item];

  return results.map((r) => r.item);
}

function extractTitleFromStartHeading(line: string, rawTs: string): string | undefined {
  // 形如：
  // # 2026-01-14 08:20 xxx --- <!-- id -->
  // # ✓ 2026-01-14 08:20 xxx (2h 51m) --- <!-- id -->
  const withoutId = (line || '').replace(TASK_ID_RE, '').trim();
  const afterHash = withoutId.replace(/^#+\s*/, '').trim();
  const afterMark = afterHash.replace(/^✓\s*/u, '').trim();

  // 去掉时间戳前缀
  let rest = afterMark;
  if (rest.startsWith(rawTs)) {
    rest = rest.slice(rawTs.length).trim();
  }

  // 去掉结尾 --- 与时长
  rest = rest.replace(/\s*---\s*$/g, '').trim();
  rest = rest.replace(/\s*\(\s*(?=.*\d)(?=.*[hms])[\dhms\s]+\)\s*$/i, '').trim();
  return rest;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
