import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PromptStorageService } from './PromptStorageService';
import { ConfigurationService } from './ConfigurationService';
import { Prompt } from '../types/Prompt';
import { generateId } from '../utils/helpers';
import { MarkdownPromptParser } from '../utils/MarkdownPromptParser';

/**
 * Markdown 镜像服务
 * - 监听 Markdown 文件保存
 * - 将内容同步到 JSON 存储（新增或更新）
 */
export class MarkdownMirrorService {
  constructor(
    private readonly storage: PromptStorageService,
    private readonly config: ConfigurationService
  ) {}

  /**
   * 绑定保存事件
   */
  bindOnSave(context: vscode.ExtensionContext): void {
    console.log('[MarkdownMirrorService] 开始绑定保存事件监听器');
    const disposable = vscode.workspace.onDidSaveTextDocument(async (doc) => {
      console.log('[MarkdownMirrorService] ===== 保存事件触发 =====');
      console.log('[MarkdownMirrorService] 触发文件:', doc.uri.fsPath);
      try {
        await this.onDidSave(doc);
      } catch (err) {
        console.error('[MarkdownMirrorService] 保存时同步到 JSON 失败', err);
      }
    });
    context.subscriptions.push(disposable);
    console.log('[MarkdownMirrorService] 保存事件监听器已绑定');
  }

  /**
   * 绑定存储变更事件 → 导出为 Markdown
   * 注意：为避免循环触发，暂时禁用自动导出功能
   * 用户保存Markdown文件时，已经通过onDidSave同步到JSON
   * 不需要再反向导出
   */
  bindOnStorageChange(context: vscode.ExtensionContext): void {
    // 暂时禁用自动导出，避免循环触发和覆盖用户编辑
    // const disposable = this.storage.onDidChangePrompts(async () => {
    //   try {
    //     await this.exportAllToMarkdown();
    //   } catch (err) {
    //     console.error('JSON 变更导出 Markdown 失败', err);
    //   }
    // });
    // context.subscriptions.push(disposable as unknown as vscode.Disposable);

    console.log('[MarkdownMirrorService] 跳过绑定存储变更事件（避免覆盖用户编辑）');
  }

