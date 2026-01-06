import * as vscode from 'vscode';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { ConfigurationService } from './ConfigurationService';
import type { BatchMetaRequestItem, BatchMetaResultItem, GeneratedMeta } from './AIService';
import { extractJsonArray } from '../utils/JsonExtract';
import { logger } from './Logger';

const execAsync = promisify(exec);
const fsPromises = fs.promises;

/**
 * 本地 Claude Code 提供商
 * 调用本地安装的 Claude Code CLI 进行 AI 操作
 */
export class LocalClaudeProvider {
  private cachedClaudePath: string | null | undefined;

  constructor(private readonly config: ConfigurationService) {}

  private createProcessError(
    message: string,
    details: {
      code: number | null;
      signal: NodeJS.Signals | string | null;
      killed: boolean;
      stdout: string;
      stderr: string;
    }
  ): Error & {
    code?: number | null;
    signal?: NodeJS.Signals | string | null;
    killed?: boolean;
    stdout?: string;
    stderr?: string;
  } {
    const err = new Error(message) as Error & {
      code?: number | null;
      signal?: NodeJS.Signals | string | null;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
    };
    err.code = details.code;
    err.signal = details.signal;
    err.killed = details.killed;
    err.stdout = details.stdout;
    err.stderr = details.stderr;
    return err;
  }

