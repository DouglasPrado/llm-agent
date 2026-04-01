import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';

/**
 * Centralized SQLite wrapper with auto-create tables, migrations, and WAL mode.
 */
export class SQLiteDatabase {
  private _db: BetterSqlite3.Database | null = null;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  get db(): BetterSqlite3.Database {
    if (!this._db) throw new Error('Database not initialized. Call initialize() first.');
    return this._db;
  }

  initialize(): void {
    if (this._db) return;

    this._db = new Database(this.path);

    // Enable WAL mode for concurrent reads
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('synchronous = NORMAL');

    this.migrateV1();
  }

  close(): void {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }

  private migrateV1(): void {
    const db = this.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        scope TEXT NOT NULL,
        category TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.8,
        access_count INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'extracted',
        thread_id TEXT,
        embedding BLOB,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
      CREATE INDEX IF NOT EXISTS idx_memories_thread ON memories(thread_id);
      CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence);
    `);

    // FTS5 virtual table for full-text search
    // Check if already exists (FTS5 tables don't support IF NOT EXISTS in all versions)
    const ftsExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'"
    ).get();

    if (!ftsExists) {
      db.exec(`
        CREATE VIRTUAL TABLE memories_fts USING fts5(
          content,
          content=memories,
          content_rowid=rowid
        );
      `);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_call_id TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_thread ON conversations(thread_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_pinned ON conversations(thread_id, pinned);
    `);
  }
}
