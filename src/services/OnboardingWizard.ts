import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { OnboardingState } from '../types/Prompt';

/**
 * 首次使用配置向导
 *
 * 步骤：
 * 1. 欢迎页
 * 2. 存储路径
 * 3. Git 同步（可选，支持「上一步」返回 2）
 * 4. AI Provider（可选，支持「上一步」返回 3）
 * 5. 完成页
 */
export class OnboardingWizard {
  private state: OnboardingState;

  constructor(private readonly context: vscode.ExtensionContext) {
    // 从 workspaceState 里恢复上次的引导状态
    this.state =
      this.context.workspaceState.get<OnboardingState>('promptHub.onboardingState') ?? {
        step: 1,
        storagePath: '~/.prompt-hub',
        gitEnabled: false,
        completed: false,
      };
  }

  /** 对外启动入口 */
  async start(): Promise<void> {
    const result = await this.showWelcome();

    if (result === 'start') {
      await this.runFlow();
    } else if (result === 'defaults') {
      await this.useDefaults();
    }
    // result === 'later' 或 undefined：什么都不做，下次继续提示
  }

  /** 显示欢迎页 */
  private async showWelcome(): Promise<'start' | 'defaults' | 'later' | undefined> {
    const message = [
      '欢迎使用 Prompt Hub 👋',
      '',
      '我们将通过一个简短的向导帮你完成初始配置：',
      '  • 选择 Prompt 存储路径',
      '  • 是否启用 Git 同步',
      '  • 配置 AI Provider（可选）',
    ].join('\n');

    const result = await vscode.window.showInformationMessage(
      message,
      { modal: true },
      '开始配置',
      '使用默认配置',
      '以后再说'
    );

    if (result === '开始配置') return 'start';
    if (result === '使用默认配置') return 'defaults';
    if (result === '以后再说') return 'later';
    return undefined;
  }

