import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import * as path from 'path';
import { ConfigurationService } from './ConfigurationService';

const exec = util.promisify(cp.exec);

/**
 * Git 同步服务（最小可用实现）
 */
export class GitSyncService {
  private autoSyncTimer: NodeJS.Timeout | undefined;

  constructor(private readonly config: ConfigurationService) {}

  private get root(): string {
    return this.config.getStoragePath();
  }

  private async run(cmd: string): Promise<string> {
    const { stdout, stderr } = await exec(cmd, { cwd: this.root });
    if (stderr && !stdout) throw new Error(stderr);
    return stdout || stderr || '';
  }

  async ensureRepo(): Promise<void> {
    try {
      await this.run('git rev-parse --is-inside-work-tree');
    } catch {
      await this.run('git init');
    }
  }

  async status(): Promise<string> {
    await this.ensureRepo();
    return await this.run('git status --porcelain');
  }

  async addAll(): Promise<void> {
    await this.ensureRepo();
    await this.run('git add -A');
  }

  async commit(message?: string): Promise<void> {
    const msg = message || this.config.get<string>('git.commitMessageTemplate', 'chore: sync prompts');
    await this.run(`git commit -m "${msg}" || echo no changes`);
  }

  async pull(): Promise<void> {
    await this.run('git pull --rebase || echo no remote');
  }

  async push(): Promise<void> {
    await this.run('git push || echo no remote');
  }

  async sync(): Promise<void> {
    await this.addAll();
    await this.commit();
    if (this.config.get<boolean>('git.enableSync', false)) {
      await this.pull();
      await this.push();
    }
  }

  /**
   * 绑定自动同步逻辑：监听存储目录下 Markdown 文件保存事件，延迟一段时间后执行 git sync
   */
  bindAutoSync(context: vscode.ExtensionContext): void {
    const disposable = vscode.workspace.onDidSaveTextDocument((doc) => {
      const enableSync = this.config.get<boolean>('git.enableSync', false);
      const autoSync = this.config.get<boolean>('git.autoSyncOnSave', true);
      if (!enableSync || !autoSync) {
        return;
      }

      const isMarkdown =
        doc.languageId === 'markdown' ||
        doc.fileName.toLowerCase().endsWith('.md');
      if (!isMarkdown) {
        return;
      }

      const storagePath = this.root;
      const isInStoragePath = this.isInside(storagePath, doc.uri.fsPath);
      if (!isInStoragePath) {
        return;
      }

      this.scheduleAutoSync();
    });

    context.subscriptions.push(disposable);
  }

  /**
   * 安排一次延迟自动同步（多次保存会重置计时器，达到防抖效果）
   */
  private scheduleAutoSync(): void {
    const delaySeconds = this.config.get<number>(
      'git.autoSyncDelaySeconds',
      60
    );
    const delayMs = Math.max(5, delaySeconds) * 1000;

    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
    }

    this.autoSyncTimer = setTimeout(async () => {
      this.autoSyncTimer = undefined;
      try {
        await this.sync();
        vscode.window.setStatusBarMessage(
          'Prompt Hub: Git 自动同步完成',
          3000
        );
      } catch (error) {
        console.error('[GitSyncService] 自动同步失败:', error);
        vscode.window.showErrorMessage(
          `Prompt Hub: Git 自动同步失败：${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }, delayMs);
  }

  /**
   * 判断 target 是否位于 root 目录内
   */
  private isInside(root: string, target: string): boolean {
    const rel = path.relative(path.resolve(root), path.resolve(target));
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  }
}
