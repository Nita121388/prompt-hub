import * as vscode from 'vscode';
import Fuse from 'fuse.js';
import { PromptStorageService } from '../services/PromptStorageService';
import { ConfigurationService } from '../services/ConfigurationService';
import { PromptTreeProvider } from '../providers/PromptTreeProvider';
import { OnboardingWizard } from '../services/OnboardingWizard';
import { SelectionParser } from '../utils/SelectionParser';
import { Prompt } from '../types/Prompt';
import { generateId } from '../utils/helpers';
import { PromptFileService } from '../services/PromptFileService';
import { AIService } from '../services/AIService';
import { GitSyncService } from '../services/GitSyncService';
import { UsageLogService } from '../services/UsageLogService';

/**
 * 命令注册器：集中注册所有命令
 */
export class CommandRegistrar {
  constructor(
    private context: vscode.ExtensionContext,
    private storageService: PromptStorageService,
    private configService: ConfigurationService,
    private treeProvider: PromptTreeProvider
  ) {}

  /** 注册所有命令 */
  registerAll(): void {
    this.register('promptHub.createFromSelection', () => this.createFromSelection());
    this.register('promptHub.newPromptFile', () => this.newPromptFile());
    this.register('promptHub.searchPrompt', () => this.searchPrompt());
    this.register('promptHub.copyPromptContent', (prompt: Prompt) => this.copyPromptContent(prompt));
    this.register('promptHub.refreshView', () => this.refreshView());
    this.register('promptHub.openSettings', () => this.openSettings());
    this.register('promptHub.startOnboarding', () => this.startOnboarding());
    this.register('promptHub.resetOnboarding', () => this.resetOnboarding());
    this.register('promptHub.deletePrompt', (prompt: Prompt) => this.deletePrompt(prompt));
    this.register('promptHub.aiGenerateMeta', (prompt?: Prompt) => this.aiGenerateMeta(prompt));
    this.register('promptHub.aiOptimize', (prompt?: Prompt) => this.aiOptimize(prompt));
    this.register('promptHub.gitSync', () => this.gitSync());
    this.register('promptHub.showQuickPick', () => this.showQuickPick());
  }

  /** 注册命令工具 */
  private register(command: string, callback: (...args: any[]) => any): void {
    const disposable = vscode.commands.registerCommand(command, callback);
    this.context.subscriptions.push(disposable);
  }

