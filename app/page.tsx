"use client";

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDown, Check, Eye, EyeOff, LockKeyhole, Pencil, Reply, Send, Smile, X } from "lucide-react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import {
  HEARTBEAT_MS,
  MESSAGE_COLUMNS,
  PAGE_SIZE,
  PRESENCE_COLUMNS,
  PROFILE_COLUMNS,
  QUICK_EMOJI,
  STARTERS,
  UPGRADE_HINT,
  byOrder,
  dayLabel,
  defaultNameFromEmail,
  friendlyAuthError,
  latestUpdate,
  mergeMessages,
  ms,
  needsUpgrade,
  presenceLine,
  sameDay,
  toMessage,
  uuid,
  type ChatMessage,
  type Presence,
  type Profile,
  type Reaction,
  type Receipt,
  type ReceiptState,
} from "@/lib/chat";
import { Avatar } from "@/components/Avatar";
import { MessageRow, type Chip } from "@/components/MessageRow";
import { ProfileSheet } from "@/components/ProfileSheet";

/* ---------- the bits you'll probably want to tweak ---------- */

const APP = {
  name: "close",
  fallbackTitle: "hey babe 💕", // shown until the other person has set up their profile
  creator: "Shaddie",
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Home() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [access, setAccess] = useState<"checking" | "ok" | "denied">("checking");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState("");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [parentCache, setParentCache] = useState<Record<string, ChatMessage>>({});
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [presence, setPresence] = useState<Record<string, Presence>>({});
  const [clock, setClock] = useState(() => Date.now());

  const [loaded, setLoaded] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [connected, setConnected] = useState(false);

  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState("");

  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const firstScroll = useRef(true);
  const restoreScroll = useRef<{ height: number; top: number } | null>(null);
  const coarsePointer = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const freshBase = useRef<Set<string> | null>(null); // ids that were there when the chat opened (no pop-in)
  const loadingOlderRef = useRef(false);
  const receiptSent = useRef({ delivered: 0, read: 0 });
  const requestedParents = useRef(new Set<string>());
  const clockOffset = useRef(0); // server time minus this device's time
  const toastTimer = useRef<number>(undefined);
  const flashTimer = useRef<number>(undefined);
  const transmitRef = useRef<(m: ChatMessage) => void>(() => {});

  const userId = user?.id ?? null;
  const userEmail = user?.email ?? "";

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
          setAuthError(err instanceof Error ? err.message : "Could not start the app.");
          setBooting(false);
        });
      const { data: listener } = client.auth.onAuthStateChange((event, session) => {
        setUser(session?.user ?? null);
        setBooting(false);
        if (event === "SIGNED_IN") setAuthError("");
      });
      unsubscribe = () => listener.subscription.unsubscribe();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Could not start the app.");
      setBooting(false);
    }
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  /* ---------- loaders ---------- */
  const loadLatest = useCallback(async (client: SupabaseClient) => {
    setLoadingMessages(true);
    const { data, error } = await client
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE + 1);
    if (error) {
      setNotice(needsUpgrade(error) ? UPGRADE_HINT : `Couldn't load your messages 😕 ${error.message}`);
    } else {
      const rows = (data ?? []) as ChatMessage[];
      const page = rows.slice(0, PAGE_SIZE).reverse();
      setHasMore(rows.length > PAGE_SIZE);
      setMessages((prev) => mergeMessages(page, prev));
      freshBase.current ??= new Set(page.map((m) => m.id));
      setLoaded(true);
      setNotice("");
    }
    setLoadingMessages(false);
  }, []);

  const loadOlder = useCallback(async () => {
    if (!supabase || loadingOlderRef.current) return;
    const oldest = messagesRef.current.find((m) => !m.status);
    if (!oldest) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const el = listRef.current;
    const { data, error } = await supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .lt("created_at", oldest.created_at)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE + 1);
    if (error) {
      setNotice(`Couldn't load earlier messages 😕 ${error.message}`);
    } else {
      const rows = (data ?? []) as ChatMessage[];
      const page = rows.slice(0, PAGE_SIZE).reverse();
      page.forEach((m) => freshBase.current?.add(m.id));
      if (el) restoreScroll.current = { height: el.scrollHeight, top: el.scrollTop };
      stickToBottom.current = false;
      setHasMore(rows.length > PAGE_SIZE);
      setMessages((prev) => mergeMessages(page, prev));
    }
    loadingOlderRef.current = false;
    setLoadingOlder(false);
  }, [supabase]);

  /** Catch up on edits, deletes and new messages since we last heard (after a reconnect or a sleeping tab). */
  const syncChanges = useCallback(
    async (client: SupabaseClient) => {
      const base = messagesRef.current.filter((m) => !m.status);
      if (base.length === 0) return void (await loadLatest(client));
      const since = latestUpdate(base)!;
      const oldest = base[0].created_at;
      const known = new Set(base.map((m) => m.id));
      const fetched: ChatMessage[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client
          .from("messages")
          .select(MESSAGE_COLUMNS)
          .gte("updated_at", since)
          .order("updated_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + 999);
        if (error) return;
        const page = (data ?? []) as ChatMessage[];
        fetched.push(...page);
        if (page.length < 1000) break;
      }
      // ignore edits to messages older than what's on screen (they'd leave a gap in the list)
      const relevant = fetched.filter((m) => known.has(m.id) || ms(m.created_at) >= ms(oldest));
      if (relevant.length) setMessages((prev) => mergeMessages(prev, relevant));
    },
    [loadLatest],
  );

  const loadReactions = useCallback(async (client: SupabaseClient) => {
    const { data, error } = await client.from("message_reactions").select("message_id,user_id,emoji");
    if (!error && data) setReactions(data as Reaction[]);
  }, []);

  const loadReceipts = useCallback(async (client: SupabaseClient) => {
    const { data, error } = await client
      .from("message_reads")
      .select("user_id,last_read_at,last_delivered_at");
    if (!error && data) setReceipts(data as Receipt[]);
  }, []);

  const loadPresence = useCallback(async (client: SupabaseClient) => {
    const { data, error } = await client.from("member_presence").select(PRESENCE_COLUMNS);
    if (!error && data) {
      setPresence(Object.fromEntries((data as Presence[]).map((p) => [p.user_id, p])));
    }
  }, []);

  const loadProfiles = useCallback(
    async (client: SupabaseClient, uid: string, mail: string) => {
      const { data, error } = await client.from("profiles").select(PROFILE_COLUMNS);
      if (error) {
        if (needsUpgrade(error)) setNotice(UPGRADE_HINT);
        return;
      }
      const next = Object.fromEntries(((data ?? []) as Profile[]).map((p) => [p.user_id, p]));
      if (!next[uid]) {
        // first visit: create a starter profile (change it any time from your avatar)
        const fresh: Profile = {
          user_id: uid,
          display_name: defaultNameFromEmail(mail),
          avatar_emoji: "🌸",
          avatar_photo: null,
        };
        const { error: createError } = await client.from("profiles").upsert(fresh, { onConflict: "user_id" });
        if (!createError) next[uid] = fresh;
      }
      setProfiles((prev) => ({ ...prev, ...next }));
    },
    [],
  );

  /* ---------- membership + realtime ---------- */
  useEffect(() => {
    if (!supabase || !userId) {
      setMessages([]);
      setReactions([]);
      setReceipts([]);
      setPresence({});
      setConnected(false);
      setLoaded(false);
      setAccess("checking");
      return;
    }
    let alive = true;
    let channel: ReturnType<SupabaseClient["channel"]> | null = null;

    (async () => {
      const { data: rows, error } = await supabase.from("chat_members").select("user_id");
      if (!alive) return;
      const ids = ((rows ?? []) as { user_id: string }[]).map((r) => r.user_id);
      // only block when we're sure (a network blip shouldn't lock you out; the database rules protect the data anyway)
      if (!error && !ids.includes(userId)) {
        setAccess("denied");
        return;
      }
      setMemberIds(ids);
      setAccess("ok");

      void loadProfiles(supabase, userId, userEmail);
      void loadLatest(supabase);
      void loadReactions(supabase);
      void loadReceipts(supabase);
      void loadPresence(supabase);

      channel = supabase
        .channel("private-two-person-chat")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
          const row = payload.new as Partial<ChatMessage> & { id?: string };
          if (!row?.id || !alive) return;
          setMessages((prev) => mergeMessages(prev, [toMessage(row as Partial<ChatMessage> & { id: string })]));
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
          const row = payload.new as Partial<ChatMessage> & { id?: string };
          if (!row?.id || !alive) return;
          // partial merge: very long messages may arrive without their text if it didn't change
          setMessages((prev) =>
            prev.map((m) => (m.id === row.id ? { ...m, ...row, status: undefined } : m)),
          );
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, (payload) => {
          if (!alive) return;
          if (payload.eventType === "INSERT") {
            const r = payload.new as Reaction;
            if (!r?.message_id) return;
            setReactions((prev) =>
              prev.some((x) => x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji)
                ? prev
                : [...prev, r],
            );
          } else if (payload.eventType === "DELETE") {
            const r = payload.old as Partial<Reaction>;
            if (r?.message_id && r?.user_id && r?.emoji) {
              setReactions((prev) =>
                prev.filter((x) => !(x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji)),
              );
            } else {
              void loadReactions(supabase);
            }
          }
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "message_reads" }, () => {
          if (alive) void loadReceipts(supabase);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "member_presence" }, (payload) => {
          const row = payload.new as Presence;
          if (alive && row?.user_id) setPresence((prev) => ({ ...prev, [row.user_id]: row }));
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, (payload) => {
          const row = payload.new as Partial<Profile>;
          if (alive && row?.user_id) {
            setProfiles((prev) => ({ ...prev, [row.user_id!]: { ...prev[row.user_id!], ...row } as Profile }));
          }
        })
        .subscribe((status) => {
          if (!alive) return;
          setConnected(status === "SUBSCRIBED");
          if (status === "SUBSCRIBED") {
            // (re)connected: catch up, then re-send anything that failed while we were offline
            void syncChanges(supabase);
            void loadReactions(supabase);
            void loadReceipts(supabase);
            void loadPresence(supabase);
            messagesRef.current.filter((m) => m.status === "failed").forEach((m) => transmitRef.current(m));
          }
        });
    })();

    return () => {
      alive = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, userId, userEmail, loadLatest, loadReactions, loadReceipts, loadPresence, loadProfiles, syncChanges]);

  /* ---------- online now / last seen ---------- */
  useEffect(() => {
    if (!supabase || !userId || access !== "ok") return;
    let stopped = false;

    const beat = async (online: boolean) => {
      const t0 = Date.now();
      const { data, error } = await supabase
        .from("member_presence")
        .upsert({ user_id: userId, online }, { onConflict: "user_id" })
        .select("last_seen_at")
        .single();
      if (stopped || error || !data) return;
      // the database stamps last_seen_at; use it to learn how far this device's clock is off
      const midpoint = (t0 + Date.now()) / 2;
      clockOffset.current = ms((data as { last_seen_at: string }).last_seen_at) - midpoint;
    };

    const tick = () => {
      if (document.visibilityState === "visible") void beat(true);
    };
    const onVisibility = () => void beat(document.visibilityState === "visible");
    const onPageHide = () => void beat(false);

    tick();
    const heartbeat = window.setInterval(tick, HEARTBEAT_MS);
    const clockTick = window.setInterval(() => setClock(Date.now()), 15_000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      stopped = true;
      window.clearInterval(heartbeat);
      window.clearInterval(clockTick);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [supabase, userId, access]);

  /* ---------- receipts (stamped with message times, so no clock-skew) ---------- */
  const pingReceipt = useCallback(
    async (kind: "delivered" | "read") => {
      if (!supabase || !userId) return;
      let newest: ChatMessage | undefined;
      for (let i = messagesRef.current.length - 1; i >= 0; i--) {
        const m = messagesRef.current[i];
        if (m.sender_id !== userId && !m.status) {
          newest = m;
          break;
        }
      }
      if (!newest) return;
      const at = ms(newest.created_at);
      if (at <= receiptSent.current[kind]) return; // already told them about this one
      receiptSent.current[kind] = at;
      const stamp = newest.created_at;
      const patch: Record<string, string> =
        kind === "read"
          ? { user_id: userId, last_read_at: stamp, last_delivered_at: stamp }
          : { user_id: userId, last_delivered_at: stamp };
      const { error } = await supabase.from("message_reads").upsert(patch, { onConflict: "user_id" });
      if (error) receiptSent.current[kind] = 0; // try again next time
    },
    [supabase, userId],
  );

  useEffect(() => {
    if (!userId || access !== "ok" || messages.length === 0) return;
    void pingReceipt("delivered");
    if (stickToBottom.current && document.visibilityState === "visible") void pingReceipt("read");
  }, [messages, userId, access, pingReceipt]);

  /* ---------- coming back to the tab ---------- */
  useEffect(() => {
    if (!supabase || !userId || access !== "ok") return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void syncChanges(supabase);
      void loadReceipts(supabase);
      void loadPresence(supabase);
      void pingReceipt("delivered");
      if (stickToBottom.current) void pingReceipt("read");
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [supabase, userId, access, syncChanges, loadReceipts, loadPresence, pingReceipt]);

  /* ---------- quoted messages that are older than what's loaded ---------- */
  useEffect(() => {
    if (!supabase || access !== "ok") return;
    const have = new Set(messages.map((m) => m.id));
    const missing = [
      ...new Set(
        messages
          .map((m) => m.reply_to)
          .filter((id): id is string => !!id && !have.has(id) && !requestedParents.current.has(id)),
      ),
    ];
    if (!missing.length) return;
    missing.forEach((id) => requestedParents.current.add(id));
    supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .in("id", missing)
      .then(({ data }) => {
        if (data) {
          setParentCache((prev) => ({
            ...prev,
            ...Object.fromEntries((data as ChatMessage[]).map((m) => [m.id, m])),
          }));
        }
      });
  }, [messages, supabase, access]);

  /* ---------- scrolling & layout ---------- */
  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" });
  }, []);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (restoreScroll.current) {
      // older messages were added above: keep what you were reading exactly where it was
      el.scrollTop = el.scrollHeight - restoreScroll.current.height + restoreScroll.current.top;
      restoreScroll.current = null;
      return;
    }
    if (!stickToBottom.current) return;
    scrollToBottom(!firstScroll.current);
    if (messages.length) firstScroll.current = false;
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight;
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

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || profileOpen) return;
      if (actionsFor) setActionsFor(null);
      else if (editingId || replyingTo) cancelComposerExtras();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  /* ---------- derived ---------- */
  const partnerId = memberIds.find((id) => id !== userId) ?? null;
  const me = userId ? profiles[userId] : undefined;
  const partner = partnerId ? profiles[partnerId] : undefined;
  const partnerName = partner?.display_name ?? "Them";
  const myProfile: Profile | null = userId
    ? (me ?? { user_id: userId, display_name: defaultNameFromEmail(userEmail), avatar_emoji: "🌸", avatar_photo: null })
    : null;

  const byId = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  const chipsByMessage = useMemo(() => {
    const grouped = new Map<string, Map<string, Chip>>();
    for (const r of reactions) {
      const perEmoji = grouped.get(r.message_id) ?? new Map<string, Chip>();
      const chip = perEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
      chip.count += 1;
      if (r.user_id === userId) chip.mine = true;
      perEmoji.set(r.emoji, chip);
      grouped.set(r.message_id, perEmoji);
    }
    return new Map([...grouped].map(([id, per]) => [id, [...per.values()]]));
  }, [reactions, userId]);

  const otherReceipt = useMemo(() => receipts.find((r) => r.user_id !== userId) ?? null, [receipts, userId]);

  function receiptFor(m: ChatMessage): ReceiptState | null {
    if (m.sender_id !== userId) return null;
    if (m.status) return m.status;
    const at = ms(m.created_at);
    if (otherReceipt && ms(otherReceipt.last_read_at) >= at) return "read";
    if (otherReceipt && ms(otherReceipt.last_delivered_at) >= at) return "delivered";
    return "sent";
  }

  const nowServer = clock + clockOffset.current;
  const partnerPresence = partnerId ? presence[partnerId] : undefined;
  const presenceText = !partnerId
    ? "waiting for your person to join 💌"
    : partnerPresence
      ? presenceLine(partnerPresence, nowServer)
      : "hasn't visited yet";
  const partnerOnline = presenceText === "online";
  const statusText = connected ? presenceText : "connecting…";

  /* ---------- actions ---------- */
  function showToast(text: string) {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 1800);
  }

  function cancelComposerExtras() {
    setReplyingTo(null);
    setEditingId(null);
    setDraft("");
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!supabase || signingIn) return;
    setAuthError("");
    setSigningIn(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
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
    if (supabase && userId) {
      // let them see "last seen" right away instead of waiting for the heartbeat to time out
      await supabase.from("member_presence").upsert({ user_id: userId, online: false }, { onConflict: "user_id" });
      await supabase.auth.signOut();
    }
    setProfileOpen(false);
    setMessages([]);
    setReactions([]);
    setReceipts([]);
    setProfiles({});
    setMemberIds([]);
    setParentCache({});
    setEmojiOpen(false);
    setReplyingTo(null);
    setEditingId(null);
    setActionsFor(null);
    setDraft("");
    freshBase.current = null;
    firstScroll.current = true;
    stickToBottom.current = true;
    receiptSent.current = { delivered: 0, read: 0 };
    requestedParents.current = new Set();
  }

  async function saveProfile(next: Pick<Profile, "display_name" | "avatar_emoji" | "avatar_photo">) {
    if (!supabase || !userId) return "You're signed out.";
    const { data, error } = await supabase
      .from("profiles")
      .upsert({ user_id: userId, ...next }, { onConflict: "user_id" })
      .select(PROFILE_COLUMNS)
      .single();
    if (error) return needsUpgrade(error) ? UPGRADE_HINT : error.message;
    setProfiles((prev) => ({ ...prev, [userId]: data as Profile }));
    return null;
  }

  /** Send (or re-send) a message. It carries its own id, so a retry can never create a duplicate. */
  async function transmit(m: ChatMessage) {
    if (!supabase) return;
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: "sending" } : x)));
    const { data, error } = await supabase
      .from("messages")
      .insert({ id: m.id, sender_id: m.sender_id, content: m.content, reply_to: m.reply_to })
      .select(MESSAGE_COLUMNS)
      .single();

    if (error?.code === "23505") {
      // an earlier attempt actually went through (we just never heard back): fetch it instead
      const { data: existing } = await supabase.from("messages").select(MESSAGE_COLUMNS).eq("id", m.id).single();
      if (existing) {
        setMessages((prev) => mergeMessages(prev, [existing as ChatMessage]));
        return;
      }
    }
    if (error || !data) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: "failed" } : x)));
      return;
    }
    setMessages((prev) => mergeMessages(prev, [data as ChatMessage]));
    setNotice("");
  }
  transmitRef.current = (m) => void transmit(m);

  async function sendMessage() {
    const content = draft.trim();
    if (!supabase || !userId || !content) return;
    const now = new Date().toISOString();
    const pending: ChatMessage = {
      id: uuid(),
      sender_id: userId,
      content,
      created_at: now,
      updated_at: now,
      edited_at: null,
      deleted_at: null,
      reply_to: replyingTo?.id ?? null,
      status: "sending",
    };
    setMessages((prev) => [...prev, pending].sort(byOrder));
    setDraft("");
    setReplyingTo(null);
    setEmojiOpen(false);
    stickToBottom.current = true;
    void transmit(pending);
    composerRef.current?.focus();
  }

  async function saveEdit() {
    const content = draft.trim();
    if (!supabase || !editingId || !content) return;
    const id = editingId;
    const original = byId.get(id);
    setEditingId(null);
    setDraft("");
    if (!original || original.content === content) return;

    const editedAt = new Date().toISOString();
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content, edited_at: editedAt } : m)));
    const { error } = await supabase.from("messages").update({ content, edited_at: editedAt }).eq("id", id);
    if (error) {
      setMessages((prev) => prev.map((m) => (m.id === id ? original : m)));
      setNotice(`Couldn't save that edit 😕 ${error.message}`);
    }
    composerRef.current?.focus();
  }

  async function deleteMessage(id: string) {
    if (!supabase) return;
    setActionsFor(null);
    const original = byId.get(id);
    if (!original || original.deleted_at) return;
    const deletedAt = new Date().toISOString();
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: "", deleted_at: deletedAt } : m)));
    // the text is wiped from the database too, not just hidden
    const { error } = await supabase.from("messages").update({ content: "", deleted_at: deletedAt }).eq("id", id);
    if (error) {
      setMessages((prev) => prev.map((m) => (m.id === id ? original : m)));
      setNotice(needsUpgrade(error) ? UPGRADE_HINT : `Couldn't delete that 😕 ${error.message}`);
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!supabase || !userId) return;
    setActionsFor(null);
    const mine = reactions.find((r) => r.message_id === messageId && r.user_id === userId && r.emoji === emoji);
    const same = (r: Reaction) => r.message_id === messageId && r.user_id === userId && r.emoji === emoji;
    if (mine) {
      setReactions((prev) => prev.filter((r) => !same(r)));
      const { error } = await supabase.from("message_reactions").delete().match({ message_id: messageId, user_id: userId, emoji });
      if (error) {
        setReactions((prev) => [...prev, mine]);
        setNotice(`Couldn't remove that reaction 😕 ${error.message}`);
      }
    } else {
      const next: Reaction = { message_id: messageId, user_id: userId, emoji };
      setReactions((prev) => [...prev, next]);
      const { error } = await supabase.from("message_reactions").insert(next);
      if (error) {
        setReactions((prev) => prev.filter((r) => !same(r)));
        setNotice(`Couldn't add that reaction 😕 ${error.message}`);
      }
    }
  }

  function startReply(m: ChatMessage) {
    setActionsFor(null);
    setEditingId(null);
    setReplyingTo(m);
    composerRef.current?.focus();
  }

  function startEdit(m: ChatMessage) {
    setActionsFor(null);
    setReplyingTo(null);
    setEditingId(m.id);
    setDraft(m.content);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(m.content.length, m.content.length);
    });
  }

  async function copyMessage(m: ChatMessage) {
    setActionsFor(null);
    try {
      await navigator.clipboard.writeText(m.content);
      showToast("Copied 📋");
    } catch {
      showToast("Couldn't copy that 😕");
    }
  }

  function jumpTo(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return showToast("That one is further back ⬆️ Load earlier messages first");
    stickToBottom.current = false;
    el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    setFlashId(id);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashId(null), 1500);
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
    if (atBottom && document.visibilityState === "visible") void pingReceipt("read");
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !coarsePointer.current) {
      event.preventDefault();
      if (editingId) void saveEdit();
      else void sendMessage();
    }
  }

  /* stable handlers for the memoised message rows */
  const actions = useRef({
    react: toggleReaction,
    reply: startReply,
    edit: startEdit,
    del: deleteMessage,
    copy: copyMessage,
    retry: (m: ChatMessage) => void transmit(m),
    discard: (id: string) => setMessages((prev) => prev.filter((m) => m.id !== id)),
    jump: jumpTo,
  });
  actions.current = {
    react: toggleReaction,
    reply: startReply,
    edit: startEdit,
    del: deleteMessage,
    copy: copyMessage,
    retry: (m: ChatMessage) => void transmit(m),
    discard: (id: string) => setMessages((prev) => prev.filter((m) => m.id !== id)),
    jump: jumpTo,
  };
  const handlers = useMemo(
    () => ({
      onToggleMenu: (id: string | null) => setActionsFor(id),
      onReact: (id: string, e: string) => void actions.current.react(id, e),
      onReply: (m: ChatMessage) => actions.current.reply(m),
      onEdit: (m: ChatMessage) => actions.current.edit(m),
      onDelete: (id: string) => void actions.current.del(id),
      onCopy: (m: ChatMessage) => void actions.current.copy(m),
      onRetry: (m: ChatMessage) => actions.current.retry(m),
      onDiscard: (id: string) => actions.current.discard(id),
      onJump: (id: string) => actions.current.jump(id),
    }),
    [],
  );

  /* ---------- screens ---------- */
  if (booting || (user && access === "checking"))
    return (
      <main className="splash">
        <div className="brand-mark" aria-hidden="true">💌</div>
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
            <span className="brand-mark" aria-hidden="true">💌</span>
            <span className="brand-word">
              {APP.name}
              <span className="brand-period">.</span>
            </span>
          </div>
          <div className="auth-copy">
            <h1>
              Hey you <span className="wave" aria-hidden="true">👋</span>
            </h1>
            <p>Our little corner of the internet. Sign in and pick up right where we left off.</p>
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
            <button className="primary-button" type="submit" disabled={signingIn}>
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
              {APP.name} is just for two people, and <strong>{user.email ?? "this account"}</strong>{" "}
              isn&apos;t one of them yet. Wrong account? Sign out and try the other one.
            </p>
          </div>
          <button className="primary-button" type="button" onClick={signOut}>
            Sign out 👋
          </button>
        </section>
      </main>
    );

  const editingMessage = editingId ? byId.get(editingId) : undefined;

  return (
    <main className="chat-shell">
      <aside className="side-rail">
        <div className="rail-logo" aria-hidden="true">💌</div>
        <button className="rail-me" onClick={() => setProfileOpen(true)} aria-label="Your profile" title="Your profile">
          <Avatar profile={myProfile} size={44} />
        </button>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          <div className="chat-person">
            <Avatar profile={partner} size={46} ring fallback="💕" />
            <div className="person-copy">
              <h1>{partner?.display_name ?? APP.fallbackTitle}</h1>
              <div className="presence" role="status">
                <span className={`presence-dot${connected && partnerOnline ? " is-online" : ""}${connected ? "" : " is-connecting"}`} />
                {statusText}
              </div>
            </div>
          </div>
          <div className="header-actions">
            <div className="secure-label">
              <LockKeyhole size={14} />
              <span>just us</span>
            </div>
            <button
              className="header-me"
              onClick={() => setProfileOpen(true)}
              aria-label="Your profile"
              title="Your profile"
            >
              <Avatar profile={myProfile} size={38} />
            </button>
          </div>
        </header>

        <div className="conversation" ref={listRef} onScroll={onScroll} onClick={() => actionsFor && setActionsFor(null)}>
          <div className="conversation-inner">
            <div className="privacy-note">
              <div className="privacy-icon" aria-hidden="true">🔒</div>
              <p>
                <strong>hey babie!! 💕</strong>
                <br />
                Only the two of us can read or send messages in here.
              </p>
            </div>

            {hasMore && (
              <button type="button" className="load-earlier" onClick={() => void loadOlder()} disabled={loadingOlder}>
                {loadingOlder ? <span className="mini-spinner" /> : <ArrowDown size={14} style={{ transform: "rotate(180deg)" }} />}
                {loadingOlder ? "Loading…" : "Load earlier messages"}
              </button>
            )}

            {loadingMessages && messages.length === 0 && (
              <div className="loading-line">
                <span className="mini-spinner" /> Fetching your messages… 💭
              </div>
            )}

            {loaded && messages.length === 0 && (
              <div className="empty-state">
                <div className="empty-avatars">
                  <Avatar profile={partner} size={64} fallback="💕" />
                  <Avatar profile={myProfile} size={64} />
                </div>
                <h2>It&apos;s just the two of you in here</h2>
                <p>Say hi first. Whatever you send will be waiting right here next time.</p>
                <div className="starters">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setDraft(s);
                        composerRef.current?.focus();
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const close = (a: ChatMessage, b: ChatMessage) =>
                a.sender_id === b.sender_id && sameDay(a.created_at, b.created_at) && ms(b.created_at) - ms(a.created_at) < 5 * 60_000;
              const mine = m.sender_id === userId;
              const parent = m.reply_to ? (byId.get(m.reply_to) ?? parentCache[m.reply_to]) : undefined;
              const joinedPrev = !!prev && close(prev, m);
              return (
                <MessageRow
                  key={m.id}
                  message={m}
                  mine={mine}
                  parent={parent}
                  parentAuthor={parent?.sender_id === userId ? "You" : partnerName}
                  joinedPrev={joinedPrev}
                  endsGroup={!next || !close(m, next)}
                  dayText={!prev || !sameDay(prev.created_at, m.created_at) ? dayLabel(m.created_at) : null}
                  partner={partner}
                  showAvatar={!mine && (!next || !close(m, next))}
                  chips={chipsByMessage.get(m.id) ?? NO_CHIPS}
                  receipt={receiptFor(m)}
                  menuOpen={actionsFor === m.id}
                  fresh={freshBase.current !== null && !freshBase.current.has(m.id)}
                  flash={flashId === m.id}
                  {...handlers}
                />
              );
            })}

            {notice && (
              <div className="notice" role="status">
                {notice}
                <button onClick={() => setNotice("")} aria-label="Dismiss">×</button>
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
              scrollToBottom(true);
            }}
            aria-label="Scroll to latest message"
          >
            <ArrowDown size={18} />
          </button>
        )}

        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}

        <footer className="composer-area">
          {(replyingTo || editingId) && (
            <div className="composer-banner">
              <div className="banner-icon" aria-hidden="true">
                {editingId ? <Pencil size={15} /> : <Reply size={15} />}
              </div>
              <div className="banner-copy">
                <strong>
                  {editingId ? "Editing message" : `Replying to ${replyingTo?.sender_id === userId ? "yourself" : partnerName}`}
                </strong>
                <span>{editingId ? (editingMessage?.content ?? "") : replyingTo?.deleted_at ? "message deleted" : (replyingTo?.content ?? "")}</span>
              </div>
              <button type="button" onClick={cancelComposerExtras} aria-label="Cancel">
                <X size={16} />
              </button>
            </div>
          )}

          {emojiOpen && (
            <div className="emoji-tray" role="group" aria-label="Quick emoji">
              {QUICK_EMOJI.map((emoji) => (
                <button key={emoji} type="button" className="emoji-btn" onClick={() => addEmoji(emoji)} onPointerDown={(e) => e.preventDefault()}>
                  {emoji}
                </button>
              ))}
            </div>
          )}

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (editingId) void saveEdit();
              else void sendMessage();
            }}
          >
            <button
              type="button"
              className={`emoji-toggle${emojiOpen ? " is-open" : ""}`}
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
              placeholder={editingId ? "Edit your message…" : "Say something… 💬"}
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
            <span className="hint-keys">Enter to send · Shift + Enter for a new line · Esc to cancel</span>
          </div>
        </footer>
      </section>

      {profileOpen && myProfile && (
        <ProfileSheet profile={myProfile} onSave={saveProfile} onClose={() => setProfileOpen(false)} onSignOut={signOut} />
      )}
    </main>
  );
}

const NO_CHIPS: Chip[] = [];
