import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 配置管理服务
 */
export class ConfigurationService {
  private readonly CONFIG_PREFIX = 'otter';
  // 兼容旧版配置前缀，避免升级后设置/密钥失效
  private readonly LEGACY_CONFIG_PREFIX = 'promptHub';

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * 获取配置项
   */
  get<T>(key: string, defaultValue?: T): T {
    const config = vscode.workspace.getConfiguration(this.CONFIG_PREFIX);
    if (this.hasValue(config, key)) {
      return config.get<T>(key, defaultValue as T);
    }

    // 兼容旧版配置（如已在 promptHub.* 下配置）
    const legacyConfig = vscode.workspace.getConfiguration(this.LEGACY_CONFIG_PREFIX);
    if (this.hasValue(legacyConfig, key)) {
      return legacyConfig.get<T>(key, defaultValue as T);
    }

    return config.get<T>(key, defaultValue as T);
  }

  /**
   * 设置配置项（写入用户设置）
   */
  async set(
    key: string,
    value: unknown,
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_PREFIX);
    await config.update(key, value, target);
  }

  /**
   * 获取存储路径（解析变量）
   */
  getStoragePath(): string {
    const rawPath = this.get<string>('storagePath', '~/.otter');
    const resolved = this.resolvePathVariables(rawPath);

    // 若使用默认路径且新目录不存在，但旧目录存在，则回退旧目录，减小升级成本
    if (rawPath === '~/.otter') {
      const legacyPath = this.resolvePathVariables('~/.prompt-hub');
      if (!fs.existsSync(resolved) && fs.existsSync(legacyPath)) {
        return legacyPath;
      }
    }

    return resolved;
  }

  /**
   * 解析路径变量
   * 支持: ~, ${workspaceFolder}, ${env:VAR}
   */
  private resolvePathVariables(inputPath: string): string {
    let resolved = inputPath;

    // 替换 ~ 为用户主目录
    if (resolved.startsWith('~')) {
      resolved = resolved.replace('~', os.homedir());
    }

    // 替换 ${workspaceFolder}
    if (resolved.includes('${workspaceFolder}')) {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (workspaceFolder) {
        resolved = resolved.replace(/\$\{workspaceFolder\}/g, workspaceFolder);
      }
    }

    // 替换环境变量 ${env:VAR} 或 $VAR
    resolved = resolved.replace(/\$\{env:(\w+)\}/g, (_, varName) => {
      return process.env[varName] || '';
    });

    // 替换 $VAR 格式的环境变量
    resolved = resolved.replace(/\$(\w+)/g, (_, varName) => {
      return process.env[varName] || '';
    });

    // 替换 %VAR% 格式的环境变量（Windows）
    if (process.platform === 'win32') {
      resolved = resolved.replace(/%(\w+)%/g, (_, varName) => {
        return process.env[varName] || '';
      });
    }

    return path.normalize(resolved);
  }

  /**
   * 监听配置变更
   */
  onDidChange(callback: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration(this.CONFIG_PREFIX) ||
        e.affectsConfiguration(this.LEGACY_CONFIG_PREFIX)
      ) {
        callback(e);
      }
    });
  }

  /**
   * 存储密钥到 SecretStorage
   */
  async storeSecret(key: string, value: string): Promise<void> {
    await this.context.secrets.store(`${this.CONFIG_PREFIX}.${key}`, value);
  }

  /**
   * 从 SecretStorage 读取密钥
   */
  async getSecret(key: string): Promise<string | undefined> {
    const value = await this.context.secrets.get(`${this.CONFIG_PREFIX}.${key}`);
    if (value !== undefined) return value;
    // 兼容旧版密钥命名
    return await this.context.secrets.get(`${this.LEGACY_CONFIG_PREFIX}.${key}`);
  }

  /**
   * 删除 SecretStorage 中的密钥
   */
  async deleteSecret(key: string): Promise<void> {
    await this.context.secrets.delete(`${this.CONFIG_PREFIX}.${key}`);
    await this.context.secrets.delete(`${this.LEGACY_CONFIG_PREFIX}.${key}`);
  }

  /**
   * 快速打开设置页面
   */
  openSettings(): void {
    vscode.commands.executeCommand(
      'workbench.action.openSettings',
      `@ext:${this.context.extension.id}`
    );
  }

  private hasValue<T>(config: vscode.WorkspaceConfiguration, key: string): boolean {
    const inspected = config.inspect<T>(key);
    if (!inspected) return false;
    return (
      inspected.globalValue !== undefined ||
      inspected.workspaceValue !== undefined ||
      inspected.workspaceFolderValue !== undefined
    );
  }
}
