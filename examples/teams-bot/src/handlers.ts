import {
  ActivityTypes,
  MessageFactory,
  TeamsActivityHandler,
  TurnContext,
  type Activity,
} from "botbuilder";
import { getAgent } from "./agent-factory.js";

const TEAMS_MAX_LENGTH = 4000;
const STREAM_UPDATE_INTERVAL = 1000; // ms between message edits (Teams is stricter than Telegram)

/**
 * Teams bot handler — routes commands and streams agent responses.
 */
export class AgentXBot extends TeamsActivityHandler {
  constructor() {
    super();
    this.onMessage(async (context, next) => {
      await this.handleIncomingMessage(context);
      await next();
    });
    this.onMembersAdded(async (context, next) => {
      await this.handleMembersAdded(context);
      await next();
    });
  }

  private async handleIncomingMessage(context: TurnContext): Promise<void> {
    // Strip @mention from message (Teams adds it in channels/groups)
    TurnContext.removeRecipientMention(context.activity);
    const text = (context.activity.text ?? "").trim();
    if (!text) return;

    // Route commands
    if (text === "/start" || text.toLowerCase() === "start") {
      await this.handleStart(context);
    } else if (text === "/reset" || text.toLowerCase() === "reset" || text === "/limpar") {
      await this.handleReset(context);
    } else if (text === "/usage") {
      await this.handleUsage(context);
    } else if (text.startsWith("/memory ")) {
      await this.handleMemory(context, text.replace(/^\/memory\s*/, "").trim());
    } else if (text.startsWith("/learn ")) {
      await this.handleLearn(context, text.replace(/^\/learn\s*/, "").trim());
    } else {
      await this.handleChat(context, text);
    }
  }

  private async handleStart(context: TurnContext): Promise<void> {
    await context.sendActivity(
      "**AgentX SDK Bot**\n\n" +
        "I'm an AI assistant powered by AgentX SDK.\n\n" +
        "**Commands:**\n" +
        "- `/start` — This message\n" +
        "- `/limpar` — Clear conversation history\n" +
        "- `/usage` — Show token usage\n" +
        "- `/memory <text>` — Save a memory\n" +
        "- `/learn <text>` — Teach me a document (RAG)\n\n" +
        "Just send me a message to chat!",
    );
  }

  private async handleReset(context: TurnContext): Promise<void> {
    const conversationId = context.activity.conversation.id;
    const agent = await getAgent(conversationId);
    agent.clearHistory(conversationId);
    await context.sendActivity("Conversa limpa. Começando do zero.");
  }

  private async handleUsage(context: TurnContext): Promise<void> {
    const conversationId = context.activity.conversation.id;
    const agent = await getAgent(conversationId);
    const usage = agent.getUsage();
    await context.sendActivity(
      "**Token Usage**\n\n" +
        `Input: ${usage.inputTokens.toLocaleString()}\n` +
        `Output: ${usage.outputTokens.toLocaleString()}\n` +
        `Total: ${usage.totalTokens.toLocaleString()}`,
    );
  }

  private async handleLearn(
    context: TurnContext,
    text: string,
  ): Promise<void> {
    if (!text) {
      await context.sendActivity("Usage: `/learn <document text>`\nEnvia um texto longo para o bot aprender via RAG.");
      return;
    }

    const conversationId = context.activity.conversation.id;
    const agent = await getAgent(conversationId);
    try {
      await agent.ingestKnowledge({
        content: text,
        metadata: { source: 'teams-chat', ingestedAt: new Date().toISOString() },
      });
      await context.sendActivity(`Knowledge ingested successfully.`);
    } catch (error) {
      console.error('Learn error:', error);
      await context.sendActivity("Failed to ingest knowledge. Knowledge subsystem may be disabled.");
    }
  }

  private async handleMemory(
    context: TurnContext,
    text: string,
  ): Promise<void> {
    if (!text) {
      await context.sendActivity("Usage: `/memory The user prefers dark mode`");
      return;
    }

    const conversationId = context.activity.conversation.id;
    const agent = await getAgent(conversationId);
    try {
      const filename = await agent.remember(text);
      await context.sendActivity(`Memory saved: ${filename}`);
    } catch {
      await context.sendActivity(
        "Failed to save memory. Memory subsystem may be disabled.",
      );
    }
  }

