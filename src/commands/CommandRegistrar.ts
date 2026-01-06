import * as vscode from 'vscode';
import * as path from 'path';
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
 * 命令注册器：负责注册所有 Otter 相关命令并实现具体逻辑
 */
export class CommandRegistrar {
  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private static isPrompt(value: unknown): value is Prompt {
    if (!CommandRegistrar.isRecord(value)) return false;
    return (
      typeof value.id === 'string' &&
      typeof value.name === 'string' &&
      typeof value.content === 'string'
    );
  }

  private static extractPrompt(value: unknown): Prompt | undefined {
    if (CommandRegistrar.isPrompt(value)) return value;
    if (!CommandRegistrar.isRecord(value)) return undefined;
    const maybePrompt = value.prompt;
    if (CommandRegistrar.isPrompt(maybePrompt)) return maybePrompt;
    return undefined;
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly storageService: PromptStorageService,
    private readonly configService: ConfigurationService,
    private readonly treeProvider: PromptTreeProvider,
    private readonly treeView?: vscode.TreeView<vscode.TreeItem>
  ) {}

  /** 注册所有命令 */
  registerAll(): void {
    this.register('otter.createFromSelection', () => this.createFromSelection());
    this.register('otter.newPromptFile', () => this.newPromptFile());
    this.register('otter.searchPrompt', () => this.searchPrompt());
    this.register('otter.renamePromptFile', (context?: unknown) => this.renamePromptFile(context));
    this.register('otter.copyPromptContent', (context?: unknown) =>
      this.copyPromptContent(context)
    );
    this.register('otter.editPrompt', (context?: unknown) => this.editPrompt(context));
    this.register('otter.refreshView', () => this.refreshView());
    this.register('otter.openSettings', () => this.openSettings());
    this.register('otter.openStorageFolder', () => this.openStorageFolder());
    this.register('otter.startOnboarding', () => this.startOnboarding());
    this.register('otter.resetOnboarding', () => this.resetOnboarding());
    this.register('otter.deletePrompt', (context?: unknown) => this.deletePrompt(context));
    this.register('otter.gitPull', () => this.gitPull());
    this.register('otter.gitSync', () => this.gitSync());
    this.register('otter.showQuickPick', () => this.showQuickPick());
    this.register('otter.onPromptItemClick', (arg?: unknown) =>
      this.onPromptTreeItemClick(CommandRegistrar.extractPrompt(arg))
    );
    this.register('otter.batchGenerateMeta', () => this.batchGenerateMeta());
    this.register('otter.batchGenerateMetaSelected', () =>
      this.batchGenerateMetaSelected()
    );
    this.register('otter.optimizeMeta', (context?: unknown) => this.optimizeMeta(context));
    this.register('otter.batchOptimizeMeta', () => this.batchOptimizeMeta());
  }

