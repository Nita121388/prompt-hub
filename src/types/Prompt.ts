import * as vscode from 'vscode';

/**
 * Prompt 数据模型
 */
export interface Prompt {
  /** 唯一标识符 */
  id: string;

  /** Prompt 名称 */
  name: string;

  /** Emoji 图标 */
  emoji?: string;

  /** Prompt 正文内容 */
  content: string;

  /** 创建时间 (ISO 8601) */
  createdAt: string;

  /** 更新时间 (ISO 8601) */
  updatedAt: string;

  /** 来源文件路径 */
  sourceFile?: string;

  /** 标签列表 */
  tags?: string[];

  /** 是否由 AI 生成元信息 */
  aiGeneratedMeta?: boolean;

  /** 关联的 Markdown 文件 URI */
  fromMarkdownFile?: vscode.Uri;
}

/**
 * AI 使用日志
 */
export interface AIUsageLog {
  /** 日志 ID */
  id: string;

  /** 关联的 Prompt ID */
  promptId?: string;

  /** 文件 URI */
  fileUri?: string;

  /** 操作类型 */
  operation: 'meta' | 'optimize';

  /** 使用的模型 */
  model: string;

  /** 输入 token 数 */
  tokensIn: number;

  /** 输出 token 数 */
  tokensOut: number;

  /** 预估费用 */
  cost?: number;

  /** 耗时（毫秒） */
  durationMs: number;

  /** 时间戳 (ISO 8601) */
  timestamp: string;

  /** 状态 */
  status: 'success' | 'failed';

  /** 错误信息 */
  message?: string;
}

/**
 * 选区解析结果
 */
export interface ParsedPromptInfo {
  /** 提取的名称 */
  name?: string;

  /** 提取的 emoji */
  emoji?: string;

  /** 处理后的内容 */
  content: string;
}

/**
 * 首次引导状态
 */
export interface OnboardingState {
  /** 当前步骤 (1-5) */
  step: number;

  /** 存储路径 */
  storagePath: string;

  /** 是否启用 Git */
  gitEnabled: boolean;

  /** Git 远程仓库 URL */
  gitRemoteUrl?: string;

  /** AI 提供商 */
  aiProvider?: 'openai' | 'azure' | 'gemini' | 'deepseek' | 'qwen' | 'custom' | 'local-claude' | 'local-codex';

  /** AI 模型 */
  aiModel?: string;

  /** 是否完成 */
  completed: boolean;
}

/**
 * 存储数据结构
 */
export interface PromptStorage {
  /** 数据版本 */
  version: string;

  /** Prompt 列表 */
  prompts: Prompt[];

  /** AI 使用日志 */
  usageLogs?: AIUsageLog[];
}
