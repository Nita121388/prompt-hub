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

  private formatCommand(bin: string, args: string): string {
    const trimmed = (bin || '').trim();
    const needsQuote = /[\s"]/g.test(trimmed);
    const escapedBin = trimmed.replace(/"/g, '""');
    const binPart = needsQuote ? `"${escapedBin}"` : escapedBin;
    return `${binPart} ${args}`.trim();
  }

  /**
   * 使用本地 Codex 生成元信息（标题和 emoji）
   */
  async generateMeta(content: string): Promise<GeneratedMeta> {
    const LOG_PREFIX = '[LocalCodexProvider] generateMeta';
    try {
      console.log(`${LOG_PREFIX} 开始执行`);
      const contentLen = content.length;
      console.log(`${LOG_PREFIX} 输入内容长度: ${contentLen} 字节`);

      const codexPath = await this.getCodexPath();
      if (!codexPath) {
        const err = '未找到 Codex CLI，请在设置中配置 promptHub.local.codexPath，或设置环境变量 CODEX_BIN，或确保 PATH 中可直接执行 codex';
        console.error(`${LOG_PREFIX} ${err}`);
        throw new Error(err);
      }
      console.log(`${LOG_PREFIX} 检测到 Codex 路径:`, codexPath);

      // 注意：Codex CLI 的可用模型与账号/提供商相关（例如 ChatGPT 账号不一定支持 Claude 模型）
      // 留空时交由 Codex CLI 使用其默认模型（更稳妥）
      const model = this.config.get<string>('local.codexModel', '').trim();
      console.log(`${LOG_PREFIX} 模型配置:`, model || '(默认模型)');

      const prompt = `请分析以下 Prompt 内容，生成一个简短的中文标题（5-10个字）和一个最能代表该内容的 emoji。

要求：
1. 标题要准确概括内容的核心主题
2. emoji 要与内容主题相关
3. 只返回 JSON 格式，不要任何其他文字说明
4. JSON 格式示例：{"name":"你生成的标题","emoji":"🎯"}

以下是要分析的内容：
${content.substring(0, 2000)}`;
      console.log(`${LOG_PREFIX} 生成 Prompt 长度: ${prompt.length} 字节`);

      // 调用 Codex exec
      const command = this.formatCommand(
        codexPath,
        `exec --skip-git-repo-check --sandbox read-only ${model ? `--model ${model} ` : ''}"${this.escapeArg(prompt)}"`
      );
      console.log(`${LOG_PREFIX} 执行命令 (前500字):`, command.length > 500 ? `${command.slice(0, 500)}... (len=${command.length})` : command);

      const startedAt = Date.now();
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000,
        maxBuffer: 1024 * 1024
      });
      const elapsed = Date.now() - startedAt;
      console.log(`${LOG_PREFIX} 执行完成, 耗时: ${elapsed}ms`);

      if (stderr) {
        console.warn(`${LOG_PREFIX} stderr:`, stderr.slice(0, 500));
      }

      console.log(`${LOG_PREFIX} stdout 长度: ${stdout.length} 字节`);
      if (stdout.length <= 500) {
        console.log(`${LOG_PREFIX} stdout 内容:`, stdout);
      } else {
        console.log(`${LOG_PREFIX} stdout 内容 (前500字):`, stdout.slice(0, 500));
        console.log(`${LOG_PREFIX} stdout 完整内容:`, stdout);
      }

      // 解析响应 - 查找 JSON（匹配最后一个，避免匹配到示例）
      const jsonMatches = stdout.match(/\{[^}]*"name"[^}]*"emoji"[^}]*\}/g);
      if (jsonMatches && jsonMatches.length > 0) {
        // 取最后一个匹配（通常是实际的生成结果，而不是示例）
        const lastMatch = jsonMatches[jsonMatches.length - 1];
        console.log(`${LOG_PREFIX} 找到 ${jsonMatches.length} 个 JSON，使用最后一个:`, lastMatch);
        const parsed = JSON.parse(lastMatch);
        console.log(`${LOG_PREFIX} 解析结果:`, parsed);
        return { name: parsed.name, emoji: parsed.emoji };
      }

      console.error(`${LOG_PREFIX} 未能从响应中匹配 JSON 格式`);
      throw new Error('无法从 Codex 响应中解析 JSON');
    } catch (error) {
      const e: any = error;
      console.error(`${LOG_PREFIX} 失败:`, {
        message: e?.message || String(error),
        code: e?.code,
        signal: e?.signal,
        killed: e?.killed,
      });
      throw error;
    }
  }

  /**
   * 使用本地 Codex 优化内容
   */
  async optimize(content: string): Promise<string> {
    const LOG_PREFIX = '[LocalCodexProvider] optimize';
    try {
      console.log(`${LOG_PREFIX} 开始执行`);
      console.log(`${LOG_PREFIX} 输入内容长度: ${content.length} 字节`);

      const codexPath = await this.getCodexPath();
      if (!codexPath) {
        const err = '未找到 Codex CLI';
        console.error(`${LOG_PREFIX} ${err}`);
        throw new Error(err);
      }
      console.log(`${LOG_PREFIX} 检测到 Codex 路径:`, codexPath);

      const model = this.config.get<string>('local.codexModel', '').trim();
      console.log(`${LOG_PREFIX} 模型配置:`, model || '(默认模型)');

      const prompt = `请优化以下 Prompt 文本，使其更清晰简洁，保持中文 Markdown 格式。只返回优化后的文本，不要其他说明。\n\n${content}`;
      console.log(`${LOG_PREFIX} 生成 Prompt 长度: ${prompt.length} 字节`);

      const command = this.formatCommand(
        codexPath,
        `exec --skip-git-repo-check --sandbox read-only ${model ? `--model ${model} ` : ''}"${this.escapeArg(prompt)}"`
      );
      console.log(`${LOG_PREFIX} 执行命令 (前500字):`, command.length > 500 ? `${command.slice(0, 500)}... (len=${command.length})` : command);

      const startedAt = Date.now();
      const { stdout, stderr } = await execAsync(command, {
        timeout: 60000,
        maxBuffer: 2 * 1024 * 1024
      });
      const elapsed = Date.now() - startedAt;
      console.log(`${LOG_PREFIX} 执行完成, 耗时: ${elapsed}ms`);

      if (stderr) {
        console.warn(`${LOG_PREFIX} stderr:`, stderr.slice(0, 500));
      }

      console.log(`${LOG_PREFIX} stdout 长度: ${stdout.length} 字节`);
      const result = stdout.trim() || content;
      console.log(`${LOG_PREFIX} 返回结果长度: ${result.length} 字节`);

      return result;
    } catch (error) {
      const e: any = error;
      console.error(`${LOG_PREFIX} 失败:`, {
        message: e?.message || String(error),
        code: e?.code,
        signal: e?.signal,
        killed: e?.killed,
      });
      throw error;
    }
  }

  /**
   * 获取 Codex CLI 路径
   * 优先级：配置 > 环境变量 > 自动检测
   */
  private async getCodexPath(): Promise<string | null> {
    const LOG_PREFIX = '[LocalCodexProvider] getCodexPath';
    console.log(`${LOG_PREFIX} 开始检测 Codex CLI 路径`);

    // 1. 从配置读取
    const configured = this.config.get<string>('local.codexPath');
    if (configured) {
      const resolved = this.resolvePath(configured);
      const ok = await this.fileExists(resolved);
      console.log(`${LOG_PREFIX} 配置 local.codexPath:`, configured, '=>', resolved, 'exists=', ok);
      if (ok) {
        return resolved;
      }
    } else {
      console.log(`${LOG_PREFIX} 配置 local.codexPath 为空，跳过配置路径检测`);
    }

    // 2. 从环境变量读取
    const envCodexBin = (process.env.CODEX_BIN || '').trim();
    if (envCodexBin) {
      const resolved = this.resolvePath(envCodexBin);
      const ok = await this.fileExists(resolved);
      console.log(`${LOG_PREFIX} 环境变量 CODEX_BIN:`, envCodexBin, '=>', resolved, 'exists=', ok);
      if (ok) {
        return resolved;
      }
    } else {
      console.log(`${LOG_PREFIX} 环境变量 CODEX_BIN 未设置，跳过`);
    }

    // 3. 自动检测：优先从 PATH 中找（对齐 aicliDemo 的行为）
    const fromPath = await this.detectCodexFromPath();
    if (fromPath) {
      console.log(`${LOG_PREFIX} 从 PATH 检测到 Codex CLI:`, fromPath);
      return fromPath;
    }

    // 4. 自动检测常见路径
    const detectedPath = await this.detectCodexPath();
    if (detectedPath) {
      return detectedPath;
    }

    console.warn(`${LOG_PREFIX} 未找到 Codex CLI：已尝试 配置/local.codexPath、环境变量 CODEX_BIN、PATH(where/which)、常见目录`);
    return null;
  }

  /**
   * 从 PATH 中检测 codex（Windows: where；macOS/Linux: which）
   */
  private async detectCodexFromPath(): Promise<string | null> {
    const LOG_PREFIX = '[LocalCodexProvider] detectCodexFromPath';
    try {
      if (process.platform === 'win32') {
        console.log(`${LOG_PREFIX} Windows 平台，使用 where 命令`);
        return (
          await this.detectFromWhere('codex.exe') ||
          await this.detectFromWhere('codex.cmd') ||
          await this.detectFromWhere('codex.bat') ||
          await this.detectFromWhere('codex')
        );
      }

      console.log(`${LOG_PREFIX} Unix/macOS 平台，使用 which 命令`);
      const { stdout } = await execAsync('which codex', { timeout: 5000 });
      const first = (stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first) {
        const ok = await this.fileExists(first);
        console.log(`${LOG_PREFIX} which codex =>`, first, 'exists=', ok);
        if (ok) return first;
      }
      return null;
    } catch (error) {
      console.log(`${LOG_PREFIX} PATH 检测失败（可忽略）:`, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  private async detectFromWhere(name: string): Promise<string | null> {
    const LOG_PREFIX = '[LocalCodexProvider] detectFromWhere';
    try {
      const { stdout } = await execAsync(`where ${name}`, { timeout: 5000 });
      const lines = (stdout || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

      console.log(`${LOG_PREFIX} where ${name} 找到 ${lines.length} 条结果`);
      if (!lines.length) {
        console.log(`${LOG_PREFIX} where ${name} 无结果`);
        return null;
      }

      for (const p of lines) {
        const resolved = this.resolvePath(p);
        const ok = await this.fileExists(resolved);
        console.log(`${LOG_PREFIX} where ${name} =>`, resolved, 'exists=', ok);
        if (ok) return resolved;
      }

      return null;
    } catch (error) {
      console.log(`${LOG_PREFIX} where ${name} 执行失败（可忽略）:`, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * 自动检测 Codex CLI 路径
   */
  private async detectCodexPath(): Promise<string | null> {
    const LOG_PREFIX = '[LocalCodexProvider] detectCodexPath';
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

    console.log(`${LOG_PREFIX} 开始遍历 ${possiblePaths.length} 个常见路径`);
    for (const p of possiblePaths) {
      const ok = await this.fileExists(p);
      console.log(`${LOG_PREFIX} 常见路径探测:`, p, 'exists=', ok);
      if (ok) {
        console.log(`${LOG_PREFIX} 检测到 Codex:`, p);
        return p;
      }
    }

    console.log(`${LOG_PREFIX} 在常见路径中未找到 Codex`);
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
      // Windows 下 X_OK 行为不稳定；这里仅做“存在性”校验
      await fsPromises.access(filePath, fs.constants.F_OK);
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
