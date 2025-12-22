import * as vscode from 'vscode';
import { ConfigurationService } from './ConfigurationService';
import { LocalClaudeProvider } from './LocalClaudeProvider';
import { LocalCodexProvider } from './LocalCodexProvider';

export interface GeneratedMeta {
  name?: string;
  emoji?: string;
}

export type AIProvider = 'openai' | 'azure' | 'gemini' | 'deepseek' | 'qwen' | 'custom' | 'local-claude' | 'local-codex';

/**
 * AI 服务：封装元信息生成与内容优化
 * 支持多个提供商：OpenAI、Azure、Gemini、DeepSeek、Qwen、自定义、本地 Claude Code、本地 Codex
 */
export class AIService {
  private localClaudeProvider: LocalClaudeProvider;
  private localCodexProvider: LocalCodexProvider;

  constructor(private readonly config: ConfigurationService) {
    this.localClaudeProvider = new LocalClaudeProvider(config);
    this.localCodexProvider = new LocalCodexProvider(config);
  }

  private async getApiKey(provider?: AIProvider): Promise<string | undefined> {
    const storageName = provider ? `ai.apiKey.${provider}` : 'ai.apiKey';
    const stored = await this.config.getSecret(storageName);
    if (stored) return stored;
    const input = await vscode.window.showInputBox({
      prompt: `输入 ${provider || 'AI'} API Key（将安全保存在 VSCode SecretStorage）`,
      password: true,
    });
    if (input) await this.config.storeSecret(storageName, input);
    return input;
  }

