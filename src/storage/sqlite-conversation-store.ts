import type { ConversationStore } from '../contracts/entities/stores.js';
import type { ChatMessage } from '../contracts/entities/chat-message.js';
import type { SQLiteDatabase } from './sqlite-database.js';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

/**
 * SQLite implementation of ConversationStore.
 */
export class SQLiteConversationStore implements ConversationStore {
  private readonly database: SQLiteDatabase;
  private readonly logger: Logger;

  constructor(database: SQLiteDatabase, logger?: Logger) {
    this.database = database;
    this.logger = logger ?? createLogger({ level: 'warn', prefix: 'SQLiteConversationStore' });
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
    return rows.map(row => rowToMessage(row, this.logger));
  }

  listPinned(threadId: string): ChatMessage[] {
    const rows = this.database.db.prepare(
      'SELECT * FROM conversations WHERE thread_id = ? AND pinned = 1 ORDER BY created_at ASC'
    ).all(threadId) as ConversationRow[];
    return rows.map(row => rowToMessage(row, this.logger));
  }

  clearThread(threadId: string): void {
    this.database.db.prepare('DELETE FROM conversations WHERE thread_id = ?').run(threadId);
  }
}

const VALID_ROLES = new Set<string>(['user', 'assistant', 'system', 'tool']);

function rowToMessage(row: ConversationRow, logger: Logger): ChatMessage {
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
    try {
      toolCalls = JSON.parse(row.tool_calls);
    } catch (e) {
      logger.warn('Invalid tool_calls JSON in conversations table', {
        rowId: row.id,
        threadId: row.thread_id,
        error: e instanceof Error ? e.message : String(e),
      });
      toolCalls = undefined;
    }
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