  private async runClaudeCli(
    claudePath: string,
    args: string[],
    timeoutMs: number,
    maxBufferBytes = 2 * 1024 * 1024
  ): Promise<{ stdout: string; stderr: string }> {
    const startedAt = Date.now();
    const commandForLog = this.formatCommand(claudePath, args);
    logger.debug('[LocalClaudeProvider] runClaudeCli() spawn', commandForLog);
    logger.debug('[LocalClaudeProvider] runClaudeCli() stdio: [ignore, pipe, pipe]');
    logger.debug('[LocalClaudeProvider] runClaudeCli() parent isTTY', {
      stdin: process.stdin.isTTY,
      stdout: process.stdout.isTTY,
      stderr: process.stderr.isTTY,
    });

    return await new Promise((resolve, reject) => {
      const child = spawn(claudePath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let collectedBytes = 0;
      let timedOut = false;
      let maxBufferExceeded = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      const onBuffer = (kind: 'stdout' | 'stderr', chunk: Buffer) => {
        collectedBytes += chunk.length;
        const text = chunk.toString('utf8');
        if (kind === 'stdout') stdout += text;
        else stderr += text;

        if (collectedBytes > maxBufferBytes && !maxBufferExceeded) {
          maxBufferExceeded = true;
          child.kill('SIGTERM');
        }
      };

      child.stdout?.on('data', (d) => onBuffer('stdout', d));
      child.stderr?.on('data', (d) => onBuffer('stderr', d));

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);

        const elapsed = Date.now() - startedAt;
        logger.debug('[LocalClaudeProvider] runClaudeCli() exited', { code, signal, elapsedMs: elapsed });

        if (maxBufferExceeded) {
          reject(
            this.createProcessError(
              `Claude CLI 输出过大（>${maxBufferBytes} bytes）已终止，请缩短 Prompt 或提高 maxBuffer 配置。`,
              {
                code: code ?? null,
                signal: signal ?? null,
                killed: true,
                stdout,
                stderr,
              }
            )
          );
          return;
        }

        if (timedOut) {
          reject(
            this.createProcessError(
              `Claude CLI 执行超时（${timeoutMs}ms）被终止：可能是首次登录/授权需要交互、网络较慢或 Claude 进程卡住。补充：Claude 在检测到 stdin 为 pipe 时可能会等待 EOF（Node 默认会保持 stdin 打开）导致“假死”；本插件已使用 stdin=ignore 规避该问题。`,
              {
                code: code ?? null,
                signal: signal ?? 'SIGTERM',
                killed: true,
                stdout,
                stderr,
              }
            )
          );
          return;
        }

        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }

        reject(
          this.createProcessError(`Command failed: ${commandForLog}`, {
            code: code ?? null,
            signal: signal ?? null,
            killed: false,
            stdout,
            stderr,
          })
        );
      });
    });
  }

  private formatCommand(bin: string, args: string | string[]): string {
    const trimmed = (bin || '').trim();
    const needsQuote = /[\s"]/g.test(trimmed);
    const escapedBin = trimmed.replace(/"/g, '""');
    const binPart = needsQuote ? `"${escapedBin}"` : escapedBin;
    const argsPart = Array.isArray(args) ? this.formatArgsForLog(args) : args;
    return `${binPart} ${argsPart}`.trim();
  }

  private formatArgsForLog(args: string[]): string {
    return args
      .map((arg, index) => {
        if (index === args.length - 1 && arg.length > 500) {
          return `${JSON.stringify(arg.slice(0, 500))}... (len=${arg.length})`;
        }
        return JSON.stringify(arg);
      })
      .join(' ');
  }

  private normalizePromptArg(arg: string): string {
    return (arg || '').replace(/\r?\n/g, ' ').split('\0').join('');
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
          '未找到 Claude Code CLI，请在设置中配置 otter.local.claudePath，或设置环境变量 CLAUDE_BIN，或确保 PATH 中可直接执行 claude'
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
      const args = ['-p', '--output-format', 'text', this.normalizePromptArg(prompt)];
      const command = this.formatCommand(claudePath, args);
      logger.debug('[LocalClaudeProvider] 执行命令长度', { chars: command.length });
      logger.debug('[LocalClaudeProvider] 超时设置', { timeoutMs });

      const startedAt = Date.now();
      const { stdout, stderr } = await this.runClaudeCli(claudePath, args, timeoutMs);
      logger.debug('[LocalClaudeProvider] 执行耗时', { elapsedMs: Date.now() - startedAt });

      if (stderr) {
        logger.warn('[LocalClaudeProvider] stderr', stderr.slice(0, 500));
      }

      logger.debug('[LocalClaudeProvider] stdout 长度', { bytes: stdout.length });
      logger.debug('[LocalClaudeProvider] stdout 前500字', stdout.slice(0, 500));

      // 解析响应 - 查找 JSON（匹配最后一个，避免匹配到示例）
      const jsonMatches = stdout.match(/\{[^}]*"name"[^}]*"emoji"[^}]*\}/g);
      if (jsonMatches && jsonMatches.length > 0) {
        // 取最后一个匹配（通常是实际的生成结果，而不是示例）
        const lastMatch = jsonMatches[jsonMatches.length - 1];
        logger.debug('[LocalClaudeProvider] 找到 JSON', { count: jsonMatches.length });
        const parsed = JSON.parse(lastMatch);
        return { name: parsed.name, emoji: parsed.emoji };
      }

      throw new Error('无法从 Claude Code 响应中解析 JSON');
    } catch (error) {
      const e = error as {
        message?: string;
        code?: unknown;
        signal?: unknown;
        killed?: unknown;
        stdout?: unknown;
        stderr?: unknown;
      };
      const stderr = typeof e?.stderr === 'string' ? e.stderr : '';
      const stdout = typeof e?.stdout === 'string' ? e.stdout : '';
      logger.error('[LocalClaudeProvider] 生成元信息失败', {
        message: e?.message || String(error),
        code: e?.code,
        signal: e?.signal,
        killed: e?.killed,
      });
      logger.debug('[LocalClaudeProvider] 失败输出预览', {
        stdoutPreview: stdout ? stdout.slice(0, 300) : '',
        stderrPreview: stderr ? stderr.slice(0, 300) : '',
      });

      if (e?.killed && e?.signal === 'SIGTERM') {
        throw new Error(
          `Claude CLI 执行超时（${timeoutMs}ms）被终止：可能是首次登录/授权需要交互，或网络较慢。建议先在终端手动运行 claude -p "你好" 完成登录；也可在设置中提高 otter.local.claudeTimeoutMs。`
        );
      }

      // Check for Git Bash dependency on Windows
      if (process.platform === 'win32' && stderr.includes('requires git-bash')) {
        await this.handleGitBashMissing();
      }

      throw error;
    }
  }

  async generateMetaBatch(items: BatchMetaRequestItem[]): Promise<BatchMetaResultItem[]> {
    const timeoutMs = this.config.get<number>('local.claudeTimeoutMs', 120000);

    const claudePath = await this.getClaudePath();
    if (!claudePath) {
      throw new Error(
        '未找到 Claude Code CLI，请在设置中配置 otter.local.claudePath，或设置环境变量 CLAUDE_BIN，或确保 PATH 中可直接执行 claude'
      );
    }

    const maxChunkSize = this.config.get<number>('ai.batchChunkSize', 10);
    const previewChars = this.config.get<number>('ai.batchItemPreviewChars', 600);
    const maxPromptChars = this.config.get<number>('ai.batchMaxPromptChars', 7000);

    const results = new Map<string, BatchMetaResultItem>();
    const pending = [...items];

    while (pending.length > 0) {
      const chunk: BatchMetaRequestItem[] = [];

      while (chunk.length < maxChunkSize && pending.length > 0) {
        const next = pending[0];
        const candidate = [...chunk, next];
        const prompt = this.buildBatchMetaPrompt(candidate, previewChars);

        if (prompt.length > maxPromptChars && chunk.length > 0) break;

        pending.shift();
        chunk.push(next);

        if (prompt.length > maxPromptChars && chunk.length === 1) break;
      }

      const chunkResults = await this.generateMetaBatchOnce(claudePath, chunk, timeoutMs, previewChars, maxPromptChars);
      for (const r of chunkResults) results.set(r.id, r);
    }

    return items.map((i) => results.get(i.id) || { id: i.id, error: '未返回结果' });
  }

  private async generateMetaBatchOnce(
    claudePath: string,
    items: BatchMetaRequestItem[],
    timeoutMs: number,
    previewChars: number,
    maxPromptChars: number
  ): Promise<BatchMetaResultItem[]> {
    const LOG_PREFIX = '[LocalClaudeProvider] generateMetaBatch';
    const safeItems = items.filter((i) => i && typeof i.id === 'string');
    if (!safeItems.length) return [];

    let prompt = this.buildBatchMetaPrompt(safeItems, previewChars);
    if (prompt.length > maxPromptChars) {
      const reducedPreview = Math.max(120, Math.floor(previewChars / 2));
      prompt = this.buildBatchMetaPrompt(safeItems, reducedPreview);
    }

    if (prompt.length > maxPromptChars && safeItems.length > 1) {
      const mid = Math.ceil(safeItems.length / 2);
      const left = await this.generateMetaBatchOnce(claudePath, safeItems.slice(0, mid), timeoutMs, previewChars, maxPromptChars);
      const right = await this.generateMetaBatchOnce(claudePath, safeItems.slice(mid), timeoutMs, previewChars, maxPromptChars);
      return [...left, ...right];
    }

    try {
      const args = ['-p', '--output-format', 'text', this.normalizePromptArg(prompt)];

      const startedAt = Date.now();
      const { stdout, stderr } = await this.runClaudeCli(claudePath, args, timeoutMs);
      const elapsed = Date.now() - startedAt;
      logger.debug(`${LOG_PREFIX} 执行完成`, { elapsedMs: elapsed, items: safeItems.length });

      if (stderr) {
        logger.warn(`${LOG_PREFIX} stderr`, stderr.slice(0, 500));
      }

      const parsed = extractJsonArray<Record<string, unknown>>(stdout);
      if (!parsed) {
        throw new Error('无法从 Claude Code 响应中解析 JSON 数组');
      }

      const byId = new Map<string, BatchMetaResultItem>();
      for (const item of parsed) {
        const idValue = item['id'];
        const id = typeof idValue === 'string' ? idValue.trim() : '';
        if (!id) continue;
        const nameValue = item['name'];
        const emojiValue = item['emoji'];
        const name = typeof nameValue === 'string' ? nameValue.trim() : undefined;
        const emoji = typeof emojiValue === 'string' ? emojiValue.trim() : undefined;
        byId.set(id, { id, name: name || undefined, emoji: emoji || undefined });
      }

      const results: BatchMetaResultItem[] = [];
      for (const req of safeItems) {
        const got = byId.get(req.id);
        if (got) {
          results.push(got);
          continue;
        }

        try {
          const single = await this.generateMeta(req.content);
          results.push({ id: req.id, name: single.name, emoji: single.emoji });
        } catch (error) {
          results.push({ id: req.id, error: error instanceof Error ? error.message : String(error) });
        }
      }

      return results;
    } catch (error) {
      logger.error(`${LOG_PREFIX} 失败，将降级为逐个处理`, error instanceof Error ? error.message : String(error));

      const results: BatchMetaResultItem[] = [];
      for (const req of safeItems) {
        try {
          const single = await this.generateMeta(req.content);
          results.push({ id: req.id, name: single.name, emoji: single.emoji });
        } catch (e) {
          results.push({ id: req.id, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return results;
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
          '未找到 Claude Code CLI，请在设置中配置 otter.local.claudePath，或设置环境变量 CLAUDE_BIN，或确保 PATH 中可直接执行 claude'
        );
      }

      const prompt = `请优化以下 Prompt 文本，使其更清晰简洁，保持中文 Markdown 格式。只返回优化后的文本，不要其他说明。\n\n${content}`;

      const args = ['-p', '--output-format', 'text', this.normalizePromptArg(prompt)];
      logger.debug('[LocalClaudeProvider] 执行优化命令');
      logger.debug('[LocalClaudeProvider] 超时设置', { timeoutMs });

      const startedAt = Date.now();
      const { stdout } = await this.runClaudeCli(claudePath, args, timeoutMs);
      logger.debug('[LocalClaudeProvider] 执行耗时', { elapsedMs: Date.now() - startedAt });

      return stdout.trim() || content;
    } catch (error) {
      const e = error as {
        message?: string;
        code?: unknown;
        signal?: unknown;
        killed?: unknown;
        stdout?: unknown;
        stderr?: unknown;
      };
      const stderr = typeof e?.stderr === 'string' ? e.stderr : '';
      const stdout = typeof e?.stdout === 'string' ? e.stdout : '';
      logger.error('[LocalClaudeProvider] 优化失败', {
        message: e?.message || String(error),
        code: e?.code,
        signal: e?.signal,
        killed: e?.killed,
      });
      logger.debug('[LocalClaudeProvider] 优化失败输出预览', {
        stdoutPreview: stdout ? stdout.slice(0, 300) : '',
        stderrPreview: stderr ? stderr.slice(0, 300) : '',
      });

      if (e?.killed && e?.signal === 'SIGTERM') {
        throw new Error(
          `Claude CLI 执行超时（${timeoutMs}ms）被终止：可能是首次登录/授权需要交互，或网络较慢。建议先在终端手动运行 claude -p "你好" 完成登录；也可在设置中提高 otter.local.claudeTimeoutMs。`
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
    if (this.cachedClaudePath !== undefined) return this.cachedClaudePath;

    logger.debug('[LocalClaudeProvider] getClaudePath() 开始检测 Claude CLI 路径');
    // 1. 从配置读取
    const configured = this.config.get<string>('local.claudePath');
    if (configured) {
      const resolved = this.resolvePath(configured);
      const ok = await this.fileExists(resolved);
      logger.debug('[LocalClaudeProvider] 配置 local.claudePath', { configured, resolved, exists: ok });
      if (ok) {
        this.cachedClaudePath = resolved;
        return resolved;
      }
    } else {
      logger.debug('[LocalClaudeProvider] 配置 local.claudePath 为空，跳过配置路径检测');
    }

    // 2. 从环境变量读取
    const envClaudeBin = (process.env.CLAUDE_BIN || process.env.CLAUDE_PATH || '').trim();
    if (envClaudeBin) {
      const resolved = this.resolvePath(envClaudeBin);
      const ok = await this.fileExists(resolved);
      logger.debug('[LocalClaudeProvider] 环境变量 CLAUDE_BIN/CLAUDE_PATH', { raw: envClaudeBin, resolved, exists: ok });
      if (ok) {
        this.cachedClaudePath = resolved;
        return resolved;
      }
    } else {
      logger.debug('[LocalClaudeProvider] 环境变量 CLAUDE_BIN/CLAUDE_PATH 未设置，跳过');
    }

    // 3. 从 VSCode 扩展目录检测（Claude Code 扩展通常内置 claude.exe）
    const fromExtensions = await this.detectClaudeFromVSCodeExtensions();
    if (fromExtensions) {
      logger.debug('[LocalClaudeProvider] 从 VSCode 扩展目录检测到 Claude CLI', fromExtensions);
      this.cachedClaudePath = fromExtensions;
      return fromExtensions;
    }

    // 4. 自动检测：从 PATH 中找（Windows: where；macOS/Linux: which）
    const fromPath = await this.detectClaudeFromPath();
    if (fromPath) {
      logger.debug('[LocalClaudeProvider] 从 PATH 检测到 Claude CLI', fromPath);
      this.cachedClaudePath = fromPath;
      return fromPath;
    }

    // 5. 自动检测常见路径
    const detectedPath = await this.detectClaudePath();
    if (detectedPath) {
      this.cachedClaudePath = detectedPath;
      return detectedPath;
    }

    logger.warn('[LocalClaudeProvider] 未找到 Claude CLI：已尝试 配置/local.claudePath、环境变量 CLAUDE_BIN、PATH(where/which)、VSCode 扩展目录、常见目录');
    this.cachedClaudePath = null;
    return null;
  }

  private buildBatchMetaPrompt(items: BatchMetaRequestItem[], previewChars: number): string {
    const entries = items
      .map((i) => {
        const snippet = this.normalizeBatchContent(i.content, previewChars);
        return `ID=${i.id} 内容=${snippet}`;
      })
      .join(' ||| ');

    return `你是一个提示词整理助手。现在有若干条目，每条目包含 ID 和内容。请为每条目生成一个简短中文标题（5-10字）和一个相关 emoji。只输出 JSON 数组，不要任何其他文字。数组元素格式：{"id":"ID","name":"标题","emoji":"😀"}。条目：${entries}`;
  }

  private normalizeBatchContent(content: string, maxChars: number): string {
    const normalized = (content || '').replace(/\s+/g, ' ').trim().replace(/\|\|\|/g, '| | |');
    if (!normalized) return '(空)';
    return normalized.length > maxChars ? normalized.slice(0, maxChars) : normalized;
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
        logger.debug('[LocalClaudeProvider] VSCode 扩展目录未发现 anthropic.claude-code-*');
        return null;
      }

      const candidates: Array<{ file: string; mtimeMs: number }> = [];
      for (const dir of candidateDirs) {
        const file = process.platform === 'win32'
          ? path.join(dir, 'resources', 'native-binary', 'claude.exe')
          : path.join(dir, 'resources', 'native-binary', 'claude');

        const ok = await this.fileExists(file);
        logger.debug('[LocalClaudeProvider] 扩展内置 CLI 探测', { file, exists: ok });
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
      logger.debug('[LocalClaudeProvider] VSCode 扩展目录探测失败（可忽略）', error instanceof Error ? error.message : String(error));
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
        logger.debug('[LocalClaudeProvider] which claude', { path: first, exists: ok });
        if (ok) return first;
      }
      return null;
    } catch (error) {
      logger.debug('[LocalClaudeProvider] PATH 检测失败（可忽略）', error instanceof Error ? error.message : String(error));
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
        logger.debug('[LocalClaudeProvider] where 候选', { name, path: resolved, exists: ok });
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
      logger.debug('[LocalClaudeProvider] 常见路径探测', { path: p, exists: ok });
      if (ok) {
        logger.debug('[LocalClaudeProvider] 检测到 Claude', p);
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
      logger.debug('[LocalClaudeProvider] 检测 Git Bash', { path: gitBashPath, exists: ok });
      if (ok) {
        return gitBashPath;
      }
    }

    // Try to detect from PATH via 'where bash.exe'
    try {
      const { stdout } = await execAsync('where bash.exe', { timeout: 5000 });
      const first = (stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first && await this.fileExists(first)) {
        logger.debug('[LocalClaudeProvider] 从 PATH 检测到 Git Bash', first);
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
    logger.debug('[LocalClaudeProvider] 处理 Git Bash 缺失问题');

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
