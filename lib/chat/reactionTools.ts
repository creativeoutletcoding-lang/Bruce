import Anthropic from "@anthropic-ai/sdk";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const REACTION_TOOL: Anthropic.Messages.Tool = {
  name: "react_to_message",
  description: `React to the current user message with an emoji. Use this when the message warrants acknowledgment but no substantive reply. When you call this tool, produce no text. The tool call is your complete response.`,
  input_schema: {
    type: "object" as const,
    properties: {
      emoji: {
        type: "string",
        enum: ["👍", "❤️"],
        description: "The reaction emoji. Use 👍 to acknowledge, confirm, or agree. Use ❤️ when a message is warm, personal, or emotionally significant.",
      },
    },
    required: ["emoji"],
  },
};

export const REACTION_SYSTEM_BLOCK = `

## Reactions

You have a third response mode between responding with text and staying silent: reacting.

Call react_to_message({emoji: "👍"}) or react_to_message({emoji: "❤️"}) when:
- The message is purely informational (news, updates, confirmations, check-ins)
- Acknowledgment is appropriate but no follow-up text is needed
- A reaction conveys the right response without additional words

Use 👍 to acknowledge, confirm, or agree.
Use ❤️ when a message is warm, personal, or emotionally significant — a kind gesture, a family moment, something shared with care. Do not use ❤️ for task confirmations or neutral exchanges.

When you call react_to_message, produce no text — the tool call is your complete response.

Lean toward staying silent over reacting. A reaction still signals presence and can feel intrusive if overused. In 1-on-1 conversations you may be slightly more liberal with reactions. Never react to questions or tasks — respond with text for those.`;

function emojiToType(emoji: string): string {
  if (emoji === "❤️") return "heart";
  return "thumbs_up";
}

export async function executeReactionTool(
  messageId: string | null,
  chatId: string | null,
  emoji: string = "👍",
): Promise<string> {
  if (!messageId || !chatId) return "ok";
  const type = emojiToType(emoji);
  try {
    const serviceRole = createServiceRoleClient();
    await serviceRole.from("reactions").upsert(
      { message_id: messageId, chat_id: chatId, user_id: null, type },
      { ignoreDuplicates: true },
    );
  } catch {
    // Ignore — reaction failure is non-critical
  }
  return "ok";
}
