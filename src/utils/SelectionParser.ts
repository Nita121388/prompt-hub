import { ParsedPromptInfo } from '../types/Prompt';
import { ConfigurationService } from '../services/ConfigurationService';

/**
 * 选区解析器
 * 智能识别 # prompt: 标记
 */
export class SelectionParser {
  private readonly PROMPT_HEADER_REGEX = /^#\s*prompt\s*:\s*(.+)$/i;
  // 兼容性考虑：使用常见 emoji 范围匹配开头的 1 个字符
  private readonly EMOJI_REGEX = /^([\u231A-\u27BF\u{1F300}-\u{1FAFF}])\s*(.+)$/u;

  constructor(private configService: ConfigurationService) {}

  /**
   * 解析选区文本
   */
  parse(selectedText: string): ParsedPromptInfo {
    const autoDetect = this.configService.get<boolean>('selection.autoDetectPromptName', true);

    if (!autoDetect) {
      return { content: selectedText };
    }

    const lines = selectedText.split('\n');
    const firstLine = lines[0];

    // 匹配 prompt 标记
    const match = firstLine.match(this.PROMPT_HEADER_REGEX);

    if (match) {
      const fullName = match[1].trim();
      const { emoji, name } = this.extractEmojiAndName(fullName);

      // 移除标记行
      const removeMarker = this.configService.get<boolean>('selection.removePromptMarker', true);
      const content = removeMarker
        ? lines.slice(1).join('\n').trim()
        : selectedText;

      return { name, emoji, content };
    }

    // 未检测到标记，返回原内容
    return { content: selectedText };
  }

  /**
   * 提取 emoji 和名称
   */
  private extractEmojiAndName(text: string): { emoji?: string; name: string } {
    const match = text.match(this.EMOJI_REGEX);

    if (match) {
      return { emoji: match[1], name: match[2].trim() };
    }

    return { name: text };
  }
}
