#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const root = path.resolve(__dirname, '..');
const flags = new Set(process.argv.slice(2));
const watch = flags.has('--watch');
const noClean = flags.has('--no-clean');
const skipInstall = flags.has('--skip-install');

function log(message) {
  console.log(`[dev-debug] ${message}`);
}

function fail(message, code = 1) {
  console.error(`[dev-debug] ${message}`);
  process.exit(code);
}

function isWindows() {
  return process.platform === 'win32';
}

function npmBin() {
  return isWindows() ? 'npm.cmd' : 'npm';
}

function runSync(bin, args) {
  const res = cp.spawnSync(bin, args, { stdio: 'inherit', cwd: root });
  if (res.error) fail(`failed to run ${bin}: ${res.error.message}`);
  if (res.status !== 0) fail(`command failed (${res.status}): ${bin} ${args.join(' ')}`, res.status || 1);
}

function runAsync(bin, args, options = {}) {
  const child = cp.spawn(bin, args, { stdio: 'inherit', cwd: root, ...options });
  child.on('error', (err) => fail(`failed to run ${bin}: ${err.message}`));
  return child;
}

function hasCommand(cmd) {
  const checker = isWindows() ? 'where' : 'which';
  const res = cp.spawnSync(checker, [cmd], { stdio: 'ignore' });
  return res.status === 0;
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function findVSCodeCli() {
  if (hasCommand('code')) return 'code';
  if (process.platform !== 'darwin') return '';

  const envPath = process.env.VSCODE_CLI;
  const candidates = [
    envPath,
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    path.join(os.homedir(), 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code'),
    '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code',
    path.join(
      os.homedir(),
      'Applications',
      'Visual Studio Code - Insiders.app',
      'Contents',
      'Resources',
      'app',
      'bin',
      'code',
    ),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }

  return '';
}

function ensureDeps() {
  if (skipInstall) return;
  const nodeModules = path.join(root, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    log('node_modules missing; running npm install');
    runSync(npmBin(), ['install']);
  }
}

function cleanOut() {
  if (noClean) return;
  const outDir = path.join(root, 'out');
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
    log('cleaned out/');
  }
}

function compile() {
  log('compiling');
  runSync(npmBin(), ['run', 'compile']);
}

function launchVSCode() {
  const args = [`--extensionDevelopmentPath=${root}`, '--new-window'];

  const cli = findVSCodeCli();
  if (cli) {
    const label = cli === 'code' ? 'code CLI' : `CLI at ${cli}`;
    log(`launching VSCode via ${label}`);
    const child = runAsync(cli, args);
    child.unref();
    return true;
  }

  if (process.platform === 'darwin') {
    log('launching VSCode via open');
    const child = runAsync('open', ['-n', '-a', 'Visual Studio Code', '--args', ...args]);
    child.unref();
    return true;
  }

  log('VSCode CLI not found. Open this repo in VSCode and press F5 (Run Extension).');
  return false;
}

function main() {
  ensureDeps();
  cleanOut();
  compile();

  if (watch) {
    log('starting watch');
    const watcher = runAsync(npmBin(), ['run', 'watch']);
    const launched = launchVSCode();
    if (!launched) {
      watcher.kill();
      process.exit(1);
    }
    watcher.on('exit', (code) => {
      if (code && code !== 0) fail(`watch exited with code ${code}`, code);
      process.exit(code || 0);
    });
    return;
  }

  const launched = launchVSCode();
  if (!launched) process.exit(1);
}

main();
