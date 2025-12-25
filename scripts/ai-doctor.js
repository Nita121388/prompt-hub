#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Prompt Hub AI Doctor：在终端快速诊断本地 Claude/Codex CLI 是否可用。
 *
 * 设计目标：
 * - 默认“无副作用”：只做路径探测与环境信息输出
 * - 可选“轻量探测”：通过 --probe 实际执行一次最小命令，帮助判断是否卡在登录/网络/权限
 *
 * 用法示例：
 * - npm run ai:doctor
 * - pnpm -C upstream ai:doctor
 * - node scripts/ai-doctor.js --probe
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

function nowIso() {
  return new Date().toISOString();
}

function isWindows() {
  return process.platform === 'win32';
}

function parseArgs(argv) {
  const args = {
    probe: false,
    json: false,
    timeoutMs: 120000,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--probe') args.probe = true;
    else if (a === '--json') args.json = true;
    else if (a === '--timeout-ms') {
      const v = Number(argv[i + 1]);
      if (Number.isFinite(v) && v > 0) args.timeoutMs = v;
      i += 1;
    }
  }

  return args;
}

function exists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

function safeTrim(s) {
  return (s || '').toString().trim();
}

function run(command, options) {
  const startedAt = Date.now();
  try {
    const out = cp.execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options?.timeoutMs ?? 15000,
      windowsHide: true,
    });
    return {
      ok: true,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
      stdout: out || '',
      stderr: '',
    };
  } catch (e) {
    return {
      ok: false,
      exitCode: typeof e?.status === 'number' ? e.status : null,
      durationMs: Date.now() - startedAt,
      stdout: safeTrim(e?.stdout),
      stderr: safeTrim(e?.stderr) || safeTrim(e?.message),
      killed: !!e?.killed,
      signal: e?.signal || null,
    };
  }
}

function firstLine(text) {
  return (text || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
}

function whereOrWhich(name) {
  if (isWindows()) {
    return run(`where ${name}`, { timeoutMs: 5000 });
  }
  return run(`which ${name}`, { timeoutMs: 5000 });
}

function parseWhereLines(res) {
  if (!res?.ok) return [];
  return (res.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function findVSCodeExtensionBinaries() {
  const root = path.join(os.homedir(), '.vscode', 'extensions');
  if (!exists(root)) return { root, candidates: [] };

  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { root, candidates: [] };
  }

  const candidates = [];

  // Claude Code 扩展：anthropic.claude-code-*
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!e.name.startsWith('anthropic.claude-code-')) continue;
    const dir = path.join(root, e.name);
    const cli = isWindows()
      ? path.join(dir, 'resources', 'native-binary', 'claude.exe')
      : path.join(dir, 'resources', 'native-binary', 'claude');
    if (exists(cli)) candidates.push({ kind: 'claude', file: cli, source: 'vscode-extension' });
  }

  // Codex：有的环境是 openai.chatgpt 扩展内置 codex.exe
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!e.name.startsWith('openai.chatgpt-')) continue;
    const dir = path.join(root, e.name);
    const cli = isWindows()
      ? path.join(dir, 'bin', 'windows-x86_64', 'codex.exe')
      : path.join(dir, 'bin', 'codex');
    if (exists(cli)) candidates.push({ kind: 'codex', file: cli, source: 'vscode-extension' });
  }

  return { root, candidates };
}

function pickFirstExisting(paths) {
  for (const p of paths) {
    if (p && exists(p)) return p;
  }
  return '';
}