  /** 从选区创建 Prompt */
  private async createFromSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('请先打开编辑器');
      return;
    }
    const selection = editor.document.getText(editor.selection);
    if (!selection) {
      vscode.window.showWarningMessage('请先选中文本');
      return;
    }
    try {
      const parser = new SelectionParser(this.configService);
      const parsed = parser.parse(selection);
      const name = await vscode.window.showInputBox({
        prompt: '输入 Prompt 名称',
        placeHolder: '例如：代码审查清单',
        value: parsed.name,
      });
      if (!name) return;
      const prompt: Prompt = {
        id: generateId(),
        name,
        emoji: parsed.emoji,
        content: parsed.content,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sourceFile: editor.document.uri.fsPath,
        tags: [],
      };
      await this.storageService.add(prompt);
      vscode.window.showInformationMessage(`已创建 Prompt "${name}"`);
    } catch (error) {
      vscode.window.showErrorMessage(`创建 Prompt 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** 新建 Prompt 文件 */
  private async newPromptFile(): Promise<void> {
    try {
      const fileService = new PromptFileService(this.configService);
      await fileService.createPromptFile();
    } catch (error) {
      vscode.window.showErrorMessage(`新建 Prompt 文件失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** 搜索 Prompt（fuse.js 模糊搜索） */
  private async searchPrompt(): Promise<void> {
    const prompts = this.storageService.list();
    if (!prompts.length) {
      vscode.window.showInformationMessage('暂无 Prompt');
      return;
    }
    const input = await vscode.window.showInputBox({ placeHolder: '输入关键词进行模糊搜索（回车查看结果）' });
    const fuse = new Fuse(prompts, {
      includeScore: true,
      threshold: 0.4,
      keys: [
        { name: 'name', weight: 0.6 },
        { name: 'content', weight: 0.3 },
        { name: 'tags', weight: 0.1 },
      ],
    });
    const results = input ? fuse.search(input) : prompts.map((p) => ({ item: p } as any));
    const items = results.slice(0, 50).map((r: any) => ({
      label: `${r.item.emoji || '📝'} ${r.item.name}`,
      description: r.item.content.substring(0, 80),
      prompt: r.item as Prompt,
    }));
    const picked = await vscode.window.showQuickPick(items, { placeHolder: '选择要复制的 Prompt' });
    if (picked) await this.copyPromptContent(picked.prompt);
  }

  /** 复制 Prompt 内容 */
  private async copyPromptContent(prompt: Prompt): Promise<void> {
    await vscode.env.clipboard.writeText(prompt.content);
    // 记录使用次数
    const usage = new UsageLogService(this.configService);
    await usage.record({
      id: generateId(),
      timestamp: new Date().toISOString(),
      operation: 'meta',
      promptId: prompt.id,
      status: 'success',
    });
    vscode.window.showInformationMessage(`已复制 "${prompt.name}"`);
  }

  /** 刷新视图 */
  private async refreshView(): Promise<void> {
    await this.storageService.refresh();
    vscode.window.showInformationMessage('视图已刷新');
  }

  /** 打开设置 */
  private openSettings(): void {
    this.configService.openSettings();
  }

  /** 启动引导 */
  private async startOnboarding(): Promise<void> {
    const wizard = new OnboardingWizard(this.context);
    await wizard.start();
  }

  /** 重置引导 */
  private async resetOnboarding(): Promise<void> {
    const wizard = new OnboardingWizard(this.context);
    await wizard.reset();
  }

  /** 删除 Prompt（右键菜单） */
  private async deletePrompt(prompt: Prompt): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
      `确认删除 Prompt：${prompt.name}？此操作不可撤销。`,
      { modal: true },
      '删除',
      '取消'
    );
    if (answer !== '删除') return;
    await this.storageService.remove(prompt.id);
    vscode.window.showInformationMessage(`已删除 Prompt：${prompt.name}`);
    this.treeProvider.refresh();
  }

  /** AI 生成标题/emoji */
  private async aiGenerateMeta(prompt?: Prompt): Promise<void> {
    const p = await this.ensurePromptSelected(prompt);
    if (!p) return;
    const ai = new AIService(this.configService);
    const usage = new UsageLogService(this.configService);
    const start = Date.now();
    const meta = await ai.generateMeta(p.content);
    const durationMs = Date.now() - start;
    if (!meta.name && !meta.emoji) return;
    if (p.sourceFile) {
      await this.updateMarkdownHeader(p.sourceFile, meta.name || p.name, meta.emoji || p.emoji);
    } else {
      p.name = meta.name || p.name;
      p.emoji = meta.emoji || p.emoji;
      p.updatedAt = new Date().toISOString();
      await this.storageService.update(p);
    }
    await usage.record({ id: generateId(), timestamp: new Date().toISOString(), operation: 'meta', promptId: p.id, status: 'success', durationMs });
    this.treeProvider.refresh();
    vscode.window.showInformationMessage(`已更新标题：${meta.emoji || ''} ${meta.name || p.name}`.trim());
  }

  /** AI 优化内容 */
  private async aiOptimize(prompt?: Prompt): Promise<void> {
    const p = await this.ensurePromptSelected(prompt);
    if (!p) return;
    const ai = new AIService(this.configService);
    const usage = new UsageLogService(this.configService);
    const start = Date.now();
    const optimized = await ai.optimize(p.content);
    const durationMs = Date.now() - start;
    if (!optimized || optimized === p.content) {
      vscode.window.showInformationMessage('AI 优化没有变化');
      return;
    }
    if (p.sourceFile) {
      await this.replaceMarkdownBody(p.sourceFile, optimized);
    } else {
      p.content = optimized;
      p.updatedAt = new Date().toISOString();
      await this.storageService.update(p);
    }
    await usage.record({ id: generateId(), timestamp: new Date().toISOString(), operation: 'optimize', promptId: p.id, status: 'success', durationMs });
    this.treeProvider.refresh();
    vscode.window.showInformationMessage(`已优化 Prompt：${p.name}`);
  }

  /** Git 同步 */
  private async gitSync(): Promise<void> {
    const git = new GitSyncService(this.configService);
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Prompt Hub: Git 同步中' }, async () => {
      await git.sync();
    });
    vscode.window.showInformationMessage('Git 同步完成');
  }

  /** 显示快速访问菜单 */
  private async showQuickPick(): Promise<void> {
    const items = [
      {
        label: '📝 新建 Prompt',
        description: '创建新的 Prompt 文件',
        action: 'new',
      },
      {
        label: '🔍 搜索 Prompt',
        description: '搜索并复制 Prompt',
        action: 'search',
      },
      {
        label: '✂️ 从选区创建',
        description: '从当前选中的文本创建 Prompt',
        action: 'fromSelection',
      },
      {
        label: '🔄 刷新视图',
        description: '重新加载 Prompt 列表',
        action: 'refresh',
      },
      {
        label: '🔀 Git 同步',
        description: '同步 Prompt 到远程仓库',
        action: 'git',
      },
      {
        label: '⚙️ 打开设置',
        description: '配置 Prompt Hub',
        action: 'settings',
      },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: '选择要执行的操作',
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
      case 'git':
        await this.gitSync();
        break;
      case 'settings':
        this.openSettings();
        break;
    }
  }

  /** 若未传入 Prompt，则让用户选择 */
  private async ensurePromptSelected(prompt?: Prompt): Promise<Prompt | undefined> {
    if (prompt) return prompt;
    const list = this.storageService.list();
    if (!list.length) {
      vscode.window.showInformationMessage('暂无 Prompt');
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      list.map((p) => ({ label: `${p.emoji || '📝'} ${p.name}`, description: p.content.substring(0, 60), prompt: p })),
      { placeHolder: '选择一个 Prompt' }
    );
    return picked?.prompt;
  }

  /** 修改 Markdown 头部（# prompt: ...） */
  private async updateMarkdownHeader(file: string, name: string, emoji?: string): Promise<void> {
    const uri = vscode.Uri.file(file);
    const doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    const firstLine = doc.lineAt(0);
    const newHeader = `# prompt: ${emoji ? emoji + ' ' : ''}${name}`;
    edit.replace(uri, new vscode.Range(firstLine.range.start, firstLine.range.end), newHeader);
    await vscode.workspace.applyEdit(edit);
    await doc.save();
  }

  /** 替换 Markdown 正文（保留第一行 header 与尾部 ID 注释） */
  private async replaceMarkdownBody(file: string, newBody: string): Promise<void> {
    const uri = vscode.Uri.file(file);
    const doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    const lines = doc.getText().split('\n');
    let idLineIndex = lines.findIndex((l: string) => /<!--\s*PromptHub:id=/.test(l));
    if (idLineIndex < 0) idLineIndex = lines.length; // 没有则认为在末尾
    const startPos = new vscode.Position(1, 0); // 从第二行开始
    const endPos = new vscode.Position(idLineIndex, 0);
    const range = new vscode.Range(startPos, endPos);
    const text = `\n${newBody.trim()}\n`;
    edit.replace(uri, range, text);
    await vscode.workspace.applyEdit(edit);
    await doc.save();
  }
}
