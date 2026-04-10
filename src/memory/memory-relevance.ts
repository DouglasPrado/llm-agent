/**
 * LLM-powered relevance selection for file-based memories.
 *
 * Given a user query and a manifest of available memory files, asks the LLM
 * to select up to 5 most relevant memories. Uses LLMClient.chat().
 */

import type { LLMClient } from '../llm/llm-client.js';

const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories that will be useful to an AI agent as it processes a user's query. You will be given the user's query and a list of available memory files with their filenames and descriptions.

Return a JSON object with a "selected_memories" array containing filenames for the memories that will clearly be useful (up to 5). Only include memories that you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful, do not include it.
- If no memories would clearly be useful, return an empty array.
- Return ONLY valid JSON, no other text.`;

/**
 * Ask the LLM to select relevant memories from a manifest.
 * Returns an array of filenames (up to 5) that are most relevant to the query.
 */
export async function selectRelevantMemories(
  query: string,
  manifest: string,
  validFilenames: Set<string>,
  client: LLMClient,
  options?: { model?: string; signal?: AbortSignal },
): Promise<string[]> {
  if (!manifest.trim()) return [];

  try {
    const response = await client.chat({
      model: options?.model,
      messages: [
        { role: 'system', content: SELECT_MEMORIES_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Query: ${query}\n\nAvailable memories:\n${manifest}`,
        },
      ],
      temperature: 0,
      maxTokens: 256,
      responseFormat: { type: 'json_object' },
      signal: options?.signal,
    });

    const parsed = JSON.parse(response.content) as { selected_memories?: string[] };
    if (!Array.isArray(parsed.selected_memories)) return [];

    return parsed.selected_memories
      .filter(f => typeof f === 'string' && validFilenames.has(f))
      .slice(0, 5);
  } catch {
    return [];
  }
}
