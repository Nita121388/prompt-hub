import * as vscode from 'vscode';
import { Prompt } from '../types/Prompt';
import { PromptStorageService } from '../services/PromptStorageService';
import { ConfigurationService } from '../services/ConfigurationService';

/**
 * Prompt TreeView Provider
 */
export class PromptTreeProvider implements vscode.TreeDataProvider<PromptTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PromptTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private storageService: PromptStorageService,
    private configService: ConfigurationService
  ) {
    // 监听存储变更
    storageService.onDidChangePrompts(() => {
      this.refresh();
    });
  }

  /**
   * 刷新视图
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * 获取树节点
   */
  getTreeItem(element: PromptTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * 获取子节点
   */
  getChildren(element?: PromptTreeItem): Thenable<PromptTreeItem[]> {
    if (!element) {
      // 根节点：返回所有 Prompt
      const prompts = this.storageService.list();
      return Promise.resolve(
        prompts.map((prompt) => new PromptTreeItem(prompt, vscode.TreeItemCollapsibleState.None))
      );
    }

    // 暂时不支持子节点
    return Promise.resolve([]);
  }
}

/**
 * TreeView 项
 */
export class PromptTreeItem extends vscode.TreeItem {
  constructor(
    public readonly prompt: Prompt,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(prompt.name, collapsibleState);

    this.tooltip = prompt.content.substring(0, 100);
    this.description = prompt.emoji;
    this.contextValue = 'prompt';

    // 点击行为：复制内容到剪贴板
    this.command = {
      command: 'promptHub.copyPromptContent',
      title: '复制',
      arguments: [prompt],
    };
  }
}
