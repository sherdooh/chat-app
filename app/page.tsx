"use client";

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  Check,
  CheckCheck,
  LockKeyhole,
  LogOut,
  MessageCircle,
  MoreVertical,
  Send,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import type { SupabaseClient, User } from "@supabase/supabase-js";

type ChatMessage = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

function timeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
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

export default function Home() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [online, setOnline] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [notice, setNotice] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    try {
      const client = getSupabase();
      setSupabase(client);
      client.auth.getSession().then(({ data, error }) => {
        if (error) setAuthError(error.message);
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

  const loadMessages = useCallback(
    async (client: SupabaseClient, currentUser: User) => {
      setLoadingMessages(true);
      const pageSize = 1000;
      const allMessages: ChatMessage[] = [];
      let offset = 0;
      let loadError: { message: string } | null = null;
      // Fetch in pages so a long-running conversation is not truncated by the API row limit.
      while (true) {
        const { data, error } = await client
          .from("messages")
          .select("id,sender_id,content,created_at")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) {
          loadError = error;
          break;
        }
        const page = (data ?? []) as ChatMessage[];
        allMessages.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
      }
      if (loadError) {
        setNotice(
          loadError.message.includes("row-level security")
            ? "This account is not one of the two authorized chat members."
            : `Could not load messages: ${loadError.message}`,
        );
        setMessages([]);
      } else {
        // Merge rather than replace, so a realtime message arriving during the history fetch isn't lost.
        setMessages((previous) => {
          const merged = new Map<string, ChatMessage>();
          for (const item of allMessages) merged.set(item.id, item);
          for (const item of previous) merged.set(item.id, item);
          return [...merged.values()].sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
                new Date(b.created_at).getTime() || a.id.localeCompare(b.id),
          );
        });
        setNotice("");
        setUser(currentUser);
      }
      setLoadingMessages(false);
    },
    [],
  );

  useEffect(() => {
    if (!supabase || !user) {
      setMessages([]);
      setOnline(false);
      return;
    }
    let alive = true;
    void loadMessages(supabase, user);
    const channel = supabase
      .channel("private-two-person-chat")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const incoming = payload.new as ChatMessage;
          if (!incoming?.id || !alive) return;
          setMessages((previous) =>
            previous.some((item) => item.id === incoming.id)
              ? previous
              : [...previous, incoming].sort(
                  (a, b) =>
                    new Date(a.created_at).getTime() -
                      new Date(b.created_at).getTime() ||
                    a.id.localeCompare(b.id),
                ),
          );
        },
      )
      .subscribe((status) => setOnline(status === "SUBSCRIBED"));
    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [supabase, user?.id, loadMessages]);

  useEffect(() => {
    if (stickToBottom.current)
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error)
      setAuthError(
        error.message === "Invalid login credentials"
          ? "Email or password is incorrect."
          : error.message,
      );
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!supabase || !user || !content || sending) return;
    setSending(true);
    setDraft("");
    const { data, error } = await supabase
      .from("messages")
      .insert({ sender_id: user.id, content })
      .select("id,sender_id,content,created_at")
      .single();
    if (error) {
      setDraft(content);
      setNotice(`Message wasn't sent: ${error.message}`);
    } else if (data) {
      setMessages((previous) =>
        previous.some((item) => item.id === data.id)
          ? previous
          : [...previous, data as ChatMessage].sort(
              (a, b) =>
                new Date(a.created_at).getTime() -
                new Date(b.created_at).getTime(),
            ),
      );
      setNotice("");
    }
    setSending(false);
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setMessages([]);
  }

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    stickToBottom.current = atBottom;
    setShowScrollButton(!atBottom && messages.length > 0);
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(event);
    }
  }

  if (booting)
    return (
      <main className="splash">
        <div className="brand-mark">
          <MessageCircle size={24} />
        </div>
        <p>Opening your private space…</p>
      </main>
    );

  if (!user)
    return (
      <main className="auth-screen">
        <div className="auth-decoration decor-one" />
        <div className="auth-decoration decor-two" />
        <section className="auth-card">
          <div className="brand-lockup">
            <div className="brand-mark">
              <MessageCircle size={23} strokeWidth={2.3} />
            </div>
            <span>
              close<span className="brand-period">.</span>
            </span>
          </div>
          <div className="auth-copy">
            <div className="eyebrow">
              <LockKeyhole size={13} /> JUST THE TWO OF YOU
            </div>
            <h1>
              A little space
              <br />
              for your conversations.
            </h1>
            <p>Your messages stay here, ready whenever you come back.</p>
          </div>
          <form className="auth-form" onSubmit={signIn}>
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {authError && (
              <p className="form-error" role="alert">
                {authError}
              </p>
            )}
            <button className="primary-button auth-submit" type="submit">
              <span>Enter your chat</span>
              <span aria-hidden="true">↗</span>
            </button>
          </form>
          <div className="auth-foot">
            <ShieldCheck size={16} />
            <span>Private access for you and me only.</span>
          </div>
        </section>
        <p className="auth-caption">A quieter corner of the internet.</p>
      </main>
    );

  const displayName =
    user.user_metadata?.full_name || user.email?.split("@")[0] || "You";
  return (
    <main className="chat-shell">
      <aside className="side-rail">
        <div className="rail-logo">
          <MessageCircle size={22} />
        </div>
        <div className="rail-bottom">
          <button
            className="icon-button rail-account"
            title="Sign out"
            onClick={signOut}
          >
            <LogOut size={19} />
          </button>
        </div>
      </aside>
      <section className="chat-panel">
        <header className="chat-header">
          <div className="chat-person">
            <div className="avatar avatar-pair">
              <span>2</span>
            </div>
            <div className="person-copy">
              <h1>HEY BABE</h1>
              <div className="presence">
                <span className={`presence-dot ${online ? "is-online" : ""}`} />
                {online ? "Connected securely" : "Connecting…"}
              </div>
            </div>
          </div>
          <div className="header-actions">
            <div className="secure-label">
              <LockKeyhole size={13} />
              <span>This is private</span>
            </div>
            <button className="icon-button" title="Sign out" onClick={signOut}>
              <MoreVertical size={20} />
            </button>
          </div>
        </header>
        <div className="conversation" ref={listRef} onScroll={onScroll}>
          <div className="conversation-inner">
            <div className="privacy-note">
              <div className="privacy-icon">
                <ShieldCheck size={17} />
              </div>
              <p>
                <strong>HEY BABIE!!</strong>
                <br />
                Only the You and I can read or send messages here.
              </p>
            </div>
            {loadingMessages && messages.length === 0 && (
              <div className="loading-line">
                <span className="mini-spinner" /> Loading your conversation…
              </div>
            )}
            {!loadingMessages && messages.length === 0 && (
              <div className="empty-state">
                <div className="empty-art">
                  <MessageCircle size={30} strokeWidth={1.4} />
                  <span>✦</span>
                </div>
                <h2>Your story starts here.</h2>
                <p>
                  Send the first message. It’ll be waiting here next time you
                  return.
                </p>
              </div>
            )}
            {messages.map((message, index) => {
              const mine = message.sender_id === user.id;
              const previous = messages[index - 1];
              const showDate =
                !previous ||
                new Date(previous.created_at).toDateString() !==
                  new Date(message.created_at).toDateString();
              const next = messages[index + 1];
              const grouped =
                !!next &&
                next.sender_id === message.sender_id &&
                new Date(next.created_at).getTime() -
                  new Date(message.created_at).getTime() <
                  5 * 60 * 1000 &&
                new Date(next.created_at).toDateString() ===
                  new Date(message.created_at).toDateString();
              return (
                <div key={message.id}>
                  {showDate && (
                    <div className="date-divider">
                      <span>{dayLabel(message.created_at)}</span>
                    </div>
                  )}
                  <div
                    className={`message-row ${mine ? "mine" : "theirs"} ${grouped ? "grouped" : ""}`}
                  >
                    {!mine && !grouped && (
                      <div className="tiny-avatar">
                        {(message.sender_id === user.id ? displayName : "T")
                          .slice(0, 1)
                          .toUpperCase()}
                      </div>
                    )}
                    {!mine && grouped && <div className="avatar-spacer" />}
                    <div className="message-content">
                      <div
                        className={`bubble ${mine ? "bubble-mine" : "bubble-theirs"}`}
                      >
                        <p>{message.content}</p>
                      </div>
                      <div className="message-meta">
                        <time dateTime={message.created_at}>
                          {timeLabel(message.created_at)}
                        </time>
                        {mine && (
                          <CheckCheck
                            size={14}
                            className="read-check"
                            aria-label="Sent"
                          />
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
            <ArrowDown size={17} />
          </button>
        )}
        <footer className="composer-area">
          <form className="composer" onSubmit={sendMessage}>
            <textarea
              aria-label="Write a message"
              rows={1}
              placeholder="Write something…"
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
            >
              {sending ? (
                <span className="mini-spinner light" />
              ) : (
                <Send size={18} />
              )}
            </button>
          </form>
          <div className="composer-hint">
            <span>
              <span className="hint-dot" /> Your conversation is saved
              automatically
            </span>
            <span>Enter to send · Shift + Enter for a new line</span>
          </div>
        </footer>
      </section>
    </main>
  );
}