  /**
   * Main chat handler — streams agent response with progressive message updates.
   */
  private async handleChat(context: TurnContext, text: string): Promise<void> {
    const threadId = context.activity.conversation.id;
    console.log("threadId", threadId);
    const agent = await getAgent(threadId);

    // Send an initial typing indicator; refresh only on tool calls so it
    // doesn't linger after the final response (Teams typing auto-expires ~5s).
    try {
      await context.sendActivities([{ type: ActivityTypes.Typing }]);
    } catch {
      /* ignore */
    }

    try {
      let fullText = "";
      let activityId: string | null = null;
      let lastUpdate = 0;

      for await (const event of agent.stream(text, { threadId })) {
        console.log(`[stream] event: ${event.type}`, event.type === 'text_delta' ? `(${event.content.length} chars)` : '');

        switch (event.type) {
          case "tool_call_start": {
            const toolName = event.toolCall.function.name;
            const displayName = toolName.replace(/^mcp__[^_]+__/, "");
            const statusMsg = `${displayName}...`;

            if (!activityId) {
              const resp = await context.sendActivity(statusMsg);
              activityId = resp?.id ?? null;
            } else {
              await safeUpdate(
                context,
                activityId!,
                fullText + `\n\n_${statusMsg}_`,
              );
            }
            try {
              await context.sendActivities([{ type: ActivityTypes.Typing }]);
            } catch {
              /* ignore */
            }
            break;
          }

          case "text_delta": {
            fullText += event.content;

            const now = Date.now();
            if (now - lastUpdate > STREAM_UPDATE_INTERVAL) {
              const displayText = truncate(fullText + " ...", TEAMS_MAX_LENGTH);

              if (!activityId) {
                const resp = await context.sendActivity(displayText);
                activityId = resp?.id ?? null;
              } else {
                await safeUpdate(context, activityId!, displayText);
              }
              lastUpdate = now;
            }
            break;
          }

          case "warning": {
            if (event.code === "max_iterations") {
              console.warn("Max iterations reached for thread", threadId);
            }
            if (event.code === "cost_warning") {
              console.warn("Cost warning:", event.message);
            }
            break;
          }

          case "error": {
            console.error(`Agent error (recoverable=${event.recoverable}):`, event.error);
            if (!event.recoverable) {
              const errorMsg = activityId
                ? fullText + "\n\nAn error occurred."
                : "Sorry, an error occurred. Please try again.";

              if (activityId) {
                await safeUpdate(context, activityId!, errorMsg);
              } else {
                await context.sendActivity(errorMsg);
              }
              return;
            }
            break;
          }
        }
      }

      // Final message
      if (fullText) {
        const chunks = splitMessage(fullText, TEAMS_MAX_LENGTH);

        if (activityId) {
          await safeUpdate(context, activityId!, chunks[0]!);
          for (let i = 1; i < chunks.length; i++) {
            await context.sendActivity(chunks[i]!);
          }
        } else {
          for (const chunk of chunks) {
            await context.sendActivity(chunk);
          }
        }
      } else if (!activityId) {
        console.warn('[stream] No text and no activityId — sending fallback');
        await context.sendActivity(
          "I couldn't generate a response. Please try again.",
        );
      }
    } catch (error) {
      console.error("Handler error:", error);
      try {
        await context.sendActivity("Something went wrong. Please try again.");
      } catch {
        /* ignore */
      }
    }
  }

  private async handleMembersAdded(context: TurnContext): Promise<void> {
    for (const member of context.activity.membersAdded ?? []) {
      if (member.id !== context.activity.recipient.id) {
        await this.handleStart(context);
      }
    }
  }
}

// --- Helpers ---

async function safeUpdate(
  context: TurnContext,
  activityId: string,
  text: string,
): Promise<void> {
  try {
    const updated = MessageFactory.text(text) as Activity;
    updated.id = activityId;
    await context.updateActivity(updated);
  } catch {
    // Ignore update errors (message not modified, race conditions, etc.)
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < maxLength * 0.3) {
      // No good newline — split at space
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt < maxLength * 0.3) {
      // No good space — hard split
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
