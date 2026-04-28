import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ChatShell from "@/components/layout/ChatShell";
import type { User } from "@/lib/types";

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", authUser.id)
    .single();

  if (!profile) {
    redirect("/login");
  }

  return <ChatShell user={profile as User}>{children}</ChatShell>;
}
