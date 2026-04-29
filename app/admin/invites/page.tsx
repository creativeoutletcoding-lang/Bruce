import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import InviteAdminClient from "./InviteAdminClient";

export default async function AdminInvitesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") redirect("/chat");

  return <InviteAdminClient />;
}
