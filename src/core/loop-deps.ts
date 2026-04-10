import type { StreamChatParams, StreamChunk } from '../llm/message-types.js';
import type { LLMClient } from '../llm/llm-client.js';

/**
 * Dependency injection for the react loop.
 * Allows tests to inject fakes without mocking the entire LLMClient.
 */
export interface LoopDeps {
  /** Override for client.streamChat — returns the same stream chunk types */
  callModel: (params: StreamChatParams) => AsyncIterableIterator<StreamChunk>;
  /** UUID generator — useful for deterministic tests */
  uuid: () => string;
}

/** Create production deps from a real client */
export function createProductionDeps(client: LLMClient): LoopDeps {
  return {
    callModel: (params) => client.streamChat(params),
    uuid: () => crypto.randomUUID(),
  };
}
