import * as vscode from 'vscode';
import * as path from 'path';
import Fuse from 'fuse.js';
import { ConfigurationService } from './ConfigurationService';
import { DailyLogService } from './DailyLogService';
import { AIService } from './AIService';
import { enqueueByKey } from '../utils/WriteQueue';
import { formatDateTime, renderInlineTimeTokens, renderTimeCommandLine } from '../utils/TimeCommand';
import {
  DailyTask,
  formatDurationCompact,
  formatDurationPrecise,
  normalizeForMatch,
} from '../utils/DailyLogTaskParser';
import { sanitizeFilename } from '../utils/helpers';

type ActionKind = 'start' | 'end' | 'add' | 'new' | 'file' | 'folder';

interface ParsedActions {
  actions: Array<{ kind: ActionKind; keys?: string[]; name?: string }>;
  hasTimeToken: boolean;
  summary?: { isToday: boolean; filename?: string };
}

export class MarkdownQuickCommandService {
  private readonly processingDocs = new Set<string>();

  constructor(
    private readonly config: ConfigurationService,
    private readonly dailyLog: DailyLogService,
    private readonly onDailyTasksChanged?: () => void
  ) {}

  bindOnEnter(context: vscode.ExtensionContext): void {
    const disposable = vscode.workspace.onDidChangeTextDocument((e) => {
      void this.maybeHandleOnEnter(e);
    });
    context.subscriptions.push(disposable);
  }

