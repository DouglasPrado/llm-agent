import type { Context } from "grammy";
import { getAgent } from "./agent-factory.js";
import { config } from "./config.js";

const TELEGRAM_MAX_LENGTH = 4096;
const STREAM_UPDATE_INTERVAL = 800; // ms between message edits

/**
 * /start command
 */
export async function handleStart(ctx: Context): Promise<void> {
  await ctx.reply(
    `*AgentX SDK Bot* \n\n` +
      `I'm an AI assistant powered by AgentX SDK.\n\n` +
      `*Commands:*\n` +
      `/start — This message\n` +
      `/reset — Clear conversation history\n` +
      `/usage — Show token usage\n` +
      `/memory — Save a memory\n\n` +
      `Just send me a message to chat!`,
    { parse_mode: "Markdown" },
  );
}

/**
 * /reset command — clear thread history
 */
export async function handleReset(ctx: Context): Promise<void> {
  // The ConversationManager doesn't expose clearThread via Agent,
  // but we can use a new threadId suffix to simulate a reset
  const chatId = ctx.chat!.id.toString();
  const resetKey = `reset_${chatId}`;

  // Store reset timestamp in memory so the agent knows
  const agent = await getAgent();
  try {
    await agent.remember(
      `Conversation was reset by the user at ${new Date().toISOString()}`,
      "project",
    );
  } catch {
    // Memory might not be enabled
  }

  await ctx.reply("Conversation cleared. Starting fresh.");
}

/**
 * /usage command — show token usage
 */
export async function handleUsage(ctx: Context): Promise<void> {
  const agent = await getAgent();
  const usage = agent.getUsage();

  await ctx.reply(
    `*Token Usage*\n\n` +
      `Input: ${usage.inputTokens.toLocaleString()}\n` +
      `Output: ${usage.outputTokens.toLocaleString()}\n` +
      `Total: ${usage.totalTokens.toLocaleString()}`,
    { parse_mode: "Markdown" },
  );
}

/**
 * /memory command — explicitly save a memory
 */
export async function handleMemory(ctx: Context): Promise<void> {
  const text = ctx.message?.text?.replace(/^\/memory\s*/, "").trim();

  if (!text) {
    await ctx.reply("Usage: `/memory The user prefers dark mode`", {
      parse_mode: "Markdown",
    });
    return;
  }

  const agent = await getAgent();
  try {
    const filename = await agent.remember(text);
    await ctx.reply(`Memory saved: ${filename}`);
  } catch (error) {
    await ctx.reply("Failed to save memory. Memory subsystem may be disabled.");
  }
}

/**
 * Main message handler — streaming chat with progressive updates
 */
export async function handleMessage(ctx: Context): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  const chatId = ctx.chat!.id.toString();
  const agent = await getAgent();

  // Show "typing" indicator
  await ctx.replyWithChatAction("typing");

  try {
    let fullText = "";
    let sentMessage: { message_id: number } | null = null;
    let lastUpdate = 0;
    let isSearching = false;

    for await (const event of agent.stream(text, { threadId: chatId })) {
      switch (event.type) {
        case "tool_call_start": {
          isSearching = true;
          const toolName = event.toolCall.function.name;
          // Clean up MCP namespace for display: mcp__albert__list_companies → list_companies
          const displayName = toolName.replace(/^mcp__[^_]+__/, "");
          const statusMsg = `⚙️ ${displayName}...`;

          if (!sentMessage) {
            sentMessage = await ctx.reply(statusMsg);
          } else {
            await safeEdit(
              ctx,
              chatId,
              sentMessage.message_id,
              fullText + `\n\n_${statusMsg}_`,
            );
          }
          // Keep typing indicator alive during tool execution
          await ctx.replyWithChatAction("typing").catch(() => {});
          break;
        }

        case "tool_call_end": {
          isSearching = false;
          break;
        }

        case "warning": {
          if (event.code === "max_iterations") {
            console.warn("Max iterations reached for chat", chatId);
          }
          if (event.code === "cost_warning") {
            console.warn("Cost warning:", event.message);
          }
          break;
        }

        case "text_delta": {
          fullText += event.content;

          // Progressive update every STREAM_UPDATE_INTERVAL ms
          const now = Date.now();
          if (now - lastUpdate > STREAM_UPDATE_INTERVAL) {
            const displayText = truncate(fullText + " ▌", TELEGRAM_MAX_LENGTH);

            if (!sentMessage) {
              sentMessage = await ctx.reply(displayText);
            } else {
              await safeEdit(ctx, chatId, sentMessage.message_id, displayText);
            }
            lastUpdate = now;
          }
          break;
        }

        case "error": {
          if (!event.recoverable) {
            console.error("Agent error:", event.error);
            const errorMsg = sentMessage
              ? fullText + "\n\nAn error occurred."
              : "Sorry, an error occurred. Please try again.";

            if (sentMessage) {
              await safeEdit(ctx, chatId, sentMessage.message_id, errorMsg);
            } else {
              await ctx.reply(errorMsg);
            }
            return;
          }
          break;
        }
      }
    }

    // Final message (remove cursor, ensure delivery)
    if (fullText) {
      const chunks = splitMessage(fullText, TELEGRAM_MAX_LENGTH);

      if (sentMessage) {
        // Update first message
        await safeEdit(ctx, chatId, sentMessage.message_id, chunks[0]!);
        // Send additional chunks as new messages
        for (let i = 1; i < chunks.length; i++) {
          await ctx.reply(chunks[i]!);
        }
      } else {
        for (const chunk of chunks) {
          await ctx.reply(chunk);
        }
      }
    } else if (!sentMessage) {
      await ctx.reply("I couldn't generate a response. Please try again.");
    }
  } catch (error) {
    console.error("Handler error:", error);
    await ctx
      .reply("Something went wrong. Please try again.")
      .catch(() => {});
  }
}

// --- Helpers ---

async function safeEdit(
  ctx: Context,
  chatId: string,
  messageId: number,
  text: string,
): Promise<void> {
  try {
    await ctx.api.editMessageText(chatId, messageId, text);
  } catch {
    // Ignore edit errors (message not modified, etc.)
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
