import * as fs from 'fs/promises';
import { Dirent } from 'fs';
import * as path from 'path';
import { PromptStorage } from '../types/Prompt';
import { ConfigurationService } from './ConfigurationService';
import { logger } from './Logger';

export type RestoreMode = 'overwrite' | 'merge';

export interface BackupResult {
  backupDir: string;
  copiedFiles: number;
  skippedEntries: number;
  warnings: string[];
}

export interface RestoreResult {
  mode: RestoreMode;
  backupDir: string;
  storagePath: string;
  copiedFiles: number;
  skippedFiles: number;
  mergedPromptsAdded: number;
  warnings: string[];
}

/**
 * 备份/恢复服务
 * - 备份：把 storagePath 整个目录快照复制到 `.otter-backup-YYYYMMDD-HHMMSS/`
 * - 恢复：支持“完全覆盖”或“仅恢复缺失（合并）”
 */
export class BackupService {
  private readonly BACKUP_DIR_PREFIX = '.otter-backup-';

  constructor(private readonly configService: ConfigurationService) {}

  getStoragePath(): string {
    return this.configService.getStoragePath();
  }

  /** 创建备份（默认在 storagePath 下创建备份目录） */
  async createBackup(options?: {
    destinationRoot?: string;
    nameSuffix?: string;
  }): Promise<BackupResult> {
    const storagePath = this.getStoragePath();
    await this.assertDirectoryExists(storagePath);

    const destinationRoot = options?.destinationRoot ?? storagePath;
    await this.ensureDir(destinationRoot);

    const stamp = this.formatStamp(new Date());
    const suffix = options?.nameSuffix ? `-${options.nameSuffix}` : '';
    const backupDir = await this.makeUniqueDir(
      path.join(destinationRoot, `${this.BACKUP_DIR_PREFIX}${stamp}${suffix}`)
    );

    const warnings: string[] = [];
    let copiedFiles = 0;
    let skippedEntries = 0;

    // 备份目录在 storagePath 内时，必须忽略所有 `.otter-backup-*`，防止递归把备份再备份进去
    const shouldIgnore = (entryPath: string, entry: Dirent): boolean => {
      const name = path.basename(entryPath);
      if (entry.isDirectory() && name.startsWith(this.BACKUP_DIR_PREFIX)) return true;
      if (path.resolve(entryPath) === path.resolve(backupDir)) return true;
      return false;
    };

    const copyResult = await this.copyDirectory(storagePath, backupDir, shouldIgnore);
    copiedFiles += copyResult.copiedFiles;
    skippedEntries += copyResult.skippedEntries;
    warnings.push(...copyResult.warnings);

    logger.info('[BackupService] 已创建备份', {
      storagePath,
      backupDir,
      copiedFiles,
      skippedEntries,
      warnings: warnings.length,
    });

    return { backupDir, copiedFiles, skippedEntries, warnings };
  }