  private async maybeHandleOnEnter(e: vscode.TextDocumentChangeEvent): Promise<void> {
    const doc = e.document;
    const docKey = doc.uri.toString();
    if (this.processingDocs.has(docKey)) return;

    const enabled = this.config.get<boolean>('quickCmd.enableOnEnter', true);
    if (!enabled) return;

    const isMarkdown = doc.languageId === 'markdown' || doc.fileName.toLowerCase().endsWith('.md');
    if (!isMarkdown) return;

    const candidateLines = this.collectCandidateLines(doc, e.contentChanges);
    if (!candidateLines.length) return;

    const editor = vscode.window.visibleTextEditors.find(
      (ed) => ed.document.uri.toString() === docKey
    );
    if (!editor) return;

    const now = new Date();
    const timeEnabled = this.config.get<boolean>('time.autoRenderOnEnter', true);
    const timeFormat = this.config.get<string>('time.format', 'YYYY-MM-DD HH:mm');

    const edits: Array<{ line: number; next: string }> = [];
    let pendingTodaySummary: { filename?: string } | null = null;

    for (const line of candidateLines) {
      if (line < 0 || line >= doc.lineCount) continue;
      const original = doc.lineAt(line).text;
      if (!original.includes('@')) {
        // 没有 @ 直接跳过（TimeCommandService 的 @time 行内渲染也依赖 @）
        continue;
      }

      // 先渲染 @time（行内 token / 引用块命令行）
      let rendered = original;
      if (timeEnabled) {
        const renderedBlock = renderTimeCommandLine(rendered, now, timeFormat);
        if (renderedBlock !== null) {
          rendered = renderedBlock;
        } else {
          const renderedInline = renderInlineTimeTokens(rendered, now, timeFormat);
          if (renderedInline !== null) {
            rendered = renderedInline;
          }
        }
      }

      const parsed = this.parseActions(rendered);
      const endEnabled = this.dailyLog.getAutoDetectOnEnterEnabled();
      const actions = endEnabled ? parsed.actions : parsed.actions.filter((a) => a.kind !== 'end');
      const hasTodaySummary = parsed.summary?.isToday ?? false;

      if (!actions.length && !hasTodaySummary) {
        // 只有 @time 的情况：只改写时间 token
        if (rendered !== original) {
          edits.push({ line, next: rendered });
        }
        continue;
      }

      // 避免重复触发：若末尾已写入执行结果，跳过
      if (/\(\s*(?:已开始|已追加|已新建|已总结|\d+h|\d+m|\d+s)/.test(rendered.trimEnd())) {
        continue;
      }

      if (hasTodaySummary) {
        pendingTodaySummary = { filename: parsed.summary?.filename };
      }

      this.processingDocs.add(docKey);
      try {
        try {
          const result = await this.executeActions(editor, doc, rendered, actions, parsed.summary, now);
          if (result && result !== original) {
            edits.push({ line, next: result });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`执行 Markdown 快捷指令失败：${msg}`);
        }
      } finally {
        this.processingDocs.delete(docKey);
      }
    }

    if (!edits.length && !pendingTodaySummary) return;

    this.processingDocs.add(docKey);
    try {
      if (edits.length) {
        await editor.edit(
          (eb) => {
            for (const { line, next } of edits) {
              if (line < 0 || line >= doc.lineCount) continue;
              eb.replace(doc.lineAt(line).range, next);
            }
          },
          { undoStopBefore: false, undoStopAfter: false }
        );
      }

      if (pendingTodaySummary) {
        try {
          await this.summarizeToday(editor, doc, pendingTodaySummary.filename, now);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(`生成今日总结失败：${msg}`);
        }
      }
    } finally {
      this.processingDocs.delete(docKey);
    }
  }

  private parseActions(line: string): ParsedActions {
    const startKeywords = this.config.get<string[]>('quickCmd.startKeywords', [
      'start',
      'begin',
      '开始',
    ]);
    const endKeywords = this.config.get<string[]>('quickCmd.endKeywords', [
      'end',
      'over',
      'stop',
      '结束',
    ]);
    const addKeywords = this.config.get<string[]>('quickCmd.addKeywords', ['add', 'append', '添加', '+']);
    const newKeywords = this.config.get<string[]>('quickCmd.newKeywords', ['new', 'create', '新建']);
    const fileKeywords = this.config.get<string[]>('quickCmd.fileKeywords', ['file', '文件']);
    const folderKeywords = this.config.get<string[]>('quickCmd.folderKeywords', ['folder', '文件夹', '目录']);
    const summaryKeywords = this.config.get<string[]>('quickCmd.summaryKeywords', ['summary', '总结']);
    const todayKeywords = this.config.get<string[]>('quickCmd.todayKeywords', ['today', '今日']);
    const filenameKeywords = this.config.get<string[]>('quickCmd.filenameKeywords', ['filename', '文件名']);

    const tokens = splitTokens(line);
    const actions: Array<{ kind: ActionKind; keys?: string[]; name?: string }> = [];

    let seenSummary = false;
    let summaryToday = false;
    let summaryFilename: string | undefined;

    const matchKeyword = (raw: string, list: string[]): boolean => {
      const k = raw.trim();
      if (!k) return false;
      const normalized = k.startsWith('@') ? k.slice(1) : k;
      return list.some((x) => {
        const xx = (x || '').trim();
        if (!xx) return false;
        // @+：允许配置为 +，但实际 token 必须是 @+
        if (xx === '+') return normalized === '+';
        if (/^[A-Za-z0-9_]+$/.test(xx)) return xx.toLowerCase() === normalized.toLowerCase();
        return xx === normalized;
      });
    };

    for (let i = 0; i < tokens.length; i += 1) {
      const t = tokens[i];
      if (!t.startsWith('@')) continue;
      const baseToken = getDirectiveBaseToken(t);
      const normalized = baseToken === '@+' ? '@+' : `@${baseToken.slice(1)}`; // 保持 @ 前缀

      if (matchKeyword(normalized, summaryKeywords)) {
        seenSummary = true;
        continue;
      }
      if (matchKeyword(normalized, todayKeywords)) {
        summaryToday = true;
        continue;
      }
      if (matchKeyword(normalized, filenameKeywords)) {
        const name = this.tryParseNameArgument(tokens, i);
        if (name) summaryFilename = name;
        continue;
      }

      if (matchKeyword(normalized, startKeywords)) {
        actions.push({ kind: 'start' });
        continue;
      }
      if (matchKeyword(normalized, endKeywords)) {
        actions.push({ kind: 'end' });
        continue;
      }
      if (matchKeyword(normalized, addKeywords)) {
        const parsedKeys = this.tryParseToKeysInSameDirective(tokens, i);
        actions.push({ kind: 'add', keys: parsedKeys ?? undefined });
        continue;
      }
      if (matchKeyword(normalized, newKeywords)) {
        const parsedKeys = this.tryParseToKeysInSameDirective(tokens, i);
        actions.push({ kind: 'new', keys: parsedKeys ?? undefined });
        continue;
      }
      if (matchKeyword(normalized, fileKeywords)) {
        const name = this.tryParseNameArgument(tokens, i);
        const parsedKeys = this.tryParseToKeysInSameDirective(tokens, i);
        actions.push({ kind: 'file', name: name ?? undefined, keys: parsedKeys ?? undefined });
        continue;
      }
      if (matchKeyword(normalized, folderKeywords)) {
        const name = this.tryParseNameArgument(tokens, i);
        const parsedKeys = this.tryParseToKeysInSameDirective(tokens, i);
        actions.push({ kind: 'folder', name: name ?? undefined, keys: parsedKeys ?? undefined });
      }
    }

    const hasTimeToken = line.toLowerCase().includes('@time') || line.includes('@时间');
    const summary = seenSummary ? { isToday: summaryToday, filename: summaryFilename } : undefined;
    return { actions, hasTimeToken, summary };
  }

  private tryParseToKeysInSameDirective(tokens: string[], atIndex: number): string[] | null {
    // 支持：@add to key1,key2  或 @add:work 或 @add(work)
    const token = tokens[atIndex] || '';
    const inline = token.match(/^@[^:(\s]+[:(]([^)]+)\)?$/);
    if (inline?.[1]) {
      const keys = splitKeys(inline[1]);
      return keys.length ? keys : null;
    }

    // 扫描指令后续参数：允许 "@add xxx to key"（to 不必紧跟 @add）
    const known = this.getKnownKeys();

    for (let i = atIndex + 1; i < tokens.length; i += 1) {
      const t = tokens[i] || '';
      if (!t) continue;

      if (t.startsWith('@')) {
        const maybeTo = this.isToToken(t);
        if (!maybeTo) break; // 下一个指令开始，停止

        const keyToken = tokens[i + 1] || '';
        const keys = splitKeys(keyToken);
        if (!keys.length) return null;
        return keys;
      }

      const maybeTo = this.isToToken(t);
      if (!maybeTo) continue;

      const keyToken = tokens[i + 1] || '';
      const keys = splitKeys(keyToken);
      if (!keys.length) return null;

      if (maybeTo.kind === 'plain') {
        const allKnown = keys.every((k) => known.has(k));
        if (!allKnown) continue; // 当作普通文本的 to
      }

      return keys;
    }

    return null;
  }

  private getKnownKeys(): Set<string> {
    const keys = new Set<string>();
    const files = this.getQuickAddFiles();
    const folders = this.getQuickAddFolders();
    for (const k of Object.keys(files || {})) keys.add(k);
    for (const k of Object.keys(folders || {})) keys.add(k);
    const defAdd = this.getDefaultAddKey();
    const defNew = this.getDefaultNewKey();
    if (defAdd) keys.add(defAdd);
    if (defNew) keys.add(defNew);
    return keys;
  }

  private isToToken(token: string): { kind: 'at' | 'plain' } | null {
    const t = (token || '').trim();
    if (!t) return null;

    // @to：始终识别为 to（全 @关键字模式）
    if (t.startsWith('@')) {
      const inner = t.slice(1);
      if (inner.toLowerCase() === 'to' || inner === '到') return { kind: 'at' };
      return null;
    }

    // plain to：仅当后接“已配置 key”时才把它当作 to（避免误伤自然语言）
    if (t.toLowerCase() === 'to' || t === '到') return { kind: 'plain' };
    return null;
  }

  private tryParseToKeysFromFollowing(tokens: string[], atIndex: number): string[] | null {
    // 兼容旧方法：改为同一套实现，避免维护两份逻辑
    return this.tryParseToKeysInSameDirective(tokens, atIndex);
  }

  private tryParseNameArgument(tokens: string[], atIndex: number): string | null {
    const token = tokens[atIndex] || '';
    const inline = token.match(/^@[^:(\s]+[:(]([^)]+)\)?$/);
    if (inline?.[1]) {
      const v = inline[1].trim();
      return v ? v : null;
    }

    // 读取 @file/@folder 后面的参数：直到下一个 @xxx 或 @to/to key
    const parts: string[] = [];
    const known = this.getKnownKeys();

    for (let i = atIndex + 1; i < tokens.length; i += 1) {
      const t = tokens[i];
      if (!t) continue;
      if (t.startsWith('@')) break;

      const maybeTo = this.isToToken(t);
      if (maybeTo) {
        const next = tokens[i + 1] || '';
        const keys = splitKeys(next);
        if (maybeTo.kind === 'at') {
          break;
        }
        if (keys.length && keys.every((k) => known.has(k))) {
          break;
        }
      }

      parts.push(t);
    }

    const joined = parts.join(' ').trim();
    return joined ? joined : null;
  }

  private async executeActions(
    editor: vscode.TextEditor,
    doc: vscode.TextDocument,
    renderedLine: string,
    actions: Array<{ kind: ActionKind; keys?: string[]; name?: string }>,
    summary: ParsedActions['summary'],
    now: Date
  ): Promise<string | null> {
    // 冲突：同一行同时 start + end，弹窗让用户选择
    const hasStart = actions.some((a) => a.kind === 'start');
    const hasEnd = actions.some((a) => a.kind === 'end');
    let selectedActions = actions;

    if (hasStart && hasEnd) {
      const picked = await vscode.window.showQuickPick(
        [
          { label: '按开始执行', value: 'start' as const },
          { label: '按结束执行', value: 'end' as const },
          { label: '取消', value: 'cancel' as const },
        ],
        { placeHolder: '同一行同时包含 @start 与 @end，选择要执行的操作' }
      );
      if (!picked || picked.value === 'cancel') return null;
      selectedActions = actions.filter((a) => a.kind !== (picked.value === 'start' ? 'end' : 'start'));
    }

    // 执行顺序：end/start → new → file/folder → add → summary
    const order: ActionKind[] = ['end', 'start', 'new', 'file', 'folder', 'add'];
    const ordered = order.flatMap((k) => selectedActions.filter((a) => a.kind === k));

    const payload = extractPayload(renderedLine);
    const payloadForObsidian = this.extractPayloadRemovingKnownTargets(renderedLine);
    const results: string[] = [];

    for (const a of ordered) {
      if (a.kind === 'start') {
        if (!payload) throw new Error('无法从该行提取任务标题（@start 需要正文内容）。');
        const startResult = await this.startOrResumeByTitle(payload, now);
        if (startResult) {
          this.onDailyTasksChanged?.();
          results.push(startResult);
        }
        continue;
      }

      if (a.kind === 'end') {
        const endKeyword = (this.dailyLog.getEndKeywords()[0] || 'end').trim() || 'end';
        const textForMatch = payload ? `${endKeyword} ${payload}` : endKeyword;
        const res = await this.dailyLog.endTaskByText(textForMatch, now);
        if (res.ended) {
          this.onDailyTasksChanged?.();
          const ms =
            res.ended.durationMs ??
            (res.ended.end ? res.ended.end.getTime() - res.ended.start.getTime() : 0);
          void vscode.window.setStatusBarMessage(`已结束任务：${res.ended.title}`, 3000);
          results.push(formatDurationPrecise(ms));
          continue;
        }

        const candidates = res.candidates ?? [];
        if (!candidates.length) {
          const action = await vscode.window.showWarningMessage(
            '未匹配到可结束的运行中任务，是否将该行作为普通文本追加到今日日志？',
            '追加',
            '取消'
          );
          if (action === '追加') {
            await this.dailyLog.appendPlainTextToTodayLog(renderedLine, now);
            this.onDailyTasksChanged?.();
            results.push('已记录');
            continue;
          }
          return null;
        }

        const picked = await vscode.window.showQuickPick(
          candidates.map((t) => ({ label: t.title, description: t.id, id: t.id })),
          { placeHolder: '存在多个候选任务，请选择要结束的任务' }
        );
        if (!picked) return null;
        const ended = await this.dailyLog.endTaskById(picked.id, now);
        if (!ended) return null;
        this.onDailyTasksChanged?.();
        const ms =
          ended.durationMs ?? (ended.end ? ended.end.getTime() - ended.start.getTime() : 0);
        results.push(formatDurationPrecise(ms));
        continue;
      }

      if (a.kind === 'add') {
        const keys = a.keys && a.keys.length ? a.keys : [this.getDefaultAddKey()];
        if (!keys.length || !keys[0]) {
          throw new Error('未配置默认追加 key：请设置 otter.obsidian.quickAdd.defaultKey 或使用 “@add to key”。');
        }
        const appended = await this.appendToObsidianFiles(
          keys,
          payloadForObsidian || payload || renderedLine,
          now
        );
        results.push(`已追加:${appended.join(',')}`);
        continue;
      }

      if (a.kind === 'new') {
        const keys = a.keys && a.keys.length ? a.keys : [this.getDefaultNewKey()];
        if (!keys.length || !keys[0]) {
          throw new Error('未配置新建目录 key：请设置 otter.obsidian.quickAdd.defaultNewKey 或使用 “@new to key”。');
        }
        const created = await this.createInObsidianFolders(
          keys,
          payloadForObsidian || payload || renderedLine,
          now
        );
        results.push(`已新建:${created.join(',')}`);
        continue;
      }

      if (a.kind === 'file') {
        const name = (a.name || '').trim();
        if (!name) throw new Error('未提供文件名：请使用 “@file 文件名 @to key”。');
        const keys = a.keys && a.keys.length ? a.keys : [this.getDefaultNewKey()];
        if (!keys.length || !keys[0]) {
          throw new Error('未配置目标目录 key：请设置 otter.obsidian.quickAdd.defaultNewKey 或使用 “@file 文件名 to key”。');
        }
        const created = await this.createFilesInObsidianFolders(keys, name);
        results.push(`已创建文件:${created.join(',')}`);
        continue;
      }

      if (a.kind === 'folder') {
        const name = (a.name || '').trim();
        if (!name) throw new Error('未提供文件夹名：请使用 “@folder 文件夹名 @to key”。');
        const keys = a.keys && a.keys.length ? a.keys : [this.getDefaultNewKey()];
        if (!keys.length || !keys[0]) {
          throw new Error('未配置目标目录 key：请设置 otter.obsidian.quickAdd.defaultNewKey 或使用 “@folder 文件夹名 to key”。');
        }
        const created = await this.createFoldersInObsidianFolders(keys, name);
        results.push(`已创建文件夹:${created.join(',')}`);
      }
    }

    if (summary?.isToday) {
      results.push('已总结');
    }

    if (!results.length) return null;
    return `${renderedLine} (${results.join('; ')})`;
  }

  private getVaultPath(): string {
    return (this.config.get<string>('obsidian.vaultPath', '') || '').trim();
  }

  private getDefaultAddKey(): string {
    return (this.config.get<string>('obsidian.quickAdd.defaultKey', '') || '').trim();
  }

  private getDefaultNewKey(): string {
    return (this.config.get<string>('obsidian.quickAdd.defaultNewKey', '') || '').trim();
  }

  private getQuickAddFiles(): Record<string, string> {
    return this.config.get<Record<string, string>>('obsidian.quickAdd.files', {});
  }

  private getQuickAddFolders(): Record<string, string> {
    return this.config.get<Record<string, string>>('obsidian.quickAdd.folders', {});
  }

  private extractPayloadRemovingKnownTargets(line: string): string {
    const tokens = splitTokens(line);
    const out: string[] = [];
    const known = this.getKnownKeys();

    for (let i = 0; i < tokens.length; i += 1) {
      const t = tokens[i];
      if (!t) continue;

      if (t.startsWith('@')) {
        const base = getDirectiveBaseToken(t);
        const inner = base.slice(1);
        if (inner.toLowerCase() === 'to' || inner === '到') {
          i += 1; // skip key token
        }
        continue;
      }

      const maybeTo = this.isToToken(t);
      if (maybeTo?.kind === 'plain') {
        const keyToken = tokens[i + 1] || '';
        const keys = splitKeys(keyToken);
        if (keys.length && keys.every((k) => known.has(k))) {
          i += 1; // skip key token
          continue;
        }
      }

      out.push(t);
    }

    const raw = out.join(' ').trim();
    return raw.replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+/g, '').trim();
  }

