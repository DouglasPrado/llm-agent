import type { VectorStore } from '../contracts/entities/stores.js';
import type { KnowledgeChunk, RetrievedKnowledge } from '../contracts/entities/knowledge.js';
import type { SQLiteDatabase } from '../storage/sqlite-database.js';

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

  search(queryEmbedding: Float32Array, topK: number): RetrievedKnowledge[] {
    const rows = this.database.db.prepare('SELECT * FROM vectors').all() as VectorRow[];

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

interface VectorRow {
  id: string;
  content: string;
  embedding: Buffer;
  metadata: string | null;
  created_at: number;
}
