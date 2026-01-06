import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { Dirent } from 'fs';
import * as path from 'path';
import { Prompt, PromptStorage } from '../types/Prompt';
import { ConfigurationService } from './ConfigurationService';
import { MarkdownPromptParser } from '../utils/MarkdownPromptParser';
import { generateId } from '../utils/helpers';
import { logger } from './Logger';
import { enqueueByKey } from '../utils/WriteQueue';

/**
 * Prompt 存储服务
 * 负责 JSON 文件的读写和 Prompt 的 CRUD 操作
 */
export class PromptStorageService {
  private prompts: Prompt[] = [];
  private storagePath: string;
  private storageFile: string;
  private readonly STORAGE_VERSION = '1.0.0';

  // 事件发射器
  private readonly _onDidChangePrompts = new vscode.EventEmitter<void>();
  public readonly onDidChangePrompts = this._onDidChangePrompts.event;

  constructor(private configService: ConfigurationService) {
    this.storagePath = this.configService.getStoragePath();
    this.storageFile = path.join(this.storagePath, 'prompts.json');
  }

  private get gitDebugLogEnabled(): boolean {
    return this.configService.get<boolean>('git.debugLog', false);
  }

  /**
   * 初始化存储服务
   */
  async initialize(): Promise<void> {
    try {
      // 确保存储目录存在
      await this.ensureStorageDirectory();

      // 加载 Prompt 数据
      await this.load();

      // 尝试把存储目录中已有的 Markdown 文件导入到 prompts.json
      const imported = await this.importMarkdownPrompts();
      const pruned = await this.pruneMissingSourceFiles();
      if (imported > 0 || pruned > 0) {
        if (imported > 0) {
          console.log(`[PromptStorageService] 从 Markdown 导入了 ${imported} 条 Prompt，写回 prompts.json`);
        }
        if (pruned > 0) {
          console.log(`[PromptStorageService] 清理缺失源文件的 Prompt 数量: ${pruned}`);
        }
        await this.save();
      }

      console.log(`Prompt 存储初始化成功，加载了 ${this.prompts.length} 个 Prompt`);
    } catch (error) {
      console.error('初始化存储服务失败:', error);
      throw error;
    }
  }

  /**
   * 确保存储目录存在
   */
  private async ensureStorageDirectory(): Promise<void> {
    const autoCreate = this.configService.get<boolean>('storage.autoCreate', true);

    try {
      await fs.access(this.storagePath);
    } catch {
      if (autoCreate) {
        await fs.mkdir(this.storagePath, { recursive: true });
        logger.info('已创建存储目录', { storagePath: this.storagePath });
      } else {
        throw new Error(`存储目录不存在: ${this.storagePath}`);
      }
    }
  }

