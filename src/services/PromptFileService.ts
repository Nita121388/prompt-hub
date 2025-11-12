import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigurationService } from './ConfigurationService';

/**
 * Prompt 文件服务
 * 负责创建 Markdown 模板文件并打开到编辑器
 */
export class PromptFileService {
  constructor(private readonly configService: ConfigurationService) {}

  /**
   * 新建 Prompt Markdown 文件并打开到编辑器
   */
  async createPromptFile(): Promise<void> {
    // 读取配置
    const storagePath = this.configService.getStoragePath();
    const template = this.configService.get<string>(
      'markdown.filenameTemplate',
      'prompt-{timestamp}.md'
    );

    // 生成默认文件名（使用时间戳，不再询问）
    const defaultName = this.formatFilename(template, {});

    // 归一化与清洗
    const finalName = this.sanitizeFilename(defaultName);

    // 确保存储目录存在
    await fs.mkdir(storagePath, { recursive: true });

    // 生成不重复路径
    const filepath = await this.makeUniquePath(path.join(storagePath, finalName));

    // 写入默认内容（中文注释与模板）
    const content = this.defaultMarkdownContent();
    await fs.writeFile(filepath, content, 'utf-8');

    // 打开文档并将光标定位到标题处
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filepath));
    const editor = await vscode.window.showTextDocument(doc, { preview: false });

    // 光标定位到第 1 行标题处，选中"在此填写标题"文字
    const firstLine = doc.lineAt(0).text;
    const titleStart = firstLine.indexOf('在此填写标题');
    if (titleStart !== -1) {
      const start = new vscode.Position(0, titleStart);
      const end = new vscode.Position(0, titleStart + '在此填写标题'.length);
      editor.selection = new vscode.Selection(start, end);
      editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
    } else {
      // 如果找不到，定位到行尾
      const pos = new vscode.Position(0, firstLine.length);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }

    vscode.window.showInformationMessage('📝 已创建新的 Prompt 文件');
  }

  /**
   * 生成基于模板的文件名
   * 支持占位符：{timestamp}、{date}
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
    return this.sanitizeFilename(name);
  }

  /**
   * 清洗文件名（移除不合法字符）
   */
  private sanitizeFilename(name: string): string {
    // Windows 非法字符 \/:*?"<>| 以及前后空格
    return name
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 生成唯一路径（若存在则追加 -1, -2, ...）
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
        // 已存在，生成下一个候选
        candidate = path.join(dir, `${base}-${i}${ext}`);
        i += 1;
      } catch {
        return candidate; // 不存在，可用
      }
    }
  }

  /**
   * 默认 Markdown 内容
   */
  private defaultMarkdownContent(): string {
    return `# prompt: 在此填写标题\n\n在此编写 Prompt 正文内容...\n`;
  }
}
