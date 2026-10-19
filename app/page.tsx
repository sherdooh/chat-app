"use client";

import {
  FormEvent,
  KeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  Check,
  CheckCheck,
  Eye,
  EyeOff,
  LockKeyhole,
  LogOut,
  MoreHorizontal,
  Pencil,
  Reply,
  RotateCw,
  Send,
  Smile,
  Trash2,
  X,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/* ---------- config ---------- */

const APP = {
  name: "close",
  chatTitle: "hey babe 💕",
  creator: "Shaddie",
};

type Person = { name: string; emoji: string; photo: string | null };

const PEOPLE: { me: Person; them: Person } = {
  me: { name: "You", emoji: "🌸", photo: null },
  them: { name: "Shaddie", emoji: "💚", photo: null },
};

const QUICK_EMOJI = [
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

const REACTION_SET = ["❤️", "😂", "🥺", "🔥", "👍", "😮"];

/* ---------- types ---------- */

type ChatMessage = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  reply_to?: string | null;
};

type Outgoing = ChatMessage & { status?: "sending" | "failed" };
type Reaction = { message_id: string; user_id: string; emoji: string };
type Receipt = {
  user_id: string;
  last_read_at: string | null;
  last_delivered_at: string | null;
};
type ReceiptPatch = {
  user_id: string;
  last_delivered_at: string;
  last_read_at?: string;
};

const MESSAGE_COLUMNS =
  "id,sender_id,content,created_at,edited_at,deleted_at,reply_to";

/* ---------- helpers ---------- */

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const timeLabel = (v: string) => timeFmt.format(new Date(v));
const timeOf = (v: string) => new Date(v).getTime();

function dayLabel(value: string) {
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

const byTime = (a: ChatMessage, b: ChatMessage) =>
  timeOf(a.created_at) - timeOf(b.created_at) || a.id.localeCompare(b.id);

function mergeMessages(...lists: ChatMessage[][]) {
  const map = new Map<string, ChatMessage>();
  for (const list of lists) for (const m of list) map.set(m.id, m);
  return [...map.values()].sort(byTime);
}

function lastSyncedAt(list: ChatMessage[]): string | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    if (!(list[i] as Outgoing).status) return list[i].created_at;
  }
  return undefined;
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)"'\]])/g;
function linkify(text: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

/** Detect a bubble whose only content is 1–3 emoji. */
function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 20) return false;
  const emojis = trimmed.match(/\p{Extended_Pictographic}/gu);
  if (!emojis || emojis.length === 0 || emojis.length > 3) return false;
  return /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Emoji_Component}|\u200D|\uFE0F|\s)+$/u.test(
    trimmed,
  );
}

function friendlyAuthError(message: string) {
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

const newLocalId = () =>
  `local-${
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  }`;

/* ---------- small components ---------- */

function Avatar({
  person,
  size = "md",
  ring = false,
}: {
  person: Person;
  size?: "xs" | "sm" | "md";
  ring?: boolean;
}) {
  const cls = [
    "avatar",
    size !== "md" ? `avatar-${size}` : "",
    ring ? "has-ring" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls} aria-hidden="true">
      {person.photo ? (
        <img src={person.photo} alt="" loading="lazy" />
      ) : (
        person.emoji
      )}
    </span>
  );
}

/* ---------- app ---------- */

