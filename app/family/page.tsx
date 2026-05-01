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

export default async function FamilyPage() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  const adminSupabase = createServiceRoleClient();

  const { data: existingChat } = await adminSupabase
    .from("chats")
    .select("id")
    .eq("type", "family_group")
    .maybeSingle();

  if (!existingChat) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: "0.5rem" }}>
        <FamilyTopBar />
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9375rem" }}>
          No family chat yet.
        </p>
      </div>
    );
  }

  const chatId = existingChat.id as string;

  // Load all active members for the sender map
  const { data: membersRaw } = await adminSupabase
    .from("users")
    .select("id, name, avatar_url, role")
    .eq("status", "active");

  const members: UserSummary[] = (membersRaw ?? []) as UserSummary[];

  const memberMap: Record<string, { name: string; avatar_url: string | null }> = {};
  members.forEach((m) => {
    memberMap[m.id] = { name: m.name, avatar_url: m.avatar_url };
  });

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
