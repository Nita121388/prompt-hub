import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { ConfigurationService } from './ConfigurationService';
import { GeneratedMeta } from './AIService';

const execAsync = promisify(exec);
const fsPromises = fs.promises;

/**
 * 本地 Codex 提供商
 * 调用本地安装的 Codex CLI 进行 AI 操作
 */
export class LocalCodexProvider {
  constructor(private readonly config: ConfigurationService) {}

  /**
   * 使用本地 Codex 生成元信息（标题和 emoji）
   */
  async generateMeta(content: string): Promise<GeneratedMeta> {
    try {
      const codexPath = await this.getCodexPath();
      if (!codexPath) {
        throw new Error('未找到 Codex CLI，请在设置中配置路径');
      }

      const model = this.config.get<string>('local.codexModel', 'claude-sonnet-4.5');
      const prompt = `根据以下内容生成简短标题和一个合适的 emoji，返回 JSON 格式：{"name":"标题","emoji":"emoji"}。只返回 JSON，不要其他内容。\n\n${content.substring(0, 2000)}`;

      // 调用 Codex exec（最简单的方式）
      const command = `"${codexPath}" exec --model ${model} "${this.escapeArg(prompt)}"`;
      console.log('[LocalCodexProvider] 执行命令:', command);

      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000,
        maxBuffer: 1024 * 1024
      });

      if (stderr) {
        console.warn('[LocalCodexProvider] stderr:', stderr);
      }

      console.log('[LocalCodexProvider] stdout:', stdout);

      // 解析响应 - 查找 JSON
      const jsonMatch = stdout.match(/\{[^}]*"name"[^}]*"emoji"[^}]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return { name: parsed.name, emoji: parsed.emoji };
      }

      throw new Error('无法从 Codex 响应中解析 JSON');
    } catch (error) {
      console.error('[LocalCodexProvider] 生成元信息失败:', error);
      throw error;
    }
  }

  /**
   * 使用本地 Codex 优化内容
   */
  async optimize(content: string): Promise<string> {
    try {
      const codexPath = await this.getCodexPath();
      if (!codexPath) {
        throw new Error('未找到 Codex CLI');
      }

      const model = this.config.get<string>('local.codexModel', 'claude-sonnet-4.5');
      const prompt = `请优化以下 Prompt 文本，使其更清晰简洁，保持中文 Markdown 格式。只返回优化后的文本，不要其他说明。\n\n${content}`;

      const command = `"${codexPath}" exec --model ${model} "${this.escapeArg(prompt)}"`;
      console.log('[LocalCodexProvider] 执行优化命令');

      const { stdout } = await execAsync(command, {
        timeout: 60000,
        maxBuffer: 2 * 1024 * 1024
      });

      return stdout.trim() || content;
    } catch (error) {
      console.error('[LocalCodexProvider] 优化失败:', error);
      throw error;
    }
  }

  /**
   * 获取 Codex CLI 路径
   * 优先级：配置 > 环境变量 > 自动检测
   */
  private async getCodexPath(): Promise<string | null> {
    // 1. 从配置读取
    const configured = this.config.get<string>('local.codexPath');
    if (configured) {
      const resolved = this.resolvePath(configured);
      if (await this.fileExists(resolved)) {
        return resolved;
      }
    }

    // 2. 从环境变量读取
    if (process.env.CODEX_BIN) {
      const resolved = this.resolvePath(process.env.CODEX_BIN);
      if (await this.fileExists(resolved)) {
        return resolved;
      }
    }

    // 3. 自动检测常见路径
    const detectedPath = await this.detectCodexPath();
    if (detectedPath) {
      return detectedPath;
    }

    return null;
  }

  /**
   * 自动检测 Codex CLI 路径
   */
  private async detectCodexPath(): Promise<string | null> {
    const possiblePaths = [
      // Windows 常见路径
      path.join(os.homedir(), '.codex', 'codex.exe'),
      path.join(os.homedir(), '.codex', 'bin', 'codex.exe'),
      'C:\\Tools\\codex\\codex.exe',
      'C:\\Program Files\\Codex\\codex.exe',
      'C:\\Program Files (x86)\\Codex\\codex.exe',

      // macOS/Linux 常见路径
      path.join(os.homedir(), '.codex', 'codex'),
      path.join(os.homedir(), '.codex', 'bin', 'codex'),
      '/usr/local/bin/codex',
      '/opt/codex/codex',
    ];

    for (const p of possiblePaths) {
      if (await this.fileExists(p)) {
        console.log('[LocalCodexProvider] 检测到 Codex:', p);
        return p;
      }
    }

    return null;
  }

  /**
   * 解析路径（支持 ~ 等变量）
   */
  private resolvePath(inputPath: string): string {
    let resolved = inputPath;
    if (resolved.startsWith('~')) {
      resolved = path.join(os.homedir(), resolved.slice(1));
    }
    return path.normalize(resolved);
  }

  /**
   * 检查文件是否存在
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fsPromises.access(filePath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 转义命令行参数（Windows/Unix 兼容）
   */
  private escapeArg(arg: string): string {
    if (process.platform === 'win32') {
      // Windows: 转义双引号
      return arg.replace(/"/g, '""').replace(/\n/g, ' ');
    } else {
      // Unix: 转义特殊字符
      return arg.replace(/'/g, "'\\''").replace(/\n/g, ' ');
    }
  }
}