  private async startOrResumeByTitle(titleInput: string, now: Date): Promise<string | null> {
    const title = (titleInput || '').trim();
    if (!title) throw new Error('任务标题不能为空。');

    const tasks = await this.dailyLog.listTodayTasks(now);
    const candidates = this.findStartCandidates(tasks, title);

    if (!candidates.length) {
      await this.dailyLog.startTask({ title, now });
      void vscode.window.setStatusBarMessage(`已开始：${title}`, 3000);
      return '已开始';
    }

    const formatTime = (d: Date) => formatDateTime(d, this.dailyLog.getTimeFormat());

    const items: Array<vscode.QuickPickItem & { pick: StartPick }> = [
      {
        label: `新建并开始：${title}`,
        description: '未选择已有任务（新建）',
        pick: { kind: 'new', title },
      },
      ...candidates.map((t) => ({
        label: t.end ? `已完成：${t.title}` : `运行中：${t.title}`,
        description: buildTaskDescription(t, now, formatTime),
        pick: t.end ? ({ kind: 'completed', task: t } as const) : ({ kind: 'running', task: t } as const),
      })),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: '检测到相似任务：选择要开始/继续的任务（支持模糊匹配）',
      matchOnDescription: true,
    });
    if (!picked) return null;

    if (picked.pick.kind === 'new') {
      await this.dailyLog.startTask({ title: picked.pick.title, now });
      void vscode.window.setStatusBarMessage(`已开始：${picked.pick.title}`, 3000);
      return '已开始';
    }

