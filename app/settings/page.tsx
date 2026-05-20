import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BackButton from "./BackButton";
import SettingsLayout, { type SettingsProfile } from "./SettingsLayout";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("name, email, preferred_model, notification_sensitivity, notification_preferences, color_hex")
    .eq("id", user.id)
    .single();

  return (
    <div style={styles.page}>
      <div style={styles.wrapper}>
        <BackButton />
        <h1 style={styles.heading}>Settings</h1>
        <SettingsLayout profile={profile as SettingsProfile | null} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100dvh",
    backgroundColor: "var(--bg-primary)",
    overflowY: "auto",
  },
  wrapper: {
    maxWidth: "860px",
    margin: "0 auto",
    padding: "24px 16px 56px",
  },
  heading: {
    fontSize: "1.375rem",
    fontWeight: "700",
    color: "var(--text-primary)",
    letterSpacing: "-0.02em",
    margin: "8px 0 24px",
  },
};
