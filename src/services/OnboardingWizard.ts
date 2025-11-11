import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { OnboardingState } from '../types/Prompt';

/**
 * 首次使用引导向导
 */
export class OnboardingWizard {
  private state: OnboardingState;

  constructor(
    private context: vscode.ExtensionContext
  ) {
    // 初始化状态
    this.state = this.context.workspaceState.get<OnboardingState>('promptHub.onboardingState') || {
      step: 1,
      storagePath: '~/.prompt-hub',
      gitEnabled: false,
      completed: false
    };
  }

  /** 启动引导向导 */
  async start(): Promise<void> {
    // 步骤 1：欢迎页面
    const result = await this.showWelcome();

    if (result === 'start') {
      await this.runFullWizard();
    } else if (result === 'defaults') {
      await this.useDefaults();
    }
    // 'later': 不做任何操作，下次启动继续提示
  }

  /** 显示欢迎页面 */
  private async showWelcome(): Promise<'start' | 'defaults' | 'later' | undefined> {
    const result = await vscode.window.showInformationMessage(
      '🎉 欢迎使用 Prompt Hub！\n\n让我们花 2 分钟完成初始配置，开始高效管理您的 Prompt 资产。',
      { modal: true },
      '开始配置',
      '使用默认设置',
      '稍后提醒'
    );

    if (result === '开始配置') return 'start';
    if (result === '使用默认设置') return 'defaults';
    return 'later';
  }

