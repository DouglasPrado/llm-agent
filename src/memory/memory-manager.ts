import { randomUUID } from 'node:crypto';
import type { Memory } from '../contracts/entities/memory.js';
import type { MemoryStore } from '../contracts/entities/stores.js';
import type { MemoryScope, MemoryCategory } from '../contracts/enums/index.js';

export interface MemoryManagerConfig {
  store: MemoryStore;
  decayFactor?: number;
  decayInterval?: number;
  minConfidence?: number;
  samplingRate?: number;
}

/**
 * Manages memory extraction, recall, decay, and consolidation.
 */
export class MemoryManager {
  private readonly store: MemoryStore;
  private readonly decayFactor: number;
  private readonly minConfidence: number;
  private readonly samplingRate: number;
  private turnsSinceExtraction = 0;
  private readonly decayInterval: number;

  constructor(config: MemoryManagerConfig) {
    this.store = config.store;
    this.decayFactor = config.decayFactor ?? 0.95;
    this.decayInterval = config.decayInterval ?? 10;
    this.minConfidence = config.minConfidence ?? 0.1;
    this.samplingRate = config.samplingRate ?? 0.3;
  }

  /**
   * Determines if memory extraction should run on this turn.
   */
  shouldExtract(lastUserMessage: string): boolean {
    this.turnsSinceExtraction++;

    // Explicit trigger phrases
    const explicitTriggers = ['lembra que', 'remember that', 'lembre-se', 'memorize'];
    if (explicitTriggers.some(t => lastUserMessage.toLowerCase().includes(t))) return true;

    // Too many turns without extraction
    if (this.turnsSinceExtraction > this.decayInterval) return true;

    // Random sampling
    return Math.random() < this.samplingRate;
  }

  resetExtractionCounter(): void {
    this.turnsSinceExtraction = 0;
  }

  /**
   * Saves an explicitly provided memory.
   */
  saveExplicit(content: string, scope: MemoryScope = 'persistent', category: MemoryCategory = 'fact', threadId?: string): Memory {
    const memory: Memory = {
      id: randomUUID(),
      content,
      scope,
      category,
      confidence: 1.0,
      accessCount: 0,
      source: 'explicit',
      threadId,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      state: 'active',
    };
    return this.store.save(memory);
  }

  /**
   * Saves an extracted memory (from LLM analysis).
   */
  saveExtracted(content: string, category: MemoryCategory, scope: MemoryScope = 'persistent', threadId?: string, embedding?: Float32Array): Memory {
    const memory: Memory = {
      id: randomUUID(),
      content,
      scope,
      category,
      confidence: 0.8,
      accessCount: 0,
      source: 'extracted',
      threadId,
      embedding,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      state: 'active',
    };
    return this.store.save(memory);
  }

  /**
   * Recalls memories relevant to a query.
   */
  recall(query: string, options?: { threadId?: string; embedding?: Float32Array; limit?: number }): Memory[] {
    const results = this.store.search(query, {
      limit: options?.limit ?? 5,
      threadId: options?.threadId,
      embedding: options?.embedding,
      minConfidence: this.minConfidence,
    });

    // Reinforce accessed memories
    for (const memory of results) {
      this.store.incrementAccess(memory.id);
    }

    return results;
  }

  /**
   * Applies decay to memories that haven't been accessed.
   */
  applyDecay(): void {
    const allScopes: MemoryScope[] = ['persistent', 'learned', 'thread'];
    for (const scope of allScopes) {
      const memories = this.store.listByScope(scope);
      for (const memory of memories) {
        if (memory.confidence > this.minConfidence) {
          const decayed: Memory = {
            ...memory,
            confidence: Math.max(memory.confidence * this.decayFactor, 0),
            state: memory.confidence * this.decayFactor < this.minConfidence ? 'expired' : 'decaying',
          };
          this.store.save(decayed);
        }
      }
    }

    // Cleanup expired memories
    this.store.deleteLowConfidence(this.minConfidence);
  }
}
