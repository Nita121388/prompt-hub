import * as assert from 'assert';
import { MarkdownPromptParser } from '../../utils/MarkdownPromptParser';
import { ConfigurationService } from '../../services/ConfigurationService';

suite('MarkdownPromptParser Test Suite', () => {
  // 简单的 Mock 配置服务，满足构造函数依赖
  class MockConfigurationService {
    get<T>(_key: string, defaultValue: T): T {
      return defaultValue;
    }

    getStoragePath(): string {
      return '';
    }
  }

  let parser: MarkdownPromptParser;

  setup(() => {
    const mockConfig = new MockConfigurationService() as unknown as ConfigurationService;
    parser = new MarkdownPromptParser(mockConfig);
  });

  test('should parse full Obsidian style markdown with frontmatter', () => {
    const text = [
      '---',
      'id: test-id-123',
      'type: prompt',
      'emoji: 🚀',
      'tags: [prompt, code/review]',
      '---',
      '',
      '# 🚀 代码审查助手',
      '',
      '这是正文内容。',
      '',
      '第二行内容。',
      '',
      '<!-- Otter:id=legacy-id -->',
      '',
    ].join('\n');

    const result = parser.parse(text);

    assert.strictEqual(result.id, 'test-id-123');
    assert.strictEqual(result.name, '代码审查助手');
    assert.strictEqual(result.emoji, '🚀');
    assert.deepStrictEqual(result.tags, ['prompt', 'code/review']);
    assert.ok(result.content.includes('这是正文内容。'));
    assert.ok(result.content.includes('第二行内容。'));
    // content 中不应包含 frontmatter
    assert.ok(!result.content.includes('type: prompt'));
  });

  test('should fallback to header when no frontmatter', () => {
    const text = ['# My Title', '', 'Body line 1', 'Body line 2'].join('\n');

    const result = parser.parse(text);

    assert.strictEqual(result.name, 'My Title');
    assert.strictEqual(result.emoji, undefined);
    assert.strictEqual(result.id, undefined);
    assert.strictEqual(result.content, 'Body line 1\nBody line 2');
  });

  test('should parse tags from comma separated string', () => {
    const text = [
      '---',
      'id: t2',
      'tags: prompt, code, review',
      '---',
      '',
      '# Title',
      '',
      'Content',
      '',
    ].join('\n');

    const result = parser.parse(text);

    assert.deepStrictEqual(result.tags, ['prompt', 'code', 'review']);
  });

  test('should parse single tag as array', () => {
    const text = [
      '---',
      'id: t3',
      'tags: single-tag',
      '---',
      '',
      '# Title',
      '',
      'Content',
      '',
    ].join('\n');

    const result = parser.parse(text);

    assert.deepStrictEqual(result.tags, ['single-tag']);
  });

  test('should parse tags from multiline list', () => {
    const text = [
      '---',
      'id: t4',
      'tags:',
      '  - prompt',
      '  - code/review',
      '---',
      '',
      '# Title',
      '',
      'Content',
      '',
    ].join('\n');

    const result = parser.parse(text);

    assert.deepStrictEqual(result.tags, ['prompt', 'code/review']);
  });
});
