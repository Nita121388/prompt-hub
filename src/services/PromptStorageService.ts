import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Prompt, PromptStorage } from '../types/Prompt';
import { ConfigurationService } from './ConfigurationService';

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

  /**
   * 初始化存储服务
   */
  async initialize(): Promise<void> {
    try {
      // 确保存储目录存在
      await this.ensureStorageDirectory();

      // 加载 Prompt 数据
      await this.load();

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
        console.log(`已创建存储目录: ${this.storagePath}`);
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
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // 文件不存在，初始化为空
        this.prompts = [];
        await this.save();
        console.log('初始化空的 Prompt 存储文件');
      } else {
        throw error;
      }
    }
  }

  /**
   * 保存 Prompt 数据
   */
  private async save(): Promise<void> {
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
      // 清理临时文件
      try {
        await fs.unlink(tempFile);
      } catch {}
      throw error;
    }

    // 触发变更事件
    this._onDidChangePrompts.fire();
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
   * 添加新 Prompt
   */
  async add(prompt: Prompt): Promise<void> {
    // 检查名称是否重复
    if (this.prompts.some((p) => p.name === prompt.name)) {
      throw new Error(`Prompt 名称 "${prompt.name}" 已存在`);
    }

    this.prompts.push(prompt);
    await this.save();
  }

  /**
   * 更新 Prompt
   */
  async update(prompt: Prompt): Promise<void> {
    const index = this.prompts.findIndex((p) => p.id === prompt.id);

    if (index === -1) {
      throw new Error(`Prompt ID "${prompt.id}" 不存在`);
    }

    // 检查名称冲突（排除自身）
    if (
      this.prompts.some((p) => p.id !== prompt.id && p.name === prompt.name)
    ) {
      throw new Error(`Prompt 名称 "${prompt.name}" 已存在`);
    }

    prompt.updatedAt = new Date().toISOString();
    this.prompts[index] = prompt;
    await this.save();
  }

  /**
   * 删除 Prompt
   */
  async remove(id: string): Promise<Prompt | undefined> {
    const index = this.prompts.findIndex((p) => p.id === id);

    if (index === -1) {
      return undefined;
    }

    const removed = this.prompts.splice(index, 1)[0];
    await this.save();

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
   * 刷新（重新加载）
   */
  async refresh(): Promise<void> {
    await this.load();
    this._onDidChangePrompts.fire();
  }
}
