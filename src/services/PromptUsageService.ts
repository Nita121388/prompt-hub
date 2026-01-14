import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigurationService } from './ConfigurationService';
import { enqueueByKey } from '../utils/WriteQueue';

export interface PromptUsageDataV1 {
  version: 1;
  counts: Record<string, number>;
  lastUsedAt: Record<string, string>;
}

/**
 * Prompt 使用次数统计（独立文件，避免与 AI usage.json 混淆）
 * - 仅用于“复制到剪贴板”这类 Prompt 使用场景
 */
export class PromptUsageService {
  private readonly fileUri: vscode.Uri;

  constructor(private readonly config: ConfigurationService) {
    const root = this.config.getStoragePath();
    this.fileUri = vscode.Uri.file(path.join(root, 'prompt-usage.json'));
  }

  async increment(promptId: string): Promise<void> {
    if (!promptId) return;
    const now = new Date().toISOString();

    await enqueueByKey(this.fileUri.fsPath, async () => {
      const data = await this.readData();
      data.counts[promptId] = (data.counts[promptId] || 0) + 1;
      data.lastUsedAt[promptId] = now;
      await vscode.workspace.fs.writeFile(
        this.fileUri,
        Buffer.from(JSON.stringify(data, null, 2), 'utf8')
      );
    });
  }

  async getCountMap(): Promise<Map<string, number>> {
    const data = await this.readData();
    return new Map(Object.entries(data.counts).map(([k, v]) => [k, Number(v) || 0]));
  }

  private async readData(): Promise<PromptUsageDataV1> {
    try {
      const bin = await vscode.workspace.fs.readFile(this.fileUri);
      const text = Buffer.from(bin).toString('utf8');
      const raw = JSON.parse(text) as unknown;
      const record =
        raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined;
      const counts = record?.counts;
      const lastUsedAt = record?.lastUsedAt;
      return {
        version: 1,
        counts: counts && typeof counts === 'object' ? (counts as Record<string, number>) : {},
        lastUsedAt:
          lastUsedAt && typeof lastUsedAt === 'object'
            ? (lastUsedAt as Record<string, string>)
            : {},
      };
    } catch {
      return { version: 1, counts: {}, lastUsedAt: {} };
    }
  }
}
