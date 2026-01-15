import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigurationService } from './ConfigurationService';
import { enqueueByKey } from '../utils/WriteQueue';
import { formatDateTime, renderInlineTimeTokens, renderTimeCommandLine } from '../utils/TimeCommand';
import { generateId } from '../utils/helpers';
import {
  buildEndKeywordMatcher,
  containsEndKeyword,
  DailyTask,
  extractCandidateTitleFromEndText,
  formatDurationPrecise,
  fuzzyPickTaskByTitle,
  parseDailyLog,
} from '../utils/DailyLogTaskParser';
import { appendSupplementToTaskBlock } from '../utils/DailyLogTaskSupplement';

export type EndMode = 'byId' | 'byText';

export interface DailyLogPaths {
  dailyLogDir: string;
  dailyLogFile: string;
}

export class DailyLogService {
  constructor(private readonly context: vscode.ExtensionContext, private readonly config: ConfigurationService) {}

  getAutoDetectOnEnterEnabled(): boolean {
    return this.config.get<boolean>('dailyLog.autoDetectOnEnter', true);
  }

  getEndKeywords(): string[] {
    return this.config.get<string[]>('dailyLog.endKeywords', ['结束', 'end', 'over']);
  }

  getTimeFormat(): string {
    return this.config.get<string>(
      'dailyLog.timeFormat',
      this.config.get<string>('time.format', 'YYYY-MM-DD HH:mm')
    );
  }

  getDurationFormat(): 'compact' {
    return 'compact';
  }

  /** 生成“继续任务”的标题：默认在末尾追加 (续) */
  makeContinueTitle(title: string): string {
    const t = (title || '').trim();
    if (!t) return t;
    if (/\(\s*续\s*\)\s*$/u.test(t)) return t;
    if (/（\s*续\s*）\s*$/u.test(t)) return t;
    return `${t} (续)`;
  }

  private getTaskAnchor(): string {
    return '<!-- otter:tasks -->';
  }

  private getNotesAnchor(): string {
    return '<!-- otter:notes -->';
  }

  private formatIsoWeek(now: Date): string {
    // ISO week date
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = (d.getDay() + 6) % 7; // Mon=0..Sun=6
    d.setDate(d.getDate() - day + 3); // move to Thursday

    const firstThursday = new Date(d.getFullYear(), 0, 4);
    const firstDay = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - firstDay + 3);

