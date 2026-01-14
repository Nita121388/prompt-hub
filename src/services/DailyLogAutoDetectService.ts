import * as vscode from 'vscode';
import { DailyLogService } from './DailyLogService';
import { formatDurationCompact, formatDurationPrecise } from '../utils/DailyLogTaskParser';
import { formatDateTime } from '../utils/TimeCommand';

export class DailyLogAutoDetectService {
  private readonly processingDocs = new Set<string>();

  constructor(private readonly dailyLog: DailyLogService) {}

  bindAutoDetectOnEnter(context: vscode.ExtensionContext): void {
    const disposable = vscode.workspace.onDidChangeTextDocument((e) => {
      void this.maybeHandleEndDirectiveOnEnter(e);
    });
    context.subscriptions.push(disposable);
  }

  private async maybeHandleEndDirectiveOnEnter(e: vscode.TextDocumentChangeEvent): Promise<void> {
    const doc = e.document;
    const docKey = doc.uri.toString();

    if (this.processingDocs.has(docKey)) return;

    const enabled = this.dailyLog.getAutoDetectOnEnterEnabled();
    if (!enabled) return;

    const isMarkdown = doc.languageId === 'markdown' || doc.fileName.toLowerCase().endsWith('.md');
    if (!isMarkdown) return;

    const candidateLines = this.collectCandidateLines(doc, e.contentChanges);
    if (!candidateLines.length) return;

    const editor = vscode.window.visibleTextEditors.find((ed) => ed.document.uri.toString() === docKey);
    if (!editor) return;

    const endKeywords = this.dailyLog.getEndKeywords();
    const now = new Date();

    for (const line of candidateLines) {
      if (line < 0 || line >= doc.lineCount) continue;
      const original = doc.lineAt(line).text;

      const directive = this.tryParseEndDirective(original, endKeywords);
      if (!directive) continue;

      // 避免重复触发：若末尾已存在 (xh ym zs) 之类时长，则跳过
      if (/\(\s*\d+(?:h|m|s)/i.test(original.trimEnd())) continue;

      this.processingDocs.add(docKey);
      try {
        await this.handleDirective(editor, line, original, directive.textForMatch, now);
      } finally {
        this.processingDocs.delete(docKey);
      }
    }
  }

  private async handleDirective(
    editor: vscode.TextEditor,
    line: number,
    originalLineText: string,
    textForMatch: string,
    now: Date
  ): Promise<void> {
    const res = await this.dailyLog.endTaskByText(textForMatch, now);

    if (res.ended) {
      const durationMs = res.ended.durationMs ?? (res.ended.end ? res.ended.end.getTime() - res.ended.start.getTime() : 0);
      const durationText = formatDurationPrecise(durationMs);
      const rewritten = this.rewriteDirectiveLine(originalLineText, durationText);
      await editor.edit(
        (eb) => eb.replace(editor.document.lineAt(line).range, rewritten),
        { undoStopBefore: false, undoStopAfter: false }
      );
      void vscode.window.showInformationMessage(`已结束任务：${res.ended.title}（${durationText}）`);
      return;
    }

    const candidates = res.candidates ?? [];
    if (!candidates.length) {
      const action = await vscode.window.showWarningMessage(
        '未匹配到可结束的运行中任务，是否将这段文本作为普通文本追加到今日日志？',
        '追加',
        '取消'
      );
      if (action === '追加') {
        await this.dailyLog.appendPlainTextToTodayLog(textForMatch, now);
        void vscode.window.showInformationMessage('已追加到今日日志。');
      }
      return;
    }

    const picked = await vscode.window.showQuickPick(
      candidates.map((t) => ({
        label: t.title,
        description: `开始：${formatDateTime(t.start, this.dailyLog.getTimeFormat())}（运行中 ${formatDurationCompact(
          Math.max(0, now.getTime() - t.start.getTime())
        )}）`,
        id: t.id,
      })),
      { placeHolder: '存在多个候选任务，请选择要结束的任务' }
    );
    if (!picked) return;

    const ended = await this.dailyLog.endTaskById(picked.id, now);
    if (!ended) return;

    const durationMs = ended.durationMs ?? (ended.end ? ended.end.getTime() - ended.start.getTime() : 0);
    const durationText = formatDurationPrecise(durationMs);
    const rewritten = this.rewriteDirectiveLine(originalLineText, durationText);
    await editor.edit(
      (eb) => eb.replace(editor.document.lineAt(line).range, rewritten),
      { undoStopBefore: false, undoStopAfter: false }
    );
    void vscode.window.showInformationMessage(`已结束任务：${ended.title}（${durationText}）`);
  }

  private rewriteDirectiveLine(original: string, durationText: string): string {
    const trimmed = original.trimEnd();
    const withoutTrailingDuration = trimmed.replace(/\s*\(\s*\d+(?:h|m|s)[^)]*\)\s*$/i, '');
    return `${withoutTrailingDuration} (${durationText})`;
  }

  private tryParseEndDirective(
    line: string,
    keywords: string[]
  ): { keyword: string; textForMatch: string } | null {
    const raw = (line || '').trim();
    if (!raw.startsWith('@')) return null;

    // 允许：@end xxx / @ end xxx / @结束 xxx
    const m = raw.match(/^@\s*([^\s]+)\s*(.*)$/);
    if (!m) return null;
    const keyword = m[1] || '';
    const rest = (m[2] || '').trim();

    const matched = (keywords || []).some((k) => {
      const kk = (k || '').trim();
      if (!kk) return false;
      if (/^[A-Za-z0-9_]+$/.test(kk)) return kk.toLowerCase() === keyword.toLowerCase();
      return kk === keyword;
    });
    if (!matched) return null;

    // 让后续的 endTaskByText 能通过关键字识别：保留 keyword
    return { keyword, textForMatch: `${keyword} ${rest}`.trim() };
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
