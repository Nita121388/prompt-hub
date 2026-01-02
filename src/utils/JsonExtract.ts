export function stripMarkdownCodeFences(text: string): string {
  const trimmed = (text || '').trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }
  return trimmed
    .replace(/^```(?:json|JSON)?\s*/g, '')
    .replace(/\s*```$/g, '')
    .trim();
}

export function extractJsonArray<T = unknown>(text: string): T[] | null {
  const candidates: string[] = [];
  const stripped = stripMarkdownCodeFences(text);
  if (stripped) {
    candidates.push(stripped);
  }

  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start >= 0 && end > start) {
    candidates.push(stripped.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed as T[];
      }

      if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as { items?: unknown };
        if (Array.isArray(obj.items)) {
          return obj.items as T[];
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}
