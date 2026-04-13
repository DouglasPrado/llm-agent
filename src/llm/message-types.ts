import type { TokenUsage } from '../contracts/entities/token-usage.js';

/** Message format for OpenAI-compatible APIs */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | LLMContentPart[];
  tool_calls?: LLMToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface LLMContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export interface LLMToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Tool definition for function calling */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Response format for structured output */
export interface ResponseFormat {
  type: 'text' | 'json_object' | 'json_schema';
  json_schema?: { name: string; schema: Record<string, unknown>; strict?: boolean };
}

/** Parameters for streamChat/chat */
export interface StreamChatParams {
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  responseFormat?: ResponseFormat;
  signal?: AbortSignal;
  seed?: number;
  maxTokens?: number;
  model?: string;
}

export type ChatParams = StreamChatParams;

/** Chunk types emitted during SSE streaming */
export type StreamChunk =
  | { type: 'content'; data: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'reasoning'; data: string }
  | { type: 'done'; finishReason: string; usage?: TokenUsage };

/** Non-streaming chat response */
export interface ChatResponse {
  content: string;
  toolCalls?: LLMToolCall[];
  finishReason: string;
  usage: TokenUsage;
}