    if (picked.pick.kind === 'completed') {
      const continuedTitle = this.dailyLog.makeContinueTitle(picked.pick.task.title);
      await this.dailyLog.startTask({ title: continuedTitle, now });
      void vscode.window.setStatusBarMessage(`已继续：${continuedTitle}`, 3000);
      return '已继续';
    }

    // 运行中任务：需要让用户选择“保持运行/并行开始/结束后继续”
    const actionPicked = await vscode.window.showQuickPick(
      [
        { label: '保持运行（不重复开始）', value: 'keep' as const },
        { label: '并行开始一条新的同名任务', value: 'parallel' as const },
        { label: '结束该任务并继续（续）', value: 'restart' as const },
      ],
      { placeHolder: `该任务已在运行中：${picked.pick.task.title}` }
    );
    if (!actionPicked) return null;

    const action: RunningStartAction = actionPicked.value;
    if (action === 'keep') {
      void vscode.window.setStatusBarMessage(`该任务已在运行中：${picked.pick.task.title}`, 3000);
      return '已在运行中';
    }

    if (action === 'parallel') {
      await this.dailyLog.startTask({ title: picked.pick.task.title, now });
      void vscode.window.setStatusBarMessage(`已并行开始：${picked.pick.task.title}`, 3000);
      return '已开始';
    }

