import * as vscode from 'vscode';
import { Prompt } from '../types/Prompt';
import { PromptStorageService } from '../services/PromptStorageService';
import { ConfigurationService } from '../services/ConfigurationService';
import { UsageLogService } from '../services/UsageLogService';

/**
 * Prompt TreeView Provider（支持标签分组）
 */
export class PromptTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private storageService: PromptStorageService,
    private configService: ConfigurationService
  ) {
    // 监听存储变更
    storageService.onDidChangePrompts(() => this.refresh());
  }

  /** 刷新视图 */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /** 获取树节点 */
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  /** 获取子节点 */
  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    let prompts = this.storageService.list();

    // 获取排序方式
    const sortBy = this.configService.get<string>('ui.sortBy', 'recent');

    // 按排序方式排序
    if (sortBy === 'usage') {
      // 按使用次数排序
      const usageService = new UsageLogService(this.configService);
      const logs = await usageService.readAll();
      const usageCount = new Map<string, number>();

      // 统计每个 Prompt 的使用次数
      logs.forEach(log => {
        if (log.promptId) {
          usageCount.set(log.promptId, (usageCount.get(log.promptId) || 0) + 1);
        }
      });

      // 排序：使用次数多的在前
      prompts.sort((a, b) => {
        const countA = usageCount.get(a.id) || 0;
        const countB = usageCount.get(b.id) || 0;
        return countB - countA;
      });
    } else if (sortBy === 'name') {
      // 按名称排序
      prompts.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'created') {
      // 按创建时间排序
      prompts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else {
      // 默认按更新时间排序（recent）
      prompts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    if (!element) {
      // 根节点：按标签分组
      const groups = new Map<string, Prompt[]>();
      for (const p of prompts) {
        const tags = p.tags && p.tags.length ? p.tags : ['未分组'];
        for (const t of tags) {
          const key = t || '未分组';
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(p);
        }
      }
      const items = Array.from(groups.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([tag, list]) => new TagGroupTreeItem(tag, list.length));
      return items;
    }

    if (element instanceof TagGroupTreeItem) {
      const tag = element.tag;
      const filtered = prompts.filter((p) => (p.tags && p.tags.length ? p.tags : ['未分组']).includes(tag));
      return filtered.map((p) => new PromptTreeItem(p));
    }

    return [];
  }
}

/** 标签分组节点 */
class TagGroupTreeItem extends vscode.TreeItem {
  constructor(public readonly tag: string, count: number) {
    super(`${tag} (${count})`, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'promptTagGroup';
  }
}

/** 单个 Prompt 节点 */
class PromptTreeItem extends vscode.TreeItem {
  constructor(public readonly prompt: Prompt) {
    super(`${prompt.emoji ? prompt.emoji + ' ' : ''}${prompt.name}`, vscode.TreeItemCollapsibleState.None);
    this.tooltip = prompt.content.substring(0, 100);
    this.description = prompt.sourceFile ? 'md' : undefined;
    this.contextValue = 'prompt';
    this.command = {
      command: 'promptHub.copyPromptContent',
      title: '复制',
      arguments: [prompt],
    };
  }
}
