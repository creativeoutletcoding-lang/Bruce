import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import FamilyChatWindow from "@/components/family/FamilyChatWindow";
import FamilyTopBar from "@/components/family/FamilyTopBar";
import type { UserSummary } from "@/lib/types";

interface RawMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
  sender_id: string | null;
}

async function ensureFamilyChat(adminSupabase: ReturnType<typeof createServiceRoleClient>): Promise<string | null> {
  const { data: existing } = await adminSupabase
    .from("chats")
    .select("id")
    .eq("type", "family_group")
    .maybeSingle();

  if (existing) return existing.id as string;

  // Get admin to be owner_id
  const { data: adminUser } = await adminSupabase
    .from("users")
    .select("id")
    .eq("role", "admin")
    .maybeSingle();

  if (!adminUser) return null;

  const { data: newChat, error } = await adminSupabase
    .from("chats")
    .insert({
      owner_id: adminUser.id,
      project_id: null,
      type: "family_group",
      title: "Family",
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !newChat) {
    console.error("[family/page] Failed to create family chat:", error);
    return null;
  }

  // Add all active members to chat_members so message RLS works
  const { data: members } = await adminSupabase
    .from("users")
    .select("id")
    .eq("status", "active");

  if (members?.length) {
    await adminSupabase.from("chat_members").insert(
      (members as { id: string }[]).map((m) => ({
        chat_id: newChat.id,
        user_id: m.id,
      }))
    );
  }

  return newChat.id as string;
}

export default async function FamilyPage() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  const adminSupabase = createServiceRoleClient();

  const chatId = await ensureFamilyChat(adminSupabase);
  if (!chatId) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9375rem" }}>
          Family chat unavailable. Contact Jake.
        </p>
      </div>
    );
  }

  // Load all active members for the sender map
  const { data: membersRaw } = await adminSupabase
    .from("users")
    .select("id, name, avatar_url, role")
    .eq("status", "active");

  const members: UserSummary[] = (membersRaw ?? []) as UserSummary[];

  // Build member map for enriching messages
  const memberMap: Record<string, { name: string; avatar_url: string | null }> = {};
  members.forEach((m) => {
    memberMap[m.id] = { name: m.name, avatar_url: m.avatar_url };
  });

  // Load recent messages
  const { data: rawMessages } = await adminSupabase
    .from("messages")
    .select("id, role, content, created_at, sender_id")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true })
    .limit(100);

  const messages = ((rawMessages ?? []) as RawMessage[]).map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
    created_at: m.created_at,
    sender_id: m.sender_id,
    sender_name: m.sender_id ? (memberMap[m.sender_id]?.name ?? null) : null,
    sender_avatar: m.sender_id ? (memberMap[m.sender_id]?.avatar_url ?? null) : null,
  }));

  return (
    <FamilyChatWindow
      chatId={chatId}
      currentUserId={authUser.id}
      members={members}
      initialMessages={messages}
      topbar={<FamilyTopBar />}
    />
  );
}
