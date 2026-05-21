import Anthropic from "@anthropic-ai/sdk";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const REACTION_TOOL: Anthropic.Messages.Tool = {
  name: "react_to_message",
  description: `React to the current user message with a thumbs up. Use this when the message is purely informational — sharing news, a status update, a confirmation, or context that warrants acknowledgment but needs no substantive reply. When you call this tool, produce no text. The tool call is your complete response.`,
  input_schema: {
    type: "object" as const,
    properties: {
      type: {
        type: "string",
        enum: ["thumbs_up"],
        description: "Reaction type",
      },
    },
    required: ["type"],
  },
};

export const REACTION_SYSTEM_BLOCK = `

## Reactions

You have a third response mode between responding with text and staying silent: reacting.

Call react_to_message({type: "thumbs_up"}) when:
- The message is purely informational (news, updates, confirmations, check-ins)
- Acknowledgment is appropriate but no follow-up text is needed
- A thumbs up conveys the right response without additional words

When you call react_to_message, produce no text — the tool call is your complete response.

Lean toward staying silent over reacting. A reaction still signals presence and can feel intrusive if overused. In 1-on-1 conversations you may be slightly more liberal with reactions. Never react to questions or tasks — respond with text for those.`;

export async function executeReactionTool(
  messageId: string | null,
  chatId: string | null,
): Promise<string> {
  if (!messageId || !chatId) return "ok";
  try {
    const serviceRole = createServiceRoleClient();
    await serviceRole.from("reactions").upsert(
      { message_id: messageId, chat_id: chatId, user_id: null, type: "thumbs_up" },
      { ignoreDuplicates: true },
    );
  } catch {
    // Ignore — reaction failure is non-critical
  }
  return "ok";
}
