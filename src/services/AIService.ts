import * as vscode from 'vscode';
import { ConfigurationService } from './ConfigurationService';

export interface GeneratedMeta {
  name?: string;
  emoji?: string;
}

/**
 * AI 服务：封装元信息生成与内容优化
 */
export class AIService {
  constructor(private readonly config: ConfigurationService) {}

  private async getApiKey(): Promise<string | undefined> {
    const stored = await this.config.getSecret('ai.apiKey');
    if (stored) return stored;
    const input = await vscode.window.showInputBox({
      prompt: '输入 AI API Key（将安全保存在 VSCode SecretStorage）',
      password: true,
    });
    if (input) await this.config.storeSecret('ai.apiKey', input);
    return input;
  }

  async generateMeta(content: string): Promise<GeneratedMeta> {
    const provider = this.config.get<string>('ai.provider', 'openai');
    if (provider === 'custom' || provider === 'openai' || provider === 'azure' || provider === 'qwen') {
      try {
        const apiKey = await this.getApiKey();
        if (!apiKey) throw new Error('未配置 API Key');
        const baseUrl = this.config.get<string>('ai.baseUrl', 'https://api.openai.com/v1');
        const model = this.config.get<string>('ai.model', 'gpt-4o');
        const temperature = this.config.get<number>('ai.temperature', 0.4);

        const sys = '你是一个提示词整理助手。根据用户提供的文本，返回一个 JSON：{"name":"简短标题","emoji":"一个合适的emoji"}。仅输出 JSON。';
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature,
            messages: [
              { role: 'system', content: sys },
              { role: 'user', content: content.substring(0, 4000) },
            ],
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: any = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim() || '';
        try {
          const parsed = JSON.parse(text);
          return { name: parsed.name, emoji: parsed.emoji };
        } catch {
          // 简单降级：取第一行作为标题
          const line = content.split('\n')[0].trim().slice(0, 40);
          return { name: line || '未命名', emoji: '📝' };
        }
      } catch (e) {
        void vscode.window.showWarningMessage(`AI 元信息生成失败：${(e as Error).message}`);
      }
    }
    // 离线降级
    const line = content.split('\n')[0].trim().slice(0, 40);
    return { name: line || '未命名', emoji: '📝' };
  }

  async optimize(content: string): Promise<string> {
    const provider = this.config.get<string>('ai.provider', 'openai');
    if (provider === 'custom' || provider === 'openai' || provider === 'azure' || provider === 'qwen') {
      try {
        const apiKey = await this.getApiKey();
        if (!apiKey) throw new Error('未配置 API Key');
        const baseUrl = this.config.get<string>('ai.baseUrl', 'https://api.openai.com/v1');
        const model = this.config.get<string>('ai.model', 'gpt-4o');
        const temperature = this.config.get<number>('ai.temperature', 0.3);

        const sys = '你是一个提示词优化助手。请将提示词润色为清晰、简短、有条理的中文 Markdown 文本，保留原意。只返回优化后的文本。';
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature,
            messages: [
              { role: 'system', content: sys },
              { role: 'user', content: content.substring(0, 8000) },
            ],
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: any = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim() || '';
        return text || content;
      } catch (e) {
        void vscode.window.showWarningMessage(`AI 优化失败：${(e as Error).message}`);
      }
    }
    return content;
  }
}