    // restart：先结束再继续（续）
    await this.dailyLog.endTaskById(picked.pick.task.id, now);
    const continuedTitle = this.dailyLog.makeContinueTitle(picked.pick.task.title);
    await this.dailyLog.startTask({ title: continuedTitle, now });
    void vscode.window.setStatusBarMessage(`已结束并继续：${continuedTitle}`, 3000);
    return '已继续';
  }

  private findStartCandidates(tasks: DailyTask[], queryTitle: string): DailyTask[] {
    const q = normalizeForMatch(queryTitle);
    if (!q) return [];

    const exactIds = new Set(
      tasks.filter((t) => normalizeForMatch(t.title) === q).map((t) => t.id)
    );

    const containsIds = new Set(
      tasks
        .filter((t) => {
          const tt = normalizeForMatch(t.title);
          if (!tt) return false;
          return tt.includes(q) || q.includes(tt);
        })
        .map((t) => t.id)
    );

    const fuse = new Fuse(tasks, {
      keys: ['title'],
      includeScore: true,
      threshold: 0.45,
      ignoreLocation: true,
      minMatchCharLength: 2,
    });
    const fuzzy = fuse.search(q).slice(0, 8).map((r) => r.item);
    const fuzzyIds = new Set(fuzzy.map((t) => t.id));

    const idSet = new Set<string>([...exactIds, ...containsIds, ...fuzzyIds]);
    if (!idSet.size) return [];

    // 任务列表本身已按 start 倒序；保持这个顺序并限制数量
    return uniqById(tasks.filter((t) => idSet.has(t.id))).slice(0, 8);
  }

  private resolveVaultRelative(p: string): string {
    const raw = (p || '').trim();
    if (!raw) return raw;
    if (path.isAbsolute(raw)) return raw;
    const vault = this.getVaultPath();
    if (!vault) {
      throw new Error('未配置 Obsidian Vault 路径（otter.obsidian.vaultPath）。');
    }
    return path.join(vault, raw);
  }

  private getQuickFileDefaultExtension(): string {
    const raw = (this.config.get<string>('obsidian.quickFile.defaultExtension', 'md') || '').trim();
    const ext = raw.replace(/^\./, '').trim();
    return ext || 'md';
  }

  private getSummaryMaxInputChars(): number {
    const n = this.config.get<number>('summary.maxInputChars', 12_000);
    return Number.isFinite(n) && n > 1000 ? Math.floor(n) : 12_000;
  }

  private getSummaryTemplate(): string {
    return (
      this.config.get<string>('summary.template', '') ||
      [
        '## {date} 今日总结',
        '',
        '### 任务用时（计时）',
        '{timedTasksTable}',
        '',
        '### 今日完成',
        '{ai}',
        '',
        '### 进行中/待办',
        '- （无）',
        '',
        '### 问题与解决',
        '- （无）',
        '',
        '### 明日计划',
        '- （无）',
        '',
        '> 来源：{draftFile}',
        '',
      ].join('\n')
    );
  }

  private getSummaryShowTemplatePreview(): boolean {
    return this.config.get<boolean>('summary.showTemplatePreviewBeforeRun', true);
  }

  private async summarizeToday(
    editor: vscode.TextEditor,
    doc: vscode.TextDocument,
    filenameOrKey: string | undefined,
    now: Date
  ): Promise<void> {
    const date = formatDateTime(now, 'YYYY-MM-DD');

    const target = (filenameOrKey || '').trim();
    const targetLabel = target ? `目标：${target}` : `目标：当前文件（${path.basename(doc.fileName)}）`;
    const action = await vscode.window.showInformationMessage(
      `生成今日总结（${date}）？${target ? '' : '（不指定 @filename 时只总结当前文件）'}\n${targetLabel}`,
      '生成',
      '取消'
    );
    if (action !== '生成') return;

    const timedTasksMarkdown = await this.buildTodayTimedTasksMarkdown(now);

    const draftFile = path.basename(doc.fileName || 'draft.md');
    const templateRaw = this.getSummaryTemplate();
    const templateFilled = replaceSummaryPlaceholders(templateRaw, {
      date,
      draftFile,
      timedTasksTable: timedTasksMarkdown,
    });

    if (this.getSummaryShowTemplatePreview()) {
      const preview = templateRaw.split(/\r?\n/).slice(0, 18).join('\n');
      const picked = await vscode.window.showInformationMessage(
        `将使用总结模板（前 18 行预览）：\n${preview}`,
        '继续',
        '打开设置',
        '取消'
      );
      if (!picked || picked === '取消') return;
      if (picked === '打开设置') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'otter.summary.template');
        return;
      }
    }

    const maxChars = this.getSummaryMaxInputChars();
    const fullText = doc.getText();
    const withoutExistingSummary = (() => {
      const existing = findTodaySummaryRange(fullText, date);
      if (!existing) return fullText;
      return fullText.slice(0, existing.startOffset) + fullText.slice(existing.endOffset);
    })();
    const draftText =
      withoutExistingSummary.length > maxChars
        ? withoutExistingSummary.slice(withoutExistingSummary.length - maxChars)
        : withoutExistingSummary;

    if (withoutExistingSummary.length > maxChars) {
      void vscode.window.showWarningMessage(
        `当前文件内容过长（${withoutExistingSummary.length} 字符），已截取末尾 ${maxChars} 字符用于总结。`
      );
    }

    const ai = new AIService(this.config);
    const systemPrompt =
      '你是一个资深全栈技术专家和软件架构师。请用中文输出简洁、结构化的 Markdown。\n' +
      '你将收到：计时任务清单（包含每项时长，精确到秒）与当前草稿内容，以及一个总结模板。\n' +
      '要求：\n' +
      '1) 只输出用于替换模板中 {ai} 的内容，不要输出其它小节标题，不要输出整份模板\n' +
      '2) 内容应聚焦“今日完成”，用 3-8 条要点覆盖主要工作；避免复述大段原文\n' +
      '3) 若草稿/计时任务中体现了问题与解决，可在要点中简要说明\n' +
      '4) 若无内容，输出：- （无）\n';

    const userPrompt =
      `【计时任务清单（自动生成，时长精确到秒）】\n${timedTasksMarkdown}\n\n` +
      `【总结模板（已注入计时任务表；其中 {ai} 需要你生成替换内容）】\n${templateFilled}\n\n` +
      `【今日任务文件（当前草稿内容）】\n${draftText}`;

    const summaryText = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Otter：正在生成今日总结…' },
      async () => {
        const text = await ai.chat(systemPrompt, userPrompt, { temperature: 0.3, maxUserChars: 20_000 });
        return (text || '').trim();
      }
    );

    const finalSummary = buildSummaryFromTemplate(templateFilled, summaryText);
    const block = `\n\n${ensureHasTodaySummaryHeading(finalSummary, date).trim()}\n`;

    if (!target) {
      await this.upsertSummaryIntoCurrentDocument(editor, doc, date, block);
      void vscode.window.showInformationMessage('已将今日总结写入当前文件。');
      return;
    }

    const targetFile = await this.resolveSummaryTargetFile(target);
    await this.upsertSummaryIntoFile(targetFile, date, block);
    void vscode.window.showInformationMessage(`已将今日总结写入：${path.basename(targetFile)}`);
  }

  private async upsertSummaryIntoCurrentDocument(
    editor: vscode.TextEditor,
    doc: vscode.TextDocument,
    date: string,
    block: string
  ): Promise<void> {
    const text = doc.getText();
    const existing = findTodaySummaryRange(text, date);
    let mode: 'append' | 'replace' = 'append';

    if (existing) {
      const picked = await vscode.window.showQuickPick(
        [
          { label: '替换今日总结小节', value: 'replace' as const },
          { label: '追加新的今日总结小节', value: 'append' as const },
          { label: '取消', value: 'cancel' as const },
        ],
        { placeHolder: `已存在 ${date} 今日总结，选择写入方式（弹窗必选）` }
      );
      if (!picked || picked.value === 'cancel') return;
      mode = picked.value;
    }

    await editor.edit(
      (eb) => {
        if (existing && mode === 'replace') {
          const start = doc.positionAt(existing.startOffset);
          const end = doc.positionAt(existing.endOffset);
          eb.replace(new vscode.Range(start, end), block.trimStart());
          return;
        }

        const endPos = doc.lineAt(doc.lineCount - 1).range.end;
        eb.insert(endPos, ensureLeadingNewlines(block, 2));
      },
      { undoStopBefore: true, undoStopAfter: true }
    );
  }

  private async upsertSummaryIntoFile(targetFile: string, date: string, block: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(targetFile)));

    await enqueueByKey(targetFile, async () => {
      let existingText = '';
      try {
        const bin = await vscode.workspace.fs.readFile(vscode.Uri.file(targetFile));
        existingText = Buffer.from(bin).toString('utf8');
      } catch {
        existingText = '';
      }

      const existing = findTodaySummaryRange(existingText, date);
      let mode: 'append' | 'replace' = 'append';

      if (existing) {
        const picked = await vscode.window.showQuickPick(
          [
            { label: '替换今日总结小节', value: 'replace' as const },
            { label: '追加新的今日总结小节', value: 'append' as const },
            { label: '取消', value: 'cancel' as const },
          ],
          { placeHolder: `目标文件已存在 ${date} 今日总结，选择写入方式（弹窗必选）` }
        );
        if (!picked || picked.value === 'cancel') return;
        mode = picked.value;
      }

      let next = existingText;
      if (existing && mode === 'replace') {
        next = existingText.slice(0, existing.startOffset) + block.trimStart() + existingText.slice(existing.endOffset);
      } else {
        next = (existingText || '') + ensureLeadingNewlines(block, 2);
      }

      await vscode.workspace.fs.writeFile(vscode.Uri.file(targetFile), Buffer.from(next, 'utf8'));
    });
  }

  private async resolveSummaryTargetFile(filenameOrKey: string): Promise<string> {
    const raw = (filenameOrKey || '').trim();
    if (!raw) throw new Error('未提供文件名。');

    const files = this.getQuickAddFiles();
    const asKey = files[raw];
    const target = asKey ? asKey : raw;

    const withExt = ensureFileExtension(target, this.getQuickFileDefaultExtension());
    const normalized = withExt.replace(/\\/g, '/');
    const fullPath = this.resolveVaultRelative(normalized);
    return fullPath;
  }

  private async buildTodayTimedTasksMarkdown(now: Date): Promise<string> {
    const tasks = await this.dailyLog.listTodayTasks(now);
    if (!tasks.length) return '_（今日暂无计时任务）_';

    const formatTs = (d: Date) => formatDateTime(d, this.dailyLog.getTimeFormat());
    const rows: string[] = [];
    rows.push('| 状态 | 开始 | 结束 | 时长 | 任务 |');
    rows.push('| --- | --- | --- | --- | --- |');

    const sorted = [...tasks].sort((a, b) => a.start.getTime() - b.start.getTime());
    for (const t of sorted) {
      const end = t.end ? t.end : undefined;
      const ms = t.durationMs ?? Math.max(0, (end ? end.getTime() : now.getTime()) - t.start.getTime());
      const status = end ? '已完成' : '运行中';
      const startText = formatTs(t.start);
      const endText = end ? formatTs(end) : '-';
      const durText = formatDurationPrecise(ms);
      const title = (t.title || '').replace(/\|/g, '\\|');
      rows.push(`| ${status} | ${startText} | ${endText} | ${durText} | ${title} |`);
    }

    return rows.join('\n');
  }

  private async createFilesInObsidianFolders(keys: string[], rawFilename: string): Promise<string[]> {
    const map = this.getQuickAddFolders();
    const created: string[] = [];

    const filename = ensureFileExtension(
      rawFilename,
      this.getQuickFileDefaultExtension()
    );

    for (const key of keys) {
      const folder = map[key];
      if (!folder) {
        throw new Error(`未找到 key 对应的目标文件夹：${key}（请配置 otter.obsidian.quickAdd.folders）`);
      }

      const folderPath = this.resolveVaultRelative(folder);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(folderPath));

      const desired = path.join(folderPath, ...sanitizeRelativePathParts(filename));
      const finalPath = await this.pickFileConflictResolution(desired, key);
      if (!finalPath) continue;

      await enqueueByKey(finalPath, async () => {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(finalPath)));
        await vscode.workspace.fs.writeFile(vscode.Uri.file(finalPath), Buffer.from('', 'utf8'));
      });

      created.push(`${key}/${path.relative(folderPath, finalPath)}`.replace(/\\/g, '/'));
      void vscode.window.setStatusBarMessage(`已创建文件：${key}/${path.basename(finalPath)}`, 3000);
    }

    return created;
  }

  private async createFoldersInObsidianFolders(keys: string[], rawFoldername: string): Promise<string[]> {
    const map = this.getQuickAddFolders();
    const created: string[] = [];

    for (const key of keys) {
      const folder = map[key];
      if (!folder) {
        throw new Error(`未找到 key 对应的目标文件夹：${key}（请配置 otter.obsidian.quickAdd.folders）`);
      }

      const folderPath = this.resolveVaultRelative(folder);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(folderPath));

      const desired = path.join(folderPath, ...sanitizeRelativePathParts(rawFoldername));
      const finalPath = await this.pickFolderConflictResolution(desired, key);
      if (!finalPath) continue;

      await vscode.workspace.fs.createDirectory(vscode.Uri.file(finalPath));
      created.push(`${key}/${path.relative(folderPath, finalPath)}`.replace(/\\/g, '/'));
      void vscode.window.setStatusBarMessage(`已创建文件夹：${key}/${path.basename(finalPath)}`, 3000);
    }

    return created;
  }

  private async pickFileConflictResolution(desiredPath: string, key: string): Promise<string | null> {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(desiredPath));
      // 若同名目录存在，必须改名或取消
      if (stat.type === vscode.FileType.Directory) {
        const picked = await vscode.window.showQuickPick(
          [
            { label: '自动改名创建', value: 'rename' as const },
            { label: '取消', value: 'cancel' as const },
          ],
          { placeHolder: `目标已存在且是文件夹：${key}/${path.basename(desiredPath)}` }
        );
        if (!picked || picked.value === 'cancel') return null;
        return this.makeUniquePath(desiredPath);
      }

      // 同名文件存在：弹窗必选
      const picked = await vscode.window.showQuickPick(
        [
          { label: '自动改名创建', value: 'rename' as const },
          { label: '覆盖', value: 'overwrite' as const },
          { label: '取消', value: 'cancel' as const },
        ],
        { placeHolder: `文件已存在：${key}/${path.basename(desiredPath)}（请选择处理方式）` }
      );
      if (!picked || picked.value === 'cancel') return null;
      if (picked.value === 'overwrite') return desiredPath;
      return this.makeUniquePath(desiredPath);
    } catch {
      return desiredPath;
    }
  }

  private async pickFolderConflictResolution(desiredPath: string, key: string): Promise<string | null> {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(desiredPath));
      if (stat.type === vscode.FileType.Directory) {
        // 已存在文件夹：视为成功，不再打扰
        return desiredPath;
      }

      // 同名文件存在：弹窗必选
      const picked = await vscode.window.showQuickPick(
        [
          { label: '自动改名创建', value: 'rename' as const },
          { label: '取消', value: 'cancel' as const },
        ],
        { placeHolder: `存在同名文件，无法创建文件夹：${key}/${path.basename(desiredPath)}（请选择处理方式）` }
      );
      if (!picked || picked.value === 'cancel') return null;
      return this.makeUniqueDirectoryPath(desiredPath);
    } catch {
      return desiredPath;
    }
  }

  private async makeUniqueDirectoryPath(desiredPath: string): Promise<string> {
    const dir = path.dirname(desiredPath);
    const base = path.basename(desiredPath);

    let candidate = desiredPath;
    for (let counter = 0; counter <= 1000; counter += 1) {
      if (counter > 0) {
        candidate = path.join(dir, `${base}-${counter}`);
      }
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
      } catch {
        return candidate;
      }
    }

    throw new Error('无法生成不冲突的文件夹名（重试次数过多）');
  }

  private async appendToObsidianFiles(keys: string[], text: string, now: Date): Promise<string[]> {
    const map = this.getQuickAddFiles();
    const written: string[] = [];

    for (const key of keys) {
      const target = map[key];
      if (!target) {
        throw new Error(`未找到 key 对应的目标文件：${key}（请配置 otter.obsidian.quickAdd.files）`);
      }
      const targetFile = this.resolveVaultRelative(target);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(targetFile)));

      // 目标是目录会导致 EISDIR：给出可操作的提示与一键降级路径
      try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(targetFile));
        if (stat.type === vscode.FileType.Directory) {
          const filenameCandidate = (text || '').trim().split(/\s+/)[0] || '';
          const looksLikeFile = /\.[A-Za-z0-9]{1,10}$/.test(filenameCandidate);

          const picks: Array<{ label: string; value: 'createInFolder' | 'openSettings' | 'cancel' }> = [
            { label: '打开设置（修正 key→文件 映射）', value: 'openSettings' },
            { label: '取消', value: 'cancel' },
          ];
          if (looksLikeFile) {
            picks.unshift({ label: `在该目录内创建并追加：${filenameCandidate}`, value: 'createInFolder' });
          }

          const picked = await vscode.window.showQuickPick(picks, {
            placeHolder: `追加目标是目录：${targetFile}（@add 需要写入文件）`,
          });
          if (!picked || picked.value === 'cancel') {
            return written;
          }
          if (picked.value === 'openSettings') {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'otter.obsidian.quickAdd.files');
            return written;
          }

          // createInFolder：把 “@add test.md to pm” 理解为“在 pm 对应目录下创建 test.md 并追加一条记录”
          const filePath = path.join(targetFile, ...sanitizeRelativePathParts(filenameCandidate));
          const created = await this.pickFileConflictResolution(filePath, key);
          if (!created) return written;

          const timeLabel = this.config.get<string>('time.format', 'YYYY-MM-DD HH:mm');
          const block = `\n\n## ${renderInlineTimeTokens('@time', now, timeLabel) ?? ''}\n\n${text.trimEnd()}\n`;

          await enqueueByKey(created, async () => {
            let existing = '';
            try {
              const bin = await vscode.workspace.fs.readFile(vscode.Uri.file(created));
              existing = Buffer.from(bin).toString('utf8');
            } catch {
              existing = '';
            }
            await vscode.workspace.fs.writeFile(vscode.Uri.file(created), Buffer.from(existing + block, 'utf8'));
          });

          written.push(key);
          continue;
        }
      } catch {
        // stat 失败说明文件尚不存在：继续按“创建文件并写入”走
      }

      const timeLabel = this.config.get<string>('time.format', 'YYYY-MM-DD HH:mm');
      const block = `\n\n## ${renderInlineTimeTokens('@time', now, timeLabel) ?? ''}\n\n${text.trimEnd()}\n`;

      await enqueueByKey(targetFile, async () => {
        let existing = '';
        try {
          const bin = await vscode.workspace.fs.readFile(vscode.Uri.file(targetFile));
          existing = Buffer.from(bin).toString('utf8');
        } catch {
          existing = '';
        }
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(targetFile),
          Buffer.from(existing + block, 'utf8')
        );
      });

      written.push(key);
    }

    return written;
  }

  private async createInObsidianFolders(keys: string[], text: string, now: Date): Promise<string[]> {
    const map = this.getQuickAddFolders();
    const created: string[] = [];
    const timestamp = formatTimestamp(now);
    const title = (text || '').trim().slice(0, 80) || '记录';
    const filename = sanitizeFilename(`${timestamp}-${title}`).slice(0, 120) + '.md';

    for (const key of keys) {
      const folder = map[key];
      if (!folder) {
        throw new Error(`未找到 key 对应的目标文件夹：${key}（请配置 otter.obsidian.quickAdd.folders）`);
      }
      const folderPath = this.resolveVaultRelative(folder);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(folderPath));

      const targetFile = await this.makeUniquePath(path.join(folderPath, filename));
      const content = `${text.trimEnd()}\n`;
      await enqueueByKey(targetFile, async () => {
        await vscode.workspace.fs.writeFile(vscode.Uri.file(targetFile), Buffer.from(content, 'utf8'));
      });

      created.push(`${key}/${path.basename(targetFile)}`);
    }

    return created;
  }

  private async makeUniquePath(desiredPath: string): Promise<string> {
    const dir = path.dirname(desiredPath);
    const ext = path.extname(desiredPath) || '.md';
    const base = path.basename(desiredPath, ext);

    let candidate = desiredPath;
    for (let counter = 0; counter <= 1000; counter += 1) {
      if (counter > 0) {
        candidate = path.join(dir, `${base}-${counter}${ext}`);
      }
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
      } catch {
        return candidate;
      }
    }
    throw new Error('无法生成不冲突的文件名（重试次数过多）');
  }

  private collectCandidateLines(
    doc: vscode.TextDocument,
    changes: readonly vscode.TextDocumentContentChangeEvent[]
  ): number[] {
    const sorted = [...changes].sort((a, b) => a.rangeOffset - b.rangeOffset);
    let delta = 0;
    const lines = new Set<number>();

    for (const change of sorted) {
      const text = change.text ?? '';
      const newlineMatches = text.match(/\r\n|\n/g);
      if (!newlineMatches?.length) {
        delta += text.length - change.rangeLength;
        continue;
      }

      if (newlineMatches.length !== 1) {
        delta += text.length - change.rangeLength;
        continue;
      }

      if (change.range.start.line !== change.range.end.line) {
        delta += text.length - change.rangeLength;
        continue;
      }

      if (text.length > 200) {
        delta += text.length - change.rangeLength;
        continue;
      }

      const startOffsetInNewDoc = change.rangeOffset + delta;
      const startPosInNewDoc = doc.positionAt(startOffsetInNewDoc);
      const lineIndex = startPosInNewDoc.line;

      const parts = text.split(/\r\n|\n/);
      const expectedNextLinePrefix = parts[1] ?? '';
      if (lineIndex + 1 < doc.lineCount) {
        const nextLineText = doc.lineAt(lineIndex + 1).text;
        if (!nextLineText.startsWith(expectedNextLinePrefix)) {
          delta += text.length - change.rangeLength;
          continue;
        }
        const remainder = nextLineText.slice(expectedNextLinePrefix.length);
        if (remainder.trim().length > 0) {
          delta += text.length - change.rangeLength;
          continue;
        }
      }

      lines.add(lineIndex);
      delta += text.length - change.rangeLength;
    }

    return [...lines].sort((a, b) => a - b);
  }
}

