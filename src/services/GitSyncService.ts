import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigurationService } from './ConfigurationService';

/**
 * Git 同步服务（最小可用实现）
 */
export class GitSyncService {
  private autoSyncTimer: NodeJS.Timeout | undefined;
  private lastImportBackupDir: string | null = null;

  constructor(private readonly config: ConfigurationService) {}

  private get debugLogEnabled(): boolean {
    return this.config.get<boolean>('git.debugLog', false);
  }

  private get root(): string {
    return this.config.getStoragePath();
  }

  private logDebug(message: string, ...args: any[]): void {
    if (!this.debugLogEnabled) return;
    console.log(message, ...args);
  }

  private sanitizeRemoteUrl(url: string): string {
    const raw = (url || '').trim();
    if (!raw) return raw;

    try {
      const parsed = new URL(raw);
      if (parsed.username || parsed.password) {
        // 避免把 token/账号密码写进日志
        parsed.username = '***';
        parsed.password = '';
        return parsed.toString();
      }
      return raw;
    } catch {
      // scp 风格（git@github.com:org/repo.git）通常不含敏感信息；
      // 若是 https://token@host/xxx 的非标准写法，做一次粗略脱敏
      return raw.replace(/\/\/([^@/]+)@/g, '//***@');
    }
  }

  private summarizeLines(text: string, maxLines: number): string {
    const lines = (text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length <= maxLines) return lines.join(' | ');
    return [...lines.slice(0, maxLines), `...(${lines.length} 行)`].join(' | ');
  }

  private async logRepoDiagnostics(stage: string): Promise<void> {
    if (!this.debugLogEnabled) return;

    const root = this.root;
    this.logDebug(`[GitSyncService][诊断] stage=${stage} storagePath=${root}`);

    // 目录快照：帮助判断“看起来啥也没拉下来”到底是不是目录不对/没检出文件
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const names = entries
        .filter((e) => e.name !== '.git')
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort((a, b) => a.localeCompare(b));
      this.logDebug(
        `[GitSyncService][诊断] 顶层文件/目录数量=${names.length} 示例=${names.slice(0, 30).join(', ')}`
      );
    } catch (err) {
      this.logDebug('[GitSyncService][诊断] 读取 storagePath 顶层目录失败:', err);
    }

    const isRepo = await this.isGitRepo();
    this.logDebug(`[GitSyncService][诊断] isGitRepo=${isRepo}`);
    if (!isRepo) return;

    const origin = await this.getOriginRemoteUrl();
    this.logDebug(
      `[GitSyncService][诊断] origin=${origin ? this.sanitizeRemoteUrl(origin) : '(未配置)'}`
    );

    const head = await this.runGitAllowFailure(['rev-parse', '--abbrev-ref', 'HEAD'], root);
    this.logDebug(`[GitSyncService][诊断] HEAD=${(head.stdout || head.stderr || '').trim()}`);

    const lastCommit = await this.runGitAllowFailure(['log', '-1', '--oneline', '--decorate'], root);
    this.logDebug(
      `[GitSyncService][诊断] lastCommit=${this.summarizeLines(lastCommit.stdout || lastCommit.stderr, 1)}`
    );

    const status = await this.runGitAllowFailure(['status', '--porcelain'], root);
    const statusLines = (status.stdout || '').split(/\r?\n/).filter(Boolean);
    this.logDebug(
      `[GitSyncService][诊断] statusLines=${statusLines.length} 示例=${statusLines.slice(0, 20).join(' | ')}`
    );