  private async onDidSave(doc: vscode.TextDocument): Promise<void> {
    console.log('[MarkdownMirrorService] 检测到文件保存事件:', doc.uri.fsPath);

    const enable = this.config.get<boolean>('markdown.enableMirror', true);
    console.log('[MarkdownMirrorService] Markdown镜像是否启用:', enable);
    if (!enable) {
      console.log('[MarkdownMirrorService] Markdown镜像未启用，跳过同步');
      return;
    }

    // 仅处理 Markdown 文件
    const isMarkdown = doc.languageId === 'markdown' || doc.fileName.toLowerCase().endsWith('.md');
    console.log('[MarkdownMirrorService] 文件类型检查 - languageId:', doc.languageId, ', isMarkdown:', isMarkdown);
    if (!isMarkdown) {
      console.log('[MarkdownMirrorService] 非Markdown文件，跳过处理');
      return;
    }

    // 仅处理存储目录内文件，避免干扰其他 Markdown
    const storagePath = this.config.getStoragePath();
    const isInStoragePath = this.isInside(storagePath, doc.uri.fsPath);
    console.log('[MarkdownMirrorService] 路径检查 - 存储路径:', storagePath);
    console.log('[MarkdownMirrorService] 路径检查 - 文件路径:', doc.uri.fsPath);
    console.log('[MarkdownMirrorService] 路径检查 - 是否在存储目录内:', isInStoragePath);
    if (!isInStoragePath) {
      console.log('[MarkdownMirrorService] 文件不在存储目录内，跳过处理');
      return;
    }

    const text = doc.getText();
    console.log('[MarkdownMirrorService] 文件内容长度:', text.length, '字符');

    const parser = new MarkdownPromptParser(this.config);
    const parsed = parser.parse(text);
    console.log('[MarkdownMirrorService] 解析结果 - name:', parsed.name, ', emoji:', parsed.emoji);

    const filePath = doc.uri.fsPath;
    const fallbackName = path.basename(filePath, path.extname(filePath));
    let name = parsed.name?.trim() || fallbackName;

    // 如果标题是默认值"在此填写标题"，使用文件名作为名称（避免重复冲突）
    if (name === '在此填写标题') {
      console.log('[MarkdownMirrorService] 检测到默认标题，使用文件名:', fallbackName);
      name = fallbackName;
    }

    const content = (parsed.content ?? text).trim();
    const emoji = parsed.emoji;
    console.log('[MarkdownMirrorService] 最终数据 - name:', name, ', emoji:', emoji, ', content长度:', content.length);

    // 优先根据内嵌 ID 或 sourceFile 匹配已有 Prompt
    const all = this.storage.list();
    const idInFile = parsed.id || this.extractIdMarker(text);
    console.log('[MarkdownMirrorService] 提取的ID标记:', idInFile);
    console.log('[MarkdownMirrorService] 当前存储中的Prompt数量:', all.length);

    const existing = idInFile
      ? this.storage.getById(idInFile)
      : all.find((p) => p.sourceFile === filePath);
    console.log('[MarkdownMirrorService] 查找已存在的Prompt:', existing ? `找到 (id: ${existing.id})` : '未找到');

    if (existing) {
      console.log('[MarkdownMirrorService] 更新现有Prompt - id:', existing.id, ', 原name:', existing.name, ', 新name:', name);
      const updated: Prompt = {
        ...existing,
        name,
        emoji,
        content,
        updatedAt: new Date().toISOString(),
        sourceFile: filePath,
        ...(parsed.tags ? { tags: parsed.tags } : {}),
      };
      await this.storage.update(updated);
      console.log('[MarkdownMirrorService] Prompt更新成功');

      // 如果启用了文件名与标题关联，检查是否需要重命名文件
      await this.renameFileIfNeeded(filePath, name, emoji);

      vscode.window.showInformationMessage(`已更新 Prompt：${name}`);
      return;
    }

    // 新建 Prompt，处理可能的重名
    console.log('[MarkdownMirrorService] 创建新Prompt');
    const base: Omit<Prompt, 'id'> = {
      name,
      emoji,
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceFile: filePath,
      tags: parsed.tags ?? [],
    };

    await this.addWithUniqueName(base);
    console.log('[MarkdownMirrorService] 新Prompt创建成功');
    vscode.window.showInformationMessage(`已创建 Prompt：${name}`);
  }

  /**
   * 导出全部 Prompt 到 Markdown（基于存储路径）
   */
  private async exportAllToMarkdown(): Promise<void> {
    const enable = this.config.get<boolean>('markdown.enableMirror', true);
    if (!enable) return;

    const storagePath = this.config.getStoragePath();
    const prompts = this.storage.list();
    await Promise.all(
      prompts.map(async (p) => {
        const target = await this.computeTargetPath(storagePath, p);
        const body = this.composeMarkdown(p);
        try {
          await vscode.workspace.fs.writeFile(vscode.Uri.file(target), Buffer.from(body, 'utf8'));
        } catch (e) {
          console.error('导出 Markdown 失败: ', target, e);
        }
      })
    );
  }

