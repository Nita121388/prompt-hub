import * as vscode from 'vscode';
import type { ConfigurationService } from './ConfigurationService';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function safeToString(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message || String(value);
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function redact(text: string): string {
  if (!text) return text;

  // 通用 token（例如 OpenAI/Anthropic 的 sk_...）
  let out = text.replace(/\bsk_[A-Za-z0-9]{16,}\b/g, 'sk_***');

  // Bearer / API Key header 片段
  out = out.replace(/(Authorization:\s*Bearer\s+)([^\s"']+)/gi, '$1***');
  out = out.replace(/(api-key:\s*)([^\s"']+)/gi, '$1***');
  out = out.replace(/(X-API-Key:\s*)([^\s"']+)/gi, '$1***');

  // URL query 中常见的 key 参数（如 Gemini ?key=xxx）
  out = out.replace(/([?&](?:key|api_key|token)=)([^&#\s]+)/gi, '$1***');

  // URL 中的 user:pass@ 或 token@ 的形式
  out = out.replace(/\/\/([^@/]+)@/g, '//***@');

  return out;
}

class OtterLogger {
  private channel: vscode.OutputChannel | undefined;
  private debugEnabled = false;

  initialize(config: ConfigurationService): void {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel('Otter');
    }
    this.debugEnabled = config.get<boolean>('debugLog', false);
  }

  setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  private write(level: LogLevel, message: string, details?: unknown[]): void {
    const ts = new Date().toISOString();
    const base = `[${ts}][${level.toUpperCase()}] ${message}`;
    const extra =
      details && details.length
        ? ` ${details.map((d) => redact(safeToString(d))).join(' ')}`
        : '';
    const line = redact(base + extra);

    this.channel?.appendLine(line);

    if (level === 'warn') console.warn(line);
    if (level === 'error') console.error(line);
  }

  debug(message: string, ...details: unknown[]): void {
    if (!this.debugEnabled) return;
    this.write('debug', message, details);
  }

  info(message: string, ...details: unknown[]): void {
    this.write('info', message, details);
  }

  warn(message: string, ...details: unknown[]): void {
    this.write('warn', message, details);
  }

  error(message: string, ...details: unknown[]): void {
    this.write('error', message, details);
  }
}

export const logger = new OtterLogger();

