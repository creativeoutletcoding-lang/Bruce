import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NewChatOrchestrator from "@/components/chat/NewChatOrchestrator";

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("name, color_hex")
    .eq("id", user.id)
    .single();

  const p = profile as { name: string; color_hex: string } | null;

  return (
    <NewChatOrchestrator
      userName={p?.name ?? "there"}
      userColorHex={p?.color_hex ?? undefined}
    />
  );
}
