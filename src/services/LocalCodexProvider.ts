import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { ConfigurationService } from './ConfigurationService';
import type { BatchMetaRequestItem, BatchMetaResultItem, GeneratedMeta } from './AIService';
import { extractJsonArray } from '../utils/JsonExtract';

const execAsync = promisify(exec);
const fsPromises = fs.promises;

/**
 * 本地 Codex 提供商
 * 调用本地安装的 Codex CLI 进行 AI 操作
 */
export class LocalCodexProvider {
  private cachedCodexPath: string | null | undefined;
  private cachedInvocation: { bin: string; argsPrefix: string[]; displayName: string } | null | undefined;

  constructor(private readonly config: ConfigurationService) {}

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

  private async runCodexCli(
    invocation: { bin: string; argsPrefix: string[]; displayName: string },
    args: string[],
    timeoutMs: number,
    maxBufferBytes = 2 * 1024 * 1024
  ): Promise<{ stdout: string; stderr: string }> {
    const fullArgs = [...invocation.argsPrefix, ...args];
    console.log('[LocalCodexProvider] runCodexCli() spawn:', invocation.displayName, this.formatArgsForLog(fullArgs));
    console.log('[LocalCodexProvider] runCodexCli() stdio: [ignore, pipe, pipe]');

    const startedAt = Date.now();
    return await new Promise((resolve, reject) => {
      const child = spawn(invocation.bin, fullArgs, {
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
        console.log('[LocalCodexProvider] runCodexCli() exited:', { code, signal, elapsedMs: elapsed });

        if (maxBufferExceeded) {
          const err: any = new Error(
            `Codex CLI 输出过大（>${maxBufferBytes} bytes）已终止，请缩短 Prompt 或提高 maxBuffer 配置。`
          );
          err.code = code;
          err.signal = signal;
          err.killed = true;
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
          return;
        }

        if (timedOut) {
          const err: any = new Error(`Codex CLI 执行超时（${timeoutMs}ms）被终止。`);
          err.code = code;
          err.signal = signal ?? 'SIGTERM';
          err.killed = true;
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
          return;
        }

        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }

        const err: any = new Error(`Codex CLI 退出码非 0：${code ?? 'null'}`);
        err.code = code;
        err.signal = signal;
        err.killed = false;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      });
    });
  }

  private async getNodeExePath(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('where node.exe', { timeout: 5000 });
      const first = (stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first) return first;
      return null;
    } catch {
      return null;
    }
  }

  private async resolveCodexCmdShim(
    cmdPath: string
  ): Promise<{ bin: string; argsPrefix: string[]; displayName: string } | null> {
    if (process.platform !== 'win32') return null;

    try {
      const shimText = await fsPromises.readFile(cmdPath, 'utf8');
      const shimDir = path.dirname(cmdPath);
      const dp0 = shimDir.endsWith(path.sep) ? shimDir : `${shimDir}${path.sep}`;

      // npm 的 cmd shim 通常会包含一个被引号包裹的 *.js 路径，例如：
      // "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js"
      const jsMatches = [...shimText.matchAll(/\"([^\"]+?\.js)\"/gi)]
        .map((m) => m[1])
        .filter(Boolean);
      const lastJs = jsMatches.length ? jsMatches[jsMatches.length - 1] : null;
      if (!lastJs) return null;

      let scriptPath = lastJs
        .replace(/%~dp0/gi, dp0)
        .replace(/%dp0%/gi, dp0)
        .replace(/\//g, '\\');

      if (!path.isAbsolute(scriptPath)) {
        scriptPath = path.normalize(path.join(shimDir, scriptPath));
      } else {
        scriptPath = path.normalize(scriptPath);
      }

      const scriptOk = await this.fileExists(scriptPath);
      if (!scriptOk) return null;

      const bundledNode = path.join(shimDir, 'node.exe');
      const bundledOk = await this.fileExists(bundledNode);
      const nodeExe = bundledOk ? bundledNode : (await this.getNodeExePath()) || null;
      if (!nodeExe) return null;

      console.log('[LocalCodexProvider] 检测到 codex.cmd，将绕过批处理 shim 以避免中文参数乱码');
      return {
        bin: nodeExe,
        argsPrefix: [scriptPath],
        displayName: `"${nodeExe}" "${scriptPath}"`,
      };
    } catch {
      return null;
    }
  }

  private async getCodexInvocation(): Promise<{ bin: string; argsPrefix: string[]; displayName: string } | null> {
    if (this.cachedInvocation !== undefined) return this.cachedInvocation;

    const codexPath = await this.getCodexPath();
    if (!codexPath) {
      this.cachedInvocation = null;
      return null;
    }

    const ext = path.extname(codexPath).toLowerCase();
    if (process.platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
      const resolved = await this.resolveCodexCmdShim(codexPath);
      if (resolved) {
        this.cachedInvocation = resolved;
        return resolved;
      }
      console.warn('[LocalCodexProvider] codexPath 指向 .cmd/.bat，可能导致中文参数乱码；建议改用本地 Claude Provider 或配置可执行版本的 Codex');
    }

    this.cachedInvocation = { bin: codexPath, argsPrefix: [], displayName: codexPath };
    return this.cachedInvocation;
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

      const invocation = await this.getCodexInvocation();
      if (!invocation) {
        const err = '未找到 Codex CLI，请在设置中配置 promptHub.local.codexPath，或设置环境变量 CODEX_BIN，或确保 PATH 中可直接执行 codex';
        console.error(`${LOG_PREFIX} ${err}`);
        throw new Error(err);
      }
      console.log(`${LOG_PREFIX} 检测到 Codex:`, invocation.displayName);

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

      const startedAt = Date.now();
      const { stdout, stderr } = await this.runCodexCli(
        invocation,
        [
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          ...(model ? ['--model', model] : []),
          prompt,
        ],
        30000,
        1024 * 1024
      );
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

  async generateMetaBatch(items: BatchMetaRequestItem[]): Promise<BatchMetaResultItem[]> {
    const invocation = await this.getCodexInvocation();
    if (!invocation) {
      throw new Error('未找到 Codex CLI，请在设置中配置 promptHub.local.codexPath，或设置环境变量 CODEX_BIN，或确保 PATH 中可直接执行 codex');
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

      const chunkResults = await this.generateMetaBatchOnce(invocation, chunk, previewChars, maxPromptChars);
      for (const r of chunkResults) results.set(r.id, r);
    }

    return items.map((i) => results.get(i.id) || { id: i.id, error: '未返回结果' });
  }

  private async generateMetaBatchOnce(
    invocation: { bin: string; argsPrefix: string[]; displayName: string },
    items: BatchMetaRequestItem[],
    previewChars: number,
    maxPromptChars: number
  ): Promise<BatchMetaResultItem[]> {
    const LOG_PREFIX = '[LocalCodexProvider] generateMetaBatch';
    const safeItems = items.filter((i) => i && typeof i.id === 'string');
    if (!safeItems.length) return [];

    const model = this.config.get<string>('local.codexModel', '').trim();

    let prompt = this.buildBatchMetaPrompt(safeItems, previewChars);
    if (prompt.length > maxPromptChars) {
      const reducedPreview = Math.max(120, Math.floor(previewChars / 2));
      prompt = this.buildBatchMetaPrompt(safeItems, reducedPreview);
    }

    if (prompt.length > maxPromptChars && safeItems.length > 1) {
      const mid = Math.ceil(safeItems.length / 2);
      const left = await this.generateMetaBatchOnce(invocation, safeItems.slice(0, mid), previewChars, maxPromptChars);
      const right = await this.generateMetaBatchOnce(invocation, safeItems.slice(mid), previewChars, maxPromptChars);
      return [...left, ...right];
    }

    try {
      const startedAt = Date.now();
      const { stdout, stderr } = await this.runCodexCli(
        invocation,
        [
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          ...(model ? ['--model', model] : []),
          prompt,
        ],
        60000
      );
      const elapsed = Date.now() - startedAt;
      console.log(`${LOG_PREFIX} 执行完成, 耗时: ${elapsed}ms, items=${safeItems.length}`);

      if (stderr) {
        console.warn(`${LOG_PREFIX} stderr:`, stderr.slice(0, 500));
      }

      const parsed = extractJsonArray<Record<string, unknown>>(stdout);
      if (!parsed) {
        throw new Error('无法从 Codex 响应中解析 JSON 数组');
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
      console.error(`${LOG_PREFIX} 失败，将降级为逐个处理:`, error instanceof Error ? error.message : String(error));

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
   * 使用本地 Codex 优化内容
   */
  async optimize(content: string): Promise<string> {
    const LOG_PREFIX = '[LocalCodexProvider] optimize';
    try {
      console.log(`${LOG_PREFIX} 开始执行`);
      console.log(`${LOG_PREFIX} 输入内容长度: ${content.length} 字节`);

      const invocation = await this.getCodexInvocation();
      if (!invocation) {
        const err = '未找到 Codex CLI';
        console.error(`${LOG_PREFIX} ${err}`);
        throw new Error(err);
      }
      console.log(`${LOG_PREFIX} 检测到 Codex:`, invocation.displayName);

      const model = this.config.get<string>('local.codexModel', '').trim();
      console.log(`${LOG_PREFIX} 模型配置:`, model || '(默认模型)');

      const prompt = `请优化以下 Prompt 文本，使其更清晰简洁，保持中文 Markdown 格式。只返回优化后的文本，不要其他说明。\n\n${content}`;
      console.log(`${LOG_PREFIX} 生成 Prompt 长度: ${prompt.length} 字节`);

      const startedAt = Date.now();
      const { stdout, stderr } = await this.runCodexCli(
        invocation,
        [
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          ...(model ? ['--model', model] : []),
          prompt,
        ],
        60000
      );
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
    if (this.cachedCodexPath !== undefined) return this.cachedCodexPath;

    const LOG_PREFIX = '[LocalCodexProvider] getCodexPath';
    console.log(`${LOG_PREFIX} 开始检测 Codex CLI 路径`);

    // 1. 从配置读取
    const configured = this.config.get<string>('local.codexPath');
    if (configured) {
      const resolved = this.resolvePath(configured);
      const ok = await this.fileExists(resolved);
      console.log(`${LOG_PREFIX} 配置 local.codexPath:`, configured, '=>', resolved, 'exists=', ok);
      if (ok) {
        this.cachedCodexPath = resolved;
        this.cachedInvocation = undefined;
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
        this.cachedCodexPath = resolved;
        this.cachedInvocation = undefined;
        return resolved;
      }
    } else {
      console.log(`${LOG_PREFIX} 环境变量 CODEX_BIN 未设置，跳过`);
    }

    // 3. 自动检测：优先从 PATH 中找（对齐 aicliDemo 的行为）
    const fromPath = await this.detectCodexFromPath();
    if (fromPath) {
      console.log(`${LOG_PREFIX} 从 PATH 检测到 Codex CLI:`, fromPath);
      this.cachedCodexPath = fromPath;
      this.cachedInvocation = undefined;
      return fromPath;
    }

    // 4. 自动检测常见路径
    const detectedPath = await this.detectCodexPath();
    if (detectedPath) {
      this.cachedCodexPath = detectedPath;
      this.cachedInvocation = undefined;
      return detectedPath;
    }

    console.warn(`${LOG_PREFIX} 未找到 Codex CLI：已尝试 配置/local.codexPath、环境变量 CODEX_BIN、PATH(where/which)、常见目录`);
    this.cachedCodexPath = null;
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

}