type StartPick =
  | { kind: 'new'; title: string }
  | { kind: 'running'; task: DailyTask }
  | { kind: 'completed'; task: DailyTask };

type RunningStartAction = 'keep' | 'parallel' | 'restart';

function buildTaskDescription(
  task: DailyTask,
  now: Date,
  formatTime: (d: Date) => string
): string {
  const start = formatTime(task.start);
  if (!task.end) {
    return `开始：${start}（已运行 ${formatDurationCompact(Math.max(0, now.getTime() - task.start.getTime()))}）`;
  }
  const end = formatTime(task.end);
  const ms = task.durationMs ?? Math.max(0, task.end.getTime() - task.start.getTime());
  return `开始：${start} → ${end}（用时 ${formatDurationCompact(ms)}）`;
}

function uniqById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

function splitTokens(line: string): string[] {
  return (line || '')
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function getDirectiveBaseToken(token: string): string {
  const t = (token || '').trim();
  if (!t.startsWith('@')) return t;
  const m = t.match(/^@[^:(\s]+/);
  return m ? m[0] : t;
}

function splitKeys(raw: string): string[] {
  return (raw || '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ensureFileExtension(rawFilename: string, defaultExtension: string): string {
  const input = (rawFilename || '').trim();
  if (!input) return input;

  const normalized = input.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length) return input;

  const last = parts[parts.length - 1];
  const ext = path.posix.extname(last);
  if (ext) return normalized;

  const extClean = (defaultExtension || 'md').replace(/^\./, '').trim() || 'md';
  parts[parts.length - 1] = `${last}.${extClean}`;
  return parts.join('/');
}

function sanitizeRelativePathParts(raw: string): string[] {
  const input = (raw || '').trim();
  if (!input) throw new Error('名称不能为空。');

  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '');
  if (/^[A-Za-z]:\//.test(normalized) || path.isAbsolute(normalized)) {
    throw new Error('不支持绝对路径，请只输入文件名/相对路径。');
  }

  const parts = normalized.split('/').filter(Boolean);
  const out: string[] = [];

  for (const p of parts) {
    if (p === '.' || p === '..') {
      throw new Error('名称中不允许包含 "." 或 ".."。');
    }
    const seg = sanitizePathSegment(p);
    if (!seg) {
      throw new Error('名称包含非法字符，无法创建。');
    }
    out.push(seg);
  }

  if (!out.length) throw new Error('名称不能为空。');
  return out;
}

function sanitizePathSegment(raw: string): string {
  let s = (raw || '').replace(/[\x00-\x1F]/g, '').trim();
  if (!s) return '';

  // 替换 Windows 不允许的字符，但保留空格（不强制转短横线）
  s = s.replace(/[<>:"/\\|?*]/g, '-');
  // Windows 不允许以空格/点结尾
  s = s.replace(/[. ]+$/g, '');
  // 避免隐藏文件/特殊路径
  s = s.replace(/^\.+/g, '');

  return s.trim();
}

function extractPayload(line: string): string {
  // 去掉所有 @xxx token 以及 to key 参数，保留人类可读内容
  const tokens = splitTokens(line);
  const out: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.startsWith('@')) {
      // 跳过指令 token，自身不进入 payload
      const inner = t.slice(1);
      if (inner.toLowerCase() === 'to' || inner === '到') {
        // 跳过 "@to key"
        i += 1;
      }
      continue;
    }

    // 仅当 to/到 出现在指令之后时，才视为参数分隔符，避免误伤自然语言
    if ((t.toLowerCase() === 'to' || t === '到') && i > 0 && tokens[i - 1].startsWith('@')) {
      i += 1; // 跳过 key
      continue;
    }
    out.push(t);
  }

  const raw = out.join(' ').trim();
  // 去掉行首时间戳（兼容秒）
  return raw.replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+/g, '').trim();
}

