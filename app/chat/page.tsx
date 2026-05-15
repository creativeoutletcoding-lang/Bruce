import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NewChatOrchestrator from "@/components/chat/NewChatOrchestrator";
import { getUserProfile } from "@/lib/user/getUserProfile";

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const profile = await getUserProfile(supabase, user.id);

  return (
    <NewChatOrchestrator
      userName={profile?.name ?? "there"}
      userColorHex={profile?.color_hex ?? undefined}
    />
  );
}
