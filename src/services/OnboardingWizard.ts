import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as cp from 'child_process';
import { OnboardingState } from '../types/Prompt';
import { ConfigurationService } from './ConfigurationService';
import { GitSyncService } from './GitSyncService';

const LOG_PREFIX = '[OnboardingWizard]';

/**
 * 首次使用配置向导
 *
 * 步骤：
 * 1. 欢迎
 * 2. 存储路径
 * 3. Git 同步（可选，支持「上一步」）
 * 4. AI Provider（可选，支持「上一步」）
 * 5. 完成
 */
export class OnboardingWizard {
  private state: OnboardingState;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configService: ConfigurationService
  ) {
    const configStoragePath = this.configService.get<string>('storagePath', '~/.prompt-hub');
    const savedState = this.context.workspaceState.get<OnboardingState>(
      'promptHub.onboardingState'
    );

    const defaults: OnboardingState = {
      step: 1,
      storagePath: configStoragePath,
      gitEnabled: false,
      gitRemoteUrl: undefined,
      aiProvider: undefined,
      aiModel: undefined,
      completed: false,
    };

    // 始终以当前配置的存储路径为准，避免向导显示过期路径
    this.state = {
      ...defaults,
      ...(savedState ?? {}),
      storagePath: configStoragePath,
    };

    console.log(LOG_PREFIX, '构造函数初始化，state =', this.state);
  }

  /** 对外启动入口 */
  async start(): Promise<void> {
    console.log(LOG_PREFIX, 'start() 调用');
    const result = await this.showWelcomeV2();
    console.log(LOG_PREFIX, 'showWelcome 返回结果:', result);

    if (result === 'start') {
      await this.runFlow();
    } else if (result === 'defaults') {
      await this.useDefaults();
    }
    // result === 'later' 或 undefined：什么都不做，下次继续提示
  }

  /** 重置引导状态，供命令调用 */
  async reset(): Promise<void> {
    console.log(LOG_PREFIX, 'reset() 调用，重置引导状态');
    const configStoragePath = this.configService.get<string>('storagePath', '~/.prompt-hub');
    this.state = {
      step: 1,
      storagePath: configStoragePath,
      gitEnabled: false,
      gitRemoteUrl: undefined,
      aiProvider: undefined,
      aiModel: undefined,
      completed: false,
    };
    await this.saveState();
    await this.context.globalState.update('promptHub.onboardingCompleted', false);
    vscode.window.showInformationMessage('已重置 Prompt Hub 配置向导，下次会重新显示。');
  }

  /** 旧版欢迎页（保留以便后续需要时使用） */
  private async showWelcome(): Promise<'start' | 'defaults' | 'later' | undefined> {
    console.log(LOG_PREFIX, 'showWelcome() 调用');

    const message = [
      '欢迎使用 Prompt Hub 👋',
      '',
      '我们将通过一个简短的向导帮你完成初始配置：',
      '  · 选择 Prompt 存储路径',
      '  · 是否启用 Git 同步',
      '  · 配置 AI Provider（可选）',
    ].join('\n');

    const startItem: vscode.MessageItem = { title: '开始配置' };
    const defaultsItem: vscode.MessageItem = { title: '使用默认配置' };
    const laterItem: vscode.MessageItem = { title: '以后再说', isCloseAffordance: true };

    const result = await vscode.window.showInformationMessage(
      message,
      { modal: true },
      startItem,
      defaultsItem,
      laterItem
    );

    console.log(LOG_PREFIX, 'showWelcome() 用户选择:', result);

    const selectedTitle = result?.title;
    if (selectedTitle === '开始配置') return 'start';
    if (selectedTitle === '使用默认配置') return 'defaults';
    if (selectedTitle === '以后再说') return 'later';
    return undefined;
  }

  /**
   * 新版欢迎页：支持后续步骤中「上一步」返回
   */
  private async showWelcomeV2(): Promise<'start' | 'defaults' | 'later' | undefined> {
    console.log(LOG_PREFIX, 'showWelcomeV2() 调用');

    const message = [
      '欢迎使用 Prompt Hub 👋',
      '',
      '我们将通过一个简短的向导帮你完成初始配置：',
      '  · 选择 Prompt 存储路径',
      '  · 是否启用 Git 同步',
      '  · 配置 AI Provider（可选）',
    ].join('\n');

    const startItem: vscode.MessageItem = { title: '开始配置' };
    const defaultsItem: vscode.MessageItem = { title: '使用默认配置' };
    const laterItem: vscode.MessageItem = { title: '以后再说', isCloseAffordance: true };

    const result = await vscode.window.showInformationMessage(
      message,
      { modal: true },
      startItem,
      defaultsItem,
      laterItem
    );

    console.log(LOG_PREFIX, 'showWelcomeV2() 用户选择:', result);

    const selectedTitle = result?.title;
    if (selectedTitle === '开始配置') return 'start';
    if (selectedTitle === '使用默认配置') return 'defaults';
    if (selectedTitle === '以后再说') return 'later';
    return undefined;
  }

  /**
   * 主流程：支持在 Git / AI 步骤中「上一步」返回
   */
  private async runFlow(): Promise<void> {
    console.log(LOG_PREFIX, 'runFlow() 开始，当前 state =', this.state);

    try {
      let currentStep: 2 | 3 | 4 | 5 = 2;
      let finished = false;

      // 当前存储路径（如果之前配置过就复用）
      let storagePath = this.state.storagePath || '~/.prompt-hub';
      console.log(LOG_PREFIX, 'runFlow() 初始存储路径:', storagePath);

      while (!finished) {
        console.log(LOG_PREFIX, 'runFlow() 进入步骤:', currentStep);

        if (currentStep === 2) {
          // 步骤 2：存储路径
          const result = await this.configureStorage(storagePath);
          console.log(LOG_PREFIX, 'configureStorage 返回:', result);

          if (result.type === 'cancel') {
            vscode.window.showWarningMessage('配置向导已取消，之前的配置保持不变。');
            return;
          }

          storagePath = result.storagePath;
          this.state.storagePath = storagePath;
          this.state.step = 2;
          await this.saveState();

          console.log(LOG_PREFIX, '步骤 2 完成，storagePath =', storagePath);
          currentStep = 3;
        } else if (currentStep === 3) {
          // 步骤 3：Git 同步
          const result = await this.configureGit(storagePath);
          console.log(LOG_PREFIX, 'configureGit 返回:', result);

          if (result.type === 'back') {
            // 返回上一步：存储路径
            currentStep = 2;
            continue;
          }

          if (result.type === 'skip') {
            this.state.gitEnabled = false;
            this.state.gitRemoteUrl = undefined;
          } else {
            this.state.gitEnabled = result.enabled;
            this.state.gitRemoteUrl = result.remoteUrl;
          }

          // 将 Git 启用状态同步到配置，方便 GitSyncService 使用
          await vscode.workspace.getConfiguration('promptHub').update(
            'git.enableSync',
            this.state.gitEnabled,
            vscode.ConfigurationTarget.Global
          );

          // 记录远程 URL，便于新设备一键“拉取/导入”
          if (this.state.gitRemoteUrl && this.state.gitRemoteUrl.trim()) {
            await vscode.workspace.getConfiguration('promptHub').update(
              'git.remoteUrl',
              this.state.gitRemoteUrl.trim(),
              vscode.ConfigurationTarget.Global
            );
          }

          this.state.step = 3;
          await this.saveState();

          console.log(
            LOG_PREFIX,
            '步骤 3 完成，gitEnabled =',
            this.state.gitEnabled,
            'gitRemoteUrl =',
            this.state.gitRemoteUrl
          );
          currentStep = 4;
        } else if (currentStep === 4) {
          // 步骤 4：AI Provider
          const aiResult = await this.configureAI();
          console.log(LOG_PREFIX, 'configureAI 返回:', aiResult);

          if (aiResult.type === 'back') {
            currentStep = 3;
            continue;
          }

          if (aiResult.type === 'skip') {
            this.state.aiProvider = undefined;
            this.state.aiModel = undefined;
          } else {
            this.state.aiProvider = aiResult.provider;
            this.state.aiModel = aiResult.model;
          }

          this.state.step = 4;
          await this.saveState();

          console.log(LOG_PREFIX, '步骤 4 完成，aiProvider =', this.state.aiProvider);

          // 如果选择了 local-claude，且是 Windows，检查 Git Bash
          if (aiResult.type === 'next' && aiResult.provider === 'local-claude' && process.platform === 'win32') {
            currentStep = 5;
          } else {
            finished = true;
          }
        } else {
          // 步骤 5：Git Bash 检测（仅 Windows + local-claude）
          const gitBashResult = await this.checkGitBash();
          console.log(LOG_PREFIX, 'checkGitBash 返回:', gitBashResult);

          if (gitBashResult.type === 'back') {
            currentStep = 4;
            continue;
          }

          this.state.step = 5;
          await this.saveState();

          finished = true;
        }
      }

      // 步骤 5：完成页（已自动保存，只显示摘要）
      console.log(LOG_PREFIX, '所有配置步骤完成，进入完成页');
      await this.showCompletion();
    } catch (error) {
      console.error(LOG_PREFIX, '配置向导执行出错:', error);
      vscode.window.showErrorMessage(
        `配置向导出错: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ========== 步骤 2：存储路径 ==========

  private async configureStorage(
    previousPath: string
  ): Promise<{ type: 'next'; storagePath: string } | { type: 'cancel' }> {
    const resolvedPrevious = this.resolvePath(previousPath || '~/.prompt-hub');
    console.log(
      LOG_PREFIX,
      'configureStorage() 调用，previousPath =',
      previousPath,
      '解析 =',
      resolvedPrevious
    );

    type ScenarioItem = vscode.QuickPickItem & { path: string };

    const baseScenarios: ScenarioItem[] = [
      {
        label: '$(home) 本地存储（推荐）',
        description: '存储在用户目录下，路径 ~/.prompt-hub',
        path: '~/.prompt-hub',
      },
      {
        label: '$(cloud) 云盘同步',
        description: '存储在 OneDrive/网盘目录下，方便多设备同步',
        path: '~/OneDrive/prompts',
      },
      {
        label: '$(folder) 项目内存储',
        description: '存储在当前工作区内，适合团队协作',
        path: '${workspaceFolder}/.prompts',
      },
      {
        label: '$(folder-opened) 自定义路径',
        description: '手动选择任意目录保存 Prompt',
        path: 'custom',
      },
    ];

    // 根据当前路径给预设场景增加「（当前）」标记
    const decoratedBaseScenarios: ScenarioItem[] = baseScenarios.map((item) => {
      const resolved = this.resolvePath(item.path);
      if (resolved === resolvedPrevious) {
        return {
          ...item,
          description: `${item.description}（当前）`,
        };
      }
      return item;
    });

    const scenarios: ScenarioItem[] = [
      {
        label: '$(check) 保持当前路径',
        description: `继续使用：${resolvedPrevious}`,
        path: 'keep',
      },
      ...decoratedBaseScenarios,
    ];

    const selected = await vscode.window.showQuickPick(scenarios, {
      placeHolder: `当前路径：${resolvedPrevious}（可选择新的存储位置，或选择“保持当前路径”）`,
      title: '步骤 2/4：存储路径配置',
      ignoreFocusOut: true,
    });

    console.log(LOG_PREFIX, 'configureStorage() 用户选择:', selected);

    // 取消 = 整个向导中止
    if (!selected) {
      return { type: 'cancel' };
    }

    // 保持当前路径：不修改设置，只保证目录存在
    if (selected.path === 'keep') {
      const resolved = this.resolvePath(previousPath || '~/.prompt-hub');
      if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true });
        vscode.window.showInformationMessage(`已创建存储目录：${resolved}`);
      }
      return { type: 'next', storagePath: previousPath || '~/.prompt-hub' };
    }

    let storagePath: string;

    if (selected.path === 'custom') {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '确定',
      });

      console.log(
        LOG_PREFIX,
        'configureStorage() 自定义路径选择结果:',
        uris?.map((u) => u.fsPath)
      );

      if (!uris || uris.length === 0) {
        return { type: 'cancel' };
      }

      storagePath = uris[0].fsPath;
    } else {
      storagePath = selected.path;
    }

    const resolvedPath = this.resolvePath(storagePath);
    const validation = this.validateStoragePath(resolvedPath);

    console.log(
      LOG_PREFIX,
      'configureStorage() 选中路径:',
      storagePath,
      '解析 =',
      resolvedPath,
      '校验结果:',
      validation
    );

    if (!validation.valid) {
      const retry = await vscode.window.showWarningMessage(
        `路径校验失败：${validation.message}`,
        '重新选择',
        '取消'
      );

      console.log(LOG_PREFIX, 'configureStorage() 校验失败后选择:', retry);

      if (retry === '重新选择') {
        return this.configureStorage(previousPath);
      }

      return { type: 'cancel' };
    }

    // 写入 VSCode 配置（全局）
    await vscode.workspace.getConfiguration('promptHub').update(
      'storagePath',
      storagePath,
      vscode.ConfigurationTarget.Global
    );

    // 创建目录
    if (!fs.existsSync(resolvedPath)) {
      fs.mkdirSync(resolvedPath, { recursive: true });
      vscode.window.showInformationMessage(`已创建存储目录：${resolvedPath}`);
    }

    return { type: 'next', storagePath };
  }

  // ========== 步骤 3：Git 同步 ==========

  /** 确保仓库至少有一个提交（如无则创建空提交） */
  private async ensureInitialCommit(dir: string): Promise<void> {
    console.log(LOG_PREFIX, 'ensureInitialCommit() 调用，dir =', dir);

    // 如果已经有 HEAD，则直接返回
    try {
      await this.runGitCommand(['rev-parse', '--verify', 'HEAD'], dir);
      console.log(LOG_PREFIX, 'ensureInitialCommit() 已检测到现有提交');
      return;
    } catch {
      console.log(LOG_PREFIX, 'ensureInitialCommit() 尚无提交，将创建初始提交');
    }

    // 尝试暂存所有当前文件
    try {
      await this.runGitCommand(['add', '-A'], dir);
    } catch (error) {
      console.error(LOG_PREFIX, 'ensureInitialCommit() git add 失败:', error);
      // 即便 add 失败，仍尝试创建空提交
    }

    // 创建允许为空的初始提交，避免仓库为空导致无法切换分支/推送
    await this.runGitCommand(
      ['commit', '--allow-empty', '-m', 'chore: init prompt hub storage'],
      dir
    );
    console.log(LOG_PREFIX, 'ensureInitialCommit() 初始提交已创建');
  }

  /**
   * 使用远程 URL 初始化 remote / 分支并执行首次推送
   *
   * 约定：
   * - remote 名称固定为 origin
   * - 分支名固定为 main
   */
  private async setupRemoteAndInitialPush(dir: string, remoteUrl: string): Promise<void> {
    console.log(
      LOG_PREFIX,
      'setupRemoteAndInitialPush() 调用，dir =',
      dir,
      'remoteUrl =',
      this.sanitizeRemoteUrlForLog(remoteUrl)
    );

    if (!remoteUrl.trim()) {
      console.log(LOG_PREFIX, 'setupRemoteAndInitialPush() remoteUrl 为空，跳过');
      return;
    }

    // 配置 remote origin（如已存在则更新 URL）
    try {
      await this.runGitCommand(['remote', 'add', 'origin', remoteUrl], dir);
      console.log(LOG_PREFIX, 'setupRemoteAndInitialPush() 已添加 remote origin');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(LOG_PREFIX, 'remote add 失败，尝试改用 set-url:', message);
      try {
        await this.runGitCommand(['remote', 'set-url', 'origin', remoteUrl], dir);
        console.log(LOG_PREFIX, 'setupRemoteAndInitialPush() 已更新 remote origin URL');
      } catch (error2) {
        console.error(LOG_PREFIX, 'remote set-url 失败:', error2);
        throw error2;
      }
    }

    // 确保有至少一个提交
    await this.ensureInitialCommit(dir);

    // 统一分支名为 main（若失败则不终止流程，只记录日志）
    try {
      await this.runGitCommand(['branch', '-M', 'main'], dir);
      console.log(LOG_PREFIX, 'setupRemoteAndInitialPush() 已切换/重命名分支为 main');
    } catch (error) {
      console.error(LOG_PREFIX, 'branch -M main 失败（可忽略）', error);
    }

    // 首次推送到远程
    await this.runGitCommand(['push', '-u', 'origin', 'main'], dir);
    console.log(LOG_PREFIX, 'setupRemoteAndInitialPush() 首次推送完成');
  }

  private async configureGit(
    storagePath: string
  ): Promise<
    | { type: 'next'; enabled: boolean; remoteUrl?: string }
    | { type: 'skip' }
    | { type: 'back' }
  > {
    const resolvedPath = this.resolvePath(storagePath);
    console.log(
      LOG_PREFIX,
      'configureGit() 调用，storagePath =',
      storagePath,
      '解析 =',
      resolvedPath
    );

    const isGitRepo = await this.checkGitRepo(resolvedPath);
    console.log(LOG_PREFIX, 'configureGit() 当前目录是否 Git 仓库:', isGitRepo);

    let message: string;
    interface GitOption extends vscode.QuickPickItem {
      value: 'enable' | 'init' | 'skip' | 'back';
    }
    interface RemoteActionItem extends vscode.QuickPickItem {
      value: 'keep' | 'edit' | 'local-only';
    }

    let options: GitOption[];

    if (isGitRepo) {
      message = '检测到当前存储目录已经是 Git 仓库。\n\n是否启用 Git 同步功能？';
      options = [
        {
          label: '$(check) 启用 Git（保持或配置远程）',
          description: '使用现有 Git 仓库进行版本管理，可选配置远程 URL',
          value: 'enable',
          picked: true,
        },
        {
          label: '$(clock) 暂不配置',
          description: '以后再说',
          value: 'skip',
        },
        {
          label: '$(arrow-left) 上一步（返回存储路径）',
          value: 'back',
        },
      ];
    } else {
      message = '当前存储目录还不是 Git 仓库。\n\n是否初始化 Git 仓库并启用版本管理？';
      options = [
        {
          label: '$(repo) 初始化并启用同步',
          description: '在该目录执行 git init',
          value: 'init',
          picked: true,
        },
        {
          label: '$(clock) 暂不配置',
          description: '以后再说',
          value: 'skip',
        },
        {
          label: '$(arrow-left) 上一步（返回存储路径）',
          value: 'back',
        },
      ];
    }

    const selected = await vscode.window.showQuickPick(options, {
      placeHolder: `${message}\n\n使用 ↑↓ 键选择一个选项，按回车确认；按 Esc 暂不配置 Git。`,
      title: '步骤 3/4：Git 同步配置',
      ignoreFocusOut: true,
    });

    console.log(LOG_PREFIX, 'configureGit() QuickPick 选择结果:', selected);

    if (!selected) {
      return { type: 'skip' };
    }

    if (selected.value === 'back') {
      return { type: 'back' };
    }

    if (selected.value === 'skip') {
      return { type: 'skip' };
    }

    // 初始化 Git 仓库
    if (selected.value === 'init') {
      const ok = await this.initGitRepo(resolvedPath);
      console.log(LOG_PREFIX, 'configureGit() initGitRepo 结果:', ok);
      if (!ok) {
        return { type: 'skip' };
      }
    }

    let existingOriginBeforeEdit: string | undefined;
    // 已有 Git 仓库且存在远程时，先询问如何处理远程
    if (selected.value === 'enable' && isGitRepo) {
      const currentRemote = await this.getCurrentRemoteUrl(resolvedPath);
      existingOriginBeforeEdit = currentRemote;

      if (currentRemote) {
        const remoteAction = await vscode.window.showQuickPick<RemoteActionItem>(
          [
            {
              label: '$(check) 保持现有远程设置',
              description: currentRemote,
              value: 'keep',
            },
            {
              label: '$(pencil) 修改远程 URL',
              description: '更换推送目标仓库',
              value: 'edit',
            },
            {
              label: '$(circle-slash) 只用本地 Git，不配置远程',
              description: '保留本地版本管理，不自动推送到远程',
              value: 'local-only',
            },
          ],
          {
            title: 'Git 远程配置',
            placeHolder: '检测到当前仓库已配置远程 origin，你希望如何处理远程设置？',
            ignoreFocusOut: true,
          }
        );

        console.log(LOG_PREFIX, 'configureGit() 远程配置选择结果:', remoteAction);

        if (!remoteAction || remoteAction.value === 'keep') {
          return { type: 'next', enabled: true, remoteUrl: currentRemote };
        }

        if (remoteAction.value === 'local-only') {
          return { type: 'next', enabled: true, remoteUrl: undefined };
        }

        // remoteAction.value === 'edit' 时，继续向下弹出输入框
      }
    }

    let remoteUrl = await vscode.window.showInputBox({
      prompt: [
        '可选：配置或修改远程仓库 URL，用于将此存储目录推送到 Git 托管平台（例如 GitHub、Gitee 等）。',
        '',
        '提示：如果远程仓库已存在内容，我们会优先推荐“导入/拉取”，避免误操作覆盖。',
        '如果当前仓库已经配置好了远程，或你暂时只想使用本地 Git，可以留空直接回车，我们不会修改现有远程配置。',
      ].join('\n'),
      placeHolder: '例如：https://github.com/your-name/your-repo.git（留空表示不更改/不配置远程）',
      ignoreFocusOut: true,
      value: existingOriginBeforeEdit || undefined,
    });

    console.log(
      LOG_PREFIX,
      'configureGit() 用户输入远程 URL:',
      remoteUrl ? this.sanitizeRemoteUrlForLog(remoteUrl) : remoteUrl
    );

    // 若填写了远程 URL：先探测远程是否非空，再给出安全动作建议
    while (remoteUrl && remoteUrl.trim()) {
      const url = remoteUrl.trim();
      const local = await this.getLocalRepoSummary(resolvedPath);
      const probe = await this.probeRemoteRepoState(url, resolvedPath);

      interface RemoteDecisionItem extends vscode.QuickPickItem {
        value: 'import' | 'init-push' | 'save-only' | 'update-origin-only' | 'retry' | 'edit-url';
      }

      const sanitized = this.sanitizeRemoteUrlForLog(url);
      const originBeforeEdit = existingOriginBeforeEdit?.trim();
      const hasOriginToUpdate = Boolean(originBeforeEdit) && originBeforeEdit !== url;

      const recommendedValue: RemoteDecisionItem['value'] =
        probe.state === 'empty'
          ? 'init-push'
          : probe.state === 'non-empty' && !local.hasMeaningfulHistory
            ? 'import'
            : 'save-only';

      const items: RemoteDecisionItem[] = [];

      items.push({
        label: '$(check) 仅保存远程 URL（不拉取不推送）',
        description: '推荐：不会对远程仓库造成任何影响',
        value: 'save-only',
        picked: recommendedValue === 'save-only',
      });

      if (hasOriginToUpdate) {
        items.push({
          label: '$(repo) 仅更新本地 origin（不拉取不推送）',
          description: '只修改本地 Git 远程指向，不会改远程内容',
          value: 'update-origin-only',
        });
      }

      if (probe.state === 'non-empty') {
        items.push({
          label: '$(cloud-download) 从远程导入/拉取到本地（推荐）',
          description: local.hasMeaningfulHistory
            ? '检测到本地已有提交/文件：导入会重置分支到远程，建议先备份或使用新目录'
            : '远程仓库已有内容：推荐先导入再开始使用',
          value: 'import',
          picked: recommendedValue === 'import',
        });
      }

      if (probe.state === 'empty') {
        items.push({
          label: '$(cloud-upload) 创建初始提交并首次推送（推荐）',
          description: '远程仓库为空：首次推送会把本地内容同步到远程',
          value: 'init-push',
          picked: recommendedValue === 'init-push',
        });
      }

      if (probe.state === 'not-found' || probe.state === 'unauthorized' || probe.state === 'unreachable') {
        items.push({
          label: '$(debug-restart) 重试远程探测',
          description: '有时是网络/权限临时问题',
          value: 'retry',
        });
      }

      items.push({
        label: '$(pencil) 修改远程 URL',
        description: '重新输入 URL',
        value: 'edit-url',
      });

      const statusLine =
        probe.state === 'non-empty'
          ? '探测结果：远程仓库已有内容'
          : probe.state === 'empty'
            ? '探测结果：远程仓库为空'
            : probe.state === 'not-found'
              ? '探测结果：远程仓库不存在或 URL 不正确'
              : probe.state === 'unauthorized'
                ? '探测结果：无权限访问远程仓库（可能是私有仓库/需要认证）'
                : '探测结果：无法访问远程仓库（网络或其它错误）';

      const detailLine =
        probe.state === 'not-found' || probe.state === 'unauthorized' || probe.state === 'unreachable'
          ? probe.detail
            ? `\n\n详情：\n${probe.detail}`
            : ''
          : '';

      const decision = await vscode.window.showQuickPick<RemoteDecisionItem>(items, {
        title: 'Git 远程操作建议',
        placeHolder: `${statusLine}\n远程：${sanitized}${detailLine}`,
        ignoreFocusOut: true,
      });

      console.log(LOG_PREFIX, 'configureGit() 远程动作选择:', decision?.value);

      if (!decision) {
        break;
      }

      if (decision.value === 'retry') {
        continue;
      }

      if (decision.value === 'edit-url') {
        remoteUrl = await vscode.window.showInputBox({
          prompt: '请输入新的远程仓库 URL（留空表示不更改/不配置远程）',
          placeHolder: '例如：https://github.com/your-name/your-repo.git',
          ignoreFocusOut: true,
          value: url,
        });
        console.log(
          LOG_PREFIX,
          'configureGit() 修改 URL 后的输入:',
          remoteUrl ? this.sanitizeRemoteUrlForLog(remoteUrl) : remoteUrl
        );
        continue;
      }

      if (decision.value === 'save-only') {
        remoteUrl = url;
        break;
      }

      if (decision.value === 'update-origin-only') {
        try {
          const git = new GitSyncService(this.configService);
          await git.setOriginRemoteUrl(url);
          vscode.window.showInformationMessage('已更新本地 origin 指向（未执行拉取/推送）。');
        } catch (error) {
          vscode.window.showErrorMessage(
            `更新本地 origin 失败：${error instanceof Error ? error.message : String(error)}`
          );
        }
        remoteUrl = url;
        break;
      }

      if (decision.value === 'import') {
        const confirm = await vscode.window.showWarningMessage(
          [
            '将从远程仓库导入内容到本地存储目录（不会对远程仓库造成影响）。',
            '',
            `远程：${sanitized}`,
            '',
            '将执行的操作（概览）：',
            '- 初始化本地仓库（如未初始化）',
            '- 配置/更新 origin 指向该远程',
            '- git fetch --prune origin',
            '- 检测远端默认分支并检出（可能重置当前分支到远端）',
            '',
            local.hasMeaningfulHistory
              ? '注意：检测到本地已有提交/文件，导入可能重置当前分支并影响本地内容，建议先备份或使用新目录。'
              : '提示：如果本地存在未跟踪文件阻塞检出，我们会尝试自动备份后再导入。',
          ].join('\n'),
          { modal: true },
          '开始导入',
          '取消'
        );

        if (confirm !== '开始导入') {
          remoteUrl = url;
          break;
        }

        try {
          const git = new GitSyncService(this.configService);
          await git.setOriginRemoteUrl(url);
          await git.importFromRemote(url);
          await this.refreshPromptViewAfterGit();
          vscode.window.showInformationMessage('已从远程导入完成，本地仓库已就绪。');
        } catch (error) {
          console.error(LOG_PREFIX, 'configureGit() 远程导入出错:', error);
          vscode.window.showErrorMessage(
            `从远程导入失败：${error instanceof Error ? error.message : String(error)}`
          );
        }

        remoteUrl = url;
        break;
      }

      if (decision.value === 'init-push') {
        const action = await vscode.window.showInformationMessage(
          [
            '探测到远程仓库为空。',
            '',
            '是否立即在当前存储目录中创建初始提交并推送到远程？',
            '',
            `远程：${sanitized}`,
            '',
            '将执行的操作：',
            '- git add -A',
            '- git commit --allow-empty -m "chore: init prompt hub storage"',
            '- git branch -M main',
            '- git remote add/set-url origin <你的 URL>',
            '- git push -u origin main',
          ].join('\n'),
          { modal: true },
          '立即推送',
          '稍后再说'
        );

        console.log(LOG_PREFIX, 'configureGit() 首次推送确认选择:', action);

        if (action === '立即推送') {
          try {
            await this.setupRemoteAndInitialPush(resolvedPath, url);
            vscode.window.showInformationMessage('已完成 Git 远程初始化并首次推送。');
          } catch (error) {
            console.error(LOG_PREFIX, 'configureGit() 首次推送出错:', error);

            const rawMessage = error instanceof Error ? error.message : String(error);
            const lines = rawMessage.split(/\r?\n/);
            const filteredLines = lines.filter((line) => {
              const trimmed = line.trim();
              if (!trimmed) return false;
              // Git 常见的非错误提示，不作为错误弹出
              if (trimmed.startsWith('To ')) return false;
              if (/^[0-9a-f]+\.\.[0-9a-f]+\s+.+->.+$/.test(trimmed)) return false;
              if (trimmed === 'Everything up-to-date') return false;
              return true;
            });

            if (filteredLines.length === 0) {
              // 只剩下推送摘要等情况，视为正常完成
              vscode.window.showInformationMessage('Git 推送已完成。');
            } else {
              vscode.window.showErrorMessage(`Git 远程初始化或推送失败：${filteredLines.join('\n')}`);
            }
          }
        }

        remoteUrl = url;
        break;
      }
    }

    return {
      type: 'next',
      enabled: true,
      remoteUrl: remoteUrl || undefined,
    };
  }

  // ========== 步骤 4：AI Provider ==========

  private async configureAI(): Promise<
    | { type: 'next'; provider: 'openai' | 'azure' | 'qwen' | 'custom' | 'local-claude' | 'local-codex'; model: string }
    | { type: 'skip' }
    | { type: 'back' }
  > {
    interface ProviderItem extends vscode.QuickPickItem {
      id: 'openai' | 'azure' | 'qwen' | 'custom' | 'local-claude' | 'local-codex' | 'skip' | 'back';
      defaultModel?: string;
    }

    const providers: ProviderItem[] = [
      {
        id: 'local-claude',
        label: '💻 本地 Claude Code（推荐）',
        description: '无需 API Key，使用本地安装的 Claude Code CLI',
        defaultModel: 'claude-sonnet-4.5',
      },
      {
        id: 'local-codex',
        label: '⚡ 本地 Codex',
        description: '无需 API Key，使用本地安装的 Codex',
        defaultModel: 'claude-sonnet-4.5',
      },
      {
        id: 'openai',
        label: '$(sparkle) OpenAI',
        description: '使用官方 OpenAI 接口（api.openai.com）',
        defaultModel: 'gpt-4o',
      },
      {
        id: 'azure',
        label: '$(azure) Azure OpenAI',
        description: '使用 Azure OpenAI 服务',
        defaultModel: 'gpt-4o',
      },
      {
        id: 'qwen',
        label: '$(flame) 通义千问',
        description: '使用阿里云通义千问模型',
        defaultModel: 'qwen-turbo',
      },
      {
        id: 'custom',
        label: '$(tools) 自定义 Provider',
        description: '自定义 Base URL 与模型',
        defaultModel: 'gpt-4o',
      },
      {
        id: 'back',
        label: '$(arrow-left) 上一步（返回 Git 配置）',
      },
      {
        id: 'skip',
        label: '$(clock) 暂不配置',
        description: '稍后可以在设置中配置 AI Provider',
      },
    ];

    const selected = await vscode.window.showQuickPick(providers, {
      placeHolder: '选择要使用的 AI 提供商（可跳过，稍后在设置中配置）',
      title: '步骤 4/4：AI 配置',
      ignoreFocusOut: true,
    });

    console.log(LOG_PREFIX, 'configureAI() QuickPick 选择结果:', selected);

    // 取消 / 暂不配置：视为跳过
    if (!selected || selected.id === 'skip') {
      return { type: 'skip' };
    }

    if (selected.id === 'back') {
      return { type: 'back' };
    }

    // 本地 Claude Code 或 Codex：无需输入 API Key
    if (selected.id === 'local-claude' || selected.id === 'local-codex') {
      vscode.window.showInformationMessage(
        `✓ 已选择 ${selected.id === 'local-claude' ? '本地 Claude Code' : '本地 Codex'}。工具将按优先级自动检测：设置中的路径 > 环境变量 > PATH（where/which）> 常见目录。若检测失败，请在设置中配置对应路径。`
      );

      // 写入 VSCode 配置
      const aiConfig = vscode.workspace.getConfiguration('promptHub.ai');
      await aiConfig.update('provider', selected.id, vscode.ConfigurationTarget.Global);
      await aiConfig.update('model', selected.defaultModel, vscode.ConfigurationTarget.Global);

      return {
        type: 'next',
        provider: selected.id as 'local-claude' | 'local-codex',
        model: selected.defaultModel || 'claude-sonnet-4.5',
      };
    }

    // 云端 API：需要输入 API Key
    const model = await vscode.window.showInputBox({
      prompt: '请输入模型名称',
      value: selected.defaultModel,
      placeHolder: '例如：gpt-4o, gpt-3.5-turbo, qwen-turbo',
      ignoreFocusOut: true,
    });

    console.log(LOG_PREFIX, 'configureAI() 用户输入模型:', model);

    if (!model) {
      return { type: 'skip' };
    }

    const apiKey = await vscode.window.showInputBox({
      prompt: '请输入 API Key，将安全地保存在 VSCode SecretStorage 中',
      password: true,
      placeHolder: 'sk-...',
      ignoreFocusOut: true,
    });

    console.log(LOG_PREFIX, 'configureAI() 是否输入 API Key:', apiKey ? '已输入' : '未输入');

    if (!apiKey) {
      vscode.window.showWarningMessage('未配置 API Key，AI 功能暂时不可用。');
      return { type: 'skip' };
    }

    let baseUrl = 'https://api.openai.com/v1';
    if (selected.id === 'azure' || selected.id === 'custom') {
      const customUrl = await vscode.window.showInputBox({
        prompt: '请输入 API Base URL',
        value: baseUrl,
        placeHolder: '例如：https://api.openai.com/v1',
        ignoreFocusOut: true,
      });
      console.log(LOG_PREFIX, 'configureAI() 用户输入 Base URL:', customUrl);
      if (customUrl) {
        baseUrl = customUrl;
      }
    }

    // 简单的"测试连接"占位逻辑（不真正发起网络请求）
    const testConnection = await vscode.window.showQuickPick(['是', '否'], {
      placeHolder: '是否现在测试一次 API 连接？（示意，不会真实调用）',
      title: 'API 连接测试',
      ignoreFocusOut: true,
    });

    console.log(LOG_PREFIX, 'configureAI() 是否测试连接:', testConnection);

    if (testConnection === '是') {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: '正在测试 API 连接...',
          cancellable: false,
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      );
      vscode.window.showInformationMessage('API 连接测试成功（示意）。');
    }

    // 写入 VSCode 配置
    const aiConfig = vscode.workspace.getConfiguration('promptHub.ai');
    await aiConfig.update('provider', selected.id, vscode.ConfigurationTarget.Global);
    await aiConfig.update('model', model, vscode.ConfigurationTarget.Global);
    await aiConfig.update('baseUrl', baseUrl, vscode.ConfigurationTarget.Global);

    // 将 API Key 存入 SecretStorage
    // 新格式：按 provider 分桶，支持后续切换提供商时各自维护 Key
    await this.context.secrets.store(`promptHub.ai.apiKey.${selected.id}`, apiKey);
    // 兼容旧格式：历史版本使用 promptHub.ai.apiKey（AIService 会自动迁移到新格式）
    await this.context.secrets.store('promptHub.ai.apiKey', apiKey);

    return {
      type: 'next',
      provider: selected.id as 'openai' | 'azure' | 'qwen' | 'custom' | 'local-claude' | 'local-codex',
      model,
    };
  }

  // ========== 步骤 5：Git Bash 检测（仅 Windows + local-claude）==========

  private async checkGitBash(): Promise<{ type: 'next' } | { type: 'back' }> {
    console.log(LOG_PREFIX, 'checkGitBash() 开始检测 Git Bash');

    // 检测 Git Bash 是否已安装
    const gitBashPath = await this.detectGitBash();
    console.log(LOG_PREFIX, 'detectGitBash() 结果:', gitBashPath);

    interface ActionItem extends vscode.QuickPickItem {
      value: 'continue' | 'download' | 'configure' | 'back';
    }

    if (gitBashPath) {
      // 已检测到 Git Bash
      const message = `✓ 检测到 Git Bash 已安装\n路径：${gitBashPath}\n\nClaude Code 在 Windows 上需要 Git Bash 才能运行。系统已自动检测到安装，您可以直接使用。`;

      const actions: ActionItem[] = [
        {
          label: '$(check) 继续',
          description: 'Git Bash 已就绪，继续完成配置',
          value: 'continue',
        },
        {
          label: '$(arrow-left) 上一步',
          description: '返回 AI 配置',
          value: 'back',
        },
      ];

      const selected = await vscode.window.showQuickPick(actions, {
        placeHolder: message,
        title: '步骤 5/5：环境检测',
        ignoreFocusOut: true,
      });

      if (!selected || selected.value === 'continue') {
        return { type: 'next' };
      }

      return { type: 'back' };
    }

    // 未检测到 Git Bash
    const message = `⚠ 未检测到 Git Bash\n\nClaude Code 在 Windows 上需要 Git Bash 才能运行。\n\n您可以：\n1. 下载并安装 Git for Windows（推荐）\n2. 如已安装，手动配置环境变量 CLAUDE_CODE_GIT_BASH_PATH\n3. 跳过此步骤，稍后配置`;

    const actions: ActionItem[] = [
      {
        label: '$(cloud-download) 下载 Git for Windows',
        description: '打开官网下载页面（推荐）',
        value: 'download',
      },
      {
        label: '$(info) 查看配置说明',
        description: '查看手动配置步骤',
        value: 'configure',
      },
      {
        label: '$(check) 稍后配置',
        description: '跳过此步骤，继续完成向导',
        value: 'continue',
      },
      {
        label: '$(arrow-left) 上一步',
        description: '返回 AI 配置',
        value: 'back',
      },
    ];

    const selected = await vscode.window.showQuickPick(actions, {
      placeHolder: message,
      title: '步骤 5/5：环境检测',
      ignoreFocusOut: true,
    });

    if (!selected || selected.value === 'continue') {
      return { type: 'next' };
    }

    if (selected.value === 'back') {
      return { type: 'back' };
    }

    if (selected.value === 'download') {
      await vscode.env.openExternal(vscode.Uri.parse('https://gitforwindows.org/'));
      vscode.window.showInformationMessage(
        '已打开 Git for Windows 下载页面。安装完成后请重启 VSCode。'
      );
      return { type: 'next' };
    }

    if (selected.value === 'configure') {
      const configMessage = `手动配置 Git Bash 的步骤：\n\n1. 找到 Git Bash 安装路径（通常是 C:\\Program Files\\Git\\bin\\bash.exe）\n\n2. 在系统环境变量中添加：\n   变量名：CLAUDE_CODE_GIT_BASH_PATH\n   变量值：Git Bash 的完整路径\n\n3. 重启 VSCode\n\n常见路径：\n• C:\\Program Files\\Git\\bin\\bash.exe\n• C:\\Program Files (x86)\\Git\\bin\\bash.exe`;

      await vscode.window.showInformationMessage(configMessage, { modal: true });
      return { type: 'next' };
    }

    return { type: 'next' };
  }

  /**
   * 检测 Git Bash 是否已安装（仅 Windows）
   */
  private async detectGitBash(): Promise<string | null> {
    if (process.platform !== 'win32') {
      return null;
    }

    const possiblePaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Git', 'bin', 'bash.exe'),
    ];

    // 检查常见路径
    for (const gitBashPath of possiblePaths) {
      try {
        await fs.promises.access(gitBashPath, fs.constants.F_OK);
        console.log(LOG_PREFIX, 'detectGitBash() 找到 Git Bash:', gitBashPath);
        return gitBashPath;
      } catch {
        // 继续检查下一个
      }
    }

    // 尝试从 PATH 检测
    try {
      const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        cp.exec('where bash.exe', { timeout: 5000 }, (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        });
      });

      const first = (stdout || '').split(/\r?\n/).map((s: string) => s.trim()).find(Boolean);
      if (first) {
        try {
          await fs.promises.access(first, fs.constants.F_OK);
          console.log(LOG_PREFIX, 'detectGitBash() 从 PATH 找到 Git Bash:', first);
          return first;
        } catch {
          // 路径不存在
        }
      }
    } catch {
      // where 命令失败，忽略
    }

    console.log(LOG_PREFIX, 'detectGitBash() 未找到 Git Bash');
    return null;
  }

  // ========== 步骤 6：完成页 ==========

  private async showCompletion(): Promise<void> {
    const resolvedStoragePath = this.resolvePath(this.state.storagePath || '~/.prompt-hub');
    const summaryLines = [
      '配置向导完成 🎉',
      '',
      '当前配置摘要：',
      `  · 存储路径：${resolvedStoragePath}`,
      `  · Git 同步：${this.state.gitEnabled ? '已启用' : '未启用'}`,
      `  · AI 配置：${
        this.state.aiProvider ? `${this.state.aiProvider} (${this.state.aiModel ?? ''})` : '未配置'
      }`,
      '',
      '接下来可以这样开始使用：',
      '  1. 选中文本 → 右键 →「Prompt Hub: 从选区创建」',
      '  2. 执行「Prompt Hub: 新建 Prompt 文件」使用模板开始编写',
      '  3. 在活动栏中打开 Prompt Hub 视图查看和管理 Prompt',
    ];

    console.log(LOG_PREFIX, 'showCompletion() 显示配置摘要');

    // 自动标记为已完成，配置已在每个步骤中保存，用户无需手动确认
    this.state.completed = true;
    await this.context.globalState.update('promptHub.onboardingCompleted', true);
    await this.saveState();
    console.log(LOG_PREFIX, '向导已自动标记为完成');

    const openHubItem: vscode.MessageItem = { title: '打开 Prompt Hub' };
    const openDocsItem: vscode.MessageItem = { title: '查看使用文档' };
    // VS Code 的 modal 信息框会默认提供一个“取消”作为关闭入口，这里用 isCloseAffordance 改成更贴切的“关闭”
    const closeItem: vscode.MessageItem = { title: '关闭', isCloseAffordance: true };

    const result = await vscode.window.showInformationMessage(
      summaryLines.join('\n'),
      { modal: true },
      openHubItem,
      openDocsItem,
      closeItem
    );

    console.log(LOG_PREFIX, 'showCompletion() 用户选择:', result?.title);

    if (result === openHubItem) {
      await vscode.commands.executeCommand('promptHubView.focus');
    } else if (result === openDocsItem) {
      const docsUrl =
        'https://github.com/Nita121388/prompt-hub/blob/main/docs/user-guide.md';
      await vscode.env.openExternal(vscode.Uri.parse(docsUrl));
    }
  }

  // ========== 使用默认配置 ==========

  /** 直接使用默认存储路径，跳过 Git 和 AI */
  private async useDefaults(): Promise<void> {
    const defaultPath = '~/.prompt-hub';
    console.log(LOG_PREFIX, 'useDefaults() 使用默认路径:', defaultPath);

    await vscode.workspace.getConfiguration('promptHub').update(
      'storagePath',
      defaultPath,
      vscode.ConfigurationTarget.Global
    );

    const resolvedPath = this.resolvePath(defaultPath);
    if (!fs.existsSync(resolvedPath)) {
      fs.mkdirSync(resolvedPath, { recursive: true });
    }

    this.state = {
      step: 5,
      storagePath: defaultPath,
      gitEnabled: false,
      gitRemoteUrl: undefined,
      aiProvider: undefined,
      aiModel: undefined,
      completed: true,
    };
    await this.saveState();
    await this.context.globalState.update('promptHub.onboardingCompleted', true);

    vscode.window.showInformationMessage(
      '已使用默认配置。\n\n存储路径：~/.prompt-hub\n如需修改，可在设置中搜索 "Prompt Hub"。'
    );
  }

  // ========== 公共工具方法 ==========

  /** 保存引导状态到 workspaceState */
  private async saveState(): Promise<void> {
    console.log(LOG_PREFIX, '保存状态', this.state);
    await this.context.workspaceState.update('promptHub.onboardingState', this.state);
  }

  /** 解析路径（支持 ~ / ${workspaceFolder} 等变量） */
  private resolvePath(configPath: string): string {
    let resolved = configPath;

    // 替换 ~
    if (resolved.startsWith('~')) {
      resolved = resolved.replace('~', os.homedir());
    }

    // 替换 ${workspaceFolder}
    if (resolved.includes('${workspaceFolder}')) {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (workspaceFolder) {
        resolved = resolved.replace('${workspaceFolder}', workspaceFolder);
      }
    }

    return resolved;
  }

  /** 校验存储路径是否合理 */
  private validateStoragePath(absPath: string): { valid: boolean; message?: string } {
    if (!absPath || !absPath.trim()) {
      return { valid: false, message: '路径不能为空' };
    }

    if (!path.isAbsolute(absPath)) {
      return { valid: false, message: '路径必须是绝对路径' };
    }

    try {
      const stat = fs.statSync(absPath);
      if (!stat.isDirectory()) {
        return { valid: false, message: '目标路径已存在且不是目录' };
      }
      return { valid: true };
    } catch {
      // 目录不存在时，检查父目录是否存在
      const parent = path.dirname(absPath);
      if (!fs.existsSync(parent)) {
        return { valid: false, message: '父目录不存在，请先创建父目录或选择其它路径' };
      }
      return { valid: true };
    }
  }

  /** 检查目录是否已经是 Git 仓库 */
  private async checkGitRepo(dir: string): Promise<boolean> {
    try {
      const gitDir = path.join(dir, '.git');
      const exists = fs.existsSync(gitDir);
      console.log(LOG_PREFIX, 'checkGitRepo() 检查 .git 目录是否存在:', gitDir, '结果:', exists);
      return exists;
    } catch (error) {
      console.error(LOG_PREFIX, 'checkGitRepo() 出错:', error);
      return false;
    }
  }

  private async refreshPromptViewAfterGit(): Promise<void> {
    try {
      await vscode.commands.executeCommand('promptHub.refreshView');
    } catch (error) {
      console.warn(
        LOG_PREFIX,
        'refreshPromptViewAfterGit() 调用 promptHub.refreshView 失败（可忽略）:',
        error
      );
    }
  }

  private sanitizeRemoteUrlForLog(url: string): string {
    const raw = (url || '').trim();
    if (!raw) return raw;

    try {
      const parsed = new URL(raw);
      if (parsed.username || parsed.password) {
        parsed.username = '***';
        parsed.password = '';
        return parsed.toString();
      }
      return raw;
    } catch {
      // scp 风格（git@github.com:org/repo.git）通常不含敏感信息；
      // 若是 https://token@host/xxx 的非标准写法，做一次粗略脱敏
      return raw.replace(/\/\/([^@/]+)@/g, '//***@');
    }
  }

  private summarizeGitOutput(text: string, maxLines: number = 4): string {
    const lines = (text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, maxLines);
    return lines.join('\n');
  }

  private classifyRemoteProbeError(message: string): 'not-found' | 'unauthorized' | 'unreachable' {
    const text = (message || '').trim();
    if (!text) return 'unreachable';

    if (
      /repository not found/i.test(text) ||
      /does not appear to be a git repository/i.test(text) ||
      /could not read from remote repository/i.test(text)
    ) {
      return 'not-found';
    }

    if (
      /permission denied/i.test(text) ||
      /authentication failed/i.test(text) ||
      /access denied/i.test(text) ||
      /could not read Username/i.test(text) ||
      /\b401\b/.test(text) ||
      /\b403\b/.test(text)
    ) {
      return 'unauthorized';
    }

    // “not found” 这个词在不同错误里含义混杂，保守归为 unreachable，避免误判
    return 'unreachable';
  }

  private async runGitCommandAllowFailure(
    args: string[],
    cwd: string
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const safeArgs = args.map((a) => this.sanitizeRemoteUrlForLog(a));
    console.log(LOG_PREFIX, 'runGitCommandAllowFailure() 调用，cwd =', cwd, 'args =', safeArgs);

    return await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const child = cp.spawn('git', args, { cwd, shell: process.platform === 'win32' });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        stderr += (error instanceof Error ? error.message : String(error)) || '';
        resolve({ code: 1, stdout, stderr });
      });

      child.on('close', (code) => {
        resolve({ code: code ?? 1, stdout, stderr });
      });
    });
  }

  private async probeRemoteRepoState(
    remoteUrl: string,
    cwd: string
  ): Promise<
    | { state: 'empty' | 'non-empty' }
    | { state: 'not-found' | 'unauthorized' | 'unreachable'; detail?: string }
  > {
    const url = (remoteUrl || '').trim();
    if (!url) return { state: 'unreachable', detail: '远程 URL 为空' };

    const heads = await this.runGitCommandAllowFailure(['ls-remote', '--heads', url], cwd);
    if (heads.code === 0) {
      if (heads.stdout.trim()) {
        return { state: 'non-empty' };
      }

      // 兼容：有些平台在 heads 为空时仍可能存在 HEAD（或仅返回 symref），再探测一次
      const head = await this.runGitCommandAllowFailure(['ls-remote', url, 'HEAD'], cwd);
      if (head.code === 0) {
        return head.stdout.trim() ? { state: 'non-empty' } : { state: 'empty' };
      }

      const kind = this.classifyRemoteProbeError(head.stderr || head.stdout);
      return { state: kind, detail: this.summarizeGitOutput(head.stderr || head.stdout) };
    }

    const kind = this.classifyRemoteProbeError(heads.stderr || heads.stdout);
    return { state: kind, detail: this.summarizeGitOutput(heads.stderr || heads.stdout) };
  }

  private isDirectoryEffectivelyEmpty(dir: string): boolean {
    try {
      const entries = fs.readdirSync(dir);
      const others = entries.filter((name) => name !== '.git');
      return others.length === 0;
    } catch {
      return true;
    }
  }

  private async getLocalRepoSummary(dir: string): Promise<{
    isGitRepo: boolean;
    hasCommit: boolean;
    commitCount: number;
    trackedFiles: number;
    hasMeaningfulHistory: boolean;
    isEffectivelyEmptyDir: boolean;
  }> {
    const isGitRepo = await this.checkGitRepo(dir);
    const isEffectivelyEmptyDir = this.isDirectoryEffectivelyEmpty(dir);

    if (!isGitRepo) {
      return {
        isGitRepo,
        hasCommit: false,
        commitCount: 0,
        trackedFiles: 0,
        hasMeaningfulHistory: false,
        isEffectivelyEmptyDir,
      };
    }

    let hasCommit = false;
    try {
      await this.runGitCommand(['rev-parse', '--verify', 'HEAD'], dir);
      hasCommit = true;
    } catch {
      hasCommit = false;
    }

    let commitCount = 0;
    if (hasCommit) {
      try {
        const out = await this.runGitCommandAndGetStdout(['rev-list', '--count', 'HEAD'], dir);
        commitCount = Number.parseInt(out.trim(), 10) || 1;
      } catch {
        commitCount = 1;
      }
    }

    let trackedFiles = 0;
    try {
      const out = await this.runGitCommandAndGetStdout(['ls-files'], dir);
      trackedFiles = out.split(/\r?\n/).filter(Boolean).length;
    } catch {
      trackedFiles = 0;
    }

    const hasMeaningfulHistory = hasCommit && (commitCount > 1 || trackedFiles > 0);

    return {
      isGitRepo,
      hasCommit,
      commitCount,
      trackedFiles,
      hasMeaningfulHistory,
      isEffectivelyEmptyDir,
    };
  }

  /** 在指定目录初始化 Git 仓库 */
  private async initGitRepo(dir: string): Promise<boolean> {
    const confirm = await vscode.window.showWarningMessage(
      `将在目录中执行 "git init"：${dir}`,
      { modal: true },
      '继续',
      '取消'
    );
    console.log(LOG_PREFIX, 'initGitRepo() 用户确认结果:', confirm);
    if (confirm !== '继续') {
      return false;
    }

    try {
      await this.runGitCommand(['init'], dir);
      vscode.window.showInformationMessage('已在存储目录中初始化 Git 仓库。');
      return true;
    } catch (error) {
      console.error(LOG_PREFIX, 'initGitRepo() 执行 git init 出错:', error);
      vscode.window.showErrorMessage(
        `初始化 Git 仓库失败：${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * 读取当前仓库的远程 origin URL（如不存在则返回 undefined）
   */
  private async getCurrentRemoteUrl(dir: string): Promise<string | undefined> {
    try {
      const output = await this.runGitCommandAndGetStdout(['remote', 'get-url', 'origin'], dir);
      const url = output.trim();
      console.log(LOG_PREFIX, 'getCurrentRemoteUrl() 检测到远程 origin:', url);
      return url || undefined;
    } catch (error) {
      console.warn(LOG_PREFIX, 'getCurrentRemoteUrl() 获取远程 origin 失败:', error);
      return undefined;
    }
  }

  /**
   * 在指定目录执行 git 命令并返回标准输出
   */
  private async runGitCommandAndGetStdout(args: string[], cwd: string): Promise<string> {
    const safeArgs = args.map((a) => this.sanitizeRemoteUrlForLog(a));
    console.log(LOG_PREFIX, 'runGitCommandAndGetStdout() 调用，cwd =', cwd, 'args =', safeArgs);

    return await new Promise<string>((resolve, reject) => {
      const child = cp.spawn('git', args, { cwd, shell: process.platform === 'win32' });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        console.log(LOG_PREFIX, 'git stdout:', text);
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        console.log(LOG_PREFIX, 'git stderr:', text);
      });

      child.on('error', (error) => {
        console.error(LOG_PREFIX, 'git 进程错误:', error);
        reject(error);
      });

      child.on('close', (code) => {
        console.log(LOG_PREFIX, 'git 进程退出，code =', code);
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `git 退出码为 ${code}`));
        }
      });
    });
  }

  /** 在指定目录执行 git 命令（只关心成功/失败） */
  private async runGitCommand(args: string[], cwd: string): Promise<void> {
    const safeArgs = args.map((a) => this.sanitizeRemoteUrlForLog(a));
    console.log(LOG_PREFIX, 'runGitCommand() 调用，cwd =', cwd, 'args =', safeArgs);

    await new Promise<void>((resolve, reject) => {
      const child = cp.spawn('git', args, { cwd, shell: process.platform === 'win32' });
      let stderr = '';

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        console.log(LOG_PREFIX, 'git stderr:', text);
      });

      child.on('error', (error) => {
        console.error(LOG_PREFIX, 'git 进程错误:', error);
        reject(error);
      });

      child.on('close', (code) => {
        console.log(LOG_PREFIX, 'git 进程退出，code =', code);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr || `git 退出码为 ${code}`));
        }
      });
    });
  }

}
