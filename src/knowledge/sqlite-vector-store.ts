import type { VectorStore } from '../contracts/entities/stores.js';
import type { KnowledgeChunk, RetrievedKnowledge } from '../contracts/entities/knowledge.js';
import type { SQLiteDatabase } from '../storage/sqlite-database.js';

/** Maximum rows scanned per search call to bound memory usage. */
const MAX_SCAN = 10_000;

/**
 * SQLite implementation of VectorStore with brute-force cosine similarity.
 */
export class SQLiteVectorStore implements VectorStore {
  private readonly database: SQLiteDatabase;

  constructor(database: SQLiteDatabase) {
    this.database = database;
  }

  upsert(chunk: KnowledgeChunk): void {
    this.database.db.prepare(`
      INSERT OR REPLACE INTO vectors (id, content, embedding, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      chunk.id,
      chunk.content,
      Buffer.from(chunk.embedding.buffer),
      chunk.metadata ? JSON.stringify(chunk.metadata) : null,
      chunk.createdAt,
    );
  }

  /** Atomic batch insert: rolls back all rows if any single insert fails. */
  upsertMany(chunks: KnowledgeChunk[]): void {
    if (chunks.length === 0) return;
    const stmt = this.database.db.prepare(`
      INSERT OR REPLACE INTO vectors (id, content, embedding, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const tx = this.database.db.transaction((rows: KnowledgeChunk[]) => {
      for (const c of rows) {
        stmt.run(
          c.id,
          c.content,
          Buffer.from(c.embedding.buffer),
          c.metadata ? JSON.stringify(c.metadata) : null,
          c.createdAt,
        );
      }
    });
    tx(chunks);
  }

  search(queryEmbedding: Float32Array, topK: number): RetrievedKnowledge[] {
    const rows = this.database.db.prepare(
      'SELECT * FROM vectors ORDER BY created_at DESC LIMIT ?'
    ).all(MAX_SCAN) as VectorRow[];

    const scored = rows.map(row => {
      const embedding = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      return {
        id: row.id,
        content: row.content,
        score: cosineSimilarity(queryEmbedding, embedding),
        metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  delete(id: string): void {
    this.database.db.prepare('DELETE FROM vectors WHERE id = ?').run(id);
  }

  listAll(): KnowledgeChunk[] {
    const rows = this.database.db.prepare('SELECT * FROM vectors').all() as VectorRow[];
    return rows.map(row => ({
      id: row.id,
      content: row.content,
      embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4),
      metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
      createdAt: row.created_at,
    }));
  }

  deleteBySource(sourceId: string): void {
    this.database.db.prepare("DELETE FROM vectors WHERE json_extract(metadata, '$.sourceId') = ?").run(sourceId);
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
  if (denom === 0) return 0;
  // Clamp to [0, 1]: opposite-direction vectors are treated as "not similar"
  // for RAG ranking purposes, matching the minScore config range.
  return Math.max(0, Math.min(1, dot / denom));
}

interface VectorRow {
  id: string;
  content: string;
  embedding: Buffer;
  metadata: string | null;
  created_at: number;
}