function formatTimestamp(now: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  return `${date}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
}

function ensureLeadingNewlines(text: string, count: number): string {
  const wanted = '\n'.repeat(Math.max(0, count));
  const trimmed = text.replace(/^\n+/, '');
  return wanted + trimmed;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findTodaySummaryRange(
  text: string,
  date: string
): { startOffset: number; endOffset: number } | null {
  const re = new RegExp(`^##\\s*${escapeRegExp(date)}\\s+今日总结\\s*$`, 'm');
  const m = re.exec(text);
  if (!m) return null;

  const startOffset = m.index;
  const lineEnd = text.indexOf('\n', startOffset);
  const afterLine = lineEnd >= 0 ? lineEnd + 1 : text.length;

  const rest = text.slice(afterLine);
  const next = rest.search(/^##\s+/m);
  const endOffset = next >= 0 ? afterLine + next : text.length;
  return { startOffset, endOffset };
}

function replaceSummaryPlaceholders(
  template: string,
  vars: { date: string; draftFile: string; timedTasksTable: string }
): string {
  return (template || '')
    .replace(/\{date\}/g, vars.date)
    .replace(/\{draftFile\}/g, vars.draftFile)
    .replace(/\{timedTasksTable\}/g, vars.timedTasksTable);
}

function buildSummaryFromTemplate(templateFilled: string, aiText: string): string {
  const ai = (aiText || '').trim() || '- （无）';
  if (templateFilled.includes('{ai}')) {
    return templateFilled.replace(/\{ai\}/g, ai);
  }

  // 兼容：用户模板未放置 {ai}，则将 AI 内容追加到模板末尾
  return `${templateFilled.trimEnd()}\n\n### 今日完成\n\n${ai}\n`;
}

function ensureHasTodaySummaryHeading(text: string, date: string): string {
  const t = (text || '').trim();
  if (!t) return `## ${date} 今日总结\n\n- （无）`;
  if (new RegExp(`^##\\s*${escapeRegExp(date)}\\s+今日总结\\s*$`, 'm').test(t)) return t;
  return `## ${date} 今日总结\n\n${t}`;
}
