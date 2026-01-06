import * as vscode from 'vscode';
import { ConfigurationService } from './ConfigurationService';

/**
 * 状态栏服务
 * 提供快速访问 Otter 功能的状态栏图标
 */
export class StatusBarService {
  private statusBarItem: vscode.StatusBarItem;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configService: ConfigurationService
  ) {
    // 创建状态栏项
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );

    // 设置图标和提示文字
    this.statusBarItem.text = '📋';
    this.statusBarItem.tooltip = 'Otter - 快速访问';
    this.statusBarItem.command = 'otter.showQuickPick';

    // 注册到上下文
    this.context.subscriptions.push(this.statusBarItem);

    // 根据配置显示或隐藏
    this.updateVisibility();

    // 监听配置变化
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('otter.statusBar.enable') ||
          e.affectsConfiguration('promptHub.statusBar.enable')
        ) {
          this.updateVisibility();
        }
      })
    );
  }

  /**
   * 更新状态栏显示状态
   */
  private updateVisibility(): void {
    const enabled = this.configService.get<boolean>('statusBar.enable');
    const shouldShow = enabled === undefined ? true : enabled;
    if (shouldShow) {
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  /**
   * 销毁状态栏
   */
  dispose(): void {
    this.statusBarItem.dispose();
  }
}
