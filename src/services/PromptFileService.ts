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
    const askForFilename = this.configService.get<boolean>(
      'markdown.askForFilename',
      false
    );
    const template = this.configService.get<string>(
      'markdown.filenameTemplate',
      'prompt-{timestamp}.md'
    );

    // 若模板包含 {name} / {emoji}，尝试获取占位符值
    let nameForTemplate: string | undefined;
    let emojiForTemplate: string | undefined;
    if (template.includes('{name}')) {
      nameForTemplate = await vscode.window.showInputBox({
        prompt: '输入 Prompt 名称（用于文件名模板 {name}）',
        value: ''
      });
    }
    if (template.includes('{emoji}')) {
      emojiForTemplate = await vscode.window.showInputBox({
        prompt: '输入 emoji（用于文件名模板 {emoji}，可留空）',
        value: ''
      });
      if (emojiForTemplate) {
        emojiForTemplate = emojiForTemplate.trim();
      }
    }

    // 生成默认文件名
    const defaultName = this.formatFilename(template, {
      name: nameForTemplate,
      emoji: emojiForTemplate,
    });

    // 可选：询问文件名
    let finalName = defaultName;
    if (askForFilename) {
      const input = await vscode.window.showInputBox({
        prompt: '输入文件名（将保存在存储路径中）',
        value: defaultName,
        validateInput: (val) =>
          this.sanitizeFilename(val).length === 0 ? '文件名不能为空' : undefined,
      });
      if (!input) return; // 用户取消
      finalName = input.endsWith('.md') ? input : `${input}.md`;
    }

    // 归一化与清洗
    finalName = this.sanitizeFilename(finalName);

    // 确保存储目录存在
    await fs.mkdir(storagePath, { recursive: true });

    // 生成不重复路径
    const filepath = await this.makeUniquePath(path.join(storagePath, finalName));

    // 写入默认内容（中文注释与模板）
    const content = this.defaultMarkdownContent();
    await fs.writeFile(filepath, content, 'utf-8');

    // 打开文档并将光标定位到正文区域
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filepath));
    const editor = await vscode.window.showTextDocument(doc, { preview: false });

    // 光标定位到第 3 行（正文起始处）
    const line = Math.min(2, doc.lineCount - 1);
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);

    vscode.window.showInformationMessage('已创建新的 Prompt 文件');
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
