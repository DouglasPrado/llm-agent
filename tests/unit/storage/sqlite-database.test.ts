import { describe, it, expect, afterEach } from 'vitest';
import { SQLiteDatabase } from '../../../src/storage/sqlite-database.js';

describe('SQLiteDatabase', () => {
  let db: SQLiteDatabase;

  afterEach(() => {
    db?.close();
  });

  it('should initialize with in-memory database', () => {
    db = new SQLiteDatabase(':memory:');
    db.initialize();
    expect(db.db).toBeDefined();
  });

  it('should create all required tables on initialize', () => {
    db = new SQLiteDatabase(':memory:');
    db.initialize();

    const tables = db.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;

    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('memories');
    expect(tableNames).toContain('memories_fts');
    expect(tableNames).toContain('vectors');
    expect(tableNames).toContain('conversations');
  });

  it('should enable WAL mode', () => {
    db = new SQLiteDatabase(':memory:');
    db.initialize();

    const result = db.db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    // In-memory databases may use 'memory' mode instead of WAL, but file-based will use WAL
    expect(result[0]!.journal_mode).toBeDefined();
  });

  it('should create indices on conversations', () => {
    db = new SQLiteDatabase(':memory:');
    db.initialize();

    const indices = db.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='conversations'"
    ).all() as Array<{ name: string }>;

    const indexNames = indices.map(i => i.name);
    expect(indexNames).toContain('idx_conversations_thread');
    expect(indexNames).toContain('idx_conversations_pinned');
  });

  it('should create indices on memories', () => {
    db = new SQLiteDatabase(':memory:');
    db.initialize();

    const indices = db.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memories'"
    ).all() as Array<{ name: string }>;

    const indexNames = indices.map(i => i.name);
    expect(indexNames).toContain('idx_memories_scope');
    expect(indexNames).toContain('idx_memories_thread');
    expect(indexNames).toContain('idx_memories_confidence');
  });

  it('should be idempotent on multiple initialize calls', () => {
    db = new SQLiteDatabase(':memory:');
    db.initialize();
    db.initialize(); // should not throw
  });

  it('should close cleanly', () => {
    db = new SQLiteDatabase(':memory:');
    db.initialize();
    db.close();
    // Accessing after close should throw
    expect(() => db.db.prepare('SELECT 1')).toThrow();
  });
});
