import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import * as util from 'util';
import Fuse from 'fuse.js';
import { PromptStorageService } from '../services/PromptStorageService';
import { ConfigurationService } from '../services/ConfigurationService';
import { PromptTreeProvider } from '../providers/PromptTreeProvider';
import { OnboardingWizard } from '../services/OnboardingWizard';
import { SelectionParser } from '../utils/SelectionParser';
import { Prompt } from '../types/Prompt';
import { generateId, sanitizeFilename } from '../utils/helpers';
import { PromptFileService } from '../services/PromptFileService';
import { AIService } from '../services/AIService';
import { GitSyncService } from '../services/GitSyncService';
import { UsageLogService } from '../services/UsageLogService';

/**
 * 命令注册器：负责注册所有 Prompt Hub 相关命令并实现具体逻辑
 */
export class CommandRegistrar {
  /** 将 child_process.exec 封装为 Promise，方便在命令中调用 CLI */
  private readonly exec = util.promisify(cp.exec);

  /** 带环境变量的 exec 封装，包含超时处理 */
  private readonly execWithEnv = (command: string, env: NodeJS.ProcessEnv, timeout: number = 60000): Promise<{ stdout: string; stderr: string }> => {
    return new Promise((resolve, reject) => {
      console.log(`[PromptHub][execWithEnv] 执行命令: ${command}`);
      console.log(`[PromptHub][execWithEnv] 超时设置: ${timeout}ms`);

      const child = cp.exec(command, {
        env,
        encoding: 'utf8'
      }, (error, stdout, stderr) => {
        if (error) {
          console.error(`[PromptHub][execWithEnv] 命令执行错误:`, error);
          reject(error);
        } else {
          console.log(`[PromptHub][execWithEnv] 命令执行成功，stdout长度: ${stdout?.length || 0}, stderr长度: ${stderr?.length || 0}`);
          resolve({ stdout: stdout || '', stderr: stderr || '' });
        }
      });

      // 设置超时
      const timer = setTimeout(() => {
        console.error(`[PromptHub][execWithEnv] 命令执行超时 (${timeout}ms)`);
        child.kill('SIGTERM');
        reject(new Error(`命令执行超时 (${timeout}ms)`));
      }, timeout);

      // 监听进程退出
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        console.log(`[PromptHub][execWithEnv] 进程退出，code: ${code}, signal: ${signal}`);
      });

      // 监听输出
      if (child.stdout) {
        child.stdout.on('data', (data) => {
          console.log(`[PromptHub][execWithEnv] stdout:`, data.toString().trim());
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (data) => {
          console.log(`[PromptHub][execWithEnv] stderr:`, data.toString().trim());
        });
      }
    });
  };

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly storageService: PromptStorageService,
    private readonly configService: ConfigurationService,
    private readonly treeProvider: PromptTreeProvider,
    private readonly treeView?: vscode.TreeView<any>
  ) {}

  /** 注册所有命令 */
  registerAll(): void {
    this.register('promptHub.createFromSelection', () => this.createFromSelection());
    this.register('promptHub.newPromptFile', () => this.newPromptFile());
    this.register('promptHub.searchPrompt', () => this.searchPrompt());
    this.register('promptHub.renamePromptFile', (context?: any) => this.renamePromptFile(context));
    this.register('promptHub.copyPromptContent', (context?: any) =>
      this.copyPromptContent(context)
    );
    this.register('promptHub.editPrompt', (context?: any) => this.editPrompt(context));
    this.register('promptHub.refreshView', () => this.refreshView());
    this.register('promptHub.openSettings', () => this.openSettings());
    this.register('promptHub.openStorageFolder', () => this.openStorageFolder());
    this.register('promptHub.startOnboarding', () => this.startOnboarding());
    this.register('promptHub.resetOnboarding', () => this.resetOnboarding());
    this.register('promptHub.deletePrompt', (context?: any) => this.deletePrompt(context));
    this.register('promptHub.gitPull', () => this.gitPull());
    this.register('promptHub.gitSync', () => this.gitSync());
    this.register('promptHub.showQuickPick', () => this.showQuickPick());
    this.register('promptHub.onPromptItemClick', (prompt?: Prompt) => this.onPromptTreeItemClick(prompt));
    this.register('promptHub.batchGenerateMeta', () => this.batchGenerateMeta());
    this.register('promptHub.batchGenerateMetaSelected', () =>
      this.batchGenerateMetaSelected()
    );
    this.register('promptHub.optimizeMeta', (context?: any) => this.optimizeMeta(context));
    this.register('promptHub.batchOptimizeMeta', () => this.batchOptimizeMeta());
  }

  /** 注册单个命令的工具方法 */
  private register(command: string, callback: (...args: any[]) => any): void {
    const disposable = vscode.commands.registerCommand(command, callback);
    this.context.subscriptions.push(disposable);
  }

  /** 从编辑器选区创建 Prompt */
  private async createFromSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showWarningMessage('请先打开一个编辑器。');
      return;
    }

    const selection = editor.document.getText(editor.selection);
    if (!selection) {
      void vscode.window.showWarningMessage('请选择要保存为 Prompt 的文本。');
      return;
    }

    try {
      const parser = new SelectionParser(this.configService);
      const parsed = parser.parse(selection);

      const nameInput = await vscode.window.showInputBox({
        prompt: '请输入 Prompt 名称',
        placeHolder: '例如：代码审查 Checklist',
        value: parsed.name,
      });
      if (nameInput === undefined) return;

      const sourceForDefault = parsed.content?.trim() ? parsed.content : selection;
      const finalName = nameInput.trim()
        ? nameInput.trim()
        : this.generateDefaultPromptName(sourceForDefault);

      const emojiInput = await vscode.window.showInputBox({
        prompt: '请输入 Emoji（可选，可直接回车跳过）',
        placeHolder: '例如：😊',
        value: parsed.emoji,
      });
      if (emojiInput === undefined) return;
      const finalEmoji = emojiInput.trim() || undefined;

      const tagsInput = await vscode.window.showInputBox({
        prompt: '请输入标签（多个标签用逗号或空格分隔，可留空）',
        placeHolder: '例如：代码, 审查, 团队',
      });
      if (tagsInput === undefined) return;
      const parsedTags = this.parseTagsInput(tagsInput);

      const prompt: Prompt = {
        id: generateId(),
        name: finalName,
        emoji: finalEmoji,
        content: parsed.content,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sourceFile: editor.document.uri.fsPath,
        tags: parsedTags,
      };

      await this.storageService.add(prompt);
      this.treeProvider.refresh();
      void vscode.window.showInformationMessage(`已创建 Prompt「${finalName}」`);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `创建 Prompt 失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /** 新建 Prompt 文件 */
  private async newPromptFile(): Promise<void> {
    try {
      const fileService = new PromptFileService(this.configService, this.storageService);
      await fileService.createPromptFile();
    } catch (error) {
      void vscode.window.showErrorMessage(
        `新建 Prompt 文件失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /** 搜索 Prompt（fuse.js 模糊搜索，支持选区作为初始查询） */
  private async searchPrompt(): Promise<void> {
    const prompts = this.storageService.list();
    if (!prompts.length) {
      void vscode.window.showInformationMessage('暂无 Prompt。');
      return;
    }

    // 优先使用当前编辑器选中的文本作为搜索词
    let query: string | undefined;
    const editor = vscode.window.activeTextEditor;
    const selection = editor?.selection;
    if (editor && selection && !selection.isEmpty) {
      const selectedText = editor.document.getText(selection).trim();
      if (selectedText) {
        query = selectedText;
      }
    }

    // 没有选区或选区为空时，弹出输入框
    if (!query) {
      const input = await vscode.window.showInputBox({
        placeHolder: '输入关键字进行模糊搜索，留空回车查看全部 Prompt',
      });
      if (input === undefined) {
        return;
      }
      query = input.trim();
    }

    const fuse = new Fuse(prompts, {
      includeScore: true,
      threshold: 0.4,
      keys: [
        { name: 'name', weight: 0.6 },
        { name: 'content', weight: 0.3 },
        { name: 'tags', weight: 0.1 },
      ],
    });

    const results = query ? fuse.search(query) : prompts.map((p) => ({ item: p } as any));
    const items = results.slice(0, 50).map((r: any) => ({
      label: `${r.item.emoji || '📌'} ${r.item.name}`,
      description: r.item.content.substring(0, 80),
      prompt: r.item as Prompt,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: '选择要复制的 Prompt',
    });
    if (picked) {
      await this.copyPromptContent(picked.prompt);
    }
  }

  /** 复制 Prompt 内容 */
  private async copyPromptContent(context?: any): Promise<void> {
    let prompt: Prompt | undefined;

    if (context) {
      if (context.id && context.name && context.content) {
        prompt = context as Prompt;
      } else if ((context as any).prompt) {
        prompt = (context as any).prompt as Prompt;
      }
    }

    if (!prompt) {
      void vscode.window.showErrorMessage('无法确定要复制的 Prompt。');
      return;
    }

    await vscode.env.clipboard.writeText(prompt.content);

    const usage = new UsageLogService(this.configService);
    await usage.record({
      id: generateId(),
      timestamp: new Date().toISOString(),
      operation: 'meta',
      promptId: prompt.id,
      status: 'success',
    });

    void vscode.window.showInformationMessage(`已复制 Prompt「${prompt.name}」内容。`);
  }

  /** 编辑 Prompt：打开源 Markdown 文件 */
  private async editPrompt(context?: any): Promise<void> {
    const prompt = await this.ensurePromptSelected(context);
    if (!prompt) return;

    if (!prompt.sourceFile) {
      void vscode.window.showWarningMessage('该 Prompt 没有关联的源文件。');
      return;
    }

    const doc = await vscode.workspace.openTextDocument(prompt.sourceFile);
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  /**
   * 按 Prompt 的标题/emoji 重命名其 Markdown 源文件
   * - 不依赖时间戳规则：只要用户触发命令就直接重命名
   * - 用户不想重命名 → 不执行该命令即可
   */
  private async renamePromptFile(context?: any): Promise<void> {
    const prompt = await this.ensurePromptSelected(context);
    if (!prompt) return;

    console.log('[CommandRegistrar] renamePromptFile 调用 - promptId:', prompt.id, ', sourceFile:', prompt.sourceFile);

    if (!prompt.sourceFile) {
      console.log('[CommandRegistrar] renamePromptFile 跳过：无 sourceFile');
      void vscode.window.showWarningMessage('该 Prompt 没有关联的源文件，无法重命名。');
      return;
    }

    const storagePath = this.configService.getStoragePath();
    if (!this.isInside(storagePath, prompt.sourceFile)) {
      console.log('[CommandRegistrar] renamePromptFile 跳过：文件不在存储目录内', storagePath);
      void vscode.window.showWarningMessage('该文件不在 Prompt 存储目录内，出于安全考虑跳过重命名。');
      return;
    }

    const trimmedName = (prompt.name || '').trim().replace(/\.md$/i, '');
    if (!trimmedName || trimmedName === '在此填写标题') {
      console.log('[CommandRegistrar] renamePromptFile 跳过：标题为空或默认占位符', trimmedName);
      void vscode.window.showWarningMessage('标题为空或仍为默认占位符，无法用于重命名。');
      return;
    }

    const dir = path.dirname(prompt.sourceFile);
    const emojiPart = prompt.emoji ? `${prompt.emoji}-` : '';
    const base = `${emojiPart}${trimmedName}`;
    const safeBase = sanitizeFilename(base).replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!safeBase) {
      console.log('[CommandRegistrar] renamePromptFile 跳过：标题清洗后为空', base);
      void vscode.window.showWarningMessage('标题清洗后为空，无法用于重命名。');
      return;
    }

    const desiredPath = path.join(dir, `${safeBase}.md`);
    const currentPath = prompt.sourceFile;

    // 新旧相同则直接结束
    if (path.resolve(desiredPath) === path.resolve(currentPath)) {
      console.log('[CommandRegistrar] renamePromptFile 跳过：文件名已一致', desiredPath);
      void vscode.window.showInformationMessage('文件名已与标题一致，无需重命名。');
      return;
    }

    const targetPath = await this.makeUniquePath(desiredPath, currentPath);

    try {
      console.log('[CommandRegistrar] renamePromptFile 开始重命名:', currentPath, '->', targetPath);
      await vscode.workspace.fs.rename(
        vscode.Uri.file(currentPath),
        vscode.Uri.file(targetPath),
        { overwrite: false }
      );

      const updated: Prompt = {
        ...prompt,
        sourceFile: targetPath,
        updatedAt: new Date().toISOString(),
      };
      await this.storageService.update(updated);
      this.treeProvider.refresh();
      console.log('[CommandRegistrar] renamePromptFile 重命名成功，已更新存储 sourceFile');

      // 如果文件已打开，切换到新文件
      const opened = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === currentPath);
      if (opened) {
        await vscode.window.showTextDocument(opened);
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        const newDoc = await vscode.workspace.openTextDocument(targetPath);
        await vscode.window.showTextDocument(newDoc, { preview: false });
      }

      void vscode.window.showInformationMessage(`已重命名文件：${path.basename(targetPath)}`);
    } catch (err) {
      console.error('[CommandRegistrar] renamePromptFile 重命名失败:', err);
      void vscode.window.showErrorMessage(
        `重命名文件失败：${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /** 刷新 TreeView 与存储 */
  private async refreshView(): Promise<void> {
    await this.storageService.refresh();
    this.treeProvider.refresh();
    void vscode.window.showInformationMessage('Prompt 列表已刷新。');
  }

  /** 打开设置 */
  private openSettings(): void {
    this.configService.openSettings();
  }

  /** 打开 Prompt 存储目录 */
  private async openStorageFolder(): Promise<void> {
    const storagePath = this.configService.getStoragePath();
    const uri = vscode.Uri.file(storagePath);
    await vscode.env.openExternal(uri);
  }

  /** 启动配置向导 */
  private async startOnboarding(): Promise<void> {
    const wizard = new OnboardingWizard(this.context, this.configService);
    await wizard.start();
  }

  /** 重置配置向导 */
  private async resetOnboarding(): Promise<void> {
    const wizard = new OnboardingWizard(this.context, this.configService);
    await wizard.reset();
  }

  /** 删除 Prompt */
  private async deletePrompt(context?: any): Promise<void> {
    const prompt = await this.ensurePromptSelected(context);
    if (!prompt) return;

    const confirmed = await vscode.window.showWarningMessage(
      `确定要删除 Prompt「${prompt.name}」吗？该操作不可撤销。`,
      { modal: true },
      '删除',
      '取消'
    );
    if (confirmed !== '删除') return;

    await this.storageService.remove(prompt.id);
    this.treeProvider.refresh();
    void vscode.window.showInformationMessage(`已删除 Prompt「${prompt.name}」。`);
  }

  /** TreeView 单击/双击处理：单击复制，双击编辑 */
  private lastClickInfo: { id?: string; time?: number } = {};
  private async onPromptTreeItemClick(prompt?: Prompt): Promise<void> {
    if (!prompt) return;

    const now = Date.now();
    const isSame = this.lastClickInfo.id === prompt.id;
    const withinDoubleClick = isSame && this.lastClickInfo.time && now - this.lastClickInfo.time < 350;

    this.lastClickInfo = { id: prompt.id, time: now };

    if (withinDoubleClick) {
      // 双击：打开编辑
      await this.editPrompt(prompt);
      return;
    }

    // 单击：复制内容
    await this.copyPromptContent(prompt);
  }

  /** AI 生成标题 / emoji */
  private async aiGenerateMeta(prompt?: Prompt): Promise<void> {
    const target = await this.ensurePromptSelected(prompt);
    if (!target) return;

    const ai = new AIService(this.configService);
    const meta = await ai.generateMeta(target.content);

    if (!meta.name && !meta.emoji) {
      void vscode.window.showInformationMessage('AI 未返回可用的标题或 emoji。');
      return;
    }

    const updated: Prompt = {
      ...target,
      name: meta.name || target.name,
      emoji: meta.emoji ?? target.emoji,
      updatedAt: new Date().toISOString(),
    };

    await this.storageService.update(updated);
    this.treeProvider.refresh();

    if (updated.sourceFile) {
      await this.updateMarkdownHeader(updated.sourceFile, updated.name, updated.emoji);
    }

    void vscode.window.showInformationMessage(`已更新 Prompt 元信息：「${updated.name}」。`);
  }

  /** AI 优化 Prompt 内容 */
  private async aiOptimize(prompt?: Prompt): Promise<void> {
    const target = await this.ensurePromptSelected(prompt);
    if (!target) return;

    const ai = new AIService(this.configService);
    const optimized = await ai.optimize(target.content);

    if (!optimized || optimized.trim() === target.content.trim()) {
      void vscode.window.showInformationMessage('AI 优化未产生变化。');
      return;
    }

    const updated: Prompt = {
      ...target,
      content: optimized,
      updatedAt: new Date().toISOString(),
    };

    await this.storageService.update(updated);
    this.treeProvider.refresh();

    if (updated.sourceFile) {
      await this.replaceMarkdownBody(updated.sourceFile, optimized);
    }

    const usage = new UsageLogService(this.configService);
    await usage.record({
      id: generateId(),
      timestamp: new Date().toISOString(),
      operation: 'optimize',
      promptId: updated.id,
      status: 'success',
    });

    void vscode.window.showInformationMessage(`已优化 Prompt「${updated.name}」。`);
  }

  /** Git 同步 */
  private async gitSync(): Promise<void> {
    const git = new GitSyncService(this.configService);
    let importBackupDir: string | null = null;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Prompt Hub: 正在执行 Git 同步...',
      },
      async () => {
        // 新设备常见场景：storagePath 不是仓库，但用户希望从远端拉取到本地
        if (!(await git.isGitRepo())) {
          const remoteUrl = await this.ensureRemoteUrlForImport(git);
          if (!remoteUrl) {
            throw new Error('已取消 Git 导入/同步。');
          }
          await git.importFromRemote(remoteUrl);
          importBackupDir = git.getLastImportBackupDir();
        }

        await git.sync();
      }
    );

    await this.refreshAfterGit();
    if (importBackupDir) {
      void vscode.window.showWarningMessage(
        `Prompt Hub: 导入前已将现有文件备份到：${importBackupDir}`
      );
    }
    void vscode.window.showInformationMessage('Prompt Hub: Git 同步完成。');
  }

  /** Git 拉取/导入（新设备一键把远端 prompts 拉到本地） */
  private async gitPull(): Promise<void> {
    const git = new GitSyncService(this.configService);
    let importBackupDir: string | null = null;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Prompt Hub: 正在拉取/导入远端内容...',
      },
      async () => {
        if (!(await git.isGitRepo())) {
          const remoteUrl = await this.ensureRemoteUrlForImport(git);
          if (!remoteUrl) {
            throw new Error('已取消 Git 导入。');
          }
          await git.importFromRemote(remoteUrl);
          importBackupDir = git.getLastImportBackupDir();
          return;
        }

        // 已是仓库：直接 pull（若缺少 origin，会走 importFromRemote 的补齐逻辑）
        const remoteUrl = await this.ensureRemoteUrlForImport(git, {
          allowSkipIfOriginExists: true,
        });
        await git.pullRebase(remoteUrl ?? undefined);
      }
    );

    await this.refreshAfterGit();
    if (importBackupDir) {
      void vscode.window.showWarningMessage(
        `Prompt Hub: 导入前已将现有文件备份到：${importBackupDir}`
      );
    }

    const count = this.storageService.list().length;
    if (count <= 0) {
      const storagePath = this.configService.getStoragePath();
      const selected = await vscode.window.showWarningMessage(
        `Prompt Hub: Git 拉取/导入完成，但未发现任何 Prompt（prompts.json/Markdown）。请确认仓库内容与 storagePath 是否正确：${storagePath}`,
        '打开存储目录',
        '打开设置',
        '开启 Git 诊断日志'
      );

      if (selected === '打开存储目录') {
        await vscode.commands.executeCommand('promptHub.openStorageFolder');
      } else if (selected === '打开设置') {
        this.configService.openSettings();
      } else if (selected === '开启 Git 诊断日志') {
        await this.configService.set('git.debugLog', true, vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage('Prompt Hub: 已开启 Git 诊断日志，可重新执行一次拉取/导入以收集更多信息。');
      }

      return;
    }

    void vscode.window.showInformationMessage(`Prompt Hub: Git 拉取/导入完成（${count} 条 Prompt）。`);
  }

  private async refreshAfterGit(): Promise<void> {
    try {
      await this.storageService.refresh();
      this.treeProvider.refresh();
    } catch (error) {
      console.error('[CommandRegistrar] Git 操作后刷新失败:', error);
    }
  }

  private async ensureRemoteUrlForImport(
    git: GitSyncService,
    options?: { allowSkipIfOriginExists?: boolean }
  ): Promise<string | null> {
    const origin = await git.getOriginRemoteUrl();
    if (origin) {
      // 让“已配置 origin”的场景避免额外打扰
      if (options?.allowSkipIfOriginExists) return origin;
      // 同时把 origin 写回设置，方便新设备复用
      await this.configService.set('git.remoteUrl', origin, vscode.ConfigurationTarget.Global);
      return origin;
    }

    const configured = this.configService.get<string>('git.remoteUrl', '').trim();
    if (configured) return configured;

    const input = await vscode.window.showInputBox({
      prompt: '请输入 Prompt 仓库的远程 URL（用于导入/拉取）',
      placeHolder:
        '例如：https://github.com/your-name/your-prompts.git 或 git@github.com:your-name/your-prompts.git',
      ignoreFocusOut: true,
    });

    if (input === undefined) return null;
    const url = input.trim();
    if (!url) return null;

    await this.configService.set('git.remoteUrl', url, vscode.ConfigurationTarget.Global);
    return url;
  }

  /** 快速操作菜单（状态栏 / TreeView 顶部调用） */
  private async showQuickPick(): Promise<void> {
    const items: Array<{ label: string; description: string; action: string }> = [
      {
        label: '📝 新建 Prompt',
        description: '创建一个新的 Prompt 文件',
        action: 'new',
      },
      {
        label: '🔍 搜索 Prompt',
        description: '在所有 Prompt 中进行模糊搜索',
        action: 'search',
      },
      {
        label: '✂️ 从选区创建',
        description: '将当前选中的文本保存为 Prompt',
        action: 'fromSelection',
      },
      {
        label: '🔄 刷新列表',
        description: '重新加载 Prompt 列表',
        action: 'refresh',
      },
      {
        label: 'Git 拉取/导入',
        description: '新设备从远端仓库拉取到本地 storagePath',
        action: 'gitPull',
      },
      {
        label: '🔀 Git 同步',
        description: '同步 Prompt 到远程仓库',
        action: 'git',
      },
      {
        label: '🎯 配置向导',
        description: '重新运行 Prompt Hub 配置向导',
        action: 'onboarding',
      },
      {
        label: '⚙️ 打开设置',
        description: '打开 Prompt Hub 设置页',
        action: 'settings',
      },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: '选择要执行的 Prompt Hub 操作',
    });
    if (!picked) return;

    switch (picked.action) {
      case 'new':
        await this.newPromptFile();
        break;
      case 'search':
        await this.searchPrompt();
        break;
      case 'fromSelection':
        await this.createFromSelection();
        break;
      case 'refresh':
        await this.refreshView();
        break;
      case 'gitPull':
        await this.gitPull();
        break;
      case 'git':
        await this.gitSync();
        break;
      case 'onboarding':
        await this.startOnboarding();
        break;
      case 'settings':
        this.openSettings();
        break;
      default:
        break;
    }
  }

  /** 确保有一个 Prompt 被选中，没有传入时弹出列表让用户选择 */
  private async ensurePromptSelected(input?: Prompt | { prompt?: Prompt }): Promise<Prompt | undefined> {
    const prompt = (input as any)?.prompt ? (input as any).prompt as Prompt : (input as Prompt | undefined);
    if (prompt) return prompt;

    const list = this.storageService.list();
    if (!list.length) {
      void vscode.window.showInformationMessage('暂无 Prompt。');
      return undefined;
    }

    const picked = await vscode.window.showQuickPick(
      list.map((p) => ({
        label: `${p.emoji || '📌'} ${p.name}`,
        description: p.content.substring(0, 60),
        prompt: p,
      })),
      { placeHolder: '请选择一个 Prompt' }
    );

    return picked?.prompt;
  }

  private isInside(root: string, target: string): boolean {
    const rel = path.relative(path.resolve(root), path.resolve(target));
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  /**
   * 为目标路径生成不冲突的唯一路径（必要时追加 -1/-2/...）
   */
  private async makeUniquePath(desiredPath: string, currentPath?: string): Promise<string> {
    const dir = path.dirname(desiredPath);
    const ext = path.extname(desiredPath) || '.md';
    const base = path.basename(desiredPath, ext);

    let candidate = desiredPath;
    let counter = 1;

    while (true) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
        if (currentPath && path.resolve(candidate) === path.resolve(currentPath)) {
          return candidate;
        }
        candidate = path.join(dir, `${base}-${counter}${ext}`);
        counter += 1;
      } catch {
        return candidate;
      }
    }
  }

  /** 更新 Markdown 文件的标题行（# ...） */
  private async updateMarkdownHeader(
    file: string,
    name: string,
    emoji?: string
  ): Promise<void> {
    const uri = vscode.Uri.file(file);
    const doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();

    const lines = doc.getText().split('\n');
    let headerLineIndex = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].trim().startsWith('#')) {
        headerLineIndex = i;
        break;
      }
    }

    if (headerLineIndex === -1) {
      // 如果没有标题行，在 frontmatter 后追加一行
      headerLineIndex = 0;
      if (lines[0]?.trim() === '---') {
        const second = lines.findIndex((l, idx) => idx > 0 && l.trim() === '---');
        headerLineIndex = second >= 0 ? second + 1 : lines.length;
      }
    }

    const newHeader = `# ${emoji ? `${emoji} ` : ''}${name}`;
    const line = doc.lineAt(headerLineIndex);
    edit.replace(uri, line.range, newHeader);
    await vscode.workspace.applyEdit(edit);
    await doc.save();
  }

  /** 替换 Markdown 正文内容（保留 frontmatter 和标题行） */
  private async replaceMarkdownBody(file: string, newBody: string): Promise<void> {
    const uri = vscode.Uri.file(file);
    const doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();

    const lines = doc.getText().split('\n');

    let bodyStartLine = 0;

    // 跳过 frontmatter（--- ... ---）
    if (lines[0]?.trim() === '---') {
      const second = lines.findIndex((l, idx) => idx > 0 && l.trim() === '---');
      if (second >= 0) {
        bodyStartLine = second + 1;
      }
    }

    // 再跳过一行标题（# ...）
    for (let i = bodyStartLine; i < lines.length; i += 1) {
      if (lines[i].trim().startsWith('#')) {
        bodyStartLine = i + 1;
        break;
      }
    }

    const startPos = new vscode.Position(bodyStartLine, 0);
    const endPos = new vscode.Position(doc.lineCount, 0);
    const range = new vscode.Range(startPos, endPos);

    const text = `\n${newBody.trim()}\n`;
    edit.replace(uri, range, text);
    await vscode.workspace.applyEdit(edit);
    await doc.save();
  }

  /** 简单的 CLI 调用 Demo：执行一条 echo 命令并展示结果 */
  // private async cliDemo(): Promise<void> {
  //   const command =
  //     process.platform === 'win32' ? 'echo Prompt Hub CLI demo' : 'echo Prompt Hub CLI demo';

  //   try {
  //     const { stdout, stderr } = await this.exec(command);
  //     const output = [
  //       `命令: ${command}`,
  //       `stdout: ${stdout.trim() || '(空)'}`,
  //       stderr.trim() ? `stderr: ${stderr.trim()}` : '',
  //     ]
  //       .filter(Boolean)
  //       .join('\n');

  //     void vscode.window.showInformationMessage(output, { modal: true });
  //   } catch (error) {
  //     void vscode.window.showErrorMessage(
  //       `CLI 调用 Demo 失败：${
  //         error instanceof Error ? error.message : String(error)
  //       }`
  //     );
  //   }
  // }

    /** 简单的 CLI 调用 Demo：执行本地 AI CLI 并展示结果 */
  private async cliDemo(): Promise<void> {
    // 从配置读取要执行的命令：promptHub.cliDemo.command
    const command = this.configService.get<string>('cliDemo.command', '').trim();

    console.log('[PromptHub][cliDemo] 使用命令:', command);

    if (!command) {
      void vscode.window.showWarningMessage(
        '尚未配置 CLI Demo 命令，请在设置中搜索 "Prompt Hub: CLI Demo" 并填写要执行的命令行。'
      );
      return;
    }

    try {
      // 设置 Claude CLI 所需的环境变量
      const env = {
        ...process.env,
        ANTHROPIC_AUTH_TOKEN: 'sk_3eb56bdff5b7ef0d39976039db7bbe6789bbe5451b9bd4bb549c087b00077ba9',
        ANTHROPIC_BASE_URL: 'http://www.claudecodeserver.top/api'
      };

      console.log('[PromptHub][cliDemo] 设置环境变量:', {
        ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN ? env.ANTHROPIC_AUTH_TOKEN  : '未设置',
        ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL
      });

      console.log('[PromptHub][cliDemo] 开始执行命令...');
      const startTime = Date.now();

      // 使用带环境变量的 exec 执行命令，设置30秒超时
      const { stdout, stderr } = await this.execWithEnv(command, env, 30000);

      const executionTime = Date.now() - startTime;
      console.log(`[PromptHub][cliDemo] 命令执行完成，耗时: ${executionTime}ms`);
      const output = [
        `命令: ${command}`,
        `环境变量: ANTHROPIC_AUTH_TOKEN=***, ANTHROPIC_BASE_URL=${env.ANTHROPIC_BASE_URL}`,
        `stdout: ${stdout.trim() || '(空)'}`,
        stderr.trim() ? `stderr: ${stderr.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      console.log('[PromptHub][cliDemo] 输出:', output);
      void vscode.window.showInformationMessage(output, { modal: true });
    } catch (error) {
      console.error('[PromptHub][cliDemo] 调用失败:', error);
      void vscode.window.showErrorMessage(
        `CLI 调用 Demo 失败：${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 批量为所有 Prompt 生成 emoji 和 Name
   *
   * 流程：
   * 1. 检查是否有需要生成的 Prompt
   * 2. 用户确认（可能产生 API 费用）
   * 3. 显示进度条，逐个调用 AI
   * 4. 更新存储
   * 5. 显示统计结果
   */
  private async batchGenerateMeta(): Promise<void> {
    try {
      // 1. 获取所有 Prompt
      const prompts = this.storageService.list();
      if (!prompts.length) {
        void vscode.window.showInformationMessage('暂无 Prompt。');
        return;
      }

      // 2. 筛选需要生成的 Prompt（没有 emoji 或名称不规范的）
      const needsGeneration = prompts.filter((p) =>
        !p.emoji ||
        p.emoji === '📝' ||
        !p.name ||
        p.name === '未命名'
      );

      if (!needsGeneration.length) {
        void vscode.window.showInformationMessage(
          '所有 Prompt 都已有有效的 Name 和 Emoji。'
        );
        return;
      }

      // 3. 估算费用并确认
      const estimatedCost = await this.estimateBatchCost(needsGeneration.length);
      const message = estimatedCost > 0
        ? `将为 ${needsGeneration.length} 个 Prompt 生成 emoji 和 Name，预估费用 $${estimatedCost.toFixed(2)}。继续吗？`
        : `将为 ${needsGeneration.length} 个 Prompt 生成 emoji 和 Name。继续吗？`;

      const confirm = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        '继续',
        '取消'
      );

      if (confirm !== '继续') {
        return;
      }

      // 4. 创建 AI 服务实例
      const ai = new AIService(this.configService);
      let successCount = 0;
      let failureCount = 0;
      const failedPrompts: string[] = [];

      // 5. 显示进度条，逐个处理
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `正在为 ${needsGeneration.length} 个 Prompt 生成元信息...`,
          cancellable: true,
        },
        async (progress, token) => {
          for (let i = 0; i < needsGeneration.length; i++) {
            // 检查用户是否取消
            if (token.isCancellationRequested) {
              vscode.window.showWarningMessage('批量生成已取消。');
              break;
            }

            const prompt = needsGeneration[i];

            try {
              // 调用 AI 生成元信息
              const meta = await ai.generateMeta(prompt.content);

              if (!meta.name && !meta.emoji) {
                failureCount++;
                failedPrompts.push(prompt.name || `Prompt_${i}`);
                continue;
              }

              const nextName = meta.name?.trim() ? meta.name.trim() : (prompt.name || `Prompt_${i}`);
              const nextEmoji = meta.emoji !== undefined ? meta.emoji : prompt.emoji;

              // 更新 Prompt
              const updated: Prompt = {
                ...prompt,
                name: nextName,
                emoji: nextEmoji,
                updatedAt: new Date().toISOString(),
                aiGeneratedMeta: true, // 标记为 AI 生成
              };

              // 保存到存储
              await this.storageService.update(updated);

              // 如果有关联 Markdown 文件，同时更新其标题行
              if (updated.sourceFile) {
                await this.updateMarkdownHeader(updated.sourceFile, updated.name, updated.emoji);
              }
              successCount++;
            } catch (error) {
              failureCount++;
              failedPrompts.push(prompt.name || `Prompt_${i}`);
              console.error(
                `处理 Prompt "${prompt.name}" 失败:`,
                error instanceof Error ? error.message : String(error)
              );
            }

            // 更新进度
            const percentage = ((i + 1) / needsGeneration.length) * 100;
            progress.report({
              increment: 100 / needsGeneration.length,
              message: `已处理 ${i + 1}/${needsGeneration.length} (${Math.round(percentage)}%)`,
            });

            // 避免 API 速率限制，添加延迟
            // 可通过配置 promptHub.ai.batchDelayMs 调整
            const delayMs = this.configService.get<number>('ai.batchDelayMs', 500);
            await this.delay(delayMs);
          }
        }
      );

      // 6. 刷新树视图
      this.treeProvider.refresh();

      // 7. 显示结果统计
      let message_result = `批量生成完成！\n✅ 成功：${successCount} 个\n❌ 失败：${failureCount} 个`;
      if (failedPrompts.length > 0 && failedPrompts.length <= 5) {
        message_result += `\n\n失败的 Prompt：\n${failedPrompts.map(p => `  • ${p}`).join('\n')}`;
      }

      void vscode.window.showInformationMessage(message_result, { modal: false });
    } catch (error) {
      void vscode.window.showErrorMessage(
        `批量生成失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 批量为选中的 Prompt 生成 emoji 和 Name
   *
   * 用户可以多选需要生成的 Prompt，避免处理所有 Prompt
   */
  private async batchGenerateMetaSelected(): Promise<void> {
    try {
      const prompts = this.storageService.list();

      if (!prompts.length) {
        void vscode.window.showInformationMessage('暂无 Prompt。');
        return;
      }

      // 筛选需要生成的 Prompt
      const needsGeneration = prompts.filter(
        (p) => !p.emoji || p.emoji === '📝' || !p.name || p.name === '未命名'
      );

      if (!needsGeneration.length) {
        void vscode.window.showInformationMessage(
          '所有 Prompt 都已有有效的 Name 和 Emoji。'
        );
        return;
      }

      // 用户多选
      const selectedItems = await vscode.window.showQuickPick(
        needsGeneration.map((p) => ({
          label: p.emoji ? `${p.emoji} ${p.name}` : `📝 ${p.name}`,
          description: p.id,
          picked: true, // 默认全选
        })),
        {
          placeHolder: '选择要生成 emoji 的 Prompt（多选）',
          canPickMany: true,
          matchOnDescription: true,
        }
      );

      if (!selectedItems || !selectedItems.length) {
        return;
      }

      const selectedIds = selectedItems.map((item) => item.description!);
      const selectedPrompts = needsGeneration.filter((p) =>
        selectedIds.includes(p.id)
      );

      // 确认操作
      const estimatedCost = await this.estimateBatchCost(selectedPrompts.length);
      const message = estimatedCost > 0
        ? `将为 ${selectedPrompts.length} 个 Prompt 生成 emoji 和 Name，预估费用 $${estimatedCost.toFixed(2)}。继续吗？`
        : `将为 ${selectedPrompts.length} 个 Prompt 生成 emoji 和 Name。继续吗？`;

      const confirm = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        '继续',
        '取消'
      );

      if (confirm !== '继续') {
        return;
      }

      // 批量处理（同 batchGenerateMeta）
      const ai = new AIService(this.configService);
      let successCount = 0;
      let failureCount = 0;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `正在处理 ${selectedPrompts.length} 个 Prompt...`,
          cancellable: true,
        },
        async (progress, token) => {
          for (let i = 0; i < selectedPrompts.length; i++) {
            if (token.isCancellationRequested) {
              break;
            }

            const prompt = selectedPrompts[i];

            try {
              const meta = await ai.generateMeta(prompt.content);
              if (!meta.name && !meta.emoji) {
                failureCount++;
                continue;
              }

              const nextName = meta.name?.trim() ? meta.name.trim() : (prompt.name || `Prompt_${i}`);
              const nextEmoji = meta.emoji !== undefined ? meta.emoji : prompt.emoji;

              const updated: Prompt = {
                ...prompt,
                name: nextName,
                emoji: nextEmoji,
                updatedAt: new Date().toISOString(),
                aiGeneratedMeta: true,
              };
              await this.storageService.update(updated);

              if (updated.sourceFile) {
                await this.updateMarkdownHeader(updated.sourceFile, updated.name, updated.emoji);
              }
              successCount++;
            } catch (error) {
              failureCount++;
              console.error(`处理 Prompt "${prompt.name}" 失败:`, error);
            }

            progress.report({
              increment: 100 / selectedPrompts.length,
              message: `已处理 ${i + 1}/${selectedPrompts.length}`,
            });

            const delayMs = this.configService.get<number>('ai.batchDelayMs', 500);
            await this.delay(delayMs);
          }
        }
      );

      this.treeProvider.refresh();

      void vscode.window.showInformationMessage(
        `处理完成！✅ 成功：${successCount} 个\n❌ 失败：${failureCount} 个`
      );
    } catch (error) {
      void vscode.window.showErrorMessage(
        `批量生成失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 估算批量生成的费用
   *
   * 不同的 AI 提供商有不同的价格
   * 此方法返回估算的总成本（美元）
   */
  private async estimateBatchCost(count: number): Promise<number> {
    const provider = this.configService.get<string>('ai.provider', 'openai');

    // 各提供商的单次 API 调用成本（估算）
    const costPerCall: Record<string, number> = {
      'openai': 0.001,      // GPT-4o，约 1 毫美元
      'azure': 0.001,       // 同 OpenAI
      'gemini': 0,          // 免费配额内免费
      'deepseek': 0.00005,  // 非常便宜，约 0.05 毫美元
      'qwen': 0.00005,      // 通义千问，成本优化
      'custom': 0,          // 自定义 API，假设免费
    };

    const costPerCallValue = costPerCall[provider] || 0;
    return costPerCallValue * count;
  }

  /**
   * 延迟工具函数
   * 用于实现 API 调用之间的延迟，避免速率限制
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 优化单个 Prompt 的唤醒词（emoji 和 name）
   *
   * 当用户在树视图中选择单个 Prompt 时，点击 ✨ 按钮触发
   * 直接执行优化，无需确认对话
   */
  private async optimizeMeta(context?: any): Promise<void> {
    try {
      const prompt = await this.ensurePromptSelected(context);
      if (!prompt) return;

      // 创建 AI 服务实例
      const ai = new AIService(this.configService);

      // 显示进度条
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `正在优化 "${prompt.name}" 的唤醒词...`,
          cancellable: false,
        },
        async () => {
          const start = Date.now();
          try {
            // 调用 AI 生成元信息
            const meta = await ai.generateMeta(prompt.content);

            if (!meta.name && !meta.emoji) {
              const usage = new UsageLogService(this.configService);
              await usage.record({
                id: generateId(),
                timestamp: new Date().toISOString(),
                operation: 'meta',
                promptId: prompt.id,
                status: 'failed',
                durationMs: Date.now() - start,
                message: 'AI 未返回可用的标题/emoji（可能未配置或调用失败）',
              });

              void vscode.window.showInformationMessage('AI 未返回可用的唤醒词信息（可能未配置或调用失败）。');
              return;
            }

            const nextName = meta.name?.trim() ? meta.name.trim() : prompt.name;
            const nextEmoji = meta.emoji !== undefined ? meta.emoji : prompt.emoji;
            const changed = nextName !== prompt.name || nextEmoji !== prompt.emoji;

            if (!changed) {
              const usage = new UsageLogService(this.configService);
              await usage.record({
                id: generateId(),
                timestamp: new Date().toISOString(),
                operation: 'meta',
                promptId: prompt.id,
                status: 'success',
                durationMs: Date.now() - start,
                message: 'AI 返回的唤醒词与当前一致，无需更新',
              });

              void vscode.window.showInformationMessage('唤醒词无需更新。');
              return;
            }

            // 更新 Prompt
            const updated: Prompt = {
              ...prompt,
              name: nextName,
              emoji: nextEmoji,
              updatedAt: new Date().toISOString(),
              aiGeneratedMeta: true,
            };

            // 保存到存储
            await this.storageService.update(updated);

            // 同步更新 Markdown 标题
            if (updated.sourceFile) {
              await this.updateMarkdownHeader(updated.sourceFile, updated.name, updated.emoji);
            }

            // 刷新树视图
            this.treeProvider.refresh();

            const usage = new UsageLogService(this.configService);
            await usage.record({
              id: generateId(),
              timestamp: new Date().toISOString(),
              operation: 'meta',
              promptId: updated.id,
              status: 'success',
              durationMs: Date.now() - start,
            });

            // 显示成功提示
            void vscode.window.showInformationMessage(
              `✅ 已优化 "${updated.name}" 的唤醒词`
            );
          } catch (error) {
            const usage = new UsageLogService(this.configService);
            await usage.record({
              id: generateId(),
              timestamp: new Date().toISOString(),
              operation: 'meta',
              promptId: prompt.id,
              status: 'failed',
              durationMs: Date.now() - start,
              message: error instanceof Error ? error.message : String(error),
            });

            void vscode.window.showErrorMessage(
              `优化失败：${error instanceof Error ? error.message : String(error)}`
            );
            console.error('优化 Prompt 失败:', error);
          }
        }
      );
    } catch (error) {
      void vscode.window.showErrorMessage(
        `优化失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 批量优化选中的多个 Prompt 的唤醒词
   *
   * 当用户在树视图中多选 Prompt 时，工具栏显示 ✨批量优化唤醒词 按钮
   * 点击后弹出确认对话，用户确认后批量处理
   */
  private async batchOptimizeMeta(): Promise<void> {
    try {
      // 获取树视图的选择
      if (!this.treeView) {
        void vscode.window.showWarningMessage('树视图未初始化。');
        return;
      }

      const selectedItems = this.treeView.selection || [];
      if (!selectedItems.length) {
        void vscode.window.showWarningMessage('请选择要优化的 Prompt。');
        return;
      }

      // 提取 Prompt 对象（从树视图项中获取）
      const selectedPrompts: Prompt[] = [];
      for (const item of selectedItems) {
        // 检查是否是 PromptTreeItem（拥有 prompt 属性）
        const promptItem = item as any;
        if (promptItem.prompt) {
          selectedPrompts.push(promptItem.prompt);
        }
      }

      if (!selectedPrompts.length) {
        void vscode.window.showWarningMessage('未能获取选中的 Prompt。');
        return;
      }

      // 显示确认对话
      const confirmed = await vscode.window.showWarningMessage(
        `即将优化 ${selectedPrompts.length} 个 Prompt 的唤醒词，是否继续？`,
        { modal: true },
        '继续',
        '取消'
      );

      if (confirmed !== '继续') {
        return;
      }

      // 创建 AI 服务实例
      const ai = new AIService(this.configService);
      let successCount = 0;
      let skippedCount = 0;
      let failureCount = 0;
      const failedPrompts: string[] = [];

      // 显示进度条，逐个处理
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `正在优化 ${selectedPrompts.length} 个 Prompt 的唤醒词...`,
          cancellable: true,
        },
        async (progress, token) => {
          for (let i = 0; i < selectedPrompts.length; i++) {
            // 检查用户是否取消
            if (token.isCancellationRequested) {
              void vscode.window.showWarningMessage('优化已取消。');
              break;
            }

            const prompt = selectedPrompts[i];
            const start = Date.now();

            try {
              // 调用 AI 生成元信息
              const meta = await ai.generateMeta(prompt.content);

              if (!meta.name && !meta.emoji) {
                const usage = new UsageLogService(this.configService);
                await usage.record({
                  id: generateId(),
                  timestamp: new Date().toISOString(),
                  operation: 'meta',
                  promptId: prompt.id,
                  status: 'failed',
                  durationMs: Date.now() - start,
                  message: 'AI 未返回可用的标题/emoji（可能未配置或调用失败）',
                });

                failureCount++;
                failedPrompts.push(prompt.name || `Prompt_${i}`);
                continue;
              }

              const nextName = meta.name?.trim() ? meta.name.trim() : prompt.name;
              const nextEmoji = meta.emoji !== undefined ? meta.emoji : prompt.emoji;
              const changed = nextName !== prompt.name || nextEmoji !== prompt.emoji;

              if (!changed) {
                const usage = new UsageLogService(this.configService);
                await usage.record({
                  id: generateId(),
                  timestamp: new Date().toISOString(),
                  operation: 'meta',
                  promptId: prompt.id,
                  status: 'success',
                  durationMs: Date.now() - start,
                  message: 'AI 返回的唤醒词与当前一致，无需更新',
                });

                skippedCount++;
                continue;
              }

              // 更新 Prompt
              const updated: Prompt = {
                ...prompt,
                name: nextName,
                emoji: nextEmoji,
                updatedAt: new Date().toISOString(),
                aiGeneratedMeta: true,
              };

              // 保存到存储
              await this.storageService.update(updated);

              // 同步更新 Markdown 标题
              if (updated.sourceFile) {
                await this.updateMarkdownHeader(updated.sourceFile, updated.name, updated.emoji);
              }

              const usage = new UsageLogService(this.configService);
              await usage.record({
                id: generateId(),
                timestamp: new Date().toISOString(),
                operation: 'meta',
                promptId: updated.id,
                status: 'success',
                durationMs: Date.now() - start,
              });

              successCount++;
            } catch (error) {
              const usage = new UsageLogService(this.configService);
              await usage.record({
                id: generateId(),
                timestamp: new Date().toISOString(),
                operation: 'meta',
                promptId: prompt.id,
                status: 'failed',
                durationMs: Date.now() - start,
                message: error instanceof Error ? error.message : String(error),
              });

              failureCount++;
              failedPrompts.push(prompt.name || `Prompt_${i}`);
              console.error(
                `优化 Prompt "${prompt.name}" 失败:`,
                error instanceof Error ? error.message : String(error)
              );
            }

            // 更新进度
            const percentage = ((i + 1) / selectedPrompts.length) * 100;
            progress.report({
              increment: 100 / selectedPrompts.length,
              message: `已处理 ${i + 1}/${selectedPrompts.length} (${Math.round(percentage)}%)`,
            });

            // 避免 API 速率限制，添加延迟
            const delayMs = this.configService.get<number>('ai.batchDelayMs', 500);
            await this.delay(delayMs);
          }
        }
      );

      // 刷新树视图
      this.treeProvider.refresh();

      // 显示结果统计
      let resultMessage = `优化完成！\n✅ 成功：${successCount} 个\n⏭️ 无需更新：${skippedCount} 个\n❌ 失败：${failureCount} 个`;
      if (failedPrompts.length > 0 && failedPrompts.length <= 5) {
        resultMessage += `\n\n失败的 Prompt：\n${failedPrompts.map(p => `  • ${p}`).join('\n')}`;
      }

      void vscode.window.showInformationMessage(resultMessage, { modal: false });
    } catch (error) {
      void vscode.window.showErrorMessage(
        `批量优化失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 解析标签输入，支持逗号或空格分隔
   */
  private parseTagsInput(input: string): string[] {
    if (!input.trim()) {
      return [];
    }

    return input
      .split(/[,，]/) // 先按中英文逗号切分
      .map((chunk) => chunk.split(/\s+/)) // 再按空白拆分，兼容用户输入
      .flat()
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .filter((tag, index, arr) => arr.indexOf(tag) === index);
  }

  /**
   * 基于选区内容生成默认 Prompt 名称
   */
  private generateDefaultPromptName(rawContent: string): string {
    const normalized = (rawContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    const snippet = normalized.substring(0, 20);
    const base = snippet || '选区 Prompt';
    const safeBase = base.replace(/#/g, '').trim() || '选区 Prompt';
    const existingNames = new Set(this.storageService.list().map((p) => p.name));

    let index = 1;
    let candidate = `${safeBase} #${index}`;
    while (existingNames.has(candidate)) {
      index += 1;
      candidate = `${safeBase} #${index}`;
    }

    return candidate;
  }

}
