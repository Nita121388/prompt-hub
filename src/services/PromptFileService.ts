import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigurationService } from './ConfigurationService';
import { PromptStorageService } from './PromptStorageService';
import { generateId } from '../utils/helpers';
import { Prompt } from '../types/Prompt';

/**
 * Prompt 文件服务
 * 负责：
 * - 创建 Markdown 模板文件并在编辑器中打开
 * - 在 Markdown 镜像未生效时，作为兜底把新文件登记到 PromptStorageService 中
 */
export class PromptFileService {
  constructor(
    private readonly configService: ConfigurationService,
    private readonly storageService?: PromptStorageService
  ) {}

  /**
   * 新建 Prompt Markdown 文件并在编辑器中打开
   */
  async createPromptFile(): Promise<void> {
    console.log('[PromptFileService] 开始创建 Prompt 文件');

    // 读取配置
    const storagePath = this.configService.getStoragePath();
    const template = this.configService.get<string>(
      'markdown.filenameTemplate',
      'prompt-{timestamp}.md'
    );
    const askForFilename = this.configService.get<boolean>('markdown.askForFilename', false);
    console.log('[PromptFileService] 存储路径:', storagePath);
    console.log('[PromptFileService] 文件名模板:', template);
    console.log('[PromptFileService] 是否询问文件名:', askForFilename);

    // 生成默认文件名（使用时间戳等占位符）
    let defaultName = this.formatFilename(template, {});
    console.log('[PromptFileService] 生成的默认文件名:', defaultName);

    // 如配置要求，创建时询问用户文件名
    if (askForFilename) {
      const input = await vscode.window.showInputBox({
        title: '新建 Prompt 文件',
        prompt: '请输入文件名（仅文件名，不含路径；可留空使用默认）',
        value: defaultName,
        placeHolder: '例如：我的提示.md',
      });

      // 用户取消则直接退出，不创建文件
      if (input === undefined) {
        console.log('[PromptFileService] 用户取消输入文件名，终止创建流程');
        return;
      }

      const picked = input.trim();
      defaultName = picked || defaultName;
      if (!defaultName.toLowerCase().endsWith('.md')) {
        defaultName += '.md';
      }
      console.log('[PromptFileService] 用户输入的文件名:', defaultName);
    }

    // 再做一遍简单清洗，防止非法字符
    const finalName = this.sanitizeFilename(defaultName);
    console.log('[PromptFileService] 清洗后的文件名:', finalName);

    // 确保存储目录存在
    await fs.mkdir(storagePath, { recursive: true });

    // 生成不重复的文件路径（如 prompt-x-1.md）
    const filepath = await this.makeUniquePath(path.join(storagePath, finalName));
    console.log('[PromptFileService] 最终文件路径:', filepath);

    // 写入默认内容（Obsidian 风格 frontmatter）
    const { id: templateId, content } = this.defaultMarkdownContent();
    console.log('[PromptFileService] 文件内容长度:', content.length, '字符');
    console.log('[PromptFileService] 文件内容预览:', content.substring(0, 100));
    await fs.writeFile(filepath, content, 'utf-8');
    console.log('[PromptFileService] 文件写入成功');

    // 打开文档并显示到编辑器
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filepath));
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    console.log('[PromptFileService] 文档已在编辑器中打开');

    // 主动保存一次以触发 MarkdownMirrorService.onDidSave
    console.log('[PromptFileService] 尝试触发 Markdown 镜像同步');
    let saveResult = false;
    try {
      saveResult = await doc.save();
      console.log('[PromptFileService] 初次保存结果:', saveResult);
    } catch (err) {
      console.error('[PromptFileService] 初次保存失败:', err);
    }

    // 如果有存储服务，则兜底检查是否已被 MarkdownMirrorService 同步
    if (this.storageService) {
      console.log('[PromptFileService] 检查是否已通过 Markdown 镜像同步 (saveResult:', saveResult, ')');

      // 稍等片刻，给 onDidSave 一点时间
      await new Promise((resolve) => setTimeout(resolve, 200));

      const prompts = this.storageService.list();
      console.log('[PromptFileService] 当前存储中已有 Prompt 数量:', prompts.length);
      const synced = prompts.some((p) => p.sourceFile === filepath);

      if (!synced) {
        console.log('[PromptFileService] 未检测到自动镜像，同步到 JSON（兜底逻辑）...');
        const filename = path.basename(filepath, '.md');

        // 使用模板里的 id，保证与 frontmatter 中保持一致
        const id = templateId || generateId();

        // 从内容里尝试提取标题：
        // - 优先匹配 "# prompt: 标题"
        // - 其次匹配普通 H1 "# 标题"
        const promptHeaderMatch = content.match(/^#\s*prompt\s*:\s*(.+)$/im);
        const h1Match = content.match(/^#\s+(.+)$/m);
        let promptName = (promptHeaderMatch || h1Match)?.[1].trim() ?? filename;

        // 如果还是默认标题“在此填写标题”，则改用文件名，避免 TreeView 上一堆重复标题
        if (promptName === '在此填写标题') {
          console.log('[PromptFileService] 检测到默认标题，改用文件名作为名称:', filename);
          promptName = filename;
        }

        console.log('[PromptFileService] 兜底创建 Prompt，name:', promptName, ', id:', id);

        const prompt: Prompt = {
          id,
          name: promptName,
          emoji: undefined,
          // 兜底内容使用简单的占位说明，避免和文件正文强耦合
          content: '在此编写 Prompt 正文内容...',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sourceFile: filepath,
          tags: [],
        };

        try {
          await this.storageService.add(prompt);
          console.log('[PromptFileService] 兜底同步成功，Prompt ID:', id);
          vscode.window.showInformationMessage(`已创建 Prompt：${filename}`);
        } catch (err) {
          console.error('[PromptFileService] 兜底同步失败:', err);
          vscode.window.showErrorMessage(`创建 Prompt 失败：${String(err)}`);
        }
      } else {
        console.log('[PromptFileService] Prompt 已通过 Markdown 镜像自动同步');
      }
    } else {
      console.log('[PromptFileService] storageService 未配置，跳过兜底同步逻辑');
    }

    // 光标定位：默认选中第一行标题中的“在此填写标题”方便用户直接修改
    const firstLine = doc.lineAt(0).text;
    const titleKeyword = '在此填写标题';
    const titleStart = doc.getText().indexOf(titleKeyword);
    if (titleStart !== -1) {
      const position = doc.positionAt(titleStart);
      const endPosition = doc.positionAt(titleStart + titleKeyword.length);
      editor.selection = new vscode.Selection(position, endPosition);
      editor.revealRange(new vscode.Range(position, endPosition), vscode.TextEditorRevealType.InCenter);
    } else {
      // 如果没找到，就把光标放在文件末尾
      const lastLine = doc.lineCount - 1;
      const pos = new vscode.Position(lastLine, doc.lineAt(lastLine).text.length);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }

    console.log('[PromptFileService] 新建 Prompt 文件流程结束');
  }

  /**
   * 根据模板生成文件名
   * 支持占位符 {timestamp} / {date} / {name} / {emoji}
   */
  private formatFilename(template: string, ctx?: { name?: string; emoji?: string }): string {
    const now = new Date();
    const pad = (n: number) => `${n}`.padStart(2, '0');
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const timestamp = `${date}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(
      now.getSeconds()
    )}`;

    let name = template
      .replace(/\{timestamp\}/g, timestamp)
      .replace(/\{date\}/g, date)
      .replace(/\{name\}/g, this.sanitizeFilename((ctx?.name || '').trim()))
      .replace(/\{emoji\}/g, this.sanitizeFilename((ctx?.emoji || '').trim()));

    if (!name.toLowerCase().endsWith('.md')) {
      name += '.md';
    }

    name = this.sanitizeFilename(name);

    // 防御性处理：如果模板依赖 {name}/{emoji} 但上下文为空，可能生成空文件名（例如 ".md" / "-.md"）
    const parsed = path.parse(name);
    const onlySeparators = parsed.name.replace(/[-_\\s]/g, '').length === 0;
    if (!parsed.name || onlySeparators) {
      return this.sanitizeFilename(`prompt-${timestamp}.md`);
    }

    return name;
  }

  /**
   * 清洗文件名：去掉非法字符、多余空格等
   */
  private sanitizeFilename(name: string): string {
    // Windows 非法字符 \/:*?"<>| 以及多余空格
    return name
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 生成唯一路径，必要时自动在文件名后追加 -1, -2, ...
   */
  private async makeUniquePath(target: string): Promise<string> {
    const dir = path.dirname(target);
    const ext = path.extname(target);
    const base = path.basename(target, ext);

    let candidate = target;
    let i = 1;
    while (true) {
      try {
        await fs.access(candidate);
        // 文件已存在，尝试下一个
        candidate = path.join(dir, `${base}-${i}${ext}`);
        i += 1;
      } catch {
        return candidate; // 不存在，可以使用
      }
    }
  }

  /**
   * 默认 Markdown 内容（Obsidian 风格，含 frontmatter，不再包含 HTML 注释 ID）
   */
  private defaultMarkdownContent(): { id: string; content: string } {
    const id = generateId();
    const lines = [
      '---',
      `id: ${id}`,
      'type: prompt',
      'tags: [prompt]',
      '---',
      '',
      '# 在此填写标题',
      '',
      '在此编写 Prompt 正文内容...',
      '',
    ];

    return {
      id,
      content: lines.join('\n'),
    };
  }
}
