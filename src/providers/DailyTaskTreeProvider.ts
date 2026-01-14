import * as vscode from 'vscode';
import { DailyLogService } from '../services/DailyLogService';
import { DailyTask, formatDurationCompact } from '../utils/DailyLogTaskParser';
import { formatDateTime } from '../utils/TimeCommand';

type Node =
  | { kind: 'group'; id: 'running' | 'done' }
  | { kind: 'task'; task: DailyTask; state: 'running' | 'done' }
  | { kind: 'message'; text: string; command?: vscode.Command };

export class DailyTaskTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private cachedTasks: DailyTask[] = [];
  private lastError: string | undefined;

  constructor(private readonly dailyLog: DailyLogService) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async getTreeItem(element: Node): Promise<vscode.TreeItem> {
    if (element.kind === 'group') {
      const label = element.id === 'running' ? '运行中的任务' : '已完成的任务';
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = `dailyTaskGroup:${element.id}`;
      return item;
    }

    if (element.kind === 'message') {
      const item = new vscode.TreeItem(element.text, vscode.TreeItemCollapsibleState.None);
      item.contextValue = 'dailyTask:message';
      item.command = element.command;
      return item;
    }

    const t = element.task;
    const startTs = formatDateTime(t.start, this.dailyLog.getTimeFormat());

    if (element.state === 'running') {
      const elapsed = Math.max(0, Date.now() - t.start.getTime());
      const elapsedText = formatDurationCompact(elapsed);
      const item = new vscode.TreeItem(`🕐 ${startTs} ${t.title}`);
      item.description = `运行中 ${elapsedText}`;
      item.contextValue = 'dailyTask:running';
      item.command = {
        command: 'otter.dailyLog.endById',
        title: '结束任务',
        arguments: [t.id],
      };
      return item;
    }

    const duration = t.durationMs !== undefined ? formatDurationCompact(t.durationMs) : '';
    const item = new vscode.TreeItem(`✓ ${startTs} ${t.title}`);
    item.description = duration;
    item.contextValue = 'dailyTask:done';
    item.command = {
      command: 'otter.dailyLog.continueTask',
      title: '继续任务',
      arguments: [t.id],
    };
    return item;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      return [
        { kind: 'group', id: 'running' },
        { kind: 'group', id: 'done' },
      ];
    }

    if (element.kind === 'group') {
      const tasks = await this.loadTasks();
      if (this.lastError) {
        return [
          {
            kind: 'message',
            text: `未配置今日日志：${this.lastError}`,
            command: {
              command: 'workbench.action.openSettings',
              title: '打开设置',
              arguments: ['otter.dailyLog'],
            },
          },
        ];
      }
      if (element.id === 'running') {
        return tasks.filter((t) => !t.end).map((t) => ({ kind: 'task', task: t, state: 'running' }));
      }
      return tasks.filter((t) => !!t.end).map((t) => ({ kind: 'task', task: t, state: 'done' }));
    }

    return [];
  }

  async getTaskById(taskId: string): Promise<DailyTask | undefined> {
    const tasks = await this.loadTasks();
    return tasks.find((t) => t.id === taskId);
  }

  private async loadTasks(): Promise<DailyTask[]> {
    // 每次刷新都从文件解析，避免状态漂移；但会缓存一份供同一轮点击使用
    try {
      const tasks = await this.dailyLog.listTodayTasks(new Date());
      this.cachedTasks = tasks;
      this.lastError = undefined;
      return tasks;
    } catch (err) {
      this.cachedTasks = [];
      this.lastError = err instanceof Error ? err.message : String(err);
      return [];
    }
  }
}
