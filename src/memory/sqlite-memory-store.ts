import type { MemoryStore, MemorySearchOptions } from '../contracts/entities/stores.js';
import type { Memory } from '../contracts/entities/memory.js';
import type { SQLiteDatabase } from '../storage/sqlite-database.js';

/**
 * SQLite implementation of MemoryStore with FTS5 hybrid search.
 */
export class SQLiteMemoryStore implements MemoryStore {
  private readonly database: SQLiteDatabase;

  constructor(database: SQLiteDatabase) {
    this.database = database;
  }

  save(memory: Memory): Memory {
    const db = this.database.db;

    db.prepare(`
      INSERT OR REPLACE INTO memories (id, content, scope, category, confidence, access_count, source, thread_id, embedding, created_at, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      memory.id,
      memory.content,
      memory.scope,
      memory.category,
      memory.confidence,
      memory.accessCount,
      memory.source,
      memory.threadId ?? null,
      memory.embedding ? Buffer.from(memory.embedding.buffer) : null,
      memory.createdAt,
      memory.lastAccessedAt,
    );

    // Update FTS index
    const rowid = db.prepare('SELECT rowid FROM memories WHERE id = ?').get(memory.id) as { rowid: number } | undefined;
    if (rowid) {
      db.prepare('INSERT OR REPLACE INTO memories_fts(rowid, content) VALUES (?, ?)').run(rowid.rowid, memory.content);
    }

    return memory;
  }

  search(query: string, options: MemorySearchOptions = {}): Memory[] {
    const db = this.database.db;
    const { limit = 10, scope, threadId, minConfidence = 0 } = options;

    // FTS5 search
    const ftsResults = db.prepare(`
      SELECT m.*, rank
      FROM memories_fts fts
      JOIN memories m ON m.rowid = fts.rowid
      WHERE memories_fts MATCH ?
        AND m.confidence >= ?
      ORDER BY rank
      LIMIT ?
    `).all(query, minConfidence, limit * 2) as Array<MemoryRow & { rank: number }>;

    let results = ftsResults.map(row => this.rowToMemory(row));

    // Filter by scope/thread if needed
    if (scope) results = results.filter(m => m.scope === scope);
    if (threadId) results = results.filter(m => !m.threadId || m.threadId === threadId);

    // If we have embeddings in the query options, do RRF
    if (options.embedding) {
      const allMemories = this.getAllWithEmbeddings(scope, threadId, minConfidence);
      const vectorResults = this.cosineSimilaritySearch(options.embedding, allMemories, limit * 2);

      // Reciprocal Rank Fusion
      results = this.reciprocalRankFusion(results, vectorResults, limit);
    }

    return results.slice(0, limit);
  }

  findById(id: string): Memory | null {
    const row = this.database.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
    return row ? this.rowToMemory(row) : null;
  }

  incrementAccess(id: string): void {
    this.database.db.prepare(`
      UPDATE memories SET access_count = access_count + 1, confidence = MIN(confidence + 0.05, 1.0), last_accessed_at = ? WHERE id = ?
    `).run(Date.now(), id);
  }

  deleteLowConfidence(minConfidence: number): number {
    const result = this.database.db.prepare('DELETE FROM memories WHERE confidence < ?').run(minConfidence);
    return result.changes;
  }

  listByScope(scope: string, threadId?: string): Memory[] {
    let sql = 'SELECT * FROM memories WHERE scope = ?';
    const params: unknown[] = [scope];

    if (threadId) {
      sql += ' AND thread_id = ?';
      params.push(threadId);
    }

    const rows = this.database.db.prepare(sql).all(...params) as MemoryRow[];
    return rows.map(r => this.rowToMemory(r));
  }

  private getAllWithEmbeddings(scope?: string, threadId?: string, minConfidence = 0): Memory[] {
    let sql = 'SELECT * FROM memories WHERE embedding IS NOT NULL AND confidence >= ?';
    const params: unknown[] = [minConfidence];

    if (scope) { sql += ' AND scope = ?'; params.push(scope); }
    if (threadId) { sql += ' AND (thread_id IS NULL OR thread_id = ?)'; params.push(threadId); }

    const rows = this.database.db.prepare(sql).all(...params) as MemoryRow[];
    return rows.map(r => this.rowToMemory(r));
  }

  private cosineSimilaritySearch(queryEmbedding: Float32Array, memories: Memory[], topK: number): Memory[] {
    const scored = memories
      .filter(m => m.embedding)
      .map(m => ({ memory: m, score: cosineSimilarity(queryEmbedding, m.embedding!) }))
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, topK).map(s => s.memory);
  }

  private reciprocalRankFusion(ftsResults: Memory[], vectorResults: Memory[], limit: number): Memory[] {
    const k = 60; // RRF constant
    const scores = new Map<string, number>();

    ftsResults.forEach((m, i) => {
      scores.set(m.id, (scores.get(m.id) ?? 0) + 1 / (k + i + 1));
    });

    vectorResults.forEach((m, i) => {
      scores.set(m.id, (scores.get(m.id) ?? 0) + 1 / (k + i + 1));
    });

    const allMemories = new Map<string, Memory>();
    for (const m of [...ftsResults, ...vectorResults]) allMemories.set(m.id, m);

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => allMemories.get(id)!);
  }

  private rowToMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      content: row.content,
      scope: row.scope as Memory['scope'],
      category: row.category as Memory['category'],
      confidence: row.confidence,
      accessCount: row.access_count,
      source: row.source as Memory['source'],
      threadId: row.thread_id ?? undefined,
      embedding: row.embedding ? new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4) : undefined,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      state: row.confidence < 0.1 ? 'expired' : 'active',
    };
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

interface MemoryRow {
  id: string;
  content: string;
  scope: string;
  category: string;
  confidence: number;
  access_count: number;
  source: string;
  thread_id: string | null;
  embedding: Buffer | null;
  created_at: number;
  last_accessed_at: number;
}