  /** 列出某个目录下的备份（只匹配 `.otter-backup-*` 目录） */
  async listBackups(rootDir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(rootDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() && e.name.startsWith(this.BACKUP_DIR_PREFIX))
        .map((e) => path.join(rootDir, e.name))
        .sort((a, b) => b.localeCompare(a));
    } catch {
      return [];
    }
  }

  /** 从备份恢复到 storagePath */
  async restoreFromBackup(backupDir: string, mode: RestoreMode): Promise<RestoreResult> {
    const storagePath = this.getStoragePath();
    await this.assertDirectoryExists(storagePath);
    await this.assertDirectoryExists(backupDir);

    const warnings: string[] = [];
    let copiedFiles = 0;
    let skippedFiles = 0;
    let mergedPromptsAdded = 0;

    if (mode === 'overwrite') {
      const clearResult = await this.clearStoragePath(storagePath);
      warnings.push(...clearResult.warnings);

      const copyResult = await this.copyDirectory(backupDir, storagePath, (p, e) => {
        // 恢复时也跳过备份目录（避免把备份目录复制回去）
        if (e.isDirectory() && path.basename(p).startsWith(this.BACKUP_DIR_PREFIX)) return true;
        return false;
      });
      copiedFiles += copyResult.copiedFiles;
      skippedFiles += copyResult.skippedEntries;
      warnings.push(...copyResult.warnings);
    } else {
      // 合并模式：不覆盖现有文件；prompts.json 做“按 id 补齐”
      const mergeResult = await this.mergePromptsJson(backupDir, storagePath);
      mergedPromptsAdded = mergeResult.added;
      warnings.push(...mergeResult.warnings);

      const copyResult = await this.copyDirectory(
        backupDir,
        storagePath,
        (p, e) => {
          if (e.isDirectory() && path.basename(p).startsWith(this.BACKUP_DIR_PREFIX)) return true;
          return false;
        },
        { skipIfExists: true }
      );
      copiedFiles += copyResult.copiedFiles;
      skippedFiles += copyResult.skippedEntries;
      warnings.push(...copyResult.warnings);
    }

    logger.info('[BackupService] 已完成恢复', {
      mode,
      storagePath,
      backupDir,
      copiedFiles,
      skippedFiles,
      mergedPromptsAdded,
      warnings: warnings.length,
    });

    return {
      mode,
      backupDir,
      storagePath,
      copiedFiles,
      skippedFiles,
      mergedPromptsAdded,
      warnings,
    };
  }

  private async mergePromptsJson(
    backupDir: string,
    storagePath: string
  ): Promise<{ added: number; warnings: string[] }> {
    const warnings: string[] = [];
    const backupFile = path.join(backupDir, 'prompts.json');
    const currentFile = path.join(storagePath, 'prompts.json');

    let backupStorage: PromptStorage | undefined;
    try {
      backupStorage = JSON.parse(await fs.readFile(backupFile, 'utf-8')) as PromptStorage;
    } catch (e) {
      warnings.push('备份中未找到可用的 prompts.json（已跳过合并）');
      return { added: 0, warnings };
    }

    let currentStorage: PromptStorage | undefined;
    try {
      currentStorage = JSON.parse(await fs.readFile(currentFile, 'utf-8')) as PromptStorage;
    } catch {
      // 当前不存在 prompts.json：直接使用备份版本（合并意义等价于复制）
      await this.atomicWriteFile(currentFile, JSON.stringify(backupStorage, null, 2));
      return { added: backupStorage.prompts?.length ?? 0, warnings };
    }

    currentStorage.prompts = currentStorage.prompts || [];
    const currentById = new Map(currentStorage.prompts.map((p) => [p.id, p]));
    let added = 0;
    for (const p of backupStorage.prompts || []) {
      if (!currentById.has(p.id)) {
        currentStorage.prompts.push(p);
        currentById.set(p.id, p);
        added += 1;
      }
    }

    await this.atomicWriteFile(currentFile, JSON.stringify(currentStorage, null, 2));
    return { added, warnings };
  }

  private async clearStoragePath(storagePath: string): Promise<{ warnings: string[] }> {
    const warnings: string[] = [];
    let entries: Dirent[];
    try {
      entries = await fs.readdir(storagePath, { withFileTypes: true });
    } catch (e) {
      warnings.push('清空 storagePath 失败：无法读取目录内容');
      return { warnings };
    }

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith(this.BACKUP_DIR_PREFIX)) {
        continue; // 永远保留备份目录，避免误删
      }

      const full = path.join(storagePath, entry.name);
      try {
        await fs.rm(full, { recursive: true, force: true });
      } catch (e) {
        warnings.push(`清理失败：${full}`);
      }
    }

    return { warnings };
  }

  private async copyDirectory(
    srcDir: string,
    dstDir: string,
    shouldIgnore: (entryPath: string, entry: Dirent) => boolean,
    options?: { skipIfExists?: boolean }
  ): Promise<{ copiedFiles: number; skippedEntries: number; warnings: string[] }> {
    const warnings: string[] = [];
    let copiedFiles = 0;
    let skippedEntries = 0;

    await this.ensureDir(dstDir);

    let entries: Dirent[];
    try {
      entries = await fs.readdir(srcDir, { withFileTypes: true });
    } catch (e) {
      warnings.push(`读取目录失败：${srcDir}`);
      return { copiedFiles, skippedEntries, warnings };
    }

    for (const entry of entries) {
      const from = path.join(srcDir, entry.name);
      const to = path.join(dstDir, entry.name);

      if (shouldIgnore(from, entry)) {
        skippedEntries += 1;
        continue;
      }

      if (entry.isDirectory()) {
        const res = await this.copyDirectory(from, to, shouldIgnore, options);
        copiedFiles += res.copiedFiles;
        skippedEntries += res.skippedEntries;
        warnings.push(...res.warnings);
        continue;
      }

      if (entry.isSymbolicLink()) {
        // Windows 下创建符号链接可能需要额外权限；这里保守跳过
        skippedEntries += 1;
        warnings.push(`已跳过符号链接：${from}`);
        continue;
      }

      if (!entry.isFile()) {
        skippedEntries += 1;
        continue;
      }

      if (options?.skipIfExists) {
        try {
          await fs.access(to);
          skippedEntries += 1;
          continue;
        } catch {
          // not exists
        }
      }

      try {
        await this.ensureDir(path.dirname(to));
        await fs.copyFile(from, to);
        copiedFiles += 1;
      } catch (e) {
        warnings.push(`复制失败：${from} -> ${to}`);
      }
    }

    return { copiedFiles, skippedEntries, warnings };
  }

  private async atomicWriteFile(filepath: string, content: string): Promise<void> {
    const tmp = `${filepath}.tmp`;
    await fs.writeFile(tmp, content, 'utf-8');
    await fs.rename(tmp, filepath);
  }

  private async assertDirectoryExists(dir: string): Promise<void> {
    let stat;
    try {
      stat = await fs.stat(dir);
    } catch {
      throw new Error(`目录不存在：${dir}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`不是目录：${dir}`);
    }
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  private formatStamp(date: Date): string {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    return (
      `${date.getFullYear()}` +
      `${pad2(date.getMonth() + 1)}` +
      `${pad2(date.getDate())}-` +
      `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
    );
  }

  private async makeUniqueDir(base: string): Promise<string> {
    let candidate = base;
    for (let i = 0; i <= 1000; i += 1) {
      if (i > 0) candidate = `${base}-${i}`;
      try {
        await fs.access(candidate);
      } catch {
        await fs.mkdir(candidate, { recursive: true });
        return candidate;
      }
    }
    throw new Error('无法创建唯一备份目录（重试次数过多）');
  }
}
