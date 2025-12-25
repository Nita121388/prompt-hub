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

  private formatCommand(bin: string, args: string): string {
    const trimmed = (bin || '').trim();
    const needsQuote = /[\s"]/g.test(trimmed);
    const escapedBin = trimmed.replace(/"/g, '""');
    const binPart = needsQuote ? `"${escapedBin}"` : escapedBin;
    return `${binPart} ${args}`.trim();
  }

  /**
   * 使用本地 Claude Code 生成元信息（标题和 emoji）
   */
  async generateMeta(content: string): Promise<GeneratedMeta> {
    const timeoutMs = this.config.get<number>('local.claudeTimeoutMs', 120000);
    try {
      const claudePath = await this.getClaudePath();
      if (!claudePath) {
        throw new Error(
          '未找到 Claude Code CLI，请在设置中配置 promptHub.local.claudePath，或设置环境变量 CLAUDE_BIN，或确保 PATH 中可直接执行 claude'
        );
      }

      const prompt = `请分析以下 Prompt 内容，生成一个简短的中文标题（5-10个字）和一个最能代表该内容的 emoji。

要求：
1. 标题要准确概括内容的核心主题
2. emoji 要与内容主题相关
3. 只返回 JSON 格式，不要任何其他文字说明
4. JSON 格式示例：{"name":"你生成的标题","emoji":"🎯"}

以下是要分析的内容：
${content.substring(0, 2000)}`;

      // 调用 Claude Code CLI（最简单的方式）
      // 使用 -p/--print 避免进入交互模式，并跳过工作区信任对话框
      const command = this.formatCommand(
        claudePath,
        `-p --output-format text "${this.escapeArg(prompt)}"`
      );
      console.log('[LocalClaudeProvider] 执行命令:', command.length > 500 ? `${command.slice(0, 500)}... (len=${command.length})` : command);
      console.log('[LocalClaudeProvider] 超时设置:', timeoutMs, 'ms');

      const startedAt = Date.now();
      const { stdout, stderr } = await execAsync(command, {
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024
      });
      console.log('[LocalClaudeProvider] 执行耗时:', Date.now() - startedAt, 'ms');

      if (stderr) {
        console.warn('[LocalClaudeProvider] stderr:', stderr);
      }

      console.log('[LocalClaudeProvider] stdout:', stdout);

      // 解析响应 - 查找 JSON（匹配最后一个，避免匹配到示例）
      const jsonMatches = stdout.match(/\{[^}]*"name"[^}]*"emoji"[^}]*\}/g);
      if (jsonMatches && jsonMatches.length > 0) {
        // 取最后一个匹配（通常是实际的生成结果，而不是示例）
        const lastMatch = jsonMatches[jsonMatches.length - 1];
        console.log(`[LocalClaudeProvider] 找到 ${jsonMatches.length} 个 JSON，使用最后一个:`, lastMatch);
        const parsed = JSON.parse(lastMatch);
        return { name: parsed.name, emoji: parsed.emoji };
      }

      throw new Error('无法从 Claude Code 响应中解析 JSON');
    } catch (error) {
      const e: any = error;
      const stderr = typeof e?.stderr === 'string' ? e.stderr : '';
      const stdout = typeof e?.stdout === 'string' ? e.stdout : '';
      console.error('[LocalClaudeProvider] 生成元信息失败:', {
        message: e?.message || String(error),
        code: e?.code,
        signal: e?.signal,
        killed: e?.killed,
        stdoutPreview: stdout ? stdout.slice(0, 800) : '',
        stderrPreview: stderr ? stderr.slice(0, 800) : '',
      });

      if (e?.killed && e?.signal === 'SIGTERM') {
        throw new Error(
          `Claude CLI 执行超时（${timeoutMs}ms）被终止：可能是首次登录/授权需要交互，或网络较慢。建议先在终端手动运行 claude -p \"你好\" 完成登录；也可在设置中提高 promptHub.local.claudeTimeoutMs。`
        );
      }

      // Check for Git Bash dependency on Windows
      if (process.platform === 'win32' && stderr.includes('requires git-bash')) {
        await this.handleGitBashMissing();
      }

      throw error;
    }
  }

  /**
   * 使用本地 Claude Code 优化内容
   */
  async optimize(content: string): Promise<string> {
    const timeoutMs = this.config.get<number>('local.claudeTimeoutMs', 120000);
    try {
      const claudePath = await this.getClaudePath();
      if (!claudePath) {
        throw new Error(
          '未找到 Claude Code CLI，请在设置中配置 promptHub.local.claudePath，或设置环境变量 CLAUDE_BIN，或确保 PATH 中可直接执行 claude'
        );
      }

      const prompt = `请优化以下 Prompt 文本，使其更清晰简洁，保持中文 Markdown 格式。只返回优化后的文本，不要其他说明。\n\n${content}`;

      const command = this.formatCommand(
        claudePath,
        `-p --output-format text "${this.escapeArg(prompt)}"`
      );
      console.log('[LocalClaudeProvider] 执行优化命令');
      console.log('[LocalClaudeProvider] 超时设置:', timeoutMs, 'ms');

      const startedAt = Date.now();
      const { stdout } = await execAsync(command, {
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024
      });
      console.log('[LocalClaudeProvider] 执行耗时:', Date.now() - startedAt, 'ms');

      return stdout.trim() || content;
    } catch (error) {
      const e: any = error;
      const stderr = typeof e?.stderr === 'string' ? e.stderr : '';
      const stdout = typeof e?.stdout === 'string' ? e.stdout : '';
      console.error('[LocalClaudeProvider] 优化失败:', {
        message: e?.message || String(error),
        code: e?.code,
        signal: e?.signal,
        killed: e?.killed,
        stdoutPreview: stdout ? stdout.slice(0, 800) : '',
        stderrPreview: stderr ? stderr.slice(0, 800) : '',
      });

      if (e?.killed && e?.signal === 'SIGTERM') {
        throw new Error(
          `Claude CLI 执行超时（${timeoutMs}ms）被终止：可能是首次登录/授权需要交互，或网络较慢。建议先在终端手动运行 claude -p \"你好\" 完成登录；也可在设置中提高 promptHub.local.claudeTimeoutMs。`
        );
      }

      // Check for Git Bash dependency on Windows
      if (process.platform === 'win32' && stderr.includes('requires git-bash')) {
        await this.handleGitBashMissing();
      }

      throw error;
    }
  }

  /**
   * 获取 Claude Code CLI 路径
   * 优先级：配置 > 环境变量 > PATH > 常见目录
   */
  private async getClaudePath(): Promise<string | null> {
    console.log('[LocalClaudeProvider] getClaudePath() 开始检测 Claude CLI 路径');
    // 1. 从配置读取
    const configured = this.config.get<string>('local.claudePath');
    if (configured) {
      const resolved = this.resolvePath(configured);
      const ok = await this.fileExists(resolved);
      console.log('[LocalClaudeProvider] 配置 local.claudePath:', configured, '=>', resolved, 'exists=', ok);
      if (ok) {
        return resolved;
      }
    } else {
      console.log('[LocalClaudeProvider] 配置 local.claudePath 为空，跳过配置路径检测');
    }

    // 2. 从环境变量读取
    const envClaudeBin = (process.env.CLAUDE_BIN || process.env.CLAUDE_PATH || '').trim();
    if (envClaudeBin) {
      const resolved = this.resolvePath(envClaudeBin);
      const ok = await this.fileExists(resolved);
      console.log('[LocalClaudeProvider] 环境变量 CLAUDE_BIN/CLAUDE_PATH:', envClaudeBin, '=>', resolved, 'exists=', ok);
      if (ok) {
        return resolved;
      }
    } else {
      console.log('[LocalClaudeProvider] 环境变量 CLAUDE_BIN/CLAUDE_PATH 未设置，跳过');
    }

    // 3. 从 VSCode 扩展目录检测（Claude Code 扩展通常内置 claude.exe）
    const fromExtensions = await this.detectClaudeFromVSCodeExtensions();
    if (fromExtensions) {
      console.log('[LocalClaudeProvider] 从 VSCode 扩展目录检测到 Claude CLI:', fromExtensions);
      return fromExtensions;
    }

    // 4. 自动检测：从 PATH 中找（Windows: where；macOS/Linux: which）
    const fromPath = await this.detectClaudeFromPath();
    if (fromPath) {
      console.log('[LocalClaudeProvider] 从 PATH 检测到 Claude CLI:', fromPath);
      return fromPath;
    }

    // 5. 自动检测常见路径
    const detectedPath = await this.detectClaudePath();
    if (detectedPath) {
      return detectedPath;
    }

    console.warn('[LocalClaudeProvider] 未找到 Claude CLI：已尝试 配置/local.claudePath、环境变量 CLAUDE_BIN、PATH(where/which)、VSCode 扩展目录、常见目录');
    return null;
  }

  /**
   * 从 VSCode 扩展目录检测 claude（二进制通常在 anthropic.claude-code 扩展内置）
   */
  private async detectClaudeFromVSCodeExtensions(): Promise<string | null> {
    try {
      const extensionsRoot = path.join(os.homedir(), '.vscode', 'extensions');
      const entries = await fsPromises.readdir(extensionsRoot, { withFileTypes: true });

      const candidateDirs = entries
        .filter((e) => e.isDirectory() && e.name.startsWith('anthropic.claude-code-'))
        .map((e) => path.join(extensionsRoot, e.name));

      if (!candidateDirs.length) {
        console.log('[LocalClaudeProvider] VSCode 扩展目录未发现 anthropic.claude-code-*');
        return null;
      }

      const candidates: Array<{ file: string; mtimeMs: number }> = [];
      for (const dir of candidateDirs) {
        const file = process.platform === 'win32'
          ? path.join(dir, 'resources', 'native-binary', 'claude.exe')
          : path.join(dir, 'resources', 'native-binary', 'claude');

        const ok = await this.fileExists(file);
        console.log('[LocalClaudeProvider] 扩展内置 CLI 探测:', file, 'exists=', ok);
        if (!ok) continue;

        try {
          const stat = await fsPromises.stat(file);
          candidates.push({ file, mtimeMs: stat.mtimeMs });
        } catch {
          candidates.push({ file, mtimeMs: 0 });
        }
      }

      if (!candidates.length) return null;

      candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return candidates[0].file;
    } catch (error) {
      console.log('[LocalClaudeProvider] VSCode 扩展目录探测失败（可忽略）:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * 从 PATH 中检测 claude（Windows: where；macOS/Linux: which）
   */
  private async detectClaudeFromPath(): Promise<string | null> {
    try {
      if (process.platform === 'win32') {
        return (
          await this.detectFromWhere('claude.exe') ||
          await this.detectFromWhere('claude.cmd') ||
          await this.detectFromWhere('claude.bat') ||
          await this.detectFromWhere('claude')
        );
      }

      const { stdout } = await execAsync('which claude', { timeout: 5000 });
      const first = (stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first) {
        const ok = await this.fileExists(first);
        console.log('[LocalClaudeProvider] which claude =>', first, 'exists=', ok);
        if (ok) return first;
      }
      return null;
    } catch (error) {
      console.log('[LocalClaudeProvider] PATH 检测失败（可忽略）:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  private async detectFromWhere(name: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`where ${name}`, { timeout: 5000 });
      const lines = (stdout || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (!lines.length) return null;

      for (const p of lines) {
        const resolved = this.resolvePath(p);
        const ok = await this.fileExists(resolved);
        console.log('[LocalClaudeProvider] where', name, '=>', resolved, 'exists=', ok);
        if (ok) return resolved;
      }

      return null;
    } catch {
      return null;
    }
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
      const ok = await this.fileExists(p);
      console.log('[LocalClaudeProvider] 常见路径探测:', p, 'exists=', ok);
      if (ok) {
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

    for (const gitBashPath of possiblePaths) {
      const ok = await this.fileExists(gitBashPath);
      console.log('[LocalClaudeProvider] 检测 Git Bash:', gitBashPath, 'exists=', ok);
      if (ok) {
        return gitBashPath;
      }
    }

    // Try to detect from PATH via 'where bash.exe'
    try {
      const { stdout } = await execAsync('where bash.exe', { timeout: 5000 });
      const first = (stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first && await this.fileExists(first)) {
        console.log('[LocalClaudeProvider] 从 PATH 检测到 Git Bash:', first);
        return first;
      }
    } catch {
      // Ignore errors
    }

    return null;
  }

  /**
   * 处理 Git Bash 缺失的情况（引导用户安装或配置）
   */
  private async handleGitBashMissing(): Promise<void> {
    console.log('[LocalClaudeProvider] 处理 Git Bash 缺失问题');

    // 尝试自动检测
    const detectedPath = await this.detectGitBash();
    if (detectedPath) {
      const message = `检测到 Git Bash 已安装在：\n${detectedPath}\n\n但 Claude Code 无法使用。您可以设置环境变量 CLAUDE_CODE_GIT_BASH_PATH 指向此路径。`;
      const action = await vscode.window.showInformationMessage(
        message,
        { modal: true },
        '复制路径',
        '查看文档'
      );

      if (action === '复制路径') {
        await vscode.env.clipboard.writeText(detectedPath);
        vscode.window.showInformationMessage('Git Bash 路径已复制到剪贴板');
      } else if (action === '查看文档') {
        vscode.env.openExternal(vscode.Uri.parse('https://gitforwindows.org/'));
      }
      return;
    }

    // 未检测到，引导用户下载安装
    const message = `Claude Code 在 Windows 上需要 Git Bash 才能运行。\n\n请选择以下操作：\n1. 下载并安装 Git for Windows（推荐）\n2. 如已安装，手动配置环境变量 CLAUDE_CODE_GIT_BASH_PATH`;
    const action = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      '下载 Git for Windows',
      '查看配置说明'
    );

    if (action === '下载 Git for Windows') {
      vscode.env.openExternal(vscode.Uri.parse('https://gitforwindows.org/'));
    } else if (action === '查看配置说明') {
      const configMessage = `请按以下步骤配置：\n\n1. 找到 Git Bash 安装路径（通常是 C:\\Program Files\\Git\\bin\\bash.exe）\n2. 在系统环境变量中添加：\n   变量名：CLAUDE_CODE_GIT_BASH_PATH\n   变量值：Git Bash 的完整路径\n3. 重启 VSCode\n\n常见路径：\n- C:\\Program Files\\Git\\bin\\bash.exe\n- C:\\Program Files (x86)\\Git\\bin\\bash.exe`;
      vscode.window.showInformationMessage(configMessage, { modal: true });
    }
  }
}
