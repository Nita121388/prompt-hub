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
import { TimeCommandService } from './services/TimeCommandService';
import { logger } from './services/Logger';

/**
 * 插件激活时调用
 */
export async function activate(context: vscode.ExtensionContext) {
  const configService = new ConfigurationService(context);
  logger.initialize(configService);
  logger.info('Otter 插件正在激活...');

  try {
    // 监听 debugLog 开关变化
    context.subscriptions.push(
      configService.onDidChange((e) => {
        if (
          e.affectsConfiguration('otter.debugLog') ||
          e.affectsConfiguration('promptHub.debugLog')
        ) {
          logger.setDebugEnabled(configService.get<boolean>('debugLog', false));
          logger.info('已更新 debugLog 开关', { enabled: configService.get<boolean>('debugLog', false) });
        }
      })
    );

    // 初始化存储服务
    const storageService = new PromptStorageService(configService);
    await storageService.initialize();

    // 初始化 TreeView Provider
    const treeProvider = new PromptTreeProvider(storageService, configService);
    const treeView = vscode.window.createTreeView('otterView', {
      treeDataProvider: treeProvider,
      canSelectMany: true, // 支持多选
    });
    context.subscriptions.push(treeView);

    // 监听 storagePath 配置变更，动态切换存储目录并刷新视图
    context.subscriptions.push(
      configService.onDidChange(async (e) => {
        if (
          e.affectsConfiguration('otter.storagePath') ||
          e.affectsConfiguration('promptHub.storagePath')
        ) {
          try {
            const newPath = configService.getStoragePath();
            await storageService.updateStoragePath(newPath);
            treeProvider.refresh();
            vscode.window.showInformationMessage(`Otter 已切换存储路径：${newPath}`);
          } catch (err) {
            logger.error('[Extension] 切换 storagePath 失败', err);
            void vscode.window.showErrorMessage(
              `Otter 切换存储路径失败：${err instanceof Error ? err.message : String(err)}`
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

    logger.debug('[Extension] 开始初始化 MarkdownMirrorService');
    const mirrorService = new MarkdownMirrorService(storageService, configService);
    logger.debug('[Extension] MarkdownMirrorService 已创建');
    mirrorService.bindOnSave(context);
    mirrorService.bindOnStorageChange(context);

    const timeCommandService = new TimeCommandService(configService);
    timeCommandService.bindAutoRenderOnEnter(context);

    // 初始化状态栏
    const statusBarService = new StatusBarService(context, configService);
    void statusBarService;

    // Git 自动同步与启动自动拉取
    const gitSyncService = new GitSyncService(configService);

    // 绑定自动同步（保存存储目录中的 Markdown 文件后，延迟一段时间自动 sync）
    gitSyncService.bindAutoSync(context);

    // 启动时自动拉取远程
    if (configService.get<boolean>('git.autoPullOnStartup', false)) {
      setTimeout(() => {
        gitSyncService
          .pull()
          .then(async () => {
            logger.info('[Extension] Git auto pull on startup completed');
            try {
              await storageService.refresh();
              treeProvider.refresh();
            } catch (error) {
              logger.error('[Extension] Git auto pull 后刷新失败', error);
            }
          })
          .catch((error) => {
            logger.error('[Extension] Git auto pull on startup failed', error);
          });
      }, 0);
    }

    // 首次使用引导
    const onboardingCompleted =
      context.globalState.get<boolean>('otter.onboardingCompleted') ??
      context.globalState.get<boolean>('promptHub.onboardingCompleted') ??
      false;
    if (!onboardingCompleted) {
      // 延迟 1 秒启动向导，避免与其他插件冲突
      setTimeout(() => {
        const wizard = new OnboardingWizard(context, configService);
        wizard.start();
      }, 1000);
    }

    vscode.window.showInformationMessage('Otter 已激活');
    logger.info('Otter 插件激活成功');
  } catch (error) {
    logger.error('Otter 激活失败', error);
    vscode.window.showErrorMessage(
      `Otter 激活失败：${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 插件停用时调用
 */
export function deactivate() {
  logger.info('Otter 插件已停用');
}
