import * as vscode from 'vscode';
import { PromptStorageService } from '../services/PromptStorageService';
import { ConfigurationService } from '../services/ConfigurationService';
import { PromptTreeProvider } from '../providers/PromptTreeProvider';
import { OnboardingWizard } from '../services/OnboardingWizard';
import { SelectionParser } from '../utils/SelectionParser';
import { Prompt } from '../types/Prompt';
import { generateId } from '../utils/helpers';

/**
 * 命令注册器
 * 集中注册所有命令
 */
export class CommandRegistrar {
  constructor(
    private context: vscode.ExtensionContext,
    private storageService: PromptStorageService,
    private configService: ConfigurationService,
    private treeProvider: PromptTreeProvider
  ) {}

  /**
   * 注册所有命令
   */
  registerAll(): void {
    // 从选区创建 Prompt
    this.register('promptHub.createFromSelection', () => this.createFromSelection());

    // 新建 Prompt 文件
    this.register('promptHub.newPromptFile', () => this.newPromptFile());

    // 搜索 Prompt
    this.register('promptHub.searchPrompt', () => this.searchPrompt());

    // 复制 Prompt 内容
    this.register('promptHub.copyPromptContent', (prompt: Prompt) =>
      this.copyPromptContent(prompt)
    );

    // 刷新视图
    this.register('promptHub.refreshView', () => this.refreshView());

    // 打开设置
    this.register('promptHub.openSettings', () => this.openSettings());

    // 启动引导
    this.register('promptHub.startOnboarding', () => this.startOnboarding());

    // 重置引导
    this.register('promptHub.resetOnboarding', () => this.resetOnboarding());
  }

  /**
   * 注册命令
   */
  private register(command: string, callback: (...args: any[]) => any): void {
    const disposable = vscode.commands.registerCommand(command, callback);
    this.context.subscriptions.push(disposable);
  }

  /**
   * 从选区创建 Prompt
   */
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
      // 智能解析选区
      const parser = new SelectionParser(this.configService);
      const parsed = parser.parse(selection);

      // 询问名称
      const name = await vscode.window.showInputBox({
        prompt: '输入 Prompt 名称',
        placeHolder: '例如：代码审查清单',
        value: parsed.name,
      });

      if (!name) {
        return;
      }

      // 创建 Prompt
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
      vscode.window.showInformationMessage(`✓ Prompt "${name}" 创建成功`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `创建 Prompt 失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 新建 Prompt 文件
   */
  private async newPromptFile(): Promise<void> {
    vscode.window.showInformationMessage('新建 Prompt 文件功能正在开发中...');
  }

  /**
   * 搜索 Prompt
   */
  private async searchPrompt(): Promise<void> {
    const prompts = this.storageService.list();

    if (prompts.length === 0) {
      vscode.window.showInformationMessage('暂无 Prompt');
      return;
    }

    const items = prompts.map((p) => ({
      label: `${p.emoji || '📝'} ${p.name}`,
      description: p.content.substring(0, 50),
      prompt: p,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: '搜索 Prompt...',
    });

    if (selected) {
      await this.copyPromptContent(selected.prompt);
    }
  }

  /**
   * 复制 Prompt 内容
   */
  private async copyPromptContent(prompt: Prompt): Promise<void> {
    await vscode.env.clipboard.writeText(prompt.content);
    vscode.window.showInformationMessage(`✓ 已复制 "${prompt.name}"`);
  }

  /**
   * 刷新视图
   */
  private async refreshView(): Promise<void> {
    await this.storageService.refresh();
    vscode.window.showInformationMessage('视图已刷新');
  }

  /**
   * 打开设置
   */
  private openSettings(): void {
    this.configService.openSettings();
  }

  /**
   * 启动引导
   */
  private async startOnboarding(): Promise<void> {
    const wizard = new OnboardingWizard(this.context, this.configService);
    await wizard.start();
  }

  /**
   * 重置引导
   */
  private async resetOnboarding(): Promise<void> {
    const wizard = new OnboardingWizard(this.context, this.configService);
    await wizard.reset();
  }
}
