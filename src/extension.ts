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
import { DailyLogService } from './services/DailyLogService';
import { DailyTaskTreeProvider } from './providers/DailyTaskTreeProvider';
import { DailyLogAutoDetectService } from './services/DailyLogAutoDetectService';
import { MarkdownQuickCommandService } from './services/MarkdownQuickCommandService';
import { TrackedFileService } from './services/TrackedFileService';
import { TrackedFileDecorationProvider } from './providers/TrackedFileDecorationProvider';

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

    // 今日日志任务 TreeView（计时）
    const dailyLogService = new DailyLogService(context, configService);
    const dailyTaskProvider = new DailyTaskTreeProvider(dailyLogService);
    const dailyTaskView = vscode.window.createTreeView('otterDailyTaskView', {
      treeDataProvider: dailyTaskProvider,
      canSelectMany: false,
    });
    context.subscriptions.push(dailyTaskView);

    // 启动时友好提示：今日任务/今日日志未配置
    try {
      dailyLogService.getTodayLogPaths(new Date());
    } catch (err) {
      const key = 'otter.dailyLog.configHintShownVersion';
      const currentVersion = String(context.extension.packageJSON?.version ?? '0');
      const shownVersion = context.workspaceState.get<string>(key);

      if (shownVersion !== currentVersion) {
        void context.workspaceState.update(key, currentVersion);

        const message =
          '今日任务/今日日志尚未配置：请配置 Obsidian Vault（otter.obsidian.vaultPath），或将今日日志目录（otter.dailyLog.directory）设置为绝对路径。';
        const action = await vscode.window.showWarningMessage(
          message,
          '打开配置向导',
          '打开设置'
        );
        if (action === '打开配置向导') {
          await vscode.commands.executeCommand('otter.startOnboarding');
        } else if (action === '打开设置') {
          await vscode.commands.executeCommand('workbench.action.openSettings', 'otter.dailyLog');
        }
      }
    }

    // 任意 Markdown：@结束/@end/@over + Enter 自动结束任务，并在当前行补充时长
    // 统一的 Markdown 回车指令路由：@time 渲染 + @start/@end/@add/@new/@+ 组合动作
    // - 默认启用（quickCmd.enableOnEnter=true）
    // - 若关闭，则回退旧的 @time 渲染与 @end 自动结束逻辑
    const quickCmdEnabled = configService.get<boolean>('quickCmd.enableOnEnter', true);
    if (quickCmdEnabled) {
      const quickCmdService = new MarkdownQuickCommandService(
        configService,
        dailyLogService,
        () => dailyTaskProvider.refresh()
      );
      quickCmdService.bindOnEnter(context);
    } else {
      const dailyAutoDetectService = new DailyLogAutoDetectService(dailyLogService);
      dailyAutoDetectService.bindAutoDetectOnEnter(context);

      const timeCommandService = new TimeCommandService(configService);
      timeCommandService.bindAutoRenderOnEnter(context);
    }

    // 运行中任务时长：每分钟刷新一次（只刷新 UI，不写文件）
    const timer = setInterval(() => dailyTaskProvider.refresh(), 60_000);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });

    // Git 自动同步与启动自动拉取
    const gitSyncService = new GitSyncService(configService);

    // 跟踪文件服务与标记
    const trackedFileService = new TrackedFileService(configService, gitSyncService);
    await trackedFileService.initialize(context);
    context.subscriptions.push({ dispose: () => trackedFileService.dispose() });

    const trackedDecorationProvider = new TrackedFileDecorationProvider(trackedFileService);
    context.subscriptions.push(vscode.window.registerFileDecorationProvider(trackedDecorationProvider));
    context.subscriptions.push(
      trackedFileService.onDidChange(() => {
        trackedDecorationProvider.refresh();
      })
    );

    // 监听 storagePath/track.baseDir 配置变更，动态切换存储目录并刷新视图
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
            await trackedFileService.reload();
            vscode.window.showInformationMessage(`Otter 已切换存储路径：${newPath}`);
          } catch (err) {
            logger.error('[Extension] 切换 storagePath 失败', err);
            void vscode.window.showErrorMessage(
              `Otter 切换存储路径失败：${err instanceof Error ? err.message : String(err)}`
            );
          }
        }

        if (
          e.affectsConfiguration('otter.track.baseDir') ||
          e.affectsConfiguration('promptHub.track.baseDir')
        ) {
          try {
            await trackedFileService.reload();
            trackedDecorationProvider.refresh();
          } catch (err) {
            logger.error('[Extension] 切换 track.baseDir 失败', err);
            void vscode.window.showErrorMessage(
              `Otter 切换 track.baseDir 失败：${err instanceof Error ? err.message : String(err)}`
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
      treeView,
      dailyLogService,
      dailyTaskProvider,
      trackedFileService
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

    // 初始化状态栏
    const statusBarService = new StatusBarService(context, configService);
    void statusBarService;

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
