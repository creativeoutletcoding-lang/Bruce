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
    .select("name")
    .eq("id", user.id)
    .single();

  return <NewChatOrchestrator userName={profile?.name ?? "there"} />;
}
