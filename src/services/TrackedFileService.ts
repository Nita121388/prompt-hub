import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { ConfigurationService } from './ConfigurationService';
import { GitSyncService } from './GitSyncService';
import { TrackedFileEntry, TrackedFileIndex } from '../types/TrackedFile';
import { logger } from './Logger';
import { enqueueByKey } from '../utils/WriteQueue';
import { formatDateTime } from '../utils/TimeCommand';
import { generateId, sanitizeFilename } from '../utils/helpers';

export class TrackedFileService {
  private readonly INDEX_VERSION = '1.0.0';
  private index: TrackedFileIndex = { version: this.INDEX_VERSION, entries: [] };
  private entriesBySource = new Map<string, TrackedFileEntry>();
  private watchers = new Map<string, fs.FSWatcher>();
  private autoSyncTimer: NodeJS.Timeout | undefined;
  private readonly _onDidChange = new vscode.EventEmitter<void>();

  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly config: ConfigurationService,
    private readonly git: GitSyncService
  ) {}

  async initialize(context: vscode.ExtensionContext): Promise<void> {
    await this.loadIndex();
    this.rebuildIndexMap();
    this.bindWorkspaceEvents(context);
    this.refreshWatchers();
    await this.syncMissingArchives();
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = undefined;
    }
  }

  async reload(): Promise<void> {
    this.dispose();
    await this.loadIndex();
    this.rebuildIndexMap();
    this.refreshWatchers();
    this._onDidChange.fire();
    await this.syncMissingArchives();
  }

  isTracked(sourcePath: string): boolean {
    const key = this.normalizePath(sourcePath);
    return this.entriesBySource.has(key);
  }

  list(): TrackedFileEntry[] {
    return [...this.index.entries];
  }

  async trackFile(sourcePath: string): Promise<void> {
    const resolved = this.normalizePath(sourcePath);
    if (this.entriesBySource.has(resolved)) {
      throw new Error('该文件已在跟踪列表中。');
    }

    const stat = await this.safeStat(resolved);
    if (!stat || !stat.isFile()) {
      throw new Error('请选择一个可用的文件进行跟踪。');
    }

    await this.ensureBaseDir();
    const baseDir = this.resolveBaseDir();
    if (this.isInside(baseDir, resolved)) {
      throw new Error('归档目录内的文件不可作为跟踪来源。');
    }

    const entry: TrackedFileEntry = {
      id: generateId(),
      sourcePath: resolved,
      label: path.basename(resolved),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.copyToArchive(entry, resolved);

    this.index.entries.push(entry);
    this.entriesBySource.set(resolved, entry);
    await this.saveIndex();

    this.watchFile(entry);
    this.scheduleGitSync();
    this._onDidChange.fire();
  }

  async untrackFile(sourcePath: string, options?: { removeArchive?: boolean }): Promise<void> {
    const resolved = this.normalizePath(sourcePath);
    const entry = this.entriesBySource.get(resolved);
    if (!entry) {
      throw new Error('该文件未在跟踪列表中。');
    }

    if (options?.removeArchive) {
      try {
        await this.removeArchiveFile(entry, resolved);
      } catch (err) {
        logger.warn('[TrackedFileService] remove archive failed', err);
      }
    }

    await this.removeEntry(entry);

    this.scheduleGitSync();
  }

  async goToNextFile(sourcePath: string): Promise<string> {
    const resolved = this.normalizePath(sourcePath);
    const entry = this.entriesBySource.get(resolved);
    if (!entry) {
      throw new Error('该文件未在跟踪列表中。');
    }

    const dir = path.dirname(resolved);
    const basename = path.basename(resolved, path.extname(resolved));
    const ext = path.extname(resolved);

    const filename = await this.generateNextFilename(dir, basename, ext);
    const nextPath = path.join(dir, filename);

    await fsp.copyFile(resolved, nextPath);

    await this.copyToArchive(entry, resolved);

    await this.updateEntrySourcePath(entry, nextPath);
    await this.copyToArchive(entry, nextPath);

    this.scheduleGitSync();
    return nextPath;
  }

  private bindWorkspaceEvents(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.scheme !== 'file') return;
        const target = this.entriesBySource.get(this.normalizePath(doc.uri.fsPath));
        if (!target) return;
        void this.queueSync(target, doc.uri.fsPath);
      })
    );

    context.subscriptions.push(
      vscode.workspace.onDidRenameFiles(async (e) => {
        for (const file of e.files) {
          if (file.oldUri.scheme !== 'file' || file.newUri.scheme !== 'file') continue;
          const entry = this.entriesBySource.get(this.normalizePath(file.oldUri.fsPath));
          if (!entry) continue;
          await this.updateEntrySourcePath(entry, file.newUri.fsPath);
          await this.copyToArchive(entry, file.newUri.fsPath);
          this.scheduleGitSync();
        }
      })
    );

    context.subscriptions.push(
      vscode.workspace.onDidDeleteFiles(async (e) => {
        for (const file of e.files) {
          if (file.scheme !== 'file') continue;
          const normalized = this.normalizePath(file.fsPath);
          const entry = this.entriesBySource.get(normalized);
          if (!entry) continue;
          await this.handleDeletedEntry(entry, normalized);
        }
      })
    );
  }

  private refreshWatchers(): void {
    for (const entry of this.index.entries) {
      this.watchFile(entry);
    }
  }

  private watchFile(entry: TrackedFileEntry): void {
    const target = this.normalizePath(entry.sourcePath);
    if (this.watchers.has(target)) return;

    if (!fs.existsSync(target)) {
      return;
    }

    try {
      const watcher = fs.watch(target, { persistent: false }, (eventType) => {
        if (!this.entriesBySource.has(target)) return;
        if (eventType === 'rename') {
          if (!fs.existsSync(target)) {
            void this.handleDeletedEntry(entry, target);
            return;
          }
        }
        void this.queueSync(entry, target);
      });

      watcher.on('error', (err) => {
        logger.warn('[TrackedFileService] watcher error', err);
      });

      this.watchers.set(target, watcher);
    } catch (err) {
      logger.warn('[TrackedFileService] failed to watch file', { target, err });
    }
  }

  private async queueSync(entry: TrackedFileEntry, sourcePath: string): Promise<void> {
    await enqueueByKey(`tracked:${entry.id}`, async () => {
      const exists = await this.fileExists(sourcePath);
      if (!exists) return;
      try {
        await this.copyToArchive(entry, sourcePath);
        this.scheduleGitSync();
      } catch (err) {
        logger.warn('[TrackedFileService] sync archive failed', err);
      }
    });
  }

  private scheduleGitSync(): void {
    const enable = this.config.get<boolean>('track.autoSyncOnSave', true);
    if (!enable) return;

    const delaySeconds = this.config.get<number>('track.autoSyncDelaySeconds', 30);
    const delayMs = Math.max(5, delaySeconds) * 1000;

    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
    }

    this.autoSyncTimer = setTimeout(async () => {
      this.autoSyncTimer = undefined;
      try {
        await this.git.sync();
        vscode.window.setStatusBarMessage('Otter: 跟踪文件已同步', 3000);
      } catch (err) {
        logger.error('[TrackedFileService] auto sync failed', err);
        void vscode.window.showErrorMessage(
          `Otter: 跟踪文件同步失败：${err instanceof Error ? err.message : String(err)}`
        );
      }
    }, delayMs);
  }

  private async handleDeletedEntry(entry: TrackedFileEntry, sourcePath: string): Promise<void> {
    const normalized = this.normalizePath(sourcePath);
    const current = this.entriesBySource.get(normalized);
    if (!current || current.id !== entry.id) return;

    const choice = await vscode.window.showWarningMessage(
      `检测到被跟踪文件已删除：${sourcePath}\n是否同时删除远端归档文件？`,
      '删除远端归档',
      '保留远端归档'
    );

    if (!choice) {
      return;
    }

    const removeArchive = choice === '删除远端归档';
    if (removeArchive) {
      try {
        await this.removeArchiveFile(entry, sourcePath);
      } catch (err) {
        logger.warn('[TrackedFileService] remove archive failed', err);
      }
    }

    await this.removeEntry(entry);

    this.scheduleGitSync();
  }

  private async removeEntry(entry: TrackedFileEntry): Promise<void> {
    const key = this.normalizePath(entry.sourcePath);
    this.entriesBySource.delete(key);
    this.index.entries = this.index.entries.filter((item) => item.id !== entry.id);
    const watcher = this.watchers.get(key);
    if (watcher) {
      watcher.close();
      this.watchers.delete(key);
    }
    await this.saveIndex();
    this._onDidChange.fire();
  }

  private async updateEntrySourcePath(entry: TrackedFileEntry, nextPath: string): Promise<void> {
    const oldKey = this.normalizePath(entry.sourcePath);
    const newKey = this.normalizePath(nextPath);
    if (oldKey === newKey) return;

    this.entriesBySource.delete(oldKey);
    const watcher = this.watchers.get(oldKey);
    if (watcher) {
      watcher.close();
      this.watchers.delete(oldKey);
    }

    entry.sourcePath = newKey;
    entry.label = path.basename(newKey);
    entry.updatedAt = new Date().toISOString();
    this.entriesBySource.set(newKey, entry);

    await this.saveIndex();
    this.watchFile(entry);
    this._onDidChange.fire();
  }

  private async copyToArchive(entry: TrackedFileEntry, sourcePath: string): Promise<void> {
    const archiveRoot = await this.ensureEntryDir(entry);
    const archivePath = path.join(archiveRoot, path.basename(sourcePath));
    await fsp.copyFile(sourcePath, archivePath);
  }

  private async removeArchiveFile(entry: TrackedFileEntry, sourcePath: string): Promise<void> {
    const archiveRoot = await this.ensureEntryDir(entry);
    const archivePath = path.join(archiveRoot, path.basename(sourcePath));
    try {
      await fsp.rm(archivePath, { force: true });
    } catch (err) {
      logger.warn('[TrackedFileService] failed to remove archive file', { archivePath, err });
    }
  }

  private async ensureEntryDir(entry: TrackedFileEntry): Promise<string> {
    const baseDir = this.resolveBaseDir();
    const entryDir = path.join(baseDir, entry.id);
    await fsp.mkdir(entryDir, { recursive: true });
    return entryDir;
  }

  private async ensureBaseDir(): Promise<void> {
    const baseDir = this.resolveBaseDir();
    await fsp.mkdir(baseDir, { recursive: true });
  }

  private resolveBaseDir(): string {
    const storagePath = this.config.getStoragePath();
    const raw = (this.config.get<string>('track.baseDir', '.otter-tracked') || '').trim();
    const fallback = raw || '.otter-tracked';
    const resolved = this.config.resolvePath(fallback);
    const base = path.isAbsolute(resolved) ? resolved : path.join(storagePath, resolved);
    const absolute = path.resolve(base);
    const storageAbs = path.resolve(storagePath);
    const rel = path.relative(storageAbs, absolute);
    if (!rel || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('otter.track.baseDir 必须位于 storagePath 内部。');
    }
    return absolute;
  }

  private getIndexPath(): string {
    const baseDir = this.resolveBaseDir();
    return path.join(baseDir, 'index.json');
  }

  private async loadIndex(): Promise<void> {
    let indexPath: string | null = null;
    try {
      indexPath = this.getIndexPath();
    } catch (err) {
      logger.warn('[TrackedFileService] resolve baseDir failed', err);
      this.index = { version: this.INDEX_VERSION, entries: [] };
      return;
    }

    let data: string | null = null;
    try {
      data = await fsp.readFile(indexPath, 'utf-8');
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        logger.warn('[TrackedFileService] load index failed', err);
      }
    }

    if (!data) {
      this.index = { version: this.INDEX_VERSION, entries: [] };
      return;
    }

    try {
      const parsed = JSON.parse(data) as TrackedFileIndex;
      const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      this.index = {
        version: parsed.version || this.INDEX_VERSION,
        entries: entries
          .filter((item) => item && typeof item.id === 'string' && typeof item.sourcePath === 'string')
          .map((item) => ({
            ...item,
            sourcePath: this.normalizePath(item.sourcePath),
            label: item.label || path.basename(item.sourcePath),
          })),
      };
    } catch (err) {
      logger.warn('[TrackedFileService] parse index failed', err);
      this.index = { version: this.INDEX_VERSION, entries: [] };
    }
  }

  private async saveIndex(): Promise<void> {
    let indexPath: string;
    try {
      indexPath = this.getIndexPath();
    } catch (err) {
      logger.warn('[TrackedFileService] resolve baseDir failed', err);
      return;
    }
    const payload: TrackedFileIndex = {
      version: this.INDEX_VERSION,
      entries: this.index.entries,
    };
    await enqueueByKey(indexPath, async () => {
      await this.ensureBaseDir();
      const tmp = `${indexPath}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf-8');
      await fsp.rename(tmp, indexPath);
    });
  }

  private rebuildIndexMap(): void {
    this.entriesBySource.clear();
    for (const entry of this.index.entries) {
      const key = this.normalizePath(entry.sourcePath);
      this.entriesBySource.set(key, entry);
    }
  }

  private async syncMissingArchives(): Promise<void> {
    let changed = false;
    for (const entry of this.index.entries) {
      let sourcePath: string;
      try {
        sourcePath = this.normalizePath(entry.sourcePath);
      } catch {
        continue;
      }

      const exists = await this.fileExists(sourcePath);
      if (!exists) continue;

      let archiveRoot: string;
      try {
        archiveRoot = await this.ensureEntryDir(entry);
      } catch (err) {
        logger.warn('[TrackedFileService] ensure archive dir failed', err);
        continue;
      }
      const archivePath = path.join(archiveRoot, path.basename(sourcePath));

      const sourceStat = await this.safeStat(sourcePath);
      const archiveStat = await this.safeStat(archivePath);

      if (!sourceStat) continue;
      if (!archiveStat || sourceStat.mtimeMs > archiveStat.mtimeMs) {
        try {
          await fsp.copyFile(sourcePath, archivePath);
          changed = true;
        } catch (err) {
          logger.warn('[TrackedFileService] copy archive failed', err);
        }
      }
    }

    if (changed) {
      this.scheduleGitSync();
    }
  }

  private async generateNextFilename(dir: string, basename: string, ext: string): Promise<string> {
    const template = this.config.get<string>('track.filenameTemplate', '{date}-{index}{ext}');
    const dateFormat = this.config.get<string>('track.dateFormat', 'YYYY-MM-DD');
    const indexPadding = Math.max(1, this.config.get<number>('track.indexPadding', 2));

    const now = new Date();
    const dateValue = sanitizeFilename(formatDateTime(now, dateFormat));
    const timeValue = sanitizeFilename(formatDateTime(now, 'HHmmss'));
    const safeBasename = sanitizeFilename(basename || 'untitled');
    const safeExt = ext || '';

    const baseValues = {
      date: dateValue,
      time: timeValue,
      basename: safeBasename,
      ext: safeExt,
    };

    const hasIndex = template.includes('{index}');

    if (!hasIndex) {
      const candidate = this.applyTemplate(template, { ...baseValues, index: '' });
      this.assertValidFilename(candidate);
      return await this.makeUniqueFilename(dir, candidate);
    }

    const matcher = this.buildIndexMatcher(template, baseValues);
    const files = await this.safeReadDir(dir);
    let maxIndex = 0;
    for (const name of files) {
      const match = matcher.exec(name);
      if (!match) continue;
      const rawIndex = match[1] || '';
      const num = Number.parseInt(rawIndex, 10);
      if (!Number.isNaN(num)) {
        maxIndex = Math.max(maxIndex, num);
      }
    }

    let nextIndex = maxIndex + 1;
    while (true) {
      const padded = String(nextIndex).padStart(indexPadding, '0');
      const candidate = this.applyTemplate(template, { ...baseValues, index: padded });
      this.assertValidFilename(candidate);
      const exists = await this.fileExists(path.join(dir, candidate));
      if (!exists) return candidate;
      nextIndex += 1;
    }
  }

  private applyTemplate(
    template: string,
    values: { date: string; time: string; basename: string; ext: string; index: string }
  ): string {
    return template
      .replace(/\{date\}/g, values.date)
      .replace(/\{time\}/g, values.time)
      .replace(/\{basename\}/g, values.basename)
      .replace(/\{ext\}/g, values.ext)
      .replace(/\{index\}/g, values.index);
  }

  private buildIndexMatcher(
    template: string,
    values: { date: string; time: string; basename: string; ext: string }
  ): RegExp {
    const escaped = this.escapeRegExp(template);
    const pattern = escaped
      .replace(/\\\{date\\\}/g, this.escapeRegExp(values.date))
      .replace(/\\\{time\\\}/g, this.escapeRegExp(values.time))
      .replace(/\\\{basename\\\}/g, this.escapeRegExp(values.basename))
      .replace(/\\\{ext\\\}/g, this.escapeRegExp(values.ext))
      .replace(/\\\{index\\\}/g, '(\\d+)');
    return new RegExp(`^${pattern}$`);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private assertValidFilename(candidate: string): void {
    if (candidate.includes('/') || candidate.includes('\\')) {
      throw new Error('文件名模板不能包含路径分隔符。');
    }
  }

  private isInside(root: string, target: string): boolean {
    const rel = path.relative(path.resolve(root), path.resolve(target));
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  private async makeUniqueFilename(dir: string, filename: string): Promise<string> {
    const ext = path.extname(filename);
    const base = ext ? filename.slice(0, -ext.length) : filename;
    let candidate = filename;
    let index = 2;
    while (await this.fileExists(path.join(dir, candidate))) {
      candidate = `${base}-${index}${ext}`;
      index += 1;
    }
    return candidate;
  }

  private normalizePath(sourcePath: string): string {
    return path.resolve(sourcePath);
  }

  private async fileExists(target: string): Promise<boolean> {
    try {
      await fsp.access(target);
      return true;
    } catch {
      return false;
    }
  }

  private async safeStat(target: string): Promise<fs.Stats | null> {
    try {
      return await fsp.stat(target);
    } catch {
      return null;
    }
  }

  private async safeReadDir(dir: string): Promise<string[]> {
    try {
      return await fsp.readdir(dir);
    } catch {
      return [];
    }
  }
}
