// ============================================================
// BRUCE — TypeScript types
// Match schema.sql exactly. Import from here, never redefine inline.
// ============================================================

// ------------------------------------------------------------
// Union types for constrained string fields
// ------------------------------------------------------------

export type UserRole = "admin" | "member";
export type UserStatus = "active" | "suspended" | "deactivated";
export type NotificationSensitivity = "low" | "medium" | "high";
export type ProjectStatus = "active" | "archived";
export type ProjectMemberRole = "owner" | "member";
export type ChatType = "private" | "group" | "family" | "incognito";
export type MessageRole = "user" | "assistant" | "system";
export type MemoryTier = "core" | "active" | "archive";
export type PendingMemoryStatus = "pending" | "approved" | "rejected";

// ------------------------------------------------------------
// Household JSONB shapes
// ------------------------------------------------------------

export interface HouseholdMember {
  name: string;
  age: number;
  role: UserRole;
}

export interface HouseholdChild {
  name: string;
  age: number;
  relationship: string;
}

export interface HouseholdContext {
  family_name: string;
  members: HouseholdMember[];
  household_context: HouseholdChild[];
}

export interface HouseholdMemory {
  id: string;
  content: string;
  category?: string;
  created_at: string;
  created_by?: string;
}

// ------------------------------------------------------------
// DB table types
// ------------------------------------------------------------

export interface Household {
  id: string;
  memories: HouseholdMemory[];
  context: HouseholdContext;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role: UserRole;
  status: UserStatus;
  morning_summary_time: string;
  notification_sensitivity: NotificationSensitivity;
  notification_preferences: Record<string, unknown>;
  fcm_token: string | null;
  deactivated_at: string | null;
  purge_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InviteToken {
  id: string;
  token: string;
  created_by: string;
  email: string | null;
  role: UserRole;
  used: boolean;
  expires_at: string;
  created_at: string;
}

export interface Project {
  id: string;
  owner_id: string;
  name: string;
  icon: string;
  instructions: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: ProjectMemberRole;
  joined_at: string;
}

export interface Chat {
  id: string;
  owner_id: string;
  project_id: string | null;
  type: ChatType;
  title: string | null;
  is_incognito: boolean;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMember {
  id: string;
  chat_id: string;
  user_id: string;
  joined_at: string;
}

export interface Message {
  id: string;
  chat_id: string;
  sender_id: string | null;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface File {
  id: string;
  project_id: string;
  owner_id: string | null;
  google_drive_file_id: string;
  name: string;
  mime_type: string | null;
  drive_url: string | null;
  last_updated: string;
  created_at: string;
}

export interface Memory {
  id: string;
  user_id: string;
  content: string;
  tier: MemoryTier;
  relevance_score: number;
  category: string | null;
  last_accessed: string;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  content: string;
  metadata: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

export interface PendingMemory {
  id: string;
  suggested_by: string | null;
  content: string;
  status: PendingMemoryStatus;
  created_at: string;
}

// ------------------------------------------------------------
// Runtime types (not DB tables)
// ------------------------------------------------------------

export interface MemoryBudget {
  householdContext: string;
  coreMemories: Memory[];
  activeMemories: Memory[];
  totalWordCount: number;
}