  /** 注册单个命令的工具方法 */
  private register(command: string, callback: (...args: unknown[]) => unknown): void {
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

    const results = query ? fuse.search(query) : prompts.map((p) => ({ item: p }));
    const items = results.slice(0, 50).map((r) => ({
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
  private async copyPromptContent(context?: unknown): Promise<void> {
    const prompt = CommandRegistrar.extractPrompt(context);

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
  private async editPrompt(context?: unknown): Promise<void> {
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
  private async renamePromptFile(context?: unknown): Promise<void> {
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
  private async deletePrompt(context?: unknown): Promise<void> {
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
        title: 'Otter: 正在执行 Git 同步...',
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
        `Otter: 导入过程中检测到文件冲突，已临时备份相关文件到：${importBackupDir}（导入后已尽量恢复；若同名冲突会自动改名保留，详情见日志）`
      );
    }
    void vscode.window.showInformationMessage('Otter: Git 同步完成。');
  }

  /** Git 拉取/导入（新设备一键把远端 prompts 拉到本地） */
  private async gitPull(): Promise<void> {
    const git = new GitSyncService(this.configService);
    let importBackupDir: string | null = null;
    let preserveUntrackedBackupDir: string | null = null;
    let preserveUntrackedConflicts = 0;
    const debugLogEnabled = this.configService.get<boolean>('git.debugLog', false);
    const logDebug = (...args: unknown[]) => {
      if (!debugLogEnabled) return;
      console.log('[CommandRegistrar][GitPull]', ...args);
    };

    logDebug('开始执行 Git 拉取/导入');
    const isRepo = await git.isGitRepo();
    logDebug('isGitRepo =', isRepo);
    const remoteUrl = await this.ensureRemoteUrlForImport(git, {
      allowSkipIfOriginExists: isRepo,
    });
    logDebug('remoteUrl 已获取（为避免泄露凭据，此处不输出 URL 明文）:', Boolean(remoteUrl));

    if (!remoteUrl) {
      logDebug('用户取消 remoteUrl 输入/选择，终止');
      throw new Error(isRepo ? '已取消 Git 拉取。' : '已取消 Git 导入。');
    }

    type PullStrategy = 'rebase' | 'force' | 'preserveUntracked';
    let strategy: PullStrategy = 'rebase';

    if (isRepo) {
      const status = await git.status();
      const isDirty = Boolean(status.trim());
      logDebug('检测工作区是否干净 isDirty =', isDirty);
      if (debugLogEnabled && isDirty) {
        const statusLines = status
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        logDebug('statusLines =', statusLines.length, '示例 =', statusLines.slice(0, 20).join(' | '));
      }

      if (isDirty) {
        const picked = await vscode.window.showQuickPick(
          [
            {
              id: 'rebase' as const,
              label: '保留本地改动并拉取（推荐）',
              description: 'git pull --rebase（默认带 --autostash），可能出现冲突',
            },
            {
              id: 'preserveUntracked' as const,
              label: '保留本地未跟踪文件，仅恢复远端内容',
              description: '备份未跟踪文件 → 丢弃其它改动 → 以远端为准恢复',
            },
            {
              id: 'force' as const,
              label: '以远端覆盖本地（危险）',
              description: '丢弃所有未提交改动（包含新建文件）',
            },
          ],
          {
            title: 'Otter: 选择 Git 拉取策略',
            placeHolder: '检测到本地有未提交改动，请选择要怎么处理',
            ignoreFocusOut: true,
          }
        );

        if (!picked) {
          logDebug('用户取消策略选择，终止');
          return;
        }

        strategy = picked.id;
        logDebug('用户选择策略 =', strategy);

        if (strategy === 'force') {
          const confirm = await vscode.window.showWarningMessage(
            '将以远端为准覆盖本地：会丢弃 storagePath 下所有未提交改动，并可能删除未跟踪文件。建议先备份你要保留的 Prompt。',
            { modal: true },
            '继续',
            '取消'
          );
          if (confirm !== '继续') return;
        }

        if (strategy === 'preserveUntracked') {
          const confirm = await vscode.window.showWarningMessage(
            '将保留未跟踪文件（未提交的新文件），但会丢弃其它未提交改动（包括删除/修改）。随后会按远端最新内容恢复工作区。',
            { modal: true },
            '继续',
            '取消'
          );
          if (confirm !== '继续') return;
        }
      }
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Otter: 正在拉取/导入远端内容...',
      },
      async () => {
        if (!isRepo) {
          logDebug('当前目录非 Git 仓库，进入 importFromRemote()');
          await git.importFromRemote(remoteUrl);
          importBackupDir = git.getLastImportBackupDir();
          return;
        }

        if (strategy === 'force') {
          logDebug('执行 forceResetToRemote()（危险：丢弃本地未提交改动）');
          await git.forceResetToRemote(remoteUrl ?? undefined);
          return;
        }

        if (strategy === 'preserveUntracked') {
          logDebug('执行 restoreRemotePreserveUntracked()（保留未跟踪文件，恢复远端）');
          const result = await git.restoreRemotePreserveUntracked(remoteUrl ?? undefined);
          preserveUntrackedBackupDir = result.backupDir;
          preserveUntrackedConflicts = result.conflicts;
          logDebug('restoreRemotePreserveUntracked() 完成，backupDir =', result.backupDir, 'restored =', result.restored, 'conflicts =', result.conflicts);
          return;
        }

        logDebug('执行 pullRebase()（默认带 --autostash）');
        await git.pullRebase(remoteUrl ?? undefined);
      }
    );

    await this.refreshAfterGit();
    if (importBackupDir) {
      void vscode.window.showWarningMessage(
        `Otter: 导入过程中检测到文件冲突，已临时备份相关文件到：${importBackupDir}（导入后已尽量恢复；若同名冲突会自动改名保留，详情见日志）`
      );
    }
    if (preserveUntrackedBackupDir) {
      if (preserveUntrackedConflicts > 0) {
        void vscode.window.showWarningMessage(
          `Otter: 已恢复远端内容并保留本地未跟踪文件，但有 ${preserveUntrackedConflicts} 个文件与远端同名，已自动改名保留。备份目录：${preserveUntrackedBackupDir}`
        );
      } else {
        void vscode.window.showInformationMessage(
          `Otter: 已恢复远端内容并保留本地未跟踪文件。备份目录：${preserveUntrackedBackupDir}`
        );
      }
    }

    const count = this.storageService.list().length;
    if (count <= 0) {
      const storagePath = this.configService.getStoragePath();
      const selected = await vscode.window.showWarningMessage(
        `Otter: Git 拉取/导入完成，但未发现任何 Prompt（prompts.json/Markdown）。请确认仓库内容与 storagePath 是否正确：${storagePath}`,
        '打开存储目录',
        '打开设置',
        '开启 Git 诊断日志'
      );

      if (selected === '打开存储目录') {
        await vscode.commands.executeCommand('otter.openStorageFolder');
      } else if (selected === '打开设置') {
        this.configService.openSettings();
      } else if (selected === '开启 Git 诊断日志') {
        await this.configService.set('git.debugLog', true, vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage('Otter: 已开启 Git 诊断日志，可重新执行一次拉取/导入以收集更多信息。');
      }

      return;
    }

    void vscode.window.showInformationMessage(`Otter: Git 拉取/导入完成（${count} 条 Prompt）。`);
  }

  private async refreshAfterGit(): Promise<void> {
    try {
      await this.storageService.refresh();
      this.treeProvider.refresh();
      await this.logGitAndPromptDiagnosticsAfterRefresh();
    } catch (error) {
      console.error('[CommandRegistrar] Git 操作后刷新失败:', error);
    }
  }

  private async logGitAndPromptDiagnosticsAfterRefresh(): Promise<void> {
    const debugLogEnabled = this.configService.get<boolean>('git.debugLog', false);
    if (!debugLogEnabled) return;

    const storagePath = this.configService.getStoragePath();
    const prompts = this.storageService.list();

    const normalizeSep = (p: string) => (p || '').replace(/\\/g, '/');
    const isBackupPath = (p: string) => /(^|[\\/])\.otter-backup-\d{8}-\d{6}([\\/]|$)/.test(p);

    const relPath = (abs: string | undefined) => {
      if (!abs) return '';
      const r = path.relative(storagePath, abs);
      return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : abs;
    };

    console.log('[CommandRegistrar][GitDiagnostics] storagePath =', storagePath);
    console.log('[CommandRegistrar][GitDiagnostics] prompts =', prompts.length);

    const promptsWithSource = prompts.filter((p) => Boolean(p.sourceFile));
    const backupPrompts = promptsWithSource.filter((p) => isBackupPath(p.sourceFile!));
    console.log(
      '[CommandRegistrar][GitDiagnostics] promptsWithSource =',
      promptsWithSource.length,
      'backupPrompts =',
      backupPrompts.length
    );

    // 重复项诊断：同名（含 emoji）在 UI 上最容易被误认为“重复”
    const byDisplayName = new Map<string, Prompt[]>();
    for (const p of prompts) {
      const display = `${p.emoji ? `${p.emoji} ` : ''}${p.name || ''}`.trim();
      const list = byDisplayName.get(display) ?? [];
      list.push(p);
      byDisplayName.set(display, list);
    }

    const duplicates = Array.from(byDisplayName.entries())
      .filter(([, list]) => list.length > 1)
      .sort((a, b) => b[1].length - a[1].length);

    if (duplicates.length > 0) {
      console.log('[CommandRegistrar][GitDiagnostics] 重复显示名数量 =', duplicates.length);
      for (const [display, list] of duplicates.slice(0, 10)) {
        const items = list
          .map((p) => {
            const src = p.sourceFile ? normalizeSep(relPath(p.sourceFile)) : '(无 sourceFile)';
            const mark = p.sourceFile && isBackupPath(p.sourceFile) ? ' [backup]' : '';
            return `${p.id} -> ${src}${mark}`;
          })
          .join(' | ');
        console.log(`[CommandRegistrar][GitDiagnostics] DUP "${display}" x${list.length}:`, items);
      }
    }

    // Git 状态辅助验证：哪些文件是本地新建/未跟踪（远端不可能“凭空出现”）
    const git = new GitSyncService(this.configService);
    const isRepo = await git.isGitRepo();
    console.log('[CommandRegistrar][GitDiagnostics] isGitRepo =', isRepo);
    if (!isRepo) return;

    try {
      const status = await git.status();
      const lines = status
        .split(/\r?\n/)
        .map((l) => l.trimEnd())
        .filter(Boolean);

      const untracked = lines.filter((l) => l.startsWith('?? '));
      const deleted = lines.filter((l) => l.startsWith(' D ') || l.startsWith('D  ') || l.startsWith('DD ') || l.startsWith('UD '));

      console.log(
        '[CommandRegistrar][GitDiagnostics] git status --porcelain lines =',
        lines.length,
        'untracked =',
        untracked.length,
        'deleted =',
        deleted.length
      );
      if (untracked.length > 0) {
        console.log('[CommandRegistrar][GitDiagnostics] untracked 示例 =', untracked.slice(0, 20).join(' | '));
      }
      if (deleted.length > 0) {
        console.log('[CommandRegistrar][GitDiagnostics] deleted 示例 =', deleted.slice(0, 20).join(' | '));
      }

      if (backupPrompts.length > 0) {
        console.log(
          '[CommandRegistrar][GitDiagnostics] backupPrompts 示例 =',
          backupPrompts
            .slice(0, 10)
            .map((p) => normalizeSep(relPath(p.sourceFile!)))
            .join(' | ')
        );
      }
    } catch (err) {
      console.warn('[CommandRegistrar][GitDiagnostics] 获取 git status 失败:', err);
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
        description: '重新运行 Otter 配置向导',
        action: 'onboarding',
      },
      {
        label: '⚙️ 打开设置',
        description: '打开 Otter 设置页',
        action: 'settings',
      },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: '选择要执行的 Otter 操作',
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
  private async ensurePromptSelected(input?: unknown): Promise<Prompt | undefined> {
    const prompt = CommandRegistrar.extractPrompt(input);
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
    for (let counter = 1; counter <= 1000; counter += 1) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
        if (currentPath && path.resolve(candidate) === path.resolve(currentPath)) {
          return candidate;
        }
        candidate = path.join(dir, `${base}-${counter}${ext}`);
      } catch {
        return candidate;
      }
    }

    throw new Error(`无法生成不冲突的文件名（尝试次数过多）：${desiredPath}`);
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
  //     process.platform === 'win32' ? 'echo Otter CLI demo' : 'echo Otter CLI demo';

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
          progress.report({ message: '正在调用 AI（批处理）...' });

          const batchItems = needsGeneration.map((p) => ({ id: p.id, content: p.content }));
          const batchResults = await ai.generateMetaBatch(batchItems);
          const byId = new Map(batchResults.map((r) => [r.id, r]));

          for (let i = 0; i < needsGeneration.length; i++) {
            // 检查用户是否取消
            if (token.isCancellationRequested) {
              vscode.window.showWarningMessage('批量生成已取消。');
              break;
            }

            const prompt = needsGeneration[i];
            const meta = byId.get(prompt.id);

            if (!meta || (!meta.name && !meta.emoji)) {
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

            try {
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
          progress.report({ message: '正在调用 AI（批处理）...' });

          const batchItems = selectedPrompts.map((p) => ({ id: p.id, content: p.content }));
          const batchResults = await ai.generateMetaBatch(batchItems);
          const byId = new Map(batchResults.map((r) => [r.id, r]));

          for (let i = 0; i < selectedPrompts.length; i++) {
            if (token.isCancellationRequested) {
              break;
            }

            const prompt = selectedPrompts[i];
            const meta = byId.get(prompt.id);

            if (!meta || (!meta.name && !meta.emoji)) {
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

            try {
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
  private async optimizeMeta(context?: unknown): Promise<void> {
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
        const prompt = CommandRegistrar.extractPrompt(item);
        if (prompt) selectedPrompts.push(prompt);
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
          progress.report({ message: '正在调用 AI（批处理）...' });
          const batchStartedAt = Date.now();
          const batchItems = selectedPrompts.map((p) => ({ id: p.id, content: p.content }));
          const batchResults = await ai.generateMetaBatch(batchItems);
          const batchDurationMs = Date.now() - batchStartedAt;
          const byId = new Map(batchResults.map((r) => [r.id, r]));
          const perItemDurationMs = selectedPrompts.length ? Math.round(batchDurationMs / selectedPrompts.length) : 0;

          for (let i = 0; i < selectedPrompts.length; i++) {
            // 检查用户是否取消
            if (token.isCancellationRequested) {
              void vscode.window.showWarningMessage('优化已取消。');
              break;
            }

            const prompt = selectedPrompts[i];

            try {
              // 调用 AI 生成元信息
              const meta = byId.get(prompt.id);

              if (!meta || (!meta.name && !meta.emoji)) {
                const usage = new UsageLogService(this.configService);
                await usage.record({
                  id: generateId(),
                  timestamp: new Date().toISOString(),
                  operation: 'meta',
                  promptId: prompt.id,
                  status: 'failed',
                  durationMs: perItemDurationMs,
                  message: meta?.error || 'AI 未返回可用的标题/emoji（可能未配置或调用失败）',
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
                  durationMs: perItemDurationMs,
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
                durationMs: perItemDurationMs,
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
                durationMs: perItemDurationMs,
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
