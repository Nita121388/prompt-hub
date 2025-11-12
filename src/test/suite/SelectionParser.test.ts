import * as assert from 'assert';
import { SelectionParser } from '../../utils/SelectionParser';
import { ConfigurationService } from '../../services/ConfigurationService';

suite('SelectionParser Test Suite', () => {
  let mockConfig: ConfigurationService;
  let parser: SelectionParser;

  // 创建 mock ConfigurationService
  class MockConfigurationService {
    private config: Map<string, any> = new Map();

    get<T>(key: string, defaultValue: T): T {
      return this.config.has(key) ? this.config.get(key) : defaultValue;
    }

    set(key: string, value: any) {
      this.config.set(key, value);
    }

    clear() {
      this.config.clear();
    }
  }

  setup(() => {
    mockConfig = new MockConfigurationService() as any;
    parser = new SelectionParser(mockConfig);
  });

  suite('parse with auto-detect enabled', () => {
    setup(() => {
      mockConfig.set('selection.autoDetectPromptName', true);
      mockConfig.set('selection.removePromptMarker', true);
    });

    test('should parse prompt with name only', () => {
      const text = '# prompt: Test Prompt\nThis is the content';
      const result = parser.parse(text);

      assert.strictEqual(result.name, 'Test Prompt');
      assert.strictEqual(result.content, 'This is the content');
      assert.strictEqual(result.emoji, undefined);
    });

    test('should parse prompt with emoji and name', () => {
      const text = '# prompt: 🚀 Rocket Prompt\nThis is the content';
      const result = parser.parse(text);

      assert.strictEqual(result.name, 'Rocket Prompt');
      assert.strictEqual(result.emoji, '🚀');
      assert.strictEqual(result.content, 'This is the content');
    });

    test('should handle case-insensitive prompt marker', () => {
      const text = '# PROMPT: Test\nContent here';
      const result = parser.parse(text);

      assert.strictEqual(result.name, 'Test');
      assert.strictEqual(result.content, 'Content here');
    });

    test('should handle extra spaces in marker', () => {
      const text = '#   prompt  :   Test Prompt   \nContent here';
      const result = parser.parse(text);

      assert.strictEqual(result.name, 'Test Prompt');
      assert.strictEqual(result.content, 'Content here');
    });

    test('should handle multiline content', () => {
      const text = '# prompt: Multi Line\nLine 1\nLine 2\nLine 3';
      const result = parser.parse(text);

      assert.strictEqual(result.name, 'Multi Line');
      assert.strictEqual(result.content, 'Line 1\nLine 2\nLine 3');
    });

    test('should return original content if no marker found', () => {
      const text = 'Just some regular text\nwithout a marker';
      const result = parser.parse(text);

      assert.strictEqual(result.name, undefined);
      assert.strictEqual(result.emoji, undefined);
      assert.strictEqual(result.content, text);
    });

    test('should handle various emoji types', () => {
      const emojis = ['📝', '🎯', '💡', '⚡', '🔥'];

      emojis.forEach(emoji => {
        const text = `# prompt: ${emoji} Test\nContent`;
        const result = parser.parse(text);

        assert.strictEqual(result.emoji, emoji);
        assert.strictEqual(result.name, 'Test');
      });
    });
  });

  suite('parse with removePromptMarker disabled', () => {
    setup(() => {
      mockConfig.set('selection.autoDetectPromptName', true);
      mockConfig.set('selection.removePromptMarker', false);
    });

    test('should keep marker in content when disabled', () => {
      const text = '# prompt: Test Prompt\nThis is the content';
      const result = parser.parse(text);

      assert.strictEqual(result.name, 'Test Prompt');
      assert.strictEqual(result.content, text);
    });
  });

  suite('parse with auto-detect disabled', () => {
    setup(() => {
      mockConfig.set('selection.autoDetectPromptName', false);
    });

    test('should return original content when auto-detect disabled', () => {
      const text = '# prompt: Test Prompt\nThis is the content';
      const result = parser.parse(text);

      assert.strictEqual(result.name, undefined);
      assert.strictEqual(result.emoji, undefined);
      assert.strictEqual(result.content, text);
    });
  });

  suite('edge cases', () => {
    setup(() => {
      mockConfig.set('selection.autoDetectPromptName', true);
      mockConfig.set('selection.removePromptMarker', true);
    });

    test('should handle empty content after marker', () => {
      const text = '# prompt: Test Prompt\n';
      const result = parser.parse(text);

      assert.strictEqual(result.name, 'Test Prompt');
      assert.strictEqual(result.content, '');
    });

    test('should handle marker with only emoji', () => {
      const text = '# prompt: 🚀\nContent here';
      const result = parser.parse(text);

      // When only emoji present, it might be treated as name or handled differently
      assert.ok(result.content);
    });

    test('should handle content with empty lines', () => {
      const text = '# prompt: Test\n\n\nContent\n\n';
      const result = parser.parse(text);

      assert.strictEqual(result.name, 'Test');
      assert.ok(result.content.includes('Content'));
    });

    test('should handle single line with marker only', () => {
      const text = '# prompt: Test Only';
      const result = parser.parse(text);

      assert.strictEqual(result.name, 'Test Only');
    });
  });
});