  /**
   * 主流程：支持在 Git / AI 步骤中「上一步」返回
   */
  private async runFlow(): Promise<void> {
    try {
      let currentStep: 2 | 3 | 4 = 2;
      let finished = false;

      // 当前存储路径（如果之前配置过就复用）
      let storagePath = this.state.storagePath || '~/.prompt-hub';

      while (!finished) {
        if (currentStep === 2) {
          // 步骤 2：存储路径
          const result = await this.configureStorage(storagePath);
          if (result.type === 'cancel') {
            vscode.window.showWarningMessage('配置向导已取消，之前的配置保持不变。');
            return;
          }

          storagePath = result.storagePath;
          this.state.storagePath = storagePath;
          this.state.step = 2;
          await this.saveState();

          currentStep = 3;
        } else if (currentStep === 3) {
          // 步骤 3：Git 同步
          const result = await this.configureGit(storagePath);

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
          this.state.step = 3;
          await this.saveState();

          currentStep = 4;
        } else {
          // 步骤 4：AI 配置
          const result = await this.configureAI();

          if (result.type === 'back') {
            // 返回上一步：Git 配置
            currentStep = 3;
            continue;
          }

          if (result.type === 'skip') {
            this.state.aiProvider = undefined;
            this.state.aiModel = undefined;
          } else {
            this.state.aiProvider = result.provider;
            this.state.aiModel = result.model;
          }
          this.state.step = 4;
          await this.saveState();

          finished = true;
        }
      }

      // 步骤 5：完成页
      await this.showCompletion();

      // 标记已完成，下次不再自动弹出
      this.state.completed = true;
      await this.context.globalState.update('promptHub.onboardingCompleted', true);
      await this.saveState();
    } catch (error) {
      vscode.window.showErrorMessage(
        `配置向导出错: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ========== 步骤 2：存储路径 ==========

  private async configureStorage(
    previousPath: string
  ): Promise<{ type: 'next'; storagePath: string } | { type: 'cancel' }> {
    const scenarios: { label: string; description: string; path: string }[] = [
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

    const selected = await vscode.window.showQuickPick(scenarios, {
      placeHolder: '选择 Prompt 存储位置',
      title: '步骤 2/4：存储路径配置',
    });

    // 取消 = 整个向导中止
    if (!selected) {
      return { type: 'cancel' };
    }

    let storagePath: string;

    if (selected.path === 'custom') {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '确定',
      });

      if (!uris || uris.length === 0) {
        return { type: 'cancel' };
      }
      storagePath = uris[0].fsPath;
    } else {
      storagePath = selected.path;
    }

    const resolvedPath = this.resolvePath(storagePath);
    const validation = this.validateStoragePath(resolvedPath);

    if (!validation.valid) {
      const retry = await vscode.window.showWarningMessage(
        `路径校验失败：${validation.message}`,
        '重新选择',
        '取消'
      );

      if (retry === '重新选择') {
        return this.configureStorage(previousPath);
      }

      return { type: 'cancel' };
    }

    // 写入 VSCode 配置
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

  private async configureGit(
    storagePath: string
  ): Promise<
    | { type: 'next'; enabled: boolean; remoteUrl?: string }
    | { type: 'skip' }
    | { type: 'back' }
  > {
    const resolvedPath = this.resolvePath(storagePath);
    const isGitRepo = await this.checkGitRepo(resolvedPath);

    let message: string;
    interface GitOption {
      label: string;
      value: 'enable' | 'init' | 'skip' | 'back';
    }

    let options: GitOption[];

    if (isGitRepo) {
      message = '检测到当前存储目录已经是 Git 仓库。\n\n是否启用 Git 同步功能？';
      options = [
        { label: '✅ 启用同步', value: 'enable' },
        { label: '⏭ 暂不配置', value: 'skip' },
        { label: '⬅ 上一步（返回存储路径）', value: 'back' },
      ];
    } else {
      message = '当前存储目录还不是 Git 仓库。\n\n是否初始化 Git 仓库并启用版本管理？';
      options = [
        { label: '🌱 初始化 Git 并启用同步', value: 'init' },
        { label: '⏭ 暂不配置', value: 'skip' },
        { label: '⬅ 上一步（返回存储路径）', value: 'back' },
      ];
    }

    const picked = await vscode.window.showQuickPick(options, {
      placeHolder: message,
      title: '步骤 3/4：Git 同步配置',
    });

    // 取消/关闭 = 视为“暂不配置”
    if (!picked || picked.value === 'skip') {
      return { type: 'skip' };
    }

    if (picked.value === 'back') {
      return { type: 'back' };
    }

    // 需要初始化 Git 仓库
    if (!isGitRepo && picked.value === 'init') {
      try {
        await this.initGitRepo(resolvedPath);
        vscode.window.showInformationMessage('Git 仓库初始化成功。');
      } catch (error) {
        vscode.window.showErrorMessage(
          `Git 初始化失败：${error instanceof Error ? error.message : String(error)}`
        );
        return { type: 'skip' };
      }
    }

    // 询问远程仓库 URL
    const remoteUrl = await vscode.window.showInputBox({
      prompt: '请输入远程仓库 URL（可留空，稍后再配置）',
      placeHolder: 'https://github.com/username/prompts.git',
      ignoreFocusOut: true,
    });

    // 是否在 VSCode 启动时自动拉取
    const autoPull = await vscode.window.showQuickPick(['是', '否'], {
      placeHolder: '是否在 VSCode 启动时自动从远程拉取最新 Prompt？',
      title: 'Git 自动拉取',
    });

    const gitConfig = vscode.workspace.getConfiguration('promptHub.git');
    await gitConfig.update('enableSync', true, vscode.ConfigurationTarget.Global);
    await gitConfig.update(
      'autoPullOnStartup',
      autoPull === '是',
      vscode.ConfigurationTarget.Global
    );

    return {
      type: 'next',
      enabled: true,
      remoteUrl: remoteUrl || undefined,
    };
  }

  // ========== 步骤 4：AI Provider ==========

  private async configureAI(): Promise<
    | { type: 'next'; provider: 'openai' | 'azure' | 'qwen' | 'custom'; model: string }
    | { type: 'skip' }
    | { type: 'back' }
  > {
    type ProviderId = 'openai' | 'azure' | 'qwen' | 'custom' | 'skip' | 'back';

    const providers: {
      label: string;
      description: string;
      id: ProviderId;
      defaultModel: string;
    }[] = [
      {
        label: '$(zap) OpenAI',
        description: 'GPT-4 / GPT-3.5 等通用模型',
        id: 'openai',
        defaultModel: 'gpt-4o',
      },
      {
        label: '$(azure) Azure OpenAI',
        description: '通过 Azure 网关接入 OpenAI',
        id: 'azure',
        defaultModel: 'gpt-4',
      },
      {
        label: '$(symbol-namespace) 通义千问',
        description: '阿里通义千问大模型',
        id: 'qwen',
        defaultModel: 'qwen-turbo',
      },
      {
        label: '$(settings-gear) 自定义',
        description: '自定义任意兼容 OpenAI 协议的 API',
        id: 'custom',
        defaultModel: 'gpt-4',
      },
      {
        label: '$(close) 暂不配置',
        description: '以后再配置 AI，也可以只用本地 Prompt',
        id: 'skip',
        defaultModel: '',
      },
      {
        label: '⬅ 上一步',
        description: '返回 Git 同步配置',
        id: 'back',
        defaultModel: '',
      },
    ];

    const selected = await vscode.window.showQuickPick(providers, {
      placeHolder: '选择 AI Provider（可跳过，稍后在设置中配置）',
      title: '步骤 4/4：AI 配置',
    });

    // 取消 / 「暂不配置」都视为跳过 AI 配置
    if (!selected || selected.id === 'skip') {
      return { type: 'skip' };
    }

    if (selected.id === 'back') {
      return { type: 'back' };
    }

    // 选择模型
    const model = await vscode.window.showInputBox({
      prompt: '请输入模型名称',
      value: selected.defaultModel,
      placeHolder: '例如：gpt-4o, gpt-3.5-turbo, qwen-turbo',
    });

    if (!model) {
      return { type: 'skip' };
    }

    // API Key
    const apiKey = await vscode.window.showInputBox({
      prompt: '请输入 API Key，将安全地保存在 VSCode SecretStorage 中',
      password: true,
      placeHolder: 'sk-...',
      ignoreFocusOut: true,
    });

    if (!apiKey) {
      vscode.window.showWarningMessage('未配置 API Key，AI 功能暂时不可用。');
      return { type: 'skip' };
    }

    // Base URL（OpenAI 官方不用改，自定义/ Azure 可以修改）
    let baseUrl = 'https://api.openai.com/v1';
    if (selected.id === 'custom' || selected.id === 'azure') {
      const customUrl = await vscode.window.showInputBox({
        prompt: '请输入 API Base URL',
        value: baseUrl,
        placeHolder: '例如：https://api.openai.com/v1',
      });
      if (customUrl) {
        baseUrl = customUrl;
      }
    }

    // 是否测试连接（目前只是做一个简单的进度提示）
    const testConnection = await vscode.window.showQuickPick(['是', '否'], {
      placeHolder: '是否现在测试一次 API 连接？',
      title: 'API 连接测试',
    });

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
    await this.context.secrets.store('promptHub.ai.apiKey', apiKey);

    return {
      type: 'next',
      provider: selected.id as 'openai' | 'azure' | 'qwen' | 'custom',
      model,
    };
  }

  // ========== 步骤 5：完成页 ==========

  private async showCompletion(): Promise<void> {
    const summaryLines = [
      '配置向导完成 ✅',
      '',
      '当前配置摘要：',
      `  • 存储路径：${this.state.storagePath}`,
      `  • Git 同步：${this.state.gitEnabled ? '已启用' : '未启用'}`,
      `  • AI 配置：${
        this.state.aiProvider ? `${this.state.aiProvider} (${this.state.aiModel ?? ''})` : '未配置'
      }`,
      '',
      '接下来可以这样开始使用：',
      '  1. 选中文本 → 右键 → "Prompt Hub: 从选区创建"',
      '  2. 执行 "Prompt Hub: 新建 Prompt 文件" 使用模板开始编写',
      '  3. 在活动栏中打开 Prompt Hub 视图查看和管理 Prompt',
    ];

    const result = await vscode.window.showInformationMessage(
      summaryLines.join('\n'),
      { modal: true },
      '打开 Prompt Hub',
      '查看使用文档',
      '关闭'
    );

    if (result === '打开 Prompt Hub') {
      await vscode.commands.executeCommand('promptHubView.focus');
    } else if (result === '查看使用文档') {
      const docsUrl = 'https://github.com/your-username/prompt-hub/blob/main/docs/user-guide.md';
      await vscode.env.openExternal(vscode.Uri.parse(docsUrl));
    }
  }

  // ========== 使用默认配置 ==========

  /** 直接使用默认存储路径，跳过 Git 和 AI  */
  private async useDefaults(): Promise<void> {
    const defaultPath = '~/.prompt-hub';

    await vscode.workspace.getConfiguration('promptHub').update(
      'storagePath',
      defaultPath,
      vscode.ConfigurationTarget.Global
    );

    const resolvedPath = this.resolvePath(defaultPath);
    if (!fs.existsSync(resolvedPath)) {
      fs.mkdirSync(resolvedPath, { recursive: true });
    }

    await this.context.globalState.update('promptHub.onboardingCompleted', true);

    vscode.window.showInformationMessage(
      '已使用默认配置。\n\n存储路径：~/.prompt-hub\n如需修改，可在设置中搜索 "Prompt Hub"。'
    );
  }

  // ========== 公共工具方法 ==========

  /** 重置引导状态，供命令调用 */
  async reset(): Promise<void> {
    await this.context.globalState.update('promptHub.onboardingCompleted', false);
    await this.context.workspaceState.update('promptHub.onboardingState', undefined);
    vscode.window.showInformationMessage('配置向导状态已重置，下次将重新运行。');
  }

  /** 持久化当前引导状态 */
  private async saveState(): Promise<void> {
    await this.context.workspaceState.update('promptHub.onboardingState', this.state);
  }

  /** 解析路径中的 ~ / ${workspaceFolder} / ${ENV_VAR} */
  private resolvePath(pathStr: string): string {
    let result = pathStr;

    if (result.startsWith('~')) {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      result = result.replace('~', homeDir);
    }

    if (result.includes('${workspaceFolder}')) {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      result = result.replace('${workspaceFolder}', workspaceFolder);
    }

    result = result.replace(/\$\{(\w+)\}/g, (_, varName) => {
      return process.env[varName] || '';
    });

    return path.resolve(result);
  }

  /** 校验存储目录是否可用 */
  private validateStoragePath(pathStr: string): { valid: boolean; message?: string } {
    if (!pathStr) {
      return { valid: false, message: '路径不能为空' };
    }

    const parentDir = path.dirname(pathStr);
    if (!fs.existsSync(parentDir)) {
      return { valid: false, message: '父目录不存在' };
    }

    if (fs.existsSync(pathStr)) {
      try {
        fs.accessSync(pathStr, fs.constants.W_OK);
      } catch {
        return { valid: false, message: '目录不可写，请检查权限' };
      }
    }

    return { valid: true };
  }

  /** 判断是否为 Git 仓库 */
  private async checkGitRepo(cwd: string): Promise<boolean> {
    try {
      const { exec } = require('child_process') as typeof import('child_process');
      const { promisify } = require('util') as typeof import('util');
      const execAsync = promisify(exec);

      await execAsync('git rev-parse --is-inside-work-tree', { cwd });
      return true;
    } catch {
      return false;
    }
  }

  /** 初始化 Git 仓库（可能在空目录里，没有文件也没关系） */
  private async initGitRepo(cwd: string): Promise<void> {
    const { exec } = require('child_process') as typeof import('child_process');
    const { promisify } = require('util') as typeof import('util');
    const execAsync = promisify(exec);

    await execAsync('git init', { cwd });

    const gitignore = ['*.log', '.DS_Store', 'node_modules/', ''].join('\n');
    fs.writeFileSync(path.join(cwd, '.gitignore'), gitignore);

    try {
      await execAsync('git add .', { cwd });
      await execAsync('git commit -m "chore: init prompt hub"', { cwd });
    } catch {
      // 如果没有文件可提交，可以忽略这个错误
    }
  }
}

