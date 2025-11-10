import * as vscode from 'vscode';
import { PromptStorageService } from './services/PromptStorageService';
import { ConfigurationService } from './services/ConfigurationService';
import { OnboardingWizard } from './services/OnboardingWizard';
import { CommandRegistrar } from './commands/CommandRegistrar';
import { PromptTreeProvider } from './providers/PromptTreeProvider';

/**
 * 插件激活时调用
 */
export async function activate(context: vscode.ExtensionContext) {
  console.log('Prompt Hub 插件正在激活...');

  try {
    // 初始化配置服务
    const configService = new ConfigurationService(context);

    // 初始化存储服务
    const storageService = new PromptStorageService(configService);
    await storageService.initialize();

    // 初始化 TreeView Provider
    const treeProvider = new PromptTreeProvider(storageService, configService);
    vscode.window.registerTreeDataProvider('promptHubView', treeProvider);

    // 注册所有命令
    const commandRegistrar = new CommandRegistrar(
      context,
      storageService,
      configService,
      treeProvider
    );
    commandRegistrar.registerAll();

    // 检查是否首次使用，启动引导向导
    const onboardingCompleted = context.globalState.get<boolean>(
      'promptHub.onboardingCompleted',
      false
    );

    if (!onboardingCompleted) {
      // 延迟 1 秒启动向导，避免与其他插件冲突
      setTimeout(() => {
        const wizard = new OnboardingWizard(context, configService);
        wizard.start();
      }, 1000);
    }

    // 显示激活成功消息
    vscode.window.showInformationMessage('Prompt Hub 已激活');
    console.log('Prompt Hub 插件激活成功');
  } catch (error) {
    console.error('Prompt Hub 激活失败:', error);
    vscode.window.showErrorMessage(
      `Prompt Hub 激活失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 插件停用时调用
 */
export function deactivate() {
  console.log('Prompt Hub 插件已停用');
}
