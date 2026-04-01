import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryManager } from '../../../src/memory/memory-manager.js';
import type { MemoryStore } from '../../../src/contracts/entities/stores.js';
import type { Memory } from '../../../src/contracts/entities/memory.js';

function createMockStore(): MemoryStore {
  return {
    save: vi.fn((m: Memory) => m),
    search: vi.fn(() => []),
    findById: vi.fn(() => null),
    incrementAccess: vi.fn(),
    deleteLowConfidence: vi.fn(() => 0),
    listByScope: vi.fn(() => []),
  };
}

describe('MemoryManager', () => {
  let store: MemoryStore;
  let manager: MemoryManager;

  beforeEach(() => {
    store = createMockStore();
    manager = new MemoryManager({ store, samplingRate: 0 }); // disable random sampling
  });

  it('should save explicit memory with confidence 1.0', () => {
    const result = manager.saveExplicit('User prefers dark mode');
    expect(result.confidence).toBe(1.0);
    expect(result.source).toBe('explicit');
    expect(store.save).toHaveBeenCalledOnce();
  });

  it('should save extracted memory with confidence 0.8', () => {
    const result = manager.saveExtracted('User is a developer', 'fact');
    expect(result.confidence).toBe(0.8);
    expect(result.source).toBe('extracted');
  });

  it('should trigger extraction on explicit phrases', () => {
    expect(manager.shouldExtract('lembra que eu gosto de café')).toBe(true);
    expect(manager.shouldExtract('remember that I like coffee')).toBe(true);
  });

  it('should trigger extraction after many turns', () => {
    // Force turnsSinceExtraction > decayInterval
    for (let i = 0; i < 11; i++) {
      manager.shouldExtract('hello');
    }
    expect(manager.shouldExtract('any message')).toBe(true);
  });

  it('should recall and reinforce accessed memories', () => {
    const mem: Memory = {
      id: 'mem-1', content: 'fact', scope: 'persistent', category: 'fact',
      confidence: 0.8, accessCount: 0, source: 'extracted',
      createdAt: Date.now(), lastAccessedAt: Date.now(), state: 'active',
    };
    vi.mocked(store.search).mockReturnValue([mem]);

    const results = manager.recall('fact');
    expect(results).toHaveLength(1);
    expect(store.incrementAccess).toHaveBeenCalledWith('mem-1');
  });

  it('should apply decay to all memories', () => {
    const mem: Memory = {
      id: 'mem-1', content: 'old fact', scope: 'persistent', category: 'fact',
      confidence: 0.5, accessCount: 0, source: 'extracted',
      createdAt: Date.now(), lastAccessedAt: Date.now(), state: 'active',
    };
    vi.mocked(store.listByScope).mockReturnValue([mem]);

    manager.applyDecay();

    expect(store.save).toHaveBeenCalled();
    const savedMem = vi.mocked(store.save).mock.calls[0]![0]!;
    expect(savedMem.confidence).toBeCloseTo(0.5 * 0.95);
  });

  it('should cleanup expired memories after decay', () => {
    vi.mocked(store.listByScope).mockReturnValue([]);
    manager.applyDecay();
    expect(store.deleteLowConfidence).toHaveBeenCalledWith(0.1);
  });
});
