import * as vscode from 'vscode';

/**
 * 让选区可通过“灯泡”快速触发 Prompt Hub 搜索的 CodeActionProvider
 */
export class PromptSearchCodeActionProvider implements vscode.CodeActionProvider {
  /**
   * 声明支持的 CodeAction 类型
   */
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    _document: vscode.TextDocument,
    range: vscode.Range,
    _context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.CodeAction[] | undefined {
    // 仅在有选区时提供灯泡操作
    if (range.isEmpty) return;

    const title = '🔍 搜索 Prompt（选中内容）';
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.command = {
      title,
      command: 'promptHub.searchPrompt',
    };

    return [action];
  }
}