function detectClaude() {
  const configured = '';
  const envBin = safeTrim(process.env.CLAUDE_BIN || process.env.CLAUDE_PATH);
  const fromEnv = envBin ? expandHome(envBin) : '';

  const fromPath = (() => {
    if (isWindows()) {
      const lines =
        parseWhereLines(whereOrWhich('claude.exe'))
          .concat(parseWhereLines(whereOrWhich('claude.cmd')))
          .concat(parseWhereLines(whereOrWhich('claude.bat')))
          .concat(parseWhereLines(whereOrWhich('claude')));
      return pickFirstExisting(lines);
    }
    return firstLine(whereOrWhich('claude').stdout);
  })();

  const ext = findVSCodeExtensionBinaries();
  const fromExt = pickFirstExisting(ext.candidates.filter((c) => c.kind === 'claude').map((c) => c.file));

  const commonPaths = [
    path.join(os.homedir(), '.claude', 'claude.exe'),
    path.join(os.homedir(), '.claude', 'bin', 'claude.exe'),
    'C:\\Program Files\\Claude Code\\claude.exe',
    'C:\\Program Files (x86)\\Claude Code\\claude.exe',
    path.join(os.homedir(), '.claude', 'claude'),
    path.join(os.homedir(), '.claude', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/claude/claude',
  ];
  const fromCommon = pickFirstExisting(commonPaths);

  const resolved = pickFirstExisting([configured, fromEnv, fromExt, fromPath, fromCommon]);

  return {
    resolved,
    configured,
    env: envBin,
    fromEnv,
    fromExt,
    fromPath,
    fromCommon,
    vscodeExtensionsRoot: ext.root,
  };
}

function detectCodex() {
  const configured = '';
  const envBin = safeTrim(process.env.CODEX_BIN);
  const fromEnv = envBin ? expandHome(envBin) : '';

  const fromPath = (() => {
    if (isWindows()) {
      const lines =
        parseWhereLines(whereOrWhich('codex.exe'))
          .concat(parseWhereLines(whereOrWhich('codex.cmd')))
          .concat(parseWhereLines(whereOrWhich('codex.bat')))
          .concat(parseWhereLines(whereOrWhich('codex')));
      return pickFirstExisting(lines);
    }
    return firstLine(whereOrWhich('codex').stdout);
  })();

  const ext = findVSCodeExtensionBinaries();
  const fromExt = pickFirstExisting(ext.candidates.filter((c) => c.kind === 'codex').map((c) => c.file));

  const commonPaths = [
    path.join(os.homedir(), '.codex', 'codex.exe'),
    path.join(os.homedir(), '.codex', 'bin', 'codex.exe'),
    'C:\\Tools\\codex\\codex.exe',
    'C:\\Program Files\\Codex\\codex.exe',
    'C:\\Program Files (x86)\\Codex\\codex.exe',
    path.join(os.homedir(), '.codex', 'codex'),
    path.join(os.homedir(), '.codex', 'bin', 'codex'),
    '/usr/local/bin/codex',
    '/opt/codex/codex',
  ];
  const fromCommon = pickFirstExisting(commonPaths);

  const resolved = pickFirstExisting([configured, fromEnv, fromExt, fromPath, fromCommon]);

  return {
    resolved,
    configured,
    env: envBin,
    fromEnv,
    fromExt,
    fromPath,
    fromCommon,
    vscodeExtensionsRoot: ext.root,
  };
}

function quoteWindowsArg(text) {
  // 给 cmd.exe /c 使用：双引号内双引号转义成 ""，并将换行压平
  return `"${(text || '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

function probeClaude(bin, timeoutMs) {
  if (!bin) return { ok: false, error: '未检测到 claude 可执行文件' };

  const prompt = '你好（本次为 Prompt Hub doctor 探测请求，仅用于验证 CLI 可用性）';
  const cmd = isWindows() && bin.toLowerCase().endsWith('.cmd')
    ? `cmd.exe /c ${quoteWindowsArg(`${bin} -p --output-format text "${prompt}"`)}`
    : `${bin} -p --output-format text "${prompt}"`;

  const res = run(cmd, { timeoutMs });
  return {
    ok: res.ok,
    exitCode: res.exitCode,
    durationMs: res.durationMs,
    stderrPreview: (res.stderr || '').slice(0, 800),
    stdoutPreview: (res.stdout || '').slice(0, 800),
  };
}

function probeCodex(bin, timeoutMs) {
  if (!bin) return { ok: false, error: '未检测到 codex 可执行文件' };

  const prompt = '你好（本次为 Prompt Hub doctor 探测请求，仅用于验证 CLI 可用性）';
  const cmd = isWindows() && bin.toLowerCase().endsWith('.cmd')
    ? `cmd.exe /c ${quoteWindowsArg(`${bin} exec --skip-git-repo-check --sandbox read-only "${prompt}"`)}`
    : `${bin} exec --skip-git-repo-check --sandbox read-only "${prompt}"`;

  const res = run(cmd, { timeoutMs });
  return {
    ok: res.ok,
    exitCode: res.exitCode,
    durationMs: res.durationMs,
    stderrPreview: (res.stderr || '').slice(0, 800),
    stdoutPreview: (res.stdout || '').slice(0, 800),
  };
}

function main() {
  const args = parseArgs(process.argv);

  const result = {
    timestamp: nowIso(),
    platform: {
      node: process.version,
      os: `${process.platform} ${os.release()}`,
      arch: process.arch,
    },
    env: {
      CODEX_BIN: safeTrim(process.env.CODEX_BIN),
      CLAUDE_BIN: safeTrim(process.env.CLAUDE_BIN),
      CLAUDE_PATH: safeTrim(process.env.CLAUDE_PATH),
    },
    claude: detectClaude(),
    codex: detectCodex(),
    probe: null,
  };

  if (args.probe) {
    result.probe = {
      timeoutMs: args.timeoutMs,
      claude: probeClaude(result.claude.resolved, args.timeoutMs),
      codex: probeCodex(result.codex.resolved, args.timeoutMs),
    };
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  console.log('Prompt Hub AI Doctor');
  console.log('time:', result.timestamp);
  console.log('node:', result.platform.node);
  console.log('os:', result.platform.os, 'arch:', result.platform.arch);
  console.log('');

  console.log('[环境变量]');
  console.log('  CODEX_BIN =', result.env.CODEX_BIN || '(未设置)');
  console.log('  CLAUDE_BIN =', result.env.CLAUDE_BIN || '(未设置)');
  console.log('  CLAUDE_PATH =', result.env.CLAUDE_PATH || '(未设置)');
  console.log('');

  console.log('[Claude 探测]');
  console.log('  resolved =', result.claude.resolved || '(未找到)');
  console.log('  fromEnv  =', result.claude.fromEnv || '(无)');
  console.log('  fromExt  =', result.claude.fromExt || '(无)');
  console.log('  fromPath =', result.claude.fromPath || '(无)');
  console.log('  fromCommon =', result.claude.fromCommon || '(无)');
  console.log('');

  console.log('[Codex 探测]');
  console.log('  resolved =', result.codex.resolved || '(未找到)');
  console.log('  fromEnv  =', result.codex.fromEnv || '(无)');
  console.log('  fromExt  =', result.codex.fromExt || '(无)');
  console.log('  fromPath =', result.codex.fromPath || '(无)');
  console.log('  fromCommon =', result.codex.fromCommon || '(无)');
  console.log('');

  if (args.probe) {
    console.log('[可执行探测]');
    console.log('  timeoutMs =', result.probe.timeoutMs);
    console.log('  claude:', result.probe.claude.ok ? 'OK' : 'FAILED', `(${result.probe.claude.durationMs}ms)`);
    if (!result.probe.claude.ok) console.log('    stderr:', result.probe.claude.stderrPreview || '(空)');
    console.log('  codex:', result.probe.codex.ok ? 'OK' : 'FAILED', `(${result.probe.codex.durationMs}ms)`);
    if (!result.probe.codex.ok) console.log('    stderr:', result.probe.codex.stderrPreview || '(空)');
    console.log('');
  }

  console.log('[建议]');
  console.log('  - Claude：优先在 VSCode 设置中配置 promptHub.local.claudePath（或设置 CLAUDE_BIN）');
  console.log('  - Codex：优先在 VSCode 设置中配置 promptHub.local.codexPath（或设置 CODEX_BIN）');
  console.log('  - 如首次登录/网络慢：可用 --probe 观察是否超时，并适当调大 timeout');
}

main();

