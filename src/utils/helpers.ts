/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 文件名安全化
 * 移除或替换非法字符
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '-') // 替换非法字符
    .replace(/\s+/g, '-') // 空格转短横线
    .replace(/^\.+/, '') // 移除开头的点
    .substring(0, 100); // 限制长度
}

/**
 * 格式化日期
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * 格式化时间
 */
export function formatTime(date: Date): string {
  return date.toTimeString().split(' ')[0].replace(/:/g, '-');
}
