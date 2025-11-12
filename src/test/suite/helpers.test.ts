import * as assert from 'assert';
import { generateId, sanitizeFilename, formatDate, formatTime } from '../../utils/helpers';

suite('Helpers Test Suite', () => {
  suite('generateId', () => {
    test('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();

      assert.notStrictEqual(id1, id2, 'IDs should be unique');
      assert.ok(id1.length > 0, 'ID should not be empty');
      assert.ok(id2.length > 0, 'ID should not be empty');
    });

    test('should generate ID with timestamp and random string', () => {
      const id = generateId();
      const parts = id.split('-');

      assert.ok(parts.length >= 2, 'ID should contain timestamp and random parts');
      assert.ok(!isNaN(Number(parts[0])), 'First part should be a timestamp');
    });
  });

  suite('sanitizeFilename', () => {
    test('should replace illegal characters', () => {
      const result = sanitizeFilename('test<>:"/\\|?*file');
      assert.ok(!result.match(/[<>:"/\\|?*]/), 'Should not contain illegal characters');
      assert.strictEqual(result, 'test----------file');
    });

    test('should replace spaces with dashes', () => {
      const result = sanitizeFilename('test file name');
      assert.strictEqual(result, 'test-file-name');
    });

    test('should remove leading dots', () => {
      const result = sanitizeFilename('...test.txt');
      assert.strictEqual(result, 'test.txt');
    });

    test('should limit length to 100 characters', () => {
      const longName = 'a'.repeat(150);
      const result = sanitizeFilename(longName);
      assert.strictEqual(result.length, 100);
    });

    test('should handle multiple consecutive spaces', () => {
      const result = sanitizeFilename('test   multiple   spaces');
      assert.strictEqual(result, 'test-multiple-spaces');
    });

    test('should handle mixed illegal characters and spaces', () => {
      const result = sanitizeFilename('test: file / name?');
      assert.strictEqual(result, 'test--file---name-');
    });
  });

  suite('formatDate', () => {
    test('should format date as YYYY-MM-DD', () => {
      const date = new Date('2024-03-15T10:30:00Z');
      const result = formatDate(date);
      assert.strictEqual(result, '2024-03-15');
    });

    test('should handle different dates', () => {
      const date1 = new Date('2023-01-01T00:00:00Z');
      const date2 = new Date('2023-12-31T23:59:59Z');

      assert.strictEqual(formatDate(date1), '2023-01-01');
      assert.strictEqual(formatDate(date2), '2023-12-31');
    });

    test('should format current date', () => {
      const now = new Date();
      const result = formatDate(now);
      assert.ok(result.match(/^\d{4}-\d{2}-\d{2}$/), 'Should match YYYY-MM-DD format');
    });
  });

  suite('formatTime', () => {
    test('should format time with dashes', () => {
      const date = new Date('2024-03-15T14:30:45Z');
      const result = formatTime(date);
      assert.ok(result.match(/^\d{2}-\d{2}-\d{2}$/), 'Should match HH-MM-SS format');
      assert.ok(!result.includes(':'), 'Should not contain colons');
    });

    test('should handle different times', () => {
      const date = new Date('2024-03-15T09:05:03Z');
      const result = formatTime(date);
      assert.ok(result.match(/^\d{2}-\d{2}-\d{2}$/), 'Should match HH-MM-SS format');
    });
  });
});
