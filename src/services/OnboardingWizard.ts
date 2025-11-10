import * as vscode from 'vscode';
import { ConfigurationService } from './ConfigurationService';
import { OnboardingState } from '../types/Prompt';

/**
 * 首次使用引导向导
 */
export class OnboardingWizard {
  constructor(
    private context: vscode.ExtensionContext,
    private configService: ConfigurationService
  ) {}

  /**
   * 启动引导向导
   */
  async start(): Promise<void> {
    // TODO: 实现完整的 5 步引导流程
    const result = await vscode.window.showInformationMessage(
      '🎉 欢迎使用 Prompt Hub！\n\n让我们花 2 分钟完成初始配置。',
      '开始配置',
      '使用默认设置',
      '稍后提醒'
    );

    if (result === '开始配置') {
      await this.runFullWizard();
    } else if (result === '使用默认设置') {
      await this.useDefaults();
    }
    // 稍后提醒：不做任何操作
  }

  /**
   * 运行完整引导流程
   */
  private async runFullWizard(): Promise<void> {
    // TODO: 实现步骤 1-5
    vscode.window.showInformationMessage('完整引导功能正在开发中...');

    // 临时标记为已完成
    await this.context.globalState.update('promptHub.onboardingCompleted', true);
  }

  /**
   * 使用默认设置
   */
  private async useDefaults(): Promise<void> {
    await this.context.globalState.update('promptHub.onboardingCompleted', true);
    vscode.window.showInformationMessage('已使用默认配置');
  }

  /**
   * 重置引导
   */
  async reset(): Promise<void> {
    await this.context.globalState.update('promptHub.onboardingCompleted', false);
    vscode.window.showInformationMessage('引导已重置，下次启动时将再次显示');
  }
}
