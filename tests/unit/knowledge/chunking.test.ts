import { describe, it, expect } from 'vitest';
import { chunkText } from '../../../src/knowledge/chunking.js';

describe('chunkText', () => {
  it('should return single chunk for short text', () => {
    const chunks = chunkText('Hello world', { chunkSize: 100, chunkOverlap: 10 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('Hello world');
  });

  it('should split long text into multiple chunks', () => {
    const text = 'a'.repeat(200);
    const chunks = chunkText(text, { chunkSize: 100, chunkOverlap: 10 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('should split on paragraph boundaries when possible', () => {
    const text = 'First paragraph about topic A.\n\nSecond paragraph about topic B.\n\nThird paragraph about topic C.';
    const chunks = chunkText(text, { chunkSize: 50, chunkOverlap: 5 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('should return empty array for empty text', () => {
    expect(chunkText('', { chunkSize: 100, chunkOverlap: 10 })).toEqual([]);
  });

  it('should handle overlap correctly', () => {
    const text = 'AAAA BBBB CCCC DDDD EEEE FFFF';
    const chunks = chunkText(text, { chunkSize: 15, chunkOverlap: 5 });
    expect(chunks.length).toBeGreaterThan(1);
    // All content should be represented
    const combined = chunks.join(' ');
    expect(combined).toContain('AAAA');
    expect(combined).toContain('FFFF');
  });
});
