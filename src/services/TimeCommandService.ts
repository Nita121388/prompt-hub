import * as vscode from 'vscode';
import { ConfigurationService } from './ConfigurationService';
import { renderInlineTimeTokens, renderTimeCommandLine } from '../utils/TimeCommand';

export class TimeCommandService {
  private readonly renderingDocs = new Set<string>();

  constructor(private readonly config: ConfigurationService) {}

  bindAutoRenderOnEnter(context: vscode.ExtensionContext): void {
    const disposable = vscode.workspace.onDidChangeTextDocument((e) => {
      void this.maybeRenderTimeCommandOnEnter(e);
    });
    context.subscriptions.push(disposable);
  }

  private async maybeRenderTimeCommandOnEnter(
    e: vscode.TextDocumentChangeEvent
  ): Promise<void> {
    const doc = e.document;
    const docKey = doc.uri.toString();

    if (this.renderingDocs.has(docKey)) return;

    const enabled = this.config.get<boolean>('time.autoRenderOnEnter', true);
    if (!enabled) return;

    const isMarkdown =
      doc.languageId === 'markdown' || doc.fileName.toLowerCase().endsWith('.md');
    if (!isMarkdown) return;

    const candidateLines = this.collectCandidateLines(doc, e.contentChanges);
    if (!candidateLines.length) return;

    const editor = vscode.window.visibleTextEditors.find(
      (ed) => ed.document.uri.toString() === docKey
    );
    if (!editor) return;

    const defaultFormat = this.config.get<string>('time.format', 'YYYY-MM-DD HH:mm');
    const now = new Date();

    const edits: Array<{ line: number; rendered: string }> = [];
    for (const line of candidateLines) {
      if (line < 0 || line >= doc.lineCount) continue;
      const original = doc.lineAt(line).text;
      const renderedBlock = renderTimeCommandLine(original, now, defaultFormat);
      if (renderedBlock && renderedBlock !== original) {
        edits.push({ line, rendered: renderedBlock });
        continue;
      }

      const renderedInline = renderInlineTimeTokens(original, now, defaultFormat);
      if (renderedInline && renderedInline !== original) {
        edits.push({ line, rendered: renderedInline });
      }
    }

    if (!edits.length) return;

    this.renderingDocs.add(docKey);
    try {
      await editor.edit(
        (editBuilder) => {
          for (const { line, rendered } of edits) {
            if (line < 0 || line >= doc.lineCount) continue;
            editBuilder.replace(doc.lineAt(line).range, rendered);
          }
        },
        { undoStopBefore: false, undoStopAfter: false }
      );
    } finally {
      this.renderingDocs.delete(docKey);
    }
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

      // 仅处理单次换行（典型 Enter）。多次换行通常是粘贴/批量编辑，直接跳过。
      if (newlineMatches.length !== 1) {
        delta += text.length - change.rangeLength;
        continue;
      }

      // 跨行替换通常不是 Enter 行为，跳过。
      if (change.range.start.line !== change.range.end.line) {
        delta += text.length - change.rangeLength;
        continue;
      }

      // 大段插入通常是粘贴：为避免意外改写，跳过。
      if (text.length > 200) {
        delta += text.length - change.rangeLength;
        continue;
      }

      const startOffsetInNewDoc = change.rangeOffset + delta;
      const startPosInNewDoc = doc.positionAt(startOffsetInNewDoc);
      const lineIndex = startPosInNewDoc.line;

      // 进一步确认：下一行不应携带“原行剩余内容”，否则说明不是在行尾 Enter。
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