  /**
   * 构建 API 请求体（支持不同的提供商格式）
   */
  private buildRequestBody(provider: AIProvider, model: string, temperature: number, messages: any[]): any {
    switch (provider) {
      case 'gemini':
        // Google Gemini API 格式
        return {
          model: `models/${model}`,
          generationConfig: {
            temperature,
            topK: 40,
            topP: 0.95,
          },
          contents: messages.map((msg) => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }],
          })),
        };

      case 'deepseek':
        // DeepSeek 使用 OpenAI 兼容 API
        return {
          model,
          temperature,
          messages,
        };

      default:
        // OpenAI 兼容格式（Azure、Qwen、Custom 都支持）
        return {
          model,
          temperature,
          messages,
        };
    }
  }

  /**
   * 构建 API 端点 URL
   */
  private buildApiUrl(provider: AIProvider, baseUrl?: string): string {
    switch (provider) {
      case 'gemini':
        return 'https://generativelanguage.googleapis.com/v1beta/models';
      case 'deepseek':
        return baseUrl || 'https://api.deepseek.com/chat/completions';
      case 'azure':
        return baseUrl || 'https://{resource-name}.openai.azure.com/openai/deployments/{deployment-id}/chat/completions?api-version=2024-02-15-preview';
      default:
        return `${baseUrl || 'https://api.openai.com'}/v1/chat/completions`;
    }
  }

  /**
   * 解析 API 响应（处理不同提供商的响应格式）
   */
  private parseResponse(provider: AIProvider, data: any): string {
    switch (provider) {
      case 'gemini':
        // Gemini 响应格式
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      default:
        // OpenAI 兼容格式
        return data.choices?.[0]?.message?.content?.trim() || '';
    }
  }

  /**
   * 构建请求头
   */
  private buildHeaders(provider: AIProvider, apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    switch (provider) {
      case 'gemini':
        // Gemini 使用 API Key 作为查询参数，但仍需在 header 中提供
        headers['X-API-Key'] = apiKey;
        break;
      case 'azure':
        // Azure 使用特殊的 header
        headers['api-key'] = apiKey;
        break;
      default:
        // OpenAI 兼容格式
        headers['Authorization'] = `Bearer ${apiKey}`;
        break;
    }

    return headers;
  }

  async generateMeta(content: string): Promise<GeneratedMeta> {
    const provider = this.config.get<AIProvider>('ai.provider', 'openai');
    const supportedProviders: AIProvider[] = ['openai', 'azure', 'gemini', 'deepseek', 'qwen', 'custom', 'local-claude', 'local-codex'];

    if (!supportedProviders.includes(provider)) {
      void vscode.window.showWarningMessage(`不支持的 AI 提供商：${provider}`);
      // 降级处理
      const line = content.split('\n')[0].trim().slice(0, 40);
      return { name: line || '未命名', emoji: '📝' };
    }

    // 本地 Claude Code
    if (provider === 'local-claude') {
      try {
        return await this.localClaudeProvider.generateMeta(content);
      } catch (error) {
        void vscode.window.showWarningMessage(`本地 Claude Code 调用失败：${(error as Error).message}`);
        return this.fallbackMeta(content);
      }
    }

    // 本地 Codex
    if (provider === 'local-codex') {
      try {
        return await this.localCodexProvider.generateMeta(content);
      } catch (error) {
        void vscode.window.showWarningMessage(`本地 Codex 调用失败：${(error as Error).message}`);
        return this.fallbackMeta(content);
      }
    }

    // 云端 API 调用
    try {
      const apiKey = await this.getApiKey(provider);
      if (!apiKey) throw new Error('未配置 API Key');

      const baseUrl = this.config.get<string>('ai.baseUrl', this.buildApiUrl(provider));
      const model = this.config.get<string>('ai.model', this.getDefaultModel(provider));
      const temperature = this.config.get<number>('ai.temperature', 0.4);

      const systemPrompt = '你是一个提示词整理助手。根据用户提供的文本，返回一个 JSON：{"name":"简短标题","emoji":"一个合适的emoji"}。仅输出 JSON。';
      const userContent = content.substring(0, 4000);

      const requestBody = this.buildRequestBody(provider, model, temperature, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ]);

      const url = provider === 'gemini' ? `${baseUrl}:generateContent?key=${apiKey}` : baseUrl;
      const headers = this.buildHeaders(provider, apiKey);

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

      const data: any = await res.json();
      const text = this.parseResponse(provider, data);

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
      // 降级处理
      const line = content.split('\n')[0].trim().slice(0, 40);
      return { name: line || '未命名', emoji: '📝' };
    }
  }

  async optimize(content: string): Promise<string> {
    const provider = this.config.get<AIProvider>('ai.provider', 'openai');
    const supportedProviders: AIProvider[] = ['openai', 'azure', 'gemini', 'deepseek', 'qwen', 'custom', 'local-claude', 'local-codex'];

    if (!supportedProviders.includes(provider)) {
      void vscode.window.showWarningMessage(`不支持的 AI 提供商：${provider}`);
      return content;
    }

    // 本地 Claude Code
    if (provider === 'local-claude') {
      try {
        return await this.localClaudeProvider.optimize(content);
      } catch (error) {
        void vscode.window.showWarningMessage(`本地 Claude Code 优化失败：${(error as Error).message}`);
        return content;
      }
    }

    // 本地 Codex
    if (provider === 'local-codex') {
      try {
        return await this.localCodexProvider.optimize(content);
      } catch (error) {
        void vscode.window.showWarningMessage(`本地 Codex 优化失败：${(error as Error).message}`);
        return content;
      }
    }

    // 云端 API 调用
    try {
      const apiKey = await this.getApiKey(provider);
      if (!apiKey) throw new Error('未配置 API Key');

      const baseUrl = this.config.get<string>('ai.baseUrl', this.buildApiUrl(provider));
      const model = this.config.get<string>('ai.model', this.getDefaultModel(provider));
      const temperature = this.config.get<number>('ai.temperature', 0.3);

      const systemPrompt = '你是一个提示词优化助手。请将提示词润色为清晰、简短、有条理的中文 Markdown 文本，保留原意。只返回优化后的文本。';
      const userContent = content.substring(0, 8000);

      const requestBody = this.buildRequestBody(provider, model, temperature, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ]);

      const url = provider === 'gemini' ? `${baseUrl}:generateContent?key=${apiKey}` : baseUrl;
      const headers = this.buildHeaders(provider, apiKey);

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

      const data: any = await res.json();
      const text = this.parseResponse(provider, data);

      return text || content;
    } catch (e) {
      void vscode.window.showWarningMessage(`AI 优化失败：${(e as Error).message}`);
      return content;
    }
  }

  /**
   * 降级处理：从内容第一行生成元信息
   */
  private fallbackMeta(content: string): GeneratedMeta {
    const line = content.split('\n')[0].trim().slice(0, 40);
    return { name: line || '未命名', emoji: '📝' };
  }

  /**
   * 获取提供商的默认模型
   */
  private getDefaultModel(provider: AIProvider): string {
    switch (provider) {
      case 'gemini':
        return 'gemini-1.5-pro';
      case 'deepseek':
        return 'deepseek-chat';
      case 'azure':
        return 'gpt-4o';
      case 'qwen':
        return 'qwen-max';
      case 'local-claude':
        return 'claude-sonnet-4.5';
      case 'local-codex':
        return 'claude-sonnet-4.5';
      default:
        return 'gpt-4o';
    }
  }
}

