import type { ConversationStore } from '../contracts/entities/stores.js';
import type { ChatMessage } from '../contracts/entities/chat-message.js';
import type { SQLiteDatabase } from './sqlite-database.js';

/**
 * SQLite implementation of ConversationStore.
 */
export class SQLiteConversationStore implements ConversationStore {
  private readonly database: SQLiteDatabase;

  constructor(database: SQLiteDatabase) {
    this.database = database;
  }

  appendMessage(message: ChatMessage, threadId: string): void {
    this.database.db.prepare(`
      INSERT INTO conversations (thread_id, role, content, tool_calls, tool_call_id, pinned, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      threadId,
      message.role,
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.toolCallId ?? null,
      message.pinned ? 1 : 0,
      message.createdAt,
    );
  }

  listThread(threadId: string): ChatMessage[] {
    const rows = this.database.db.prepare(
      'SELECT * FROM conversations WHERE thread_id = ? ORDER BY created_at ASC'
    ).all(threadId) as ConversationRow[];
    return rows.map(rowToMessage);
  }

  listPinned(threadId: string): ChatMessage[] {
    const rows = this.database.db.prepare(
      'SELECT * FROM conversations WHERE thread_id = ? AND pinned = 1 ORDER BY created_at ASC'
    ).all(threadId) as ConversationRow[];
    return rows.map(rowToMessage);
  }

  clearThread(threadId: string): void {
    this.database.db.prepare('DELETE FROM conversations WHERE thread_id = ?').run(threadId);
  }
}

const VALID_ROLES = new Set<string>(['user', 'assistant', 'system', 'tool']);

function rowToMessage(row: ConversationRow): ChatMessage {
  if (!VALID_ROLES.has(row.role)) {
    throw new Error(`Invalid message role in database: "${row.role}"`);
  }

  let content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  try {
    const parsed = JSON.parse(row.content);
    content = Array.isArray(parsed) ? parsed : row.content;
  } catch {
    content = row.content;
  }

  let toolCalls: ChatMessage['toolCalls'];
  if (row.tool_calls) {
    try { toolCalls = JSON.parse(row.tool_calls); } catch { toolCalls = undefined; }
  }

  return {
    role: row.role as ChatMessage['role'],
    content: content as ChatMessage['content'],
    toolCalls,
    toolCallId: row.tool_call_id ?? undefined,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
  };
}

interface ConversationRow {
  id: number;
  thread_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  pinned: number;
  created_at: number;
}
