import * as vscode from 'vscode';
import * as path from 'path';
import { PromptStorageService } from './PromptStorageService';
import { ConfigurationService } from './ConfigurationService';
import { SelectionParser } from '../utils/SelectionParser';
import { Prompt } from '../types/Prompt';
import { generateId } from '../utils/helpers';

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
    const disposable = vscode.workspace.onDidSaveTextDocument(async (doc) => {
      try {
        await this.onDidSave(doc);
      } catch (err) {
        console.error('保存时同步到 JSON 失败', err);
      }
    });
    context.subscriptions.push(disposable);
  }

  /**
   * 绑定存储变更事件 → 导出为 Markdown
   */
  bindOnStorageChange(context: vscode.ExtensionContext): void {
    const disposable = this.storage.onDidChangePrompts(async () => {
      try {
        await this.exportAllToMarkdown();
      } catch (err) {
        console.error('JSON 变更导出 Markdown 失败', err);
      }
    });
    context.subscriptions.push(disposable as unknown as vscode.Disposable);
  }

  private async onDidSave(doc: vscode.TextDocument): Promise<void> {
    const enable = this.config.get<boolean>('markdown.enableMirror', false);
    if (!enable) return;

    // 仅处理 Markdown 文件
    const isMarkdown = doc.languageId === 'markdown' || doc.fileName.toLowerCase().endsWith('.md');
    if (!isMarkdown) return;

    // 仅处理存储目录内文件，避免干扰其他 Markdown
    const storagePath = this.config.getStoragePath();
    if (!this.isInside(storagePath, doc.uri.fsPath)) return;

    const text = doc.getText();
    const parser = new SelectionParser(this.config);
    const parsed = parser.parse(text);

    const filePath = doc.uri.fsPath;
    const fallbackName = path.basename(filePath, path.extname(filePath));
    const name = parsed.name?.trim() || fallbackName;
    const content = (parsed.content ?? text).trim();
    const emoji = parsed.emoji;

    // 优先根据内嵌 ID 或 sourceFile 匹配已有 Prompt
    const all = this.storage.list();
    const idInFile = this.extractIdMarker(text);
    const existing = idInFile
      ? this.storage.getById(idInFile)
      : all.find((p) => p.sourceFile === filePath);

    if (existing) {
      const updated: Prompt = {
        ...existing,
        name,
        emoji,
        content,
        updatedAt: new Date().toISOString(),
        sourceFile: filePath,
      };
      await this.storage.update(updated);
      vscode.window.showInformationMessage(`已更新 Prompt：${name}`);
      return;
    }

    // 新建 Prompt，处理可能的重名
    const base: Omit<Prompt, 'id'> = {
      name,
      emoji,
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceFile: filePath,
      tags: [],
    };

    await this.addWithUniqueName(base);
    vscode.window.showInformationMessage(`已创建 Prompt：${name}`);
  }

  /**
   * 导出全部 Prompt 到 Markdown（基于存储路径）
   */
  private async exportAllToMarkdown(): Promise<void> {
    const enable = this.config.get<boolean>('markdown.enableMirror', false);
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
    const header = `# prompt: ${p.emoji ? p.emoji + ' ' : ''}${p.name}`.trimEnd();
    const idMarker = `<!-- PromptHub:id=${p.id} -->`;
    return `${header}\n\n${p.content}\n\n${idMarker}\n`;
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
}