    const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / 604800000);
    const weekYear = d.getFullYear();
    return `${weekYear}-W${String(week).padStart(2, '0')}`;
  }

  private buildDefaultTodayLogTemplate(now: Date): string {
    const date = formatDateTime(now, 'YYYY-MM-DD');
    const week = this.formatIsoWeek(now);

    return [
      '---',
      'tags:',
      '  - Worklog',
      `date: ${date}`,
      `周次: ${week}`,
      'status: 记录中',
      '---',
      '',
      `# ${date}｜工作日志`,
      '',
      '## 今日焦点',
      '- ',
      '',
      '## 快速记录',
      this.getNotesAnchor(),
      '',
      '## 计时任务',
      this.getTaskAnchor(),
      '',
      '## 风险/阻塞',
      '- ',
      '',
      '## 今日产出',
      '- ',
      '',
      '## 明日计划',
      '- [ ] ',
      '',
    ].join('\n');
  }

  private insertBlockByAnchor(existingText: string, anchor: string, block: string): string {
    const text = existingText || '';
    const a = (anchor || '').trim();
    if (!a) return text + block;

    const idx = text.indexOf(a);
    const insertion = ensureLeadingNewlines(block, 2).replace(/\n+$/g, '') + '\n\n';

    if (idx < 0) {
      return text + insertion;
    }

    const before = text.slice(0, idx).replace(/\s*$/g, '');
    const after = text.slice(idx).replace(/^\n+/g, '');
    return before + insertion + after;
  }

  /** 获取今日日志文件路径；相对目录会基于 vaultPath */
  getTodayLogPaths(now = new Date()): DailyLogPaths {
    const vaultPath = (this.config.get<string>('obsidian.vaultPath', '') || '').trim();
    const configuredDir = (this.config.get<string>('dailyLog.directory', '') || '').trim();

    const date = formatDateTime(now, 'YYYY-MM-DD');
    const filenameTemplate = this.config.get<string>('dailyLog.filenameTemplate', '{date}.md');
    const filename = filenameTemplate.replace(/\{date\}/g, date);

    let dailyLogDir = configuredDir;
    if (!dailyLogDir) {
      if (!vaultPath) {
        throw new Error('未配置 Obsidian Vault 路径：请先设置 otter.obsidian.vaultPath，或配置 otter.dailyLog.directory 为绝对路径。');
      }
      dailyLogDir = vaultPath;
    } else if (!path.isAbsolute(dailyLogDir)) {
      if (!vaultPath) {
        throw new Error('今日日志目录为相对路径，但未配置 Obsidian Vault 路径（otter.obsidian.vaultPath）。');
      }
      dailyLogDir = path.join(vaultPath, dailyLogDir);
    }

    const dailyLogFile = path.join(dailyLogDir, filename);
    return { dailyLogDir, dailyLogFile };
  }

  async ensureTodayLogExists(now = new Date()): Promise<DailyLogPaths> {
    const paths = this.getTodayLogPaths(now);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(paths.dailyLogDir));
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(paths.dailyLogFile));
    } catch {
      // 新建文件：写入简化版 Obsidian 工作日志模板
      const tpl = this.buildDefaultTodayLogTemplate(now);
      await vscode.workspace.fs.writeFile(vscode.Uri.file(paths.dailyLogFile), Buffer.from(tpl, 'utf8'));
    }

    // 若文件存在但为空，则补写模板（避免旧版本创建空文件）
    try {
      const bin = await vscode.workspace.fs.readFile(vscode.Uri.file(paths.dailyLogFile));
      const existing = Buffer.from(bin).toString('utf8');
      if (!existing.trim()) {
        const tpl = this.buildDefaultTodayLogTemplate(now);
        await vscode.workspace.fs.writeFile(vscode.Uri.file(paths.dailyLogFile), Buffer.from(tpl, 'utf8'));
      }
    } catch {
      // ignore
    }
    return paths;
  }

  async readTodayLog(now = new Date()): Promise<{ paths: DailyLogPaths; text: string }> {
    const paths = await this.ensureTodayLogExists(now);
    const bin = await vscode.workspace.fs.readFile(vscode.Uri.file(paths.dailyLogFile));
    return { paths, text: Buffer.from(bin).toString('utf8') };
  }

  async listTodayTasks(now = new Date()): Promise<DailyTask[]> {
    const { text } = await this.readTodayLog(now);
    return parseDailyLog(text).tasks;
  }

  async startTask(options: { title: string; now?: Date; rawSelection?: string }): Promise<DailyTask> {
    const now = options.now ?? new Date();
    const { paths } = await this.readTodayLog(now);
    const id = generateId();
    const ts = formatDateTime(now, this.getTimeFormat());

    const title = (options.title || '').trim();
    if (!title) {
      throw new Error('任务标题不能为空');
    }

    const marker = `<!-- otter-task:id=${id} -->`;
    const heading = `### ${ts} ${title} --- ${marker}`;
    const bodyLine = `${ts} ${title}`;

    const block = `\n\n${heading}\n\n${bodyLine}\n`;

    await enqueueByKey(paths.dailyLogFile, async () => {
      const bin = await vscode.workspace.fs.readFile(vscode.Uri.file(paths.dailyLogFile));
      const existing = Buffer.from(bin).toString('utf8');
      const next = this.insertBlockByAnchor(existing, this.getTaskAnchor(), block);
      await vscode.workspace.fs.writeFile(vscode.Uri.file(paths.dailyLogFile), Buffer.from(next, 'utf8'));
    });

    // 重新解析，返回最新任务
    const tasks = await this.listTodayTasks(now);
    const created = tasks.find((t) => t.id === id);
    if (!created) {
      return { id, title, start: now, startLine: -1 };
    }
    return created;
  }

  async endTaskById(taskId: string, now = new Date()): Promise<DailyTask | null> {
    const { paths, text } = await this.readTodayLog(now);
    const parsed = parseDailyLog(text);
    const task = parsed.tasks.find((t) => t.id === taskId);
    if (!task) return null;
    if (task.end) return task; // 已结束

    const endTime = now;
    const durationMs = Math.max(0, endTime.getTime() - task.start.getTime());
    const durationText = formatDurationPrecise(durationMs);

    const startTs = formatDateTime(task.start, this.getTimeFormat());
    const endTs = formatDateTime(endTime, this.getTimeFormat());
    const marker = `<!-- otter-task:id=${taskId} -->`;

    const updatedHeadingBase = `✓ ${startTs} ${task.title} (${durationText}) --- ${marker}`;
    const endSectionTimeLine = `${endTs}`;
    const endLine = `${endTs} ${task.title} 结束 --> (${durationText}) ${marker}`;
    const endBlock = `\n\n${endSectionTimeLine}\n\n${endLine}\n`;

    await enqueueByKey(paths.dailyLogFile, async () => {
      const bin = await vscode.workspace.fs.readFile(vscode.Uri.file(paths.dailyLogFile));
      const current = Buffer.from(bin).toString('utf8');
      const { lines } = parseDailyLog(current);

      // 定位开始标题行：包含 id 且以 # 开头
      const startLineIndex =
        task.startLine >= 0 && task.startLine < lines.length
          ? task.startLine
          : lines.findIndex((l) => l.includes(marker) && l.trimStart().startsWith('#'));
      if (startLineIndex >= 0) {
        const existingLine = lines[startLineIndex] || '';
        const hash = existingLine.match(/^\s*#+/)?.[0] || '###';
        lines[startLineIndex] = `${hash} ${updatedHeadingBase}`;
      }

      const nextText = lines.join('\n');
      const next = this.insertBlockByAnchor(nextText, this.getTaskAnchor(), endBlock);
      await vscode.workspace.fs.writeFile(vscode.Uri.file(paths.dailyLogFile), Buffer.from(next, 'utf8'));
    });

    const tasks = await this.listTodayTasks(now);
    return tasks.find((t) => t.id === taskId) ?? null;
  }

  /**
   * 基于“文本输出”结束任务：从选区中提取候选标题 -> 在运行中任务中模糊匹配 -> 结束
   * - 返回：结束成功的任务；若需要用户选择则返回候选列表
   */
  async endTaskByText(
    selectionText: string,
    now = new Date()
  ): Promise<{ ended?: DailyTask; candidates?: DailyTask[]; candidateTitle: string }> {
    const tasks = await this.listTodayTasks(now);
    const running = tasks.filter((t) => !t.end);

    const keywordPatterns = buildEndKeywordMatcher(this.getEndKeywords());
    const candidateTitle = extractCandidateTitleFromEndText(selectionText, keywordPatterns);

    if (running.length === 1) {
      const ended = await this.endTaskById(running[0].id, now);
      return { ended: ended ?? undefined, candidateTitle };
    }

    const picked = fuzzyPickTaskByTitle(running, candidateTitle);
    if (picked.length === 1) {
      const ended = await this.endTaskById(picked[0].id, now);
      return { ended: ended ?? undefined, candidateTitle };
    }

    return { candidates: picked, candidateTitle };
  }

  /**
   * 将一段文本“补充到任务”下方：
   * - 会写入到任务开始标题块内（含 task id 的标题行后面的块）
   * - 若不存在“#### 补充”小节，会自动创建
   * - 内容以 ```text 代码块原样追加，避免破坏 Markdown
   */
  async appendToTaskById(taskId: string, text: string, now = new Date()): Promise<void> {
    const { paths } = await this.readTodayLog(now);

    await enqueueByKey(paths.dailyLogFile, async () => {
      const bin = await vscode.workspace.fs.readFile(vscode.Uri.file(paths.dailyLogFile));
      const current = Buffer.from(bin).toString('utf8');
      const nextText = appendSupplementToTaskBlock(current, taskId, text);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(paths.dailyLogFile),
        Buffer.from(nextText, 'utf8')
      );
    });
  }

  async appendPlainTextToTodayLog(text: string, now = new Date()): Promise<void> {
    const { paths } = await this.readTodayLog(now);
    const ts = formatDateTime(now, this.getTimeFormat());
    const block = `\n\n${ts}\n\n${text.trimEnd()}\n`;

    await enqueueByKey(paths.dailyLogFile, async () => {
      const bin = await vscode.workspace.fs.readFile(vscode.Uri.file(paths.dailyLogFile));
      const existing = Buffer.from(bin).toString('utf8');
      const next = this.insertBlockByAnchor(existing, this.getNotesAnchor(), block);
      await vscode.workspace.fs.writeFile(vscode.Uri.file(paths.dailyLogFile), Buffer.from(next, 'utf8'));
    });
  }

  /**
   * 对选中文本执行 @time 渲染（行内 token + 引用块命令行）
   */
  renderTimeInSelection(selection: string, now = new Date()): string {
    const defaultFormat = this.getTimeFormat();
    const lines = (selection || '').split(/\r?\n/);
    const out: string[] = [];

    for (const line of lines) {
      const replacedBlock = renderTimeCommandLine(line, now, defaultFormat);
      if (replacedBlock !== null) {
        out.push(replacedBlock);
        continue;
      }

      const replacedInline = renderInlineTimeTokens(line, now, defaultFormat);
      out.push(replacedInline !== null ? replacedInline : line);
    }

    return out.join('\n');
  }

  selectionLooksLikeEnd(selection: string): boolean {
    const patterns = buildEndKeywordMatcher(this.getEndKeywords());
    return containsEndKeyword(selection, patterns);
  }
}

function ensureLeadingNewlines(text: string, count: number): string {
  const wanted = '\n'.repeat(Math.max(0, count));
  const trimmed = (text || '').replace(/^\n+/, '');
  return wanted + trimmed;
}