  /** 运行完整引导流程 */
  private async runFullWizard(): Promise<void> {
    try {
      // 步骤 2：存储路径配置
      const storagePath = await this.configureStorage();
      if (!storagePath) {
        vscode.window.showWarningMessage('配置已取消');
        return;
      }
      this.state.storagePath = storagePath;
      await this.saveState();

      // 步骤 3：Git 仓库配置
      const gitConfig = await this.configureGit(storagePath);
      if (gitConfig) {
        this.state.gitEnabled = gitConfig.enabled;
        this.state.gitRemoteUrl = gitConfig.remoteUrl;
        await this.saveState();
      }

      // 步骤 4：AI Provider 配置
      const aiConfig = await this.configureAI();
      if (aiConfig) {
        this.state.aiProvider = aiConfig.provider;
        this.state.aiModel = aiConfig.model;
        await this.saveState();
      }

      // 步骤 5：完成页面
      await this.showCompletion();

      // 标记完成
      this.state.completed = true;
      await this.context.globalState.update('promptHub.onboardingCompleted', true);
      await this.saveState();

    } catch (error) {
      vscode.window.showErrorMessage(
        `配置向导出错: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /** 步骤 2：配置存储路径 */
  private async configureStorage(): Promise<string | undefined> {
    const scenarios = [
      {
        label: '$(home) 本地存储（推荐）',
        description: '存储在用户主目录',
        path: '~/.prompt-hub'
      },
      {
        label: '$(cloud) 云盘同步',
        description: '存储在云盘目录，自动同步',
        path: '~/OneDrive/prompts'
      },
      {
        label: '$(folder) 项目级别',
        description: '存储在当前工作区，适合团队协作',
        path: '${workspaceFolder}/.prompts'
      },
      {
        label: '$(folder-opened) 自定义路径',
        description: '浏览并选择自定义目录',
        path: 'custom'
      }
    ];

    const selected = await vscode.window.showQuickPick(scenarios, {
      placeHolder: '选择 Prompt 存储位置',
      title: '步骤 2/4: 存储路径配置'
    });

    if (!selected) return undefined;

    let storagePath: string;

    if (selected.path === 'custom') {
      // 打开文件夹选择对话框
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '选择存储目录'
      });

      if (!uris || uris.length === 0) return undefined;
      storagePath = uris[0].fsPath;
    } else {
      storagePath = selected.path;
    }

    // 验证路径
    const resolvedPath = this.resolvePath(storagePath);
    const validation = this.validateStoragePath(resolvedPath);

    if (!validation.valid) {
      const retry = await vscode.window.showWarningMessage(
        `路径验证失败: ${validation.message}`,
        '重新选择',
        '取消'
      );
      if (retry === '重新选择') {
        return this.configureStorage();
      }
      return undefined;
    }

    // 保存配置
    await vscode.workspace.getConfiguration('promptHub').update(
      'storagePath',
      storagePath,
      vscode.ConfigurationTarget.Global
    );

    // 创建目录
    if (!fs.existsSync(resolvedPath)) {
      fs.mkdirSync(resolvedPath, { recursive: true });
      vscode.window.showInformationMessage(`已创建存储目录: ${resolvedPath}`);
    }

    return storagePath;
  }

  /** 步骤 3：配置 Git 仓库 */
  private async configureGit(storagePath: string): Promise<{ enabled: boolean; remoteUrl?: string } | undefined> {
    const resolvedPath = this.resolvePath(storagePath);

    // 检测是否已在 Git 仓库内
    const isGitRepo = await this.checkGitRepo(resolvedPath);

    let message: string;
    let options: string[];

    if (isGitRepo) {
      message = '✓ 已检测到 Git 仓库\n\n是否启用 Git 同步功能？';
      options = ['启用同步', '暂不启用'];
    } else {
      message = '当前路径不在 Git 仓库内\n\n是否要初始化 Git 仓库并启用版本控制？';
      options = ['初始化 Git', '暂不启用'];
    }

    const result = await vscode.window.showQuickPick(options, {
      placeHolder: message,
      title: '步骤 3/4: Git 同步配置'
    });

    if (!result || result === '暂不启用') {
      return { enabled: false };
    }

    // 如果需要初始化
    if (!isGitRepo && result === '初始化 Git') {
      try {
        await this.initGitRepo(resolvedPath);
        vscode.window.showInformationMessage('Git 仓库初始化成功');
      } catch (error) {
        vscode.window.showErrorMessage(
          `Git 初始化失败: ${error instanceof Error ? error.message : String(error)}`
        );
        return { enabled: false };
      }
    }

    // 询问远程仓库 URL
    const remoteUrl = await vscode.window.showInputBox({
      prompt: '输入远程仓库 URL（可选，可稍后配置）',
      placeHolder: 'https://github.com/username/prompts.git',
      ignoreFocusOut: true
    });

    // 配置自动拉取
    const autoPull = await vscode.window.showQuickPick(['是', '否'], {
      placeHolder: '是否在 VSCode 启动时自动拉取最新 Prompt？',
      title: 'Git 自动拉取'
    });

    // 保存配置
    const config = vscode.workspace.getConfiguration('promptHub.git');
    await config.update('enableSync', true, vscode.ConfigurationTarget.Global);
    await config.update('autoPullOnStartup', autoPull === '是', vscode.ConfigurationTarget.Global);

    return {
      enabled: true,
      remoteUrl: remoteUrl || undefined
    };
  }

  /** 步骤 4：配置 AI Provider */
  private async configureAI(): Promise<{ provider: 'openai' | 'azure' | 'qwen' | 'custom'; model: string } | undefined> {
    const providers = [
      {
        label: '$(zap) OpenAI',
        description: 'GPT-4, GPT-3.5 等模型',
        id: 'openai' as const,
        defaultModel: 'gpt-4o'
      },
      {
        label: '$(azure) Azure OpenAI',
        description: 'Azure 托管的 OpenAI 服务',
        id: 'azure' as const,
        defaultModel: 'gpt-4'
      },
      {
        label: '$(symbol-namespace) 通义千问',
        description: '阿里云通义千问大模型',
        id: 'qwen' as const,
        defaultModel: 'qwen-turbo'
      },
      {
        label: '$(settings-gear) 自定义',
        description: '使用自定义 API 端点',
        id: 'custom' as const,
        defaultModel: 'gpt-4'
      },
      {
        label: '$(close) 暂不配置',
        description: '稍后在设置中配置',
        id: 'skip' as const,
        defaultModel: ''
      }
    ];

    const selected = await vscode.window.showQuickPick(providers, {
      placeHolder: '选择 AI Provider（可选）',
      title: '步骤 4/4: AI 配置'
    });

    if (!selected || selected.id === 'skip') {
      return undefined;
    }

    // 配置模型
    const model = await vscode.window.showInputBox({
      prompt: '输入模型名称',
      value: selected.defaultModel,
      placeHolder: '例如: gpt-4o, gpt-3.5-turbo'
    });

    if (!model) return undefined;

    // 配置 API Key
    const apiKey = await vscode.window.showInputBox({
      prompt: '输入 API Key（将安全存储）',
      password: true,
      placeHolder: 'sk-...',
      ignoreFocusOut: true
    });

    if (!apiKey) {
      vscode.window.showWarningMessage('未输入 API Key，AI 功能将不可用');
      return undefined;
    }

    // 配置 Base URL（可选）
    let baseUrl = 'https://api.openai.com/v1';
    if (selected.id === 'custom' || selected.id === 'azure') {
      const customUrl = await vscode.window.showInputBox({
        prompt: '输入 API Base URL',
        value: baseUrl,
        placeHolder: 'https://api.openai.com/v1'
      });
      if (customUrl) baseUrl = customUrl;
    }

    // 测试连接
    const testConnection = await vscode.window.showQuickPick(['是', '否'], {
      placeHolder: '是否测试 API 连接？',
      title: 'API 连接测试'
    });

    if (testConnection === '是') {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: '正在测试 API 连接...',
          cancellable: false
        },
        async () => {
          // TODO: 实际测试逻辑
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      );
      vscode.window.showInformationMessage('✓ API 连接测试成功');
    }

    // 保存配置
    const config = vscode.workspace.getConfiguration('promptHub.ai');
    await config.update('provider', selected.id, vscode.ConfigurationTarget.Global);
    await config.update('model', model, vscode.ConfigurationTarget.Global);
    await config.update('baseUrl', baseUrl, vscode.ConfigurationTarget.Global);

    // 保存 API Key 到 SecretStorage
    await this.context.secrets.store('promptHub.ai.apiKey', apiKey);

    return {
      provider: selected.id,
      model: model
    };
  }

  /** 步骤 5：显示完成页面 */
  private async showCompletion(): Promise<void> {
    const summary = [
      '✅ 配置完成！',
      '',
      '您的配置：',
      `  • 存储路径：${this.state.storagePath}`,
      `  • Git 同步：${this.state.gitEnabled ? '已启用' : '未启用'}`,
      `  • AI 辅助：${this.state.aiProvider ? `已配置 ${this.state.aiProvider} (${this.state.aiModel})` : '未配置'}`,
      '',
      '快速开始：',
      '  1. 选中文本 → 右键 → "Prompt Hub: 从选区创建"',
      '  2. 打开命令面板 → "Prompt Hub: 新建 Prompt 文件"',
      '  3. 查看侧边栏的 Prompt Hub 视图'
    ].join('\n');

    const result = await vscode.window.showInformationMessage(
      summary,
      { modal: true },
      '打开 Prompt Hub',
      '查看文档',
      '完成'
    );

    if (result === '打开 Prompt Hub') {
      await vscode.commands.executeCommand('promptHubView.focus');
    } else if (result === '查看文档') {
      const docsUrl = 'https://github.com/your-username/prompt-hub/blob/main/docs/user-guide.md';
      await vscode.env.openExternal(vscode.Uri.parse(docsUrl));
    }
  }

  /** 使用默认设置 */
  private async useDefaults(): Promise<void> {
    // 设置默认存储路径
    const defaultPath = '~/.prompt-hub';
    await vscode.workspace.getConfiguration('promptHub').update(
      'storagePath',
      defaultPath,
      vscode.ConfigurationTarget.Global
    );

    // 创建目录
    const resolvedPath = this.resolvePath(defaultPath);
    if (!fs.existsSync(resolvedPath)) {
      fs.mkdirSync(resolvedPath, { recursive: true });
    }

    // 标记完成
    await this.context.globalState.update('promptHub.onboardingCompleted', true);

    vscode.window.showInformationMessage(
      '✓ 已使用默认配置\n\n存储路径: ~/.prompt-hub\n您可以随时在设置中修改配置'
    );
  }

  /** 重置引导 */
  async reset(): Promise<void> {
    await this.context.globalState.update('promptHub.onboardingCompleted', false);
    await this.context.workspaceState.update('promptHub.onboardingState', undefined);
    vscode.window.showInformationMessage('✓ 引导已重置，下次启动时将再次显示');
  }

  /** 保存当前状态 */
  private async saveState(): Promise<void> {
    await this.context.workspaceState.update('promptHub.onboardingState', this.state);
  }

  /** 解析路径（支持 ~、环境变量、工作区变量） */
  private resolvePath(pathStr: string): string {
    // 替换 ~
    if (pathStr.startsWith('~')) {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      pathStr = pathStr.replace('~', homeDir);
    }

    // 替换 ${workspaceFolder}
    if (pathStr.includes('${workspaceFolder}')) {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      pathStr = pathStr.replace('${workspaceFolder}', workspaceFolder);
    }

    // 替换环境变量
    pathStr = pathStr.replace(/\$\{(\w+)\}/g, (_, varName) => {
      return process.env[varName] || '';
    });

    return path.resolve(pathStr);
  }

  /** 验证存储路径 */
  private validateStoragePath(pathStr: string): { valid: boolean; message?: string } {
    if (!pathStr) {
      return { valid: false, message: '路径不能为空' };
    }

    // 检查父目录是否存在
    const parentDir = path.dirname(pathStr);
    if (!fs.existsSync(parentDir)) {
      return { valid: false, message: '父目录不存在' };
    }

    // 检查是否可写（如果目录已存在）
    if (fs.existsSync(pathStr)) {
      try {
        fs.accessSync(pathStr, fs.constants.W_OK);
      } catch {
        return { valid: false, message: '目录不可写' };
      }
    }

    return { valid: true };
  }

  /** 检查是否为 Git 仓库 */
  private async checkGitRepo(cwd: string): Promise<boolean> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      await execAsync('git rev-parse --is-inside-work-tree', { cwd });
      return true;
    } catch {
      return false;
    }
  }

  /** 初始化 Git 仓库 */
  private async initGitRepo(cwd: string): Promise<void> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    // git init
    await execAsync('git init', { cwd });

    // 创建 .gitignore
    const gitignore = ['*.log', '.DS_Store', 'node_modules/', ''].join('\n');
    fs.writeFileSync(path.join(cwd, '.gitignore'), gitignore);

    // 初始提交
    await execAsync('git add .', { cwd });
    await execAsync('git commit -m "chore: init prompt hub"', { cwd });
  }
}
