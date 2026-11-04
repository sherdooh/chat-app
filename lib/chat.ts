import type { PostgrestError } from "@supabase/supabase-js";

export const PAGE_SIZE = 50;
export const HEARTBEAT_MS = 25_000;

export const MESSAGE_COLUMNS =
  "id,sender_id,content,created_at,updated_at,edited_at,deleted_at,reply_to";
export const PRESENCE_COLUMNS = "user_id,online,last_seen_at";
export const PROFILE_COLUMNS = "user_id,display_name,avatar_emoji,avatar_photo";

export const QUICK_EMOJI = [
  "😂",
  "🥰",
  "😘",
  "🥺",
  "😭",
  "🔥",
  "💕",
  "✨",
  "🙈",
  "👀",
  "🤗",
  "😴",
];

export const STARTERS = ["hey 💕", "miss you", "you up? 🌙", "hi 🙈"];

export const UPGRADE_HINT =
  "This app got an update! The database needs the latest migration — paste the SQL from the setup guide into Supabase, then refresh.";

export type ChatMessage = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_to: string | null;
  status?: "sending" | "failed";
};

export type Presence = {
  user_id: string;
  online: boolean;
  last_seen_at: string;
};

export type Profile = {
  user_id: string;
  display_name: string;
  avatar_emoji: string | null;
  avatar_photo: string | null;
};

export type Reaction = {
  message_id: string;
  user_id: string;
  emoji: string;
};

export type Receipt = {
  user_id: string;
  last_read_at: string | null;
  last_delivered_at: string | null;
};

export type ReceiptState = "sending" | "failed" | "sent" | "delivered" | "read";

export function ms(iso: string | null | undefined): number {
  if (!iso) return 0;
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : 0;
}

export function byOrder(a: ChatMessage, b: ChatMessage): number {
  return ms(a.created_at) - ms(b.created_at) || a.id.localeCompare(b.id);
}

export function mergeMessages(...lists: ChatMessage[][]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const list of lists) for (const m of list) map.set(m.id, m);
  return [...map.values()].sort(byOrder);
}

export function latestUpdate(list: ChatMessage[]): string | null {
  let latest: string | null = null;
  let latestMs = -Infinity;
  for (const m of list) {
    const t = ms(m.updated_at);
    if (t > latestMs) {
      latestMs = t;
      latest = m.updated_at;
    }
  }
  return latest;
}

export function toMessage(
  row: Partial<ChatMessage> & { id: string },
): ChatMessage {
  const now = new Date().toISOString();
  return {
    id: row.id,
    sender_id: row.sender_id ?? "",
    content: row.content ?? "",
    created_at: row.created_at ?? now,
    updated_at: row.updated_at ?? row.created_at ?? now,
    edited_at: row.edited_at ?? null,
    deleted_at: row.deleted_at ?? null,
    reply_to: row.reply_to ?? null,
    status: row.status,
  };
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function dayLabel(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}

export function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function defaultNameFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? "you").replace(/[._-]+/g, " ").trim();
  if (!local) return "You";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials"))
    return "Hmm, that didn't match 🤔 Double-check your email and password.";
  if (m.includes("email not confirmed"))
    return "Your email isn't confirmed yet 📬 Check your inbox for the link.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Whoa, slow down 😅 Too many tries. Give it a minute.";
  if (m.includes("failed to fetch") || m.includes("network"))
    return "Can't reach the server 📡 Check your connection and try again.";
  return message;
}

export function needsUpgrade(
  error: PostgrestError | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "42P01") return true;
  const m = (error.message ?? "").toLowerCase();
  return m.includes("does not exist") || m.includes("schema cache");
}

export function presenceLine(p: Presence, nowServer: number): string {
  const age = nowServer - ms(p.last_seen_at);
  if (p.online && age < 60_000) return "online";
  if (age < 60_000) return "last seen just now";
  if (age < 60 * 60_000) return `last seen ${Math.floor(age / 60_000)}m ago`;
  if (age < 24 * 60 * 60_000)
    return `last seen ${Math.floor(age / (60 * 60_000))}h ago`;
  if (age < 7 * 24 * 60 * 60_000)
    return `last seen ${Math.floor(age / (24 * 60 * 60_000))}d ago`;
  return `last seen ${new Date(p.last_seen_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}