    const lsFiles = await this.runGitAllowFailure(['ls-files'], root);
    const files = (lsFiles.stdout || '').split(/\r?\n/).filter(Boolean);
    this.logDebug(
      `[GitSyncService][诊断] trackedFiles=${files.length} 示例=${files.slice(0, 30).join(', ')}`
    );
  }

  private async runGit(
    args: string[],
    cwd: string = this.root
  ): Promise<{ stdout: string; stderr: string }> {
    return await new Promise((resolve, reject) => {
      this.logDebug(`[GitSyncService] git ${args.join(' ')} (cwd=${cwd})`);
      const child = cp.spawn('git', args, {
        cwd,
        shell: false,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString('utf8');
      });
      child.stderr?.on('data', (data) => {
        stderr += data.toString('utf8');
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }

        const message =
          (stderr || stdout || '').trim() ||
          `git ${args.join(' ')} 执行失败（exitCode=${code}）`;
        reject(new Error(message));
      });
    });
  }

  private async runGitAllowFailure(
    args: string[],
    cwd: string = this.root
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return await new Promise((resolve) => {
      const child = cp.spawn('git', args, {
        cwd,
        shell: false,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString('utf8');
      });
      child.stderr?.on('data', (data) => {
        stderr += data.toString('utf8');
      });

      child.on('close', (code) => {
        resolve({ code: code ?? 1, stdout, stderr });
      });

      child.on('error', () => {
        resolve({ code: 1, stdout, stderr });
      });
    });
  }

  async isGitRepo(): Promise<boolean> {
    const result = await this.runGitAllowFailure(
      ['rev-parse', '--is-inside-work-tree'],
      this.root
    );
    return result.code === 0;
  }

  async ensureRepo(): Promise<void> {
    if (await this.isGitRepo()) return;
    await this.runGit(['init'], this.root);
  }

  async status(): Promise<string> {
    await this.ensureRepo();
    const { stdout } = await this.runGit(['status', '--porcelain'], this.root);
    return stdout;
  }

  async addAll(): Promise<void> {
    await this.ensureRepo();
    await this.runGit(['add', '-A'], this.root);
  }

  async commit(message?: string): Promise<void> {
    const template =
      message || this.config.get<string>('git.commitMessageTemplate', 'chore: sync prompts');
    const msg = this.expandCommitMessageTemplate(template);
    try {
      await this.runGit(['commit', '-m', msg], this.root);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      // 无变更时 git commit 会失败，属于正常情况
      if (
        /nothing to commit/i.test(raw) ||
        /no changes added to commit/i.test(raw) ||
        /working tree clean/i.test(raw)
      ) {
        return;
      }
      throw error;
    }
  }

  private expandCommitMessageTemplate(template: string): string {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const datetime = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    return (template || '').replace(/\{datetime\}/g, datetime);
  }

  private getConfiguredRemoteUrl(): string {
    return this.config.get<string>('git.remoteUrl', '').trim();
  }

  async getOriginRemoteUrl(): Promise<string | null> {
    await this.ensureRepo();
    const result = await this.runGitAllowFailure(['remote', 'get-url', 'origin'], this.root);
    if (result.code !== 0) return null;
    const url = (result.stdout || result.stderr || '').trim();
    return url || null;
  }

  async setOriginRemoteUrl(remoteUrl: string): Promise<void> {
    await this.ensureRepo();
    const url = remoteUrl.trim();
    if (!url) throw new Error('远程仓库 URL 为空，无法配置 origin。');

    const addResult = await this.runGitAllowFailure(['remote', 'add', 'origin', url], this.root);
    if (addResult.code === 0) return;

    await this.runGit(['remote', 'set-url', 'origin', url], this.root);
  }

  private async ensureOriginRemote(remoteUrl?: string): Promise<void> {
    const existing = await this.getOriginRemoteUrl();
    if (existing) return;

    const url = (remoteUrl ?? this.getConfiguredRemoteUrl()).trim();
    if (!url) {
      throw new Error('未配置远程仓库 URL，请在设置中填写 promptHub.git.remoteUrl，或通过配置向导设置。');
    }

    await this.setOriginRemoteUrl(url);
  }

  private async detectRemoteDefaultBranch(): Promise<string | null> {
    // 方式 1：远程 HEAD（更可靠）
    const headRef = await this.runGitAllowFailure(
      ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'],
      this.root
    );
    if (headRef.code === 0) {
      const ref = (headRef.stdout || '').trim();
      const match = ref.match(/^refs\/remotes\/origin\/(.+)$/);
      if (match?.[1]) return match[1];
    }

    // 方式 2：remote show 输出（不同版本 Git 文案略有差异）
    const remoteShow = await this.runGitAllowFailure(['remote', 'show', 'origin'], this.root);
    if (remoteShow.code === 0) {
      const text = remoteShow.stdout || '';
      const match = text.match(/HEAD branch:\s*(\S+)/);
      if (match?.[1]) return match[1];
    }

    // 方式 3：常见分支兜底
    const mainExists = await this.runGitAllowFailure(['rev-parse', '--verify', 'origin/main'], this.root);
    if (mainExists.code === 0) return 'main';
    const masterExists = await this.runGitAllowFailure(['rev-parse', '--verify', 'origin/master'], this.root);
    if (masterExists.code === 0) return 'master';

    return null;
  }

  private formatTimestampForFolderName(date: Date): string {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    return [
      date.getFullYear(),
      pad2(date.getMonth() + 1),
      pad2(date.getDate()),
      '-',
      pad2(date.getHours()),
      pad2(date.getMinutes()),
      pad2(date.getSeconds()),
    ].join('');
  }

  private async backupWorkingTreeForImport(): Promise<string> {
    const stamp = this.formatTimestampForFolderName(new Date());
    const backupDirName = `.prompt-hub-backup-${stamp}`;
    const backupDir = path.join(this.root, backupDirName);

    await fs.mkdir(backupDir, { recursive: true });

    const entries = await fs.readdir(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      if (entry.name === backupDirName) continue;

      const from = path.join(this.root, entry.name);
      const to = path.join(backupDir, entry.name);
      await fs.rename(from, to);
    }

    this.lastImportBackupDir = backupDir;
    return backupDir;
  }

  getLastImportBackupDir(): string | null {
    return this.lastImportBackupDir;
  }

  /**
   * 新设备/新目录导入：在 storagePath 内初始化仓库并从远端拉取内容。
   * 说明：不依赖目录必须为空，避免与 PromptHub 自动创建 prompts.json 冲突。
   */
  async importFromRemote(remoteUrl?: string): Promise<void> {
    this.lastImportBackupDir = null;
    await this.logRepoDiagnostics('importFromRemote:before');
    await this.ensureRepo();
    await this.ensureOriginRemote(remoteUrl);

    // 获取远端引用
    await this.runGit(['fetch', '--prune', 'origin'], this.root);

    // 尝试自动设置 origin/HEAD（失败可忽略）
    await this.runGitAllowFailure(['remote', 'set-head', 'origin', '-a'], this.root);

    const branch = await this.detectRemoteDefaultBranch();
    if (!branch) {
      throw new Error('无法确定远端默认分支：请确认远端仓库存在 main/master 分支，且不是空仓库。');
    }
    this.logDebug(`[GitSyncService] importFromRemote() 远端默认分支=${branch}`);

    // 创建/切换到本地分支并跟踪远端
    try {
      await this.runGit(['checkout', '-B', branch, `origin/${branch}`], this.root);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isUntrackedOverwrite =
        /would be overwritten by checkout/i.test(message) ||
        /untracked working tree files would be overwritten/i.test(message) ||
        /Please move or remove them/i.test(message);

      if (!isUntrackedOverwrite) {
        throw error;
      }

      // 尝试将当前目录已有文件整体备份，再重试 checkout（避免 prompts.json 等阻塞导入）
      await this.backupWorkingTreeForImport();
      await this.runGit(['checkout', '-B', branch, `origin/${branch}`], this.root);
    }

    await this.logRepoDiagnostics('importFromRemote:after');
  }

  async pullRebase(remoteUrl?: string): Promise<void> {
    await this.logRepoDiagnostics('pullRebase:before');
    await this.ensureRepo();

    if (!(await this.isGitRepo())) {
      throw new Error('当前目录不是 Git 仓库，无法执行拉取。');
    }

    const originUrl = await this.getOriginRemoteUrl();
    if (!originUrl) {
      // 若配置了 remoteUrl，则按“导入”逻辑补齐远端并拉取
      await this.importFromRemote(remoteUrl);
      return;
    }

    await this.runGit(['pull', '--rebase'], this.root);
    await this.logRepoDiagnostics('pullRebase:after');
  }

  /** 兼容旧调用：启动自动拉取会走这里 */
  async pull(): Promise<void> {
    // 若是新设备且配置了 remoteUrl，则自动导入；否则在已有仓库内 pull
    if (!(await this.isGitRepo())) {
      const url = this.getConfiguredRemoteUrl();
      if (!url) {
        throw new Error('当前存储目录不是 Git 仓库，且未配置 promptHub.git.remoteUrl，无法自动拉取。');
      }
      await this.importFromRemote(url);
      return;
    }

    await this.pullRebase();
  }

  async push(): Promise<void> {
    await this.ensureRepo();
    await this.ensureOriginRemote();
    await this.runGit(['push'], this.root);
  }

  async sync(): Promise<void> {
    await this.addAll();

    const status = await this.status();
    if (status.trim()) {
      await this.commit();
    }

    if (this.config.get<boolean>('git.enableSync', false)) {
      await this.pullRebase();
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
