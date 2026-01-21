import * as vscode from 'vscode';
import { TrackedFileService } from '../services/TrackedFileService';

export class TrackedFileDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri[] | undefined>();

  readonly onDidChangeFileDecorations = this._onDidChange.event;

  constructor(private readonly trackedService: TrackedFileService) {}

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme !== 'file') return undefined;
    if (!this.trackedService.isTracked(uri.fsPath)) return undefined;
    return {
      badge: 'T',
      tooltip: 'Otter: Tracked file',
      color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
    };
  }

  refresh(uris?: vscode.Uri[]): void {
    this._onDidChange.fire(uris);
  }
}