  /**
   * 加载 Prompt 数据
   */
  private async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.storageFile, 'utf-8');
      const storage: PromptStorage = JSON.parse(data);

      this.prompts = storage.prompts || [];

      // TODO: 数据迁移逻辑
      if (storage.version !== this.STORAGE_VERSION) {
        console.log(`检测到数据版本不一致，执行迁移...`);
        // await this.migrate(storage);
      }
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') {
        // 文件不存在，初始化为空
        this.prompts = [];
        await this.save();
        logger.info('初始化空的 Prompt 存储文件');
      } else {
        throw error;
      }
    }
  }

  /**
   * 保存 Prompt 数据
   */
  private async save(): Promise<void> {
    await enqueueByKey(this.storageFile, async () => {
      const storage: PromptStorage = {
        version: this.STORAGE_VERSION,
        prompts: this.prompts,
        usageLogs: [], // TODO: 集成 AI 使用日志
      };

      const json = JSON.stringify(storage, null, 2);

      // 使用临时文件 + 原子重命名策略
      const tempFile = `${this.storageFile}.tmp`;

      try {
        await fs.writeFile(tempFile, json, 'utf-8');
        await fs.rename(tempFile, this.storageFile);
      } catch (error) {
        logger.error('[PromptStorageService] 保存失败', error);
        // 清理临时文件
        try {
          await fs.unlink(tempFile);
        } catch {
          // 忽略清理失败
        }
        throw error;
      }

      // 触发变更事件
      this._onDidChangePrompts.fire();
      logger.debug('[PromptStorageService] 已保存并触发变更事件', {
        promptCount: this.prompts.length,
        storageFile: this.storageFile,
      });
    });
  }

  /**
   * 获取所有 Prompt
   */
  list(): Prompt[] {
    return [...this.prompts];
  }

  /**
   * 根据 ID 获取 Prompt
   */
  getById(id: string): Prompt | undefined {
    return this.prompts.find((p) => p.id === id);
  }

  /**
   * 替换 Prompt 的 ID（用于修复 Markdown frontmatter 与 JSON 不一致的历史数据）
   * - 仅在 newId 未被占用时允许替换
   * - 会写回 prompts.json 并触发变更事件
   */
  async replaceId(oldId: string, newId: string): Promise<void> {
    if (!oldId || !newId || oldId === newId) return;

    const existingNew = this.getById(newId);
    if (existingNew) {
      throw new Error(`无法替换 Prompt ID：新ID "${newId}" 已存在`);
    }

    const index = this.prompts.findIndex((p) => p.id === oldId);
    if (index === -1) {
      throw new Error(`无法替换 Prompt ID：旧ID "${oldId}" 不存在`);
    }

    const current = this.prompts[index];
    this.prompts[index] = {
      ...current,
      id: newId,
      updatedAt: new Date().toISOString(),
    };

    await this.save();
  }

  /**
   * 添加新 Prompt
   */
  async add(prompt: Prompt): Promise<void> {
    console.log('[PromptStorageService] 添加新Prompt - id:', prompt.id, ', name:', prompt.name);

    // 检查 ID 是否重复（理论上不应发生，防御性处理）
    if (this.prompts.some((p) => p.id === prompt.id)) {
      console.log('[PromptStorageService] Prompt ID重复:', prompt.id);
      throw new Error(`Prompt ID "${prompt.id}" 已存在`);
    }

    // 检查名称是否重复
    if (this.prompts.some((p) => p.name === prompt.name)) {
      console.log('[PromptStorageService] Prompt名称重复:', prompt.name);
      throw new Error(`Prompt 名称 "${prompt.name}" 已存在`);
    }

    this.prompts.push(prompt);
    console.log('[PromptStorageService] Prompt已添加到内存，当前总数:', this.prompts.length);
    await this.save();
    console.log('[PromptStorageService] Prompt已保存到文件，事件已触发');
  }

  /**
   * 更新 Prompt
   */
  async update(prompt: Prompt): Promise<void> {
    console.log('[PromptStorageService] 更新Prompt - id:', prompt.id, ', name:', prompt.name);

    const index = this.prompts.findIndex((p) => p.id === prompt.id);

    if (index === -1) {
      console.log('[PromptStorageService] Prompt ID不存在:', prompt.id);
      throw new Error(`Prompt ID "${prompt.id}" 不存在`);
    }

    // 检查名称冲突（排除自身）
    if (
      this.prompts.some((p) => p.id !== prompt.id && p.name === prompt.name)
    ) {
      console.log('[PromptStorageService] Prompt名称冲突:', prompt.name);
      throw new Error(`Prompt 名称 "${prompt.name}" 已存在`);
    }

    prompt.updatedAt = new Date().toISOString();
    this.prompts[index] = prompt;
    console.log('[PromptStorageService] Prompt已更新，位置:', index);
    await this.save();
    console.log('[PromptStorageService] Prompt更新已保存，事件已触发');
  }

  /**
   * 删除 Prompt
   */
  async remove(id: string): Promise<Prompt | undefined> {
    console.log('[PromptStorageService] 开始删除Prompt - id:', id);
    const index = this.prompts.findIndex((p) => p.id === id);

    if (index === -1) {
      console.log('[PromptStorageService] Prompt ID不存在，无法删除');
      return undefined;
    }

    const removed = this.prompts[index];
    console.log('[PromptStorageService] 找到Prompt - name:', removed.name, ', sourceFile:', removed.sourceFile);

    // 删除 Prompt 数据
    this.prompts.splice(index, 1);
    console.log('[PromptStorageService] Prompt已从内存中移除，剩余:', this.prompts.length);

    // 如果有关联的 Markdown 文件，也删除它
    if (removed.sourceFile) {
      try {
        console.log('[PromptStorageService] 尝试删除关联的Markdown文件:', removed.sourceFile);
        await fs.unlink(removed.sourceFile);
        console.log('[PromptStorageService] Markdown文件已删除');
      } catch (err) {
        const errorCode = (err as NodeJS.ErrnoException | undefined)?.code;
        const code = typeof errorCode === 'string' ? errorCode : undefined;
        console.error('[PromptStorageService] 删除Markdown文件失败:', err);

        // 兜底：如果文件路径已被外部工具（如 Obsidian）重命名导致找不到，则按 id 扫描存储目录定位真实文件并删除
        if (code === 'ENOENT') {
          try {
            const actual = await this.findMarkdownFileById(removed.id);
            if (actual && actual !== removed.sourceFile) {
              console.warn(
                '[PromptStorageService] sourceFile 不存在，已按 id 定位到实际文件，尝试删除:',
                actual
              );
              await fs.unlink(actual);
              console.log('[PromptStorageService] 兜底删除成功:', actual);
            } else if (!actual) {
              console.warn(
                '[PromptStorageService] sourceFile 不存在，且未在存储目录中按 id 找到对应 Markdown 文件，已跳过文件删除'
              );
            }
          } catch (fallbackErr) {
            console.error('[PromptStorageService] 兜底按 id 删除文件失败:', fallbackErr);
          }
        }
      }
    }

    await this.save();
    console.log('[PromptStorageService] Prompt删除完成，事件已触发');

    return removed;
  }

  /**
   * 搜索 Prompt
   */
  search(keyword: string): Prompt[] {
    const lowerKeyword = keyword.toLowerCase();

    return this.prompts.filter(
      (p) =>
        p.name.toLowerCase().includes(lowerKeyword) ||
        p.content.toLowerCase().includes(lowerKeyword) ||
        p.tags?.some((tag) => tag.toLowerCase().includes(lowerKeyword))
    );
  }

  /**
   * 从存储路径中的 Markdown 文件导入缺失的 Prompt
   * - 适用于用户预先把 Markdown 放入存储目录但 prompts.json 尚未同步的场景
   * - 仅针对 JSON 中没有登记 sourceFile 的 Markdown，避免重复导入
   */
  private async importMarkdownPrompts(): Promise<number> {
    const parser = new MarkdownPromptParser(this.configService);
    const files = await this.collectMarkdownFiles(this.storagePath);
    if (!files.length) return 0;

    let imported = 0;
    for (const file of files) {
      try {
        const text = await fs.readFile(file, 'utf-8');
        const parsed = parser.parse(text);
        const stat = await fs.stat(file);

        const parsedId = typeof parsed.id === 'string' ? parsed.id.trim() : '';

        // 已记录 sourceFile 的 Markdown：通常无需导入；但如果历史上因 ID 冲突生成了“新 ID”，需要修复关联，避免 TreeView 出现两个
        const existingBySource = this.prompts.find((p) => p.sourceFile === file);
        if (existingBySource) {
          if (parsedId && existingBySource.id !== parsedId) {
            const correct = this.prompts.find((p) => p.id === parsedId);
            if (correct && correct !== existingBySource) {
              if (correct.sourceFile && correct.sourceFile !== file) {
                console.warn(
                  `[PromptStorageService] Markdown ID=${parsedId} 已绑定到其他文件，跳过合并: ${file} (existing: ${correct.sourceFile})`
                );
              } else {
                if (!correct.sourceFile) {
                  correct.sourceFile = file;
                }
                if (!correct.name?.trim()) {
                  correct.name = parsed.name?.trim() || path.basename(file, path.extname(file));
                }
                if (!correct.emoji && parsed.emoji) {
                  correct.emoji = parsed.emoji;
                }
                if (!correct.content?.trim()) {
                  correct.content = (parsed.content || text).trim();
                }
                if ((!correct.tags || correct.tags.length === 0) && parsed.tags) {
                  correct.tags = parsed.tags;
                }
                correct.updatedAt = stat.mtime.toISOString();

                this.prompts = this.prompts.filter((p) => p !== existingBySource);
                imported += 1;
                console.warn(
                  `[PromptStorageService] 修复 Markdown ID 关联冲突，已合并并移除重复项: ${file} (${existingBySource.id} -> ${parsedId})`
                );
              }
            } else if (!correct) {
              // 若没有同 ID 的 Prompt，且不会与现有 ID 冲突，则直接修正当前记录的 id 与 Markdown 一致
              const oldId = existingBySource.id;
              if (!this.prompts.some((p) => p.id === parsedId)) {
                existingBySource.id = parsedId;
                existingBySource.updatedAt = stat.mtime.toISOString();
                imported += 1;
                console.warn(
                  `[PromptStorageService] 修复 Markdown ID 与记录不一致: ${file} (${oldId} -> ${parsedId})`
                );
              }
            }
          }
          continue;
        }

        if (parsedId) {
          const existing = this.prompts.find((p) => p.id === parsedId);
          if (existing) {
            // 同 ID 的 Prompt 已存在：优先“补齐 sourceFile”，避免导入重复项造成 TreeView 显示两个
            if (!existing.sourceFile) {
              existing.sourceFile = file;
              if (!existing.name?.trim()) {
                existing.name = parsed.name?.trim() || path.basename(file, path.extname(file));
              }
              if (!existing.emoji && parsed.emoji) {
                existing.emoji = parsed.emoji;
              }
              if (!existing.content?.trim()) {
                existing.content = (parsed.content || text).trim();
              }
              if ((!existing.tags || existing.tags.length === 0) && parsed.tags) {
                existing.tags = parsed.tags;
              }
              existing.updatedAt = stat.mtime.toISOString();
              imported += 1;
              console.log(`[PromptStorageService] 已关联同 ID Markdown Prompt: ${existing.name} (${file})`);
            } else if (existing.sourceFile !== file) {
              console.warn(
                `[PromptStorageService] 检测到重复 Prompt ID=${parsedId}，已忽略 Markdown 文件: ${file} (existing: ${existing.sourceFile})`
              );
            }
            continue;
          }
        }

        const prompt: Prompt = {
          id: parsedId || this.makeUniqueId(),
          name: parsed.name?.trim() || path.basename(file, path.extname(file)),
          emoji: parsed.emoji,
          content: (parsed.content || text).trim(),
          createdAt: stat.birthtime.toISOString(),
          updatedAt: stat.mtime.toISOString(),
          sourceFile: file,
          tags: parsed.tags ?? [],
        };

        this.prompts.push(prompt);
        imported += 1;
        console.log(`[PromptStorageService] 从 Markdown 导入 Prompt: ${prompt.name} (${file})`);
      } catch (err) {
        console.error('[PromptStorageService] 导入 Markdown Prompt 失败:', file, err);
      }
    }

    return imported;
  }

  /**
   * 在存储目录中按 Prompt id 定位 Markdown 文件（用于处理外部重命名导致的 sourceFile 失效）
   */
  private async findMarkdownFileById(id: string): Promise<string | undefined> {
    const files = await this.collectMarkdownFiles(this.storagePath);
    if (!files.length) return undefined;

    // 优先基于 frontmatter 中的 id: 行进行快速匹配，避免完整解析
    for (const file of files) {
      try {
        const text = await fs.readFile(file, 'utf-8');
        const fm = this.extractFrontmatter(text);
        if (!fm) continue;

        const m = fm.match(/^id\s*:\s*(.+)\s*$/im);
        const value = m?.[1]?.trim();
        if (value && value.replace(/^['"]|['"]$/g, '') === id) {
          return file;
        }
      } catch {
        // 忽略单文件读取/解析失败，继续扫描
      }
    }

    return undefined;
  }

  private extractFrontmatter(text: string): string | undefined {
    const lines = text.split(/\r?\n/);
    if (!lines.length) return undefined;
    if (lines[0].trim() !== '---') return undefined;

    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === '---') {
        return lines.slice(1, i).join('\n');
      }
    }

    return undefined;
  }

  /** 递归收集存储目录下的 Markdown 文件，忽略常见无关目录 */
  private async collectMarkdownFiles(root: string): Promise<string[]> {
    const result: string[] = [];
    const ignoreDirs = new Set(['.git', 'node_modules', '.vscode', '.obsidian']);
    const ignoreDirPrefixes = ['.otter-backup-'];

    const walk = async (dir: string) => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        console.error('[PromptStorageService] 遍历目录失败:', dir, err);
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (ignoreDirs.has(entry.name)) continue;
          if (ignoreDirPrefixes.some((prefix) => entry.name.startsWith(prefix))) continue;
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          result.push(fullPath);
        }
      }
    };

    await walk(root);
    return result;
  }

  /** 生成不与现有 Prompt 冲突的唯一 ID */
  private makeUniqueId(): string {
    let id = generateId();
    while (this.prompts.some((p) => p.id === id)) {
      id = generateId();
    }
    return id;
  }

  /**
   * 在配置中的 storagePath 变更时，重新加载并触发事件
   */
  async updateStoragePath(newPath: string): Promise<void> {
    console.log('[PromptStorageService] 检测到新的 storagePath:', newPath);
    this.storagePath = newPath;
    this.storageFile = path.join(newPath, 'prompts.json');

    await this.ensureStorageDirectory();
    await this.load();
    const imported = await this.importMarkdownPrompts();
    const pruned = await this.pruneMissingSourceFiles();
    if (imported > 0 || pruned > 0) {
      await this.save();
    } else {
      this._onDidChangePrompts.fire();
    }
  }

  /**
   * 刷新（重新加载）
   */
  async refresh(): Promise<void> {
    if (this.gitDebugLogEnabled) {
      console.log(
        `[PromptStorageService][诊断] refresh() storagePath=${this.storagePath} storageFile=${this.storageFile}`
      );
      console.log(`[PromptStorageService][诊断] refresh() before prompts=${this.prompts.length}`);
    }

    await this.load();
    const imported = await this.importMarkdownPrompts();
    const pruned = await this.pruneMissingSourceFiles();

    if (this.gitDebugLogEnabled) {
      console.log(
        `[PromptStorageService][诊断] refresh() loaded=${this.prompts.length} imported=${imported} pruned=${pruned}`
      );
    }

    if (imported > 0 || pruned > 0) {
      await this.save();
    } else {
      this._onDidChangePrompts.fire();
    }
  }

  /**
   * 清理已删除源文件的 Prompt，避免 TreeView 残留
   */
  private async pruneMissingSourceFiles(): Promise<number> {
    const kept: Prompt[] = [];
    let removed = 0;

    const isBackupPath = (filePath: string) => /(^|[\\/])\.otter-backup-/.test(filePath);

    for (const p of this.prompts) {
      if (!p.sourceFile) {
        kept.push(p);
        continue;
      }

      if (isBackupPath(p.sourceFile)) {
        removed += 1;
        console.warn('[PromptStorageService] 源文件位于备份目录，已忽略 Prompt:', p.name, '(', p.sourceFile, ')');
        continue;
      }

      try {
        await fs.access(p.sourceFile);
        kept.push(p);
      } catch {
        removed += 1;
        console.warn('[PromptStorageService] 源文件不存在，已清理 Prompt:', p.name, '(', p.sourceFile, ')');
      }
    }

    if (removed > 0) {
      this.prompts = kept;
    }

    return removed;
  }
}
