import * as vscode from 'vscode';
import { PromptStorageService } from './services/PromptStorageService';
import { ConfigurationService } from './services/ConfigurationService';
import { OnboardingWizard } from './services/OnboardingWizard';
import { CommandRegistrar } from './commands/CommandRegistrar';
import { PromptTreeProvider } from './providers/PromptTreeProvider';
import { MarkdownMirrorService } from './services/MarkdownMirrorService';
import { StatusBarService } from './services/StatusBarService';
import { GitSyncService } from './services/GitSyncService';
import { PromptSearchCodeActionProvider } from './providers/PromptSearchCodeActionProvider';

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
    const treeView = vscode.window.createTreeView('promptHubView', {
      treeDataProvider: treeProvider,
      canSelectMany: true, // 支持多选
    });
    context.subscriptions.push(treeView);

    // 监听 storagePath 配置变更，动态切换存储目录并刷新视图
    context.subscriptions.push(
      configService.onDidChange(async (e) => {
        if (e.affectsConfiguration('promptHub.storagePath')) {
          try {
            const newPath = configService.getStoragePath();
            await storageService.updateStoragePath(newPath);
            treeProvider.refresh();
            vscode.window.showInformationMessage(`Prompt Hub 已切换存储路径：${newPath}`);
          } catch (err) {
            console.error('[Extension] 切换 storagePath 失败', err);
            void vscode.window.showErrorMessage(
              `Prompt Hub 切换存储路径失败：${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      })
    );

    // 注册所有命令
    const commandRegistrar = new CommandRegistrar(
      context,
      storageService,
      configService,
      treeProvider,
      treeView
    );
    commandRegistrar.registerAll();

    // 让“灯泡”支持一键搜索选中内容
    const codeActionDisposable = vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new PromptSearchCodeActionProvider(),
      { providedCodeActionKinds: PromptSearchCodeActionProvider.providedCodeActionKinds }
    );
    context.subscriptions.push(codeActionDisposable);

    console.log('[Extension] 开始初始化 MarkdownMirrorService');
    const mirrorService = new MarkdownMirrorService(storageService, configService);
    console.log('[Extension] MarkdownMirrorService 已创建');
    console.log('[Extension] bindOnSave 已调用');
    console.log('[Extension] bindOnStorageChange 已调用');
    mirrorService.bindOnSave(context);
    mirrorService.bindOnStorageChange(context);

    // 初始化状态栏
    const statusBarService = new StatusBarService(context, configService);

    // Git 自动同步与启动自动拉取
    const gitSyncService = new GitSyncService(configService);

    // 绑定自动同步（保存存储目录中的 Markdown 文件后，延迟一段时间自动 sync）
    gitSyncService.bindAutoSync(context);

    // 启动时自动拉取远程
    if (configService.get<boolean>('git.autoPullOnStartup', false)) {
      setTimeout(() => {
        gitSyncService
          .pull()
          .then(() => {
            console.log('[Extension] Git auto pull on startup completed');
          })
          .catch((error) => {
            console.error('[Extension] Git auto pull on startup failed', error);
          });
      }, 0);
    }

    // 首次使用引导
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

    vscode.window.showInformationMessage('Prompt Hub 已激活');
    console.log('Prompt Hub 插件激活成功');
  } catch (error) {
    console.error('Prompt Hub 激活失败', error);
    vscode.window.showErrorMessage(
      `Prompt Hub 激活失败：${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 插件停用时调用
 */
export function deactivate() {
  console.log('Prompt Hub 插件已停用');
}
