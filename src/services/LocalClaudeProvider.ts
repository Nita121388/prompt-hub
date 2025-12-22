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
 * 本地 Claude Code 提供商
 * 调用本地安装的 Claude Code CLI 进行 AI 操作
 */
export class LocalClaudeProvider {
  constructor(private readonly config: ConfigurationService) {}

  /**
   * 使用本地 Claude Code 生成元信息（标题和 emoji）
   */
  async generateMeta(content: string): Promise<GeneratedMeta> {
    try {
      const claudePath = await this.getClaudePath();
      if (!claudePath) {
        throw new Error('未找到 Claude Code CLI，请在设置中配置路径');
      }

      const prompt = `根据以下内容生成简短标题和一个合适的 emoji，返回 JSON 格式：{"name":"标题","emoji":"emoji"}。只返回 JSON，不要其他内容。\n\n${content.substring(0, 2000)}`;

      // 调用 Claude Code CLI（最简单的方式）
      const command = `"${claudePath}" "${this.escapeArg(prompt)}"`;
      console.log('[LocalClaudeProvider] 执行命令:', command);

      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000,
        maxBuffer: 1024 * 1024
      });

      if (stderr) {
        console.warn('[LocalClaudeProvider] stderr:', stderr);
      }

      console.log('[LocalClaudeProvider] stdout:', stdout);

      // 解析响应 - 查找 JSON
      const jsonMatch = stdout.match(/\{[^}]*"name"[^}]*"emoji"[^}]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return { name: parsed.name, emoji: parsed.emoji };
      }

      throw new Error('无法从 Claude Code 响应中解析 JSON');
    } catch (error) {
      console.error('[LocalClaudeProvider] 生成元信息失败:', error);
      throw error;
    }
  }

  /**
   * 使用本地 Claude Code 优化内容
   */
  async optimize(content: string): Promise<string> {
    try {
      const claudePath = await this.getClaudePath();
      if (!claudePath) {
        throw new Error('未找到 Claude Code CLI');
      }

      const prompt = `请优化以下 Prompt 文本，使其更清晰简洁，保持中文 Markdown 格式。只返回优化后的文本，不要其他说明。\n\n${content}`;

      const command = `"${claudePath}" "${this.escapeArg(prompt)}"`;
      console.log('[LocalClaudeProvider] 执行优化命令');

      const { stdout } = await execAsync(command, {
        timeout: 60000,
        maxBuffer: 2 * 1024 * 1024
      });

      return stdout.trim() || content;
    } catch (error) {
      console.error('[LocalClaudeProvider] 优化失败:', error);
      throw error;
    }
  }

  /**
   * 获取 Claude Code CLI 路径
   * 优先级：配置 > 自动检测
   */
  private async getClaudePath(): Promise<string | null> {
    // 1. 从配置读取
    const configured = this.config.get<string>('local.claudePath');
    if (configured) {
      const resolved = this.resolvePath(configured);
      if (await this.fileExists(resolved)) {
        return resolved;
      }
    }

    // 2. 自动检测常见路径
    const detectedPath = await this.detectClaudePath();
    if (detectedPath) {
      return detectedPath;
    }

    return null;
  }

  /**
   * 自动检测 Claude Code CLI 路径
   */
  private async detectClaudePath(): Promise<string | null> {
    const possiblePaths = [
      // Windows 常见路径
      path.join(os.homedir(), '.claude', 'claude.exe'),
      path.join(os.homedir(), '.claude', 'bin', 'claude.exe'),
      'C:\\Program Files\\Claude Code\\claude.exe',
      'C:\\Program Files (x86)\\Claude Code\\claude.exe',

      // macOS/Linux 常见路径
      path.join(os.homedir(), '.claude', 'claude'),
      path.join(os.homedir(), '.claude', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/opt/claude/claude',
    ];

    for (const p of possiblePaths) {
      if (await this.fileExists(p)) {
        console.log('[LocalClaudeProvider] 检测到 Claude:', p);
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
