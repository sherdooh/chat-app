"use client";

import {
  FormEvent,
  KeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  LogOut,
  Send,
  Smile,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/* ---------- the bits you'll probably want to tweak ---------- */

const APP = {
  name: "close",
  chatTitle: "hey babe 💕",
  creator: "Shaddie",
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

/* ---------- types & helpers ---------- */

type ChatMessage = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const timeLabel = (value: string) => timeFmt.format(new Date(value));

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
  new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
  a.id.localeCompare(b.id);

/** Merge lists by id (later lists win), oldest first. Never loses a message, never duplicates one. */
function mergeMessages(...lists: ChatMessage[][]) {
  const map = new Map<string, ChatMessage>();
  for (const list of lists) for (const m of list) map.set(m.id, m);
  return [...map.values()].sort(byTime);
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

/* ---------- the app ---------- */

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [online, setOnline] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [notice, setNotice] = useState("");

  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const firstScroll = useRef(true);
  const coarsePointer = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  const userId = user?.id ?? null;

  /* sign-in session */
  useEffect(() => {
    coarsePointer.current = window.matchMedia("(pointer: coarse)").matches;
    try {
      const saved = localStorage.getItem("close:email");
      if (saved) setEmail(saved);
    } catch {}
    try {
      const client = getSupabase();
      setSupabase(client);
      client.auth.getSession().then(({ data, error }) => {
        if (error) setAuthError(friendlyAuthError(error.message));
        setUser(data.session?.user ?? null);
        setBooting(false);
      });
      const { data: listener } = client.auth.onAuthStateChange(
        (_event, session) => {
          setUser(session?.user ?? null);
          setBooting(false);
        },
      );
      return () => listener.subscription.unsubscribe();
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Could not start the app.",
      );
      setBooting(false);
    }
  }, []);

  /* load history. With `since`, only fetches what's new (used after reconnecting) */
  const loadMessages = useCallback(
    async (client: SupabaseClient, since?: string) => {
      if (!since && messagesRef.current.length === 0) setLoadingMessages(true);
      const pageSize = 1000;
      const fetched: ChatMessage[] = [];
      let offset = 0;
      let loadError: { message: string } | null = null;
      // Fetch in pages so a long conversation is never cut off by the API row limit.
      for (;;) {
        let query = client
          .from("messages")
          .select("id,sender_id,content,created_at");
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
        // Merge instead of replace, so a live message that arrives mid-fetch isn't lost.
        setMessages((previous) => mergeMessages(fetched, previous));
        setNotice("");
      }
      setLoadingMessages(false);
    },
    [],
  );

  /* membership check, history, live updates */
  useEffect(() => {
    if (!supabase || !userId) {
      setMessages([]);
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
      // Only block when we're sure. A network hiccup shouldn't lock you out (the database
      // rules still protect the messages either way).
      if (!error && !member) {
        setAccess("denied");
        return;
      }
      setAccess("ok");
      void loadMessages(supabase);

      channel = supabase
        .channel("private-two-person-chat")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload) => {
            const incoming = payload.new as ChatMessage;
            if (!incoming?.id || !alive) return;
            setMessages((previous) => mergeMessages(previous, [incoming]));
          },
        )
        .subscribe((status) => {
          if (!alive) return;
          setOnline(status === "SUBSCRIBED");
          // (Re)connected: grab anything that arrived while we were away.
          if (status === "SUBSCRIBED") {
            void loadMessages(supabase, messagesRef.current.at(-1)?.created_at);
          }
        });
    })();

    return () => {
      alive = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, userId, loadMessages]);

  /* coming back to the tab (phones drop connections in the background) */
  useEffect(() => {
    if (!supabase || !userId) return;
    const onVisible = () => {
      const last = messagesRef.current.at(-1)?.created_at;
      if (document.visibilityState === "visible" && last)
        void loadMessages(supabase, last);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [supabase, userId, loadMessages]);

  /* scrolling */
  useEffect(() => {
    if (!stickToBottom.current) return;
    bottomRef.current?.scrollIntoView({
      behavior: firstScroll.current ? "auto" : "smooth",
      block: "end",
    });
    if (messages.length) firstScroll.current = false;
  }, [messages]);

  // keep the latest message in view when the box grows, the emoji tray opens, or the keyboard shows
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

  // message box grows with what you type
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft, access]);

  /* actions */
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
    setEmojiOpen(false);
    firstScroll.current = true;
    stickToBottom.current = true;
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!supabase || !user || !content || sending) return;
    setSending(true);
    setDraft("");
    setEmojiOpen(false);
    stickToBottom.current = true;
    const { data, error } = await supabase
      .from("messages")
      .insert({ sender_id: user.id, content })
      .select("id,sender_id,content,created_at")
      .single();
    if (error) {
      setDraft(content);
      setNotice(
        `That didn't send 😕 It's back in the box, try again. (${error.message})`,
      );
    } else if (data) {
      setMessages((previous) => mergeMessages(previous, [data as ChatMessage]));
      setNotice("");
    }
    setSending(false);
    composerRef.current?.focus();
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
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // On phones Enter adds a new line (the send button sends); on desktop Enter sends.
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      !coarsePointer.current
    ) {
      event.preventDefault();
      void sendMessage();
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
              <strong>{user.email}</strong> isn&apos;t one of them yet. Wrong
              account? Sign out and try the other one.
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
            <div className="avatar" aria-hidden="true">
              🥰
            </div>
            <div className="person-copy">
              <h1>{APP.chatTitle}</h1>
              <div className="presence" role="status">
                <span className={`presence-dot ${online ? "is-online" : ""}`} />
                {online ? "connected ✨" : "reconnecting…"}
              </div>
            </div>
          </div>
          <div className="header-actions">
            <div className="secure-label">
              <LockKeyhole size={14} />
              <span>just us</span>
            </div>
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
                <div className="empty-art" aria-hidden="true">
                  💬
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
                new Date(b.created_at).getTime() -
                  new Date(a.created_at).getTime() <
                  5 * 60 * 1000;
              const showDate = !previous || !sameDay(previous, message);
              const joinedPrev = !!previous && closeTogether(previous, message);
              const endsGroup = !next || !closeTogether(message, next);

              return (
                <div key={message.id}>
                  {showDate && (
                    <div className="date-divider">
                      <span>{dayLabel(message.created_at)}</span>
                    </div>
                  )}
                  <div
                    className={`message-row ${mine ? "mine" : "theirs"} ${joinedPrev ? "joined" : ""}`}
                  >
                    {!mine &&
                      (endsGroup ? (
                        <div className="tiny-avatar" aria-hidden="true">
                          💚
                        </div>
                      ) : (
                        <div className="avatar-spacer" />
                      ))}
                    <div
                      className={`bubble ${mine ? "bubble-mine" : "bubble-theirs"} ${endsGroup ? "ends-group" : ""}`}
                    >
                      <span className="text">{linkify(message.content)}</span>
                      <span className="meta">
                        <time dateTime={message.created_at}>
                          {timeLabel(message.created_at)}
                        </time>
                        {mine && (
                          <Check size={14} className="tick" aria-label="Sent" />
                        )}
                      </span>
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
          <form className="composer" onSubmit={sendMessage}>
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
              aria-label="Write a message"
              rows={1}
              placeholder="Say something… 💬"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onComposerKeyDown}
              maxLength={10000}
            />
            <button
              className="send-button"
              type="submit"
              disabled={!draft.trim() || sending}
              aria-label="Send message"
              onPointerDown={(e) => e.preventDefault()}
            >
              {sending ? (
                <span className="mini-spinner light" />
              ) : (
                <Send size={19} />
              )}
            </button>
          </form>
          <div className="composer-hint">
            <span>
              <span className="hint-dot" /> Saved automatically 💾
            </span>
            <span className="hint-keys">
              Enter to send · Shift + Enter for a new line
            </span>
          </div>
        </footer>
      </section>
    </main>
  );
}