export default function Home() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [access, setAccess] = useState<"checking" | "ok" | "denied">(
    "checking",
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState("");

  const [messages, setMessages] = useState<Outgoing[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [online, setOnline] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [notice, setNotice] = useState("");

  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionsFor, setActionsFor] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const firstScroll = useRef(true);
  const coarsePointer = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const receiptPing = useRef<{ delivered: number; read: number }>({
    delivered: 0,
    read: 0,
  });
  const lastPingedId = useRef<{
    delivered: string | null;
    read: string | null;
  }>({ delivered: null, read: null });

  messagesRef.current = messages;

  const userId = user?.id ?? null;

  /* ---------- session ---------- */
  useEffect(() => {
    coarsePointer.current = window.matchMedia("(pointer: coarse)").matches;
    try {
      const saved = localStorage.getItem("close:email");
      if (saved) setEmail(saved);
    } catch {}

    let alive = true;
    let unsubscribe: (() => void) | undefined;

    try {
      const client = getSupabase();
      setSupabase(client);

      client.auth
        .getSession()
        .then(({ data, error }) => {
          if (!alive) return;
          if (error) setAuthError(friendlyAuthError(error.message));
          setUser(data.session?.user ?? null);
          setBooting(false);
        })
        .catch((err: unknown) => {
          if (!alive) return;
          setAuthError(
            err instanceof Error ? err.message : "Could not start the app.",
          );
          setBooting(false);
        });

      const { data: listener } = client.auth.onAuthStateChange(
        (event, session) => {
          setUser(session?.user ?? null);
          setBooting(false);
          if (event === "SIGNED_IN") setAuthError("");
        },
      );
      unsubscribe = () => listener.subscription.unsubscribe();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : "Could not start the app.",
      );
      setBooting(false);
    }

    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  /* ---------- history ---------- */
  const loadMessages = useCallback(
    async (client: SupabaseClient, since?: string) => {
      if (!since && messagesRef.current.length === 0) setLoadingMessages(true);
      const pageSize = 1000;
      const fetched: ChatMessage[] = [];
      let offset = 0;
      let loadError: { message: string } | null = null;

      for (;;) {
        let query = client.from("messages").select(MESSAGE_COLUMNS);
        if (since) query = query.gte("created_at", since);
        const { data, error } = await query
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) {
          loadError = error;
          break;
        }
        const page = (data ?? []) as ChatMessage[];
        fetched.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
      }

      if (loadError) {
        if (!since)
          setNotice(`Couldn't load your messages 😕 ${loadError.message}`);
      } else {
        setMessages((previous) => mergeMessages(fetched, previous));
        setNotice("");
      }
      setLoadingMessages(false);
    },
    [],
  );

  const loadReactions = useCallback(async (client: SupabaseClient) => {
    const { data, error } = await client
      .from("message_reactions")
      .select("message_id,user_id,emoji");
    if (!error && data) setReactions(data as Reaction[]);
  }, []);

  const loadReceipts = useCallback(async (client: SupabaseClient) => {
    const { data, error } = await client
      .from("message_reads")
      .select("user_id,last_read_at,last_delivered_at");
    if (!error && data) setReceipts(data as Receipt[]);
  }, []);

  /* ---------- membership + realtime ---------- */
  useEffect(() => {
    if (!supabase || !userId) {
      setMessages([]);
      setReactions([]);
      setReceipts([]);
      setOnline(false);
      setAccess("checking");
      return;
    }

    let alive = true;
    let channel: ReturnType<SupabaseClient["channel"]> | null = null;

    (async () => {
      const { data: member, error } = await supabase
        .from("chat_members")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (!alive) return;

      if (!error && !member) {
        setAccess("denied");
        return;
      }
      setAccess("ok");

      void loadMessages(supabase);
      void loadReactions(supabase);
      void loadReceipts(supabase);

      channel = supabase
        .channel("private-two-person-chat")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload) => {
            const incoming = payload.new as ChatMessage;
            if (!incoming?.id || !alive) return;
            if (incoming.sender_id === userId) return;
            setMessages((previous) => mergeMessages(previous, [incoming]));
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "messages" },
          (payload) => {
            const incoming = payload.new as ChatMessage;
            if (!incoming?.id || !alive) return;
            setMessages((previous) =>
              previous.map((m) =>
                m.id === incoming.id
                  ? { ...m, ...incoming, status: undefined }
                  : m,
              ),
            );
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "message_reactions" },
          (payload) => {
            if (!alive) return;
            if (payload.eventType === "INSERT") {
              const row = payload.new as Reaction;
              if (!row?.message_id) return;
              setReactions((previous) =>
                previous.some(
                  (r) =>
                    r.message_id === row.message_id &&
                    r.user_id === row.user_id &&
                    r.emoji === row.emoji,
                )
                  ? previous
                  : [...previous, row],
              );
            } else if (payload.eventType === "DELETE") {
              const row = payload.old as Partial<Reaction>;
              if (row?.message_id && row?.user_id && row?.emoji) {
                setReactions((previous) =>
                  previous.filter(
                    (r) =>
                      !(
                        r.message_id === row.message_id &&
                        r.user_id === row.user_id &&
                        r.emoji === row.emoji
                      ),
                  ),
                );
              } else {
                void loadReactions(supabase);
              }
            }
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "message_reads" },
          () => {
            if (!alive) return;
            void loadReceipts(supabase);
          },
        )
        .subscribe((status) => {
          if (!alive) return;
          setOnline(status === "SUBSCRIBED");
          if (status === "SUBSCRIBED") {
            void loadMessages(supabase, lastSyncedAt(messagesRef.current));
            void loadReactions(supabase);
            void loadReceipts(supabase);
          }
        });
    })();

    return () => {
      alive = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, userId, loadMessages, loadReactions, loadReceipts]);

  /* ---------- tab visible again ---------- */
  useEffect(() => {
    if (!supabase || !userId) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const last = lastSyncedAt(messagesRef.current);
      if (last) void loadMessages(supabase, last);
      void loadReceipts(supabase);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [supabase, userId, loadMessages, loadReceipts]);

  /* ---------- receipts ---------- */
  const pingReceipt = useCallback(
    async (kind: "delivered" | "read") => {
      if (!supabase || !userId) return;

      const latest = messagesRef.current[messagesRef.current.length - 1];
      const latestId = latest?.id ?? null;
      const now = Date.now();
      const sameAsLast = lastPingedId.current[kind] === latestId;

      if (sameAsLast && now - receiptPing.current[kind] < 4000) return;

      receiptPing.current[kind] = now;
      lastPingedId.current[kind] = latestId;

      const iso = new Date(now).toISOString();
      const patch: ReceiptPatch =
        kind === "read"
          ? { user_id: userId, last_read_at: iso, last_delivered_at: iso }
          : { user_id: userId, last_delivered_at: iso };

      const { error } = await supabase
        .from("message_reads")
        .upsert(patch, { onConflict: "user_id" });
      if (error) receiptPing.current[kind] = 0;
    },
    [supabase, userId],
  );

  useEffect(() => {
    if (!userId || messages.length === 0) return;
    void pingReceipt("delivered");
    if (stickToBottom.current && document.visibilityState === "visible")
      void pingReceipt("read");
  }, [messages, userId, pingReceipt]);

  /* ---------- scrolling ---------- */
  useEffect(() => {
    if (!stickToBottom.current) return;
    bottomRef.current?.scrollIntoView({
      behavior: firstScroll.current ? "auto" : "smooth",
      block: "end",
    });
    if (messages.length) firstScroll.current = false;
  }, [messages]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stickToBottom.current)
        bottomRef.current?.scrollIntoView({ block: "end" });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [access, userId]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft, access]);

  /* ---------- derived ---------- */
  const messageById = useMemo(() => {
    const map = new Map<string, Outgoing>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  const reactionsByMessage = useMemo(() => {
    const grouped = new Map<
      string,
      Map<string, { count: number; mine: boolean }>
    >();
    for (const r of reactions) {
      let perEmoji = grouped.get(r.message_id);
      if (!perEmoji) {
        perEmoji = new Map();
        grouped.set(r.message_id, perEmoji);
      }
      const entry = perEmoji.get(r.emoji) ?? { count: 0, mine: false };
      entry.count += 1;
      if (user && r.user_id === user.id) entry.mine = true;
      perEmoji.set(r.emoji, entry);
    }
    const out = new Map<
      string,
      { emoji: string; count: number; mine: boolean }[]
    >();
    for (const [id, perEmoji] of grouped) {
      out.set(
        id,
        [...perEmoji.entries()].map(([emoji, v]) => ({ emoji, ...v })),
      );
    }
    return out;
  }, [reactions, user]);

  const otherReceipt = useMemo(
    () => receipts.find((r) => r.user_id !== user?.id) ?? null,
    [receipts, user],
  );

  function receiptStateFor(message: Outgoing) {
    if (message.status === "sending") return "sending" as const;
    if (message.status === "failed") return "failed" as const;
    const at = timeOf(message.created_at);
    if (otherReceipt?.last_read_at && timeOf(otherReceipt.last_read_at) >= at)
      return "read" as const;
    if (
      otherReceipt?.last_delivered_at &&
      timeOf(otherReceipt.last_delivered_at) >= at
    )
      return "delivered" as const;
    return "sent" as const;
  }

  /* ---------- actions ---------- */
  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!supabase || signingIn) return;
    setAuthError("");
    setSigningIn(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setAuthError(friendlyAuthError(error.message));
    } else {
      try {
        localStorage.setItem("close:email", email.trim());
      } catch {}
      setPassword("");
    }
    setSigningIn(false);
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setMessages([]);
    setReactions([]);
    setReceipts([]);
    setEmojiOpen(false);
    setReplyingTo(null);
    setEditingId(null);
    setActionsFor(null);
    firstScroll.current = true;
    stickToBottom.current = true;
    lastPingedId.current = { delivered: null, read: null };
  }

  async function deliver(message: Outgoing) {
    if (!supabase) return;
    setMessages((previous) =>
      previous.map((m) =>
        m.id === message.id ? { ...m, status: "sending" } : m,
      ),
    );

    const { data, error } = await supabase
      .from("messages")
      .insert({
        sender_id: message.sender_id,
        content: message.content,
        reply_to: message.reply_to ?? null,
      })
      .select(MESSAGE_COLUMNS)
      .single();

    if (error || !data) {
      setMessages((previous) =>
        previous.map((m) =>
          m.id === message.id ? { ...m, status: "failed" } : m,
        ),
      );
      setNotice("That didn't send 😕 Tap the message to try again.");
      return;
    }

    setMessages((previous) =>
      mergeMessages(
        previous.filter((m) => m.id !== message.id),
        [data as ChatMessage],
      ),
    );
    setNotice("");
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!supabase || !user || !content) return;

    const optimistic: Outgoing = {
      id: newLocalId(),
      sender_id: user.id,
      content,
      created_at: new Date().toISOString(),
      reply_to:
        replyingTo && !replyingTo.id.startsWith("local-")
          ? replyingTo.id
          : null,
      status: "sending",
    };

    setMessages((previous) => [...previous, optimistic]);
    setDraft("");
    setReplyingTo(null);
    setEmojiOpen(false);
    stickToBottom.current = true;
    void pingReceipt("read");

    await deliver(optimistic);
    composerRef.current?.focus();
  }

  async function saveEdit() {
    if (!supabase || !editingId) return;
    const content = draft.trim();
    if (!content) return;

    const id = editingId;
    const original = messages.find((m) => m.id === id);
    setEditingId(null);
    setDraft("");
    if (!original || original.content === content) return;

    const editedAt = new Date().toISOString();
    setMessages((previous) =>
      previous.map((m) =>
        m.id === id ? { ...m, content, edited_at: editedAt } : m,
      ),
    );

    const { error } = await supabase
      .from("messages")
      .update({ content, edited_at: editedAt })
      .eq("id", id);

    if (error) {
      setMessages((previous) =>
        previous.map((m) =>
          m.id === id
            ? {
                ...m,
                content: original.content,
                edited_at: original.edited_at,
              }
            : m,
        ),
      );
      setNotice(`Couldn't save that edit 😕 ${error.message}`);
    }
    composerRef.current?.focus();
  }

  async function deleteMessage(id: string) {
    if (!supabase) return;
    setActionsFor(null);
    const original = messages.find((m) => m.id === id);
    if (!original || original.deleted_at) return;

    const deletedAt = new Date().toISOString();
    setMessages((previous) =>
      previous.map((m) => (m.id === id ? { ...m, deleted_at: deletedAt } : m)),
    );

    const { error } = await supabase
      .from("messages")
      .update({ deleted_at: deletedAt })
      .eq("id", id);

    if (error) {
      setMessages((previous) =>
        previous.map((m) => (m.id === id ? original : m)),
      );
      setNotice(`Couldn't delete that 😕 ${error.message}`);
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!supabase || !user) return;
    setActionsFor(null);

    const mine = reactions.find(
      (r) =>
        r.message_id === messageId &&
        r.user_id === user.id &&
        r.emoji === emoji,
    );

    if (mine) {
      setReactions((previous) =>
        previous.filter(
          (r) =>
            !(
              r.message_id === messageId &&
              r.user_id === user.id &&
              r.emoji === emoji
            ),
        ),
      );
      const { error } = await supabase
        .from("message_reactions")
        .delete()
        .match({ message_id: messageId, user_id: user.id, emoji });
      if (error) {
        setReactions((previous) => [...previous, mine]);
        setNotice(`Couldn't remove that reaction 😕 ${error.message}`);
      }
    } else {
      const optimistic: Reaction = {
        message_id: messageId,
        user_id: user.id,
        emoji,
      };
      setReactions((previous) => [...previous, optimistic]);
      const { error } = await supabase
        .from("message_reactions")
        .insert(optimistic);
      if (error) {
        setReactions((previous) =>
          previous.filter(
            (r) =>
              !(
                r.message_id === messageId &&
                r.user_id === user.id &&
                r.emoji === emoji
              ),
          ),
        );
        setNotice(`Couldn't add that reaction 😕 ${error.message}`);
      }
    }
  }

  function startEditing(message: Outgoing) {
    setActionsFor(null);
    setReplyingTo(null);
    setEditingId(message.id);
    setDraft(message.content);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(
        message.content.length,
        message.content.length,
      );
    });
  }

  function cancelComposerExtras() {
    setReplyingTo(null);
    setEditingId(null);
    setDraft("");
  }

  function addEmoji(emoji: string) {
    const el = composerRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + emoji.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    stickToBottom.current = atBottom;
    setShowScrollButton(!atBottom && messages.length > 0);
    if (atBottom && document.visibilityState === "visible")
      void pingReceipt("read");
  }

  function onComposerSubmit(event: FormEvent) {
    event.preventDefault();
    if (editingId) void saveEdit();
    else void sendMessage();
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      !coarsePointer.current
    ) {
      event.preventDefault();
      if (editingId) void saveEdit();
      else void sendMessage();
    }
    if (event.key === "Escape" && (editingId || replyingTo)) {
      event.preventDefault();
      cancelComposerExtras();
    }
  }

  /* ---------- screens ---------- */
  if (booting || (user && access === "checking"))
    return (
      <main className="splash">
        <div className="brand-mark" aria-hidden="true">
          💌
        </div>
        <p>Opening our little space… ✨</p>
      </main>
    );

  if (!user)
    return (
      <main className="auth-screen">
        <div className="blob blob-a" aria-hidden="true" />
        <div className="blob blob-b" aria-hidden="true" />
        <section className="auth-card">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              💌
            </span>
            <span className="brand-word">
              {APP.name}
              <span className="brand-period">.</span>
            </span>
          </div>
          <div className="auth-copy">
            <h1>
              Hey you{" "}
              <span className="wave" aria-hidden="true">
                👋
              </span>
            </h1>
            <p>
              Our little corner of the internet. Sign in and pick up right where
              we left off.
            </p>
          </div>
          <form className="auth-form" onSubmit={signIn}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="password-wrap">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Your secret password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
            </div>
            {authError && (
              <p className="form-error" role="alert">
                {authError}
              </p>
            )}
            <button
              className="primary-button"
              type="submit"
              disabled={signingIn}
            >
              {signingIn ? (
                <>
                  Opening the door… <span className="mini-spinner light" />
                </>
              ) : (
                <>Let me in 💕</>
              )}
            </button>
          </form>
          <p className="auth-foot">
            <LockKeyhole size={14} /> Just for two. Nobody else gets in.
          </p>
        </section>
        <p className="auth-caption">Built by {APP.creator}, for two 💛</p>
      </main>
    );

  if (access === "denied")
    return (
      <main className="auth-screen">
        <div className="blob blob-a" aria-hidden="true" />
        <div className="blob blob-b" aria-hidden="true" />
        <section className="auth-card">
          <div className="auth-copy denied-copy">
            <h1>Not on the list 🙅</h1>
            <p>
              {APP.name} is just for two people, and{" "}
              <strong>{user.email ?? "this account"}</strong> isn&apos;t one of
              them yet. Wrong account? Sign out and try the other one.
            </p>
          </div>
          <button className="primary-button" type="button" onClick={signOut}>
            Sign out 👋
          </button>
        </section>
      </main>
    );

  return (
    <main className="chat-shell">
      <aside className="side-rail">
        <div className="rail-logo" aria-hidden="true">
          💌
        </div>
        <button
          className="icon-button"
          title="Sign out"
          aria-label="Sign out"
          onClick={signOut}
        >
          <LogOut size={20} />
        </button>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          <div className="chat-person">
            <Avatar person={PEOPLE.them} ring />
            <div className="person-copy">
              <h1>{APP.chatTitle}</h1>
              <div className="presence" role="status">
                <span className={`presence-dot ${online ? "is-online" : ""}`} />
                {online ? "online" : "connecting…"}
              </div>
            </div>
          </div>
          <div className="header-actions">
            <button
              className="icon-button header-signout"
              title="Sign out"
              aria-label="Sign out"
              onClick={signOut}
            >
              <LogOut size={20} />
            </button>
          </div>
        </header>

        <div className="conversation" ref={listRef} onScroll={onScroll}>
          <div className="conversation-inner">
            <div className="privacy-note">
              <div className="privacy-icon" aria-hidden="true">
                🔒
              </div>
              <p>
                <strong>hey babie!! 💕</strong>
                <br />
                Only the two of us can read or send messages in here.
              </p>
            </div>

            {loadingMessages && messages.length === 0 && (
              <div className="loading-line">
                <span className="mini-spinner" /> Fetching your messages… 💭
              </div>
            )}

            {!loadingMessages && messages.length === 0 && (
              <div className="empty-state">
                <div className="empty-avatars">
                  <Avatar person={PEOPLE.them} />
                  <Avatar person={PEOPLE.me} />
                </div>
                <h2>Say hi first 👋</h2>
                <p>
                  Your very first message goes here, and it&apos;ll be waiting
                  next time you&apos;re back.
                </p>
              </div>
            )}

            {messages.map((message, index) => {
              const mine = message.sender_id === user.id;
              const previous = messages[index - 1];
              const next = messages[index + 1];
              const sameDay = (a: ChatMessage, b: ChatMessage) =>
                new Date(a.created_at).toDateString() ===
                new Date(b.created_at).toDateString();
              const closeTogether = (a: ChatMessage, b: ChatMessage) =>
                a.sender_id === b.sender_id &&
                sameDay(a, b) &&
                timeOf(b.created_at) - timeOf(a.created_at) < 5 * 60 * 1000;

              const showDate = !previous || !sameDay(previous, message);
              const joinedPrev = !!previous && closeTogether(previous, message);
              const endsGroup = !next || !closeTogether(message, next);

              const deleted = !!message.deleted_at;
              const parent = message.reply_to
                ? messageById.get(message.reply_to)
                : undefined;
              const chips = reactionsByMessage.get(message.id) ?? [];
              const receipt = mine ? receiptStateFor(message) : null;
              const failed = message.status === "failed";
              const emojiOnly =
                !deleted &&
                !parent &&
                !message.edited_at &&
                isEmojiOnly(message.content);
              const openBelow = index < 3;

              return (
                <div key={message.id}>
                  {showDate && (
                    <div className="date-divider">
                      <span>{dayLabel(message.created_at)}</span>
                    </div>
                  )}
                  <div
                    className={`message-row ${mine ? "mine" : "theirs"} ${
                      joinedPrev ? "joined" : ""
                    }`}
                  >
                    {!mine &&
                      (joinedPrev ? (
                        <div className="avatar-spacer" />
                      ) : (
                        <Avatar person={PEOPLE.them} size="xs" />
                      ))}

                    <div className="bubble-wrap">
                      <div
                        className={`bubble ${
                          mine ? "bubble-mine" : "bubble-theirs"
                        } ${endsGroup ? "ends-group" : ""} ${
                          deleted ? "is-deleted" : ""
                        } ${emojiOnly ? "bubble-emoji-only" : ""}`}
                      >
                        {parent && !deleted && (
                          <div className="reply-quote">
                            <strong>
                              {parent.sender_id === user.id
                                ? "You"
                                : PEOPLE.them.name}
                            </strong>
                            <span>
                              {parent.deleted_at
                                ? "message deleted"
                                : parent.content}
                            </span>
                          </div>
                        )}

                        <span className="text">
                          {deleted
                            ? "This message was deleted"
                            : linkify(message.content)}
                        </span>

                        {!deleted && message.edited_at && (
                          <span className="edited-tag"> · edited</span>
                        )}

                        <span className="meta">
                          <time dateTime={message.created_at}>
                            {timeLabel(message.created_at)}
                          </time>
                          {mine && receipt === "sending" && (
                            <span
                              className="mini-spinner"
                              aria-label="Sending"
                            />
                          )}
                          {mine && receipt === "failed" && (
                            <RotateCw
                              size={13}
                              className="tick is-failed"
                              aria-label="Not sent"
                            />
                          )}
                          {mine && receipt === "sent" && (
                            <Check
                              size={14}
                              className="tick"
                              aria-label="Sent"
                            />
                          )}
                          {mine && receipt === "delivered" && (
                            <CheckCheck
                              size={14}
                              className="tick"
                              aria-label="Delivered"
                            />
                          )}
                          {mine && receipt === "read" && (
                            <CheckCheck
                              size={14}
                              className="tick is-read"
                              aria-label="Read"
                            />
                          )}
                        </span>
                      </div>

                      {failed && (
                        <button
                          type="button"
                          className="retry-chip"
                          onClick={() => void deliver(message)}
                        >
                          <RotateCw size={12} /> Try again
                        </button>
                      )}

                      <div className="bubble-foot">
                        {chips.length > 0 && (
                          <div className="reaction-chips">
                            {chips.map((chip) => (
                              <button
                                key={chip.emoji}
                                type="button"
                                className={`reaction-chip ${
                                  chip.mine ? "is-mine" : ""
                                }`}
                                onClick={() =>
                                  void toggleReaction(message.id, chip.emoji)
                                }
                                aria-label={`${chip.emoji} ${chip.count}`}
                              >
                                {chip.emoji}
                                {chip.count > 1 && <b>{chip.count}</b>}
                              </button>
                            ))}
                          </div>
                        )}

                        {!deleted && !message.status && (
                          <button
                            type="button"
                            className="more-button"
                            aria-label="Message actions"
                            aria-expanded={actionsFor === message.id}
                            onClick={() =>
                              setActionsFor(
                                actionsFor === message.id ? null : message.id,
                              )
                            }
                          >
                            <MoreHorizontal size={16} />
                          </button>
                        )}

                        {actionsFor === message.id && (
                          <>
                            <button
                              type="button"
                              className="pop-backdrop"
                              aria-label="Close"
                              onClick={() => setActionsFor(null)}
                            />
                            <div
                              className={`action-pop ${
                                openBelow ? "open-below" : ""
                              }`}
                              role="menu"
                            >
                              <div className="reaction-row">
                                {REACTION_SET.map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() =>
                                      void toggleReaction(message.id, emoji)
                                    }
                                    aria-label={`React with ${emoji}`}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                              <div className="action-list">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActionsFor(null);
                                    setEditingId(null);
                                    setReplyingTo(message);
                                    composerRef.current?.focus();
                                  }}
                                >
                                  <Reply size={15} /> Reply
                                </button>
                                {mine && (
                                  <button
                                    type="button"
                                    onClick={() => startEditing(message)}
                                  >
                                    <Pencil size={15} /> Edit
                                  </button>
                                )}
                                {mine && (
                                  <button
                                    type="button"
                                    className="danger"
                                    onClick={() =>
                                      void deleteMessage(message.id)
                                    }
                                  >
                                    <Trash2 size={15} /> Delete
                                  </button>
                                )}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {notice && (
              <div className="notice" role="status">
                {notice}
                <button onClick={() => setNotice("")} aria-label="Dismiss">
                  ×
                </button>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {showScrollButton && (
          <button
            className="scroll-bottom"
            onClick={() => {
              stickToBottom.current = true;
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
            }}
            aria-label="Scroll to latest message"
          >
            <ArrowDown size={18} />
          </button>
        )}

        <footer className="composer-area">
          {(replyingTo || editingId) && (
            <div className="composer-banner">
              <div className="banner-icon" aria-hidden="true">
                {editingId ? <Pencil size={15} /> : <Reply size={15} />}
              </div>
              <div className="banner-copy">
                <strong>
                  {editingId
                    ? "Editing message"
                    : `Replying to ${
                        replyingTo && replyingTo.sender_id === user.id
                          ? "yourself"
                          : PEOPLE.them.name
                      }`}
                </strong>
                <span>
                  {editingId
                    ? (messages.find((m) => m.id === editingId)?.content ?? "")
                    : replyingTo?.deleted_at
                      ? "message deleted"
                      : (replyingTo?.content ?? "")}
                </span>
              </div>
              <button
                type="button"
                onClick={cancelComposerExtras}
                aria-label="Cancel"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {emojiOpen && (
            <div className="emoji-tray" role="group" aria-label="Quick emoji">
              {QUICK_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="emoji-btn"
                  onClick={() => addEmoji(emoji)}
                  onPointerDown={(e) => e.preventDefault()}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          <form className="composer" onSubmit={onComposerSubmit}>
            <button
              type="button"
              className={`emoji-toggle ${emojiOpen ? "is-open" : ""}`}
              onClick={() => setEmojiOpen((v) => !v)}
              onPointerDown={(e) => e.preventDefault()}
              aria-label="Add an emoji"
              aria-expanded={emojiOpen}
            >
              <Smile size={21} />
            </button>
            <textarea
              ref={composerRef}
              aria-label={editingId ? "Edit your message" : "Write a message"}
              rows={1}
              placeholder={
                editingId ? "Edit your message…" : "Say something… 💬"
              }
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onComposerKeyDown}
              maxLength={10000}
            />
            <button
              className="send-button"
              type="submit"
              disabled={!draft.trim()}
              aria-label={editingId ? "Save edit" : "Send message"}
              onPointerDown={(e) => e.preventDefault()}
            >
              {editingId ? <Check size={19} /> : <Send size={19} />}
            </button>
          </form>
          <div className="composer-hint">
            <span className="hint-keys">
              Enter to send · Shift + Enter for a new line
            </span>
          </div>
        </footer>
      </section>
    </main>
  );
}
