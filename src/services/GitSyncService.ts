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
}

