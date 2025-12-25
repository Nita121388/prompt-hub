import { ConfigurationService } from '../services/ConfigurationService';
import { SelectionParser } from './SelectionParser';

/**
 * Markdown Prompt 解析结果
 * 用于 Obsidian 风格 Markdown 中提取 Prompt 元数据
 */
export interface ParsedMarkdownPrompt {
  /** frontmatter 或注释中的 ID */
  id?: string;
  /** 提取的名称（标题） */
  name?: string;
  /** 提取的 emoji */
  emoji?: string;
  /** frontmatter 中声明的标签 */
  tags?: string[];
  /** 是否允许保存时自动重命名文件（frontmatter: rename: true/false） */
  rename?: boolean;
  /** 正文内容（不含 frontmatter 和标题行） */
  content: string;
}

/**
 * Obsidian 风格 Markdown Prompt 解析器
 * - 支持解析 YAML frontmatter（id/name/emoji/tags/type）
 * - 标题与正文解析复用 SelectionParser 的规则
 */
export class MarkdownPromptParser {
  constructor(private readonly configService: ConfigurationService) {}

  /**
   * 解析完整 Markdown 文本
   */
  parse(text: string): ParsedMarkdownPrompt {
    const { frontmatter, body } = this.splitFrontmatter(text);
    const meta = this.parseFrontmatter(frontmatter);

    // 使用现有 SelectionParser 解析正文标题和 emoji
    const selectionParser = new SelectionParser(this.configService);
    // 去掉正文开头多余的空行，避免因 frontmatter 后的空行导致解析失败
    const normalizedBody = this.normalizeBody(body);
    const parsedBody = selectionParser.parse(normalizedBody);

    const name = meta.name ?? parsedBody.name;
    const emoji = meta.emoji ?? parsedBody.emoji;
    const tags = meta.tags;
    const rename = meta.rename;
    const content = (parsedBody.content ?? normalizedBody).trim();

    return {
      id: meta.id,
      name,
      emoji,
      tags,
      rename,
      content,
    };
  }

  /**
   * 拆分 frontmatter 与正文
   * 不符合 frontmatter 规范时，frontmatter 为空字符串，全部作为正文
   */
  private splitFrontmatter(text: string): { frontmatter: string; body: string } {
    const lines = text.split(/\r?\n/);

    if (lines.length === 0) {
      return { frontmatter: '', body: '' };
    }

    // 必须以 --- 起始才视为 frontmatter
    if (lines[0].trim() !== '---') {
      return { frontmatter: '', body: text };
    }

    let endIndex = -1;
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === '---') {
        endIndex = i;
        break;
      }
    }

    // 未找到结束分隔符，视为无 frontmatter
    if (endIndex === -1) {
      return { frontmatter: '', body: text };
    }

    const frontmatterLines = lines.slice(1, endIndex);
    const bodyLines = lines.slice(endIndex + 1);

    return {
      frontmatter: frontmatterLines.join('\n'),
      body: bodyLines.join('\n'),
    };
  }

  /**
   * 解析 frontmatter，当前只关心 id/name/emoji/tags/type
   * 为保持简单，仅支持 key: value 的单行形式
   */
  private parseFrontmatter(raw: string): {
    id?: string;
    name?: string;
    emoji?: string;
    tags?: string[];
    type?: string;
    rename?: boolean;
  } {
    const result: {
      id?: string;
      name?: string;
      emoji?: string;
      tags?: string[];
      type?: string;
      rename?: boolean;
    } = {};

    if (!raw.trim()) {
      return result;
    }

    const lines = raw.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (!match) continue;

      const key = match[1];
      const value = match[2].trim();

      switch (key) {
        case 'id':
          if (value) {
            result.id = this.stripQuotes(value);
          }
          break;
        case 'name':
          if (value) {
            result.name = this.stripQuotes(value);
          }
          break;
        case 'emoji':
          if (value) {
            result.emoji = this.stripQuotes(value);
          }
          break;
        case 'tags':
          if (value) {
            result.tags = this.parseTags(value);
          }
          break;
        case 'type':
          if (value) {
            result.type = this.stripQuotes(value);
          }
          break;
        case 'rename': {
          const parsed = this.parseBoolean(value);
          if (parsed !== undefined) {
            result.rename = parsed;
          }
          break;
        }
        default:
          // 其他字段暂时忽略
          break;
      }
    }

    return result;
  }

  private parseBoolean(raw: string): boolean | undefined {
    const v = this.stripQuotes(raw).trim().toLowerCase();
    if (!v) return undefined;

    if (['true', 'yes', 'y', '1', 'on'].includes(v)) return true;
    if (['false', 'no', 'n', '0', 'off'].includes(v)) return false;
    return undefined;
  }

  /**
   * 解析 tags 字段，支持几种常见写法：
   * - [a, b, c]
   * - a, b, c
   * - single
   */
  private parseTags(raw: string): string[] {
    let text = this.stripQuotes(raw).trim();

    if (!text) return [];

    // 数组写法：tags: [a, b, c]
    if (text.startsWith('[') && text.endsWith(']')) {
      text = text.slice(1, -1).trim();
    }

    // 以逗号分隔
    if (text.includes(',')) {
      return text
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    }

    // 单个标签
    return [text];
  }

  /**
   * 去掉首尾配对引号
   */
  private stripQuotes(value: string): string {
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
    return value;
  }

  /**
   * 规范化正文内容
   * - 去掉开头的空行，保证第一行是有效文本（例如 H1 标题）
   */
  private normalizeBody(body: string): string {
    if (!body) return body;

    const lines = body.split(/\r?\n/);
    let start = 0;

    while (start < lines.length && lines[start].trim() === '') {
      start += 1;
    }

    return lines.slice(start).join('\n');
  }
}