  /**
   * 生成目标路径：优先使用 sourceFile；否则使用基于名称的路径，冲突时附加 -id
   */
  private async computeTargetPath(root: string, prompt: Prompt): Promise<string> {
    if (prompt.sourceFile) return prompt.sourceFile;
    const base = this.sanitize(`${prompt.name || 'prompt'}.md`);
    const target = path.join(root, base);
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(target));
      // 已存在但不是当前 prompt 的映射，退回到带 id 的文件名
      return path.join(root, this.sanitize(`${prompt.name}-${prompt.id}.md`));
    } catch {
      return target;
    }
  }

  /**
   * 组合 Markdown 内容（包含 ID 标记，避免重复创建）
   */
  private composeMarkdown(p: Prompt): string {
    const frontmatterLines = [
      '---',
      `id: ${p.id}`,
      'type: prompt',
      p.emoji ? `emoji: ${p.emoji}` : undefined,
      p.tags && p.tags.length ? `tags: [${p.tags.join(', ')}]` : undefined,
      '---',
      '',
    ].filter(Boolean) as string[];

    const titleLine = `# ${p.emoji ? p.emoji + ' ' : ''}${p.name}`.trimEnd();

    return [...frontmatterLines, titleLine, '', p.content, ''].join('\n');
  }

  private extractIdMarker(text: string): string | undefined {
    const m = text.match(/<!--\s*PromptHub:id=([\w-]+)\s*-->/i);
    return m?.[1];
  }

  private sanitize(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  }

  private async addWithUniqueName(base: Omit<Prompt, 'id'>): Promise<void> {
    let candidate = base.name;
    let i = 1;
    while (true) {
      try {
        await this.storage.add({ id: generateId(), ...base, name: candidate });
        return;
      } catch (e) {
        // 若名称冲突，换下一个名称
        candidate = `${base.name}-${i}`;
        i += 1;
        if (i > 50) throw e; // 保护性退出
      }
    }
  }

  private isInside(root: string, target: string): boolean {
    const rel = path.relative(path.resolve(root), path.resolve(target));
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  /**
   * 根据标题重命名文件（如果需要）
   * 仅当文件名是时间戳格式时才重命名
   */
  private async renameFileIfNeeded(
    currentPath: string,
    name: string,
    emoji?: string
  ): Promise<void> {
    const currentFilename = path.basename(currentPath, '.md');

    // 检查当前文件名是否是时间戳格式 (prompt-YYYYMMDD-HHMMSS 或类似格式)
    const timestampPattern = /^prompt-\d{8}-\d{6}(-\d+)?$/;
    if (!timestampPattern.test(currentFilename)) {
      // 文件名已经被用户自定义过，不再自动重命名
      console.log('[MarkdownMirrorService] 文件名非时间戳格式，跳过重命名');
      return;
    }

    // 生成新文件名
    const sanitizedName = this.sanitize(name);
    const emojiPart = emoji ? `${emoji}-` : '';
    const newFilename = `${emojiPart}${sanitizedName}.md`;
    const dir = path.dirname(currentPath);
    let newPath = path.join(dir, newFilename);

    console.log('[MarkdownMirrorService] 准备重命名文件:', currentPath, '->', newPath);

    // 确保新文件名不冲突
    let counter = 1;
    while (true) {
      try {
        await fs.access(newPath);
        // 文件已存在，如果是同一个文件则跳过
        if (path.resolve(newPath) === path.resolve(currentPath)) {
          console.log('[MarkdownMirrorService] 新旧文件名相同，跳过重命名');
          return;
        }
        // 否则生成带编号的文件名
        newPath = path.join(dir, `${emojiPart}${sanitizedName}-${counter}.md`);
        counter++;
      } catch {
        // 文件不存在，可以使用
        break;
      }
    }

    // 重命名文件
    try {
      console.log('[MarkdownMirrorService] 开始重命名文件');
      await fs.rename(currentPath, newPath);
      console.log('[MarkdownMirrorService] 文件重命名成功');

      // 更新存储中的 sourceFile 路径（不触发save，避免循环）
      const all = this.storage.list();
      const prompt = all.find((p) => p.sourceFile === currentPath);
      if (prompt) {
        console.log('[MarkdownMirrorService] 更新存储中的sourceFile路径');
        // 直接修改，不调用update以避免触发事件
        prompt.sourceFile = newPath;
        // 手动保存，但不触发事件
        await this.storage['save']();
        console.log('[MarkdownMirrorService] sourceFile路径已更新');
      }

      // 关闭旧文档并打开新文档
      const oldDoc = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.fsPath === currentPath
      );
      if (oldDoc) {
        console.log('[MarkdownMirrorService] 切换编辑器到新文件');
        await vscode.window.showTextDocument(oldDoc);
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        const newDoc = await vscode.workspace.openTextDocument(newPath);
        await vscode.window.showTextDocument(newDoc, { preview: false });
        console.log('[MarkdownMirrorService] 编辑器已切换');
      }
    } catch (err) {
      console.error('[MarkdownMirrorService] 重命名文件失败:', err);
    }
  }
}
