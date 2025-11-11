import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigurationService } from './ConfigurationService';

export interface UsageLogRecord {
  id: string;
  timestamp: string;
  operation: 'meta' | 'optimize';
  promptId?: string;
  model?: string;
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  status: 'success' | 'failed';
  message?: string;
}

/**
 * 使用日志服务（独立 usage.json 文件，避免污染 prompts.json）
 */
export class UsageLogService {
  private readonly fileUri: vscode.Uri;

  constructor(private readonly config: ConfigurationService) {
    const root = this.config.getStoragePath();
    this.fileUri = vscode.Uri.file(path.join(root, 'usage.json'));
  }

  async record(entry: UsageLogRecord): Promise<void> {
    try {
      const existing = await this.readAll();
      existing.push(entry);
      await vscode.workspace.fs.writeFile(this.fileUri, Buffer.from(JSON.stringify(existing, null, 2), 'utf8'));
    } catch {
      await vscode.workspace.fs.writeFile(this.fileUri, Buffer.from(JSON.stringify([entry], null, 2), 'utf8'));
    }
  }

  async readAll(): Promise<UsageLogRecord[]> {
    try {
      const bin = await vscode.workspace.fs.readFile(this.fileUri);
      const text = Buffer.from(bin).toString('utf8');
      const arr = JSON.parse(text);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
}

