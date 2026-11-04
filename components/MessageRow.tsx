"use client";

import { memo, useEffect, useState } from "react";
import {
  Check,
  CheckCheck,
  MoreHorizontal,
  Pencil,
  Reply,
  RotateCw,
  Trash2,
} from "lucide-react";
import { Avatar } from "./Avatar";
import type { ChatMessage, Profile, ReceiptState } from "@/lib/chat";

export type Chip = { emoji: string; count: number; mine: boolean };

const REACTION_SET = ["❤️", "😂", "🥺", "🔥", "👍", "😮"];

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\u200D|\uFE0F|\s)+$/u;

function isEmojiOnly(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 20) return false;
  const hits = t.match(/\p{Extended_Pictographic}/gu);
  if (!hits || hits.length === 0 || hits.length > 3) return false;
  return EMOJI_ONLY.test(t);
}

type Handlers = {
  onToggleMenu: (id: string | null) => void;
  onReact: (id: string, emoji: string) => void;
  onReply: (m: ChatMessage) => void;
  onEdit: (m: ChatMessage) => void;
  onDelete: (id: string) => void;
  onCopy: (m: ChatMessage) => void;
  onRetry: (m: ChatMessage) => void;
  onDiscard: (id: string) => void;
  onJump: (id: string) => void;
};

export type MessageRowProps = {
  message: ChatMessage;
  mine: boolean;
  parent?: ChatMessage;
  parentAuthor: string;
  joinedPrev: boolean;
  endsGroup: boolean;
  dayText: string | null;
  partner: Profile | undefined;
  showAvatar: boolean;
  chips: Chip[];
  receipt: ReceiptState | null;
  menuOpen: boolean;
  fresh: boolean;
  flash: boolean;
} & Handlers;

function MessageRowImpl(props: MessageRowProps) {
  const {
    message,
    mine,
    parent,
    parentAuthor,
    joinedPrev,
    endsGroup,
    dayText,
    partner,
    showAvatar,
    chips,
    receipt,
    menuOpen,
    fresh,
    flash,
    onToggleMenu,
    onReact,
    onReply,
    onEdit,
    onDelete,
    onCopy,
    onRetry,
    onDiscard,
    onJump,
  } = props;

  const [openBelow, setOpenBelow] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const el = document.getElementById(`msg-${message.id}`);
    if (!el) return;
    setOpenBelow(el.getBoundingClientRect().top < 260);
  }, [menuOpen, message.id]);

  const deleted = !!message.deleted_at;
  const failed = receipt === "failed";
  const emojiOnly =
    !deleted && !parent && !message.edited_at && isEmojiOnly(message.content);
  const popDir = openBelow
    ? "top-[calc(100%+6px)] bottom-auto"
    : "bottom-[calc(100%+6px)] top-auto";
  const tail = endsGroup ? (mine ? "rounded-br-sm" : "rounded-bl-sm") : "";
  const skin = mine ? "bg-outgoing text-ink" : "bg-incoming text-ink shadow-sm";
  const bubbleCls = emojiOnly
    ? "px-1 py-1 text-[40px] leading-none"
    : `relative max-w-full rounded-2xl px-3 py-1.5 text-[15px] leading-[1.45] ${skin} ${tail}`;
  const flashRing = flash
    ? "ring-2 ring-accent ring-offset-2 ring-offset-soft"
    : "";
  const animCls = fresh ? "animate-pop-in" : "";
  const metaColor = mine ? "text-accent-ink/70" : "text-muted";

  return (
    <>
      {dayText && (
        <div className="mx-1 my-4 flex items-center gap-2">
          <span className="h-px flex-1 bg-line" />
          <span className="rounded-full bg-paper px-2.5 py-1 text-[11px] font-medium tracking-wide text-muted shadow-sm">
            {dayText}
          </span>
          <span className="h-px flex-1 bg-line" />
        </div>
      )}
      <div
        id={`msg-${message.id}`}
        className={`relative flex items-end gap-2 ${joinedPrev ? "mt-0.5" : "mt-3"} ${mine ? "justify-end" : "justify-start"} ${animCls}`}
      >
        {!mine &&
          (showAvatar ? (
            <Avatar profile={partner} size={28} fallback="💚" />
          ) : (
            <div className="w-7 shrink-0" />
          ))}

        <div
          className={`flex min-w-0 max-w-[min(78%,520px)] flex-col max-[700px]:max-w-[82%] ${mine ? "items-end" : "items-start"}`}
        >
          <div className={`${bubbleCls} ${flashRing}`}>
            {parent && !deleted && (
              <button
                type="button"
                onClick={() => onJump(parent.id)}
                className={`mb-1.5 grid w-full gap-0.5 rounded-md border-l-2 px-2 py-1 text-left text-[12.5px] leading-snug transition-colors ${
                  mine
                    ? "border-accent-ink/40 bg-white/25 text-ink/80 hover:bg-white/35"
                    : "border-accent bg-soft text-muted hover:bg-hover"
                }`}
              >
                <strong className="text-[11px] font-semibold text-accent-ink">
                  {parentAuthor}
                </strong>
                <span className="line-clamp-2 break-all">
                  {parent.deleted_at ? "message deleted" : parent.content}
                </span>
              </button>
            )}

            <span
              className={`whitespace-pre-wrap break-words ${
                deleted ? "italic text-muted" : ""
              }`}
            >
              {deleted ? "This message was deleted" : message.content}
            </span>

            {!deleted && message.edited_at && (
              <span className="text-[11px] opacity-60"> · edited</span>
            )}

            {!emojiOnly && (
              <span
                className={`float-right ml-3 mt-1.5 inline-flex items-center gap-1 text-[11px] leading-none select-none ${metaColor}`}
              >
                <time dateTime={message.created_at}>
                  {timeFmt.format(new Date(message.created_at))}
                </time>
                {mine && receipt === "sending" && (
                  <span
                    className="inline-block h-3 w-3 animate-spin-soft rounded-full border-2 border-accent-ink/25 border-t-accent-ink/70"
                    aria-label="Sending"
                  />
                )}
                {mine && receipt === "failed" && (
                  <RotateCw
                    size={12}
                    className="text-danger"
                    aria-label="Not sent"
                  />
                )}
                {mine && receipt === "sent" && (
                  <Check size={13} className="text-ink/40" aria-label="Sent" />
                )}
                {mine && receipt === "delivered" && (
                  <CheckCheck
                    size={13}
                    className="text-ink/40"
                    aria-label="Delivered"
                  />
                )}
                {mine && receipt === "read" && (
                  <CheckCheck
                    size={13}
                    className="text-accent-ink"
                    aria-label="Read"
                  />
                )}
              </span>
            )}
          </div>

          {failed && (
            <div className="mt-1.5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => onRetry(message)}
                className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 bg-danger-soft px-2.5 py-1 text-[12px] font-medium text-danger transition-colors hover:opacity-90"
              >
                <RotateCw size={12} /> Try again
              </button>
              <button
                type="button"
                onClick={() => onDiscard(message.id)}
                className="text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                Discard
              </button>
            </div>
          )}

          <div
            className={`relative mt-1 flex min-h-6 items-center gap-1.5 ${mine ? "flex-row-reverse" : ""}`}
          >
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {chips.map((chip) => (
                  <button
                    key={chip.emoji}
                    type="button"
                    onClick={() => onReact(message.id, chip.emoji)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[13px] leading-[1.5] transition-colors ${
                      chip.mine
                        ? "border-accent/30 bg-accent-soft text-accent-ink"
                        : "border-line bg-paper text-ink hover:bg-hover"
                    }`}
                    aria-label={`${chip.emoji} ${chip.count}`}
                  >
                    {chip.emoji}
                    {chip.count > 1 && (
                      <b className="text-[11px] font-semibold opacity-75">
                        {chip.count}
                      </b>
                    )}
                  </button>
                ))}
              </div>
            )}

            {!deleted && !message.status && (
              <button
                type="button"
                onClick={() => onToggleMenu(menuOpen ? null : message.id)}
                className={`grid h-6 w-6 place-items-center rounded-md text-muted transition-[opacity,background,color] hover:bg-hover hover:text-ink ${
                  menuOpen
                    ? "bg-hover text-ink opacity-100"
                    : "opacity-40 hover:opacity-100 focus-visible:opacity-100"
                }`}
                aria-label="Message actions"
                aria-expanded={menuOpen}
              >
                <MoreHorizontal size={16} />
              </button>
            )}

            {menuOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-30 border-0 bg-transparent p-0"
                  onClick={() => onToggleMenu(null)}
                  aria-label="Close"
                />
                <div
                  className={`absolute z-[31] grid gap-1 rounded-xl border border-line bg-paper p-1.5 shadow-lg animate-pop-in ${mine ? "right-0" : "left-0"} ${popDir}`}
                  role="menu"
                >
                  <div className="flex gap-0.5">
                    {REACTION_SET.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => onReact(message.id, emoji)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-[18px] transition-colors hover:bg-hover"
                        aria-label={`React with ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-0.5">
                    <button
                      type="button"
                      onClick={() => onReply(message)}
                      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-hover"
                    >
                      <Reply size={14} /> Reply
                    </button>
                    <button
                      type="button"
                      onClick={() => onCopy(message)}
                      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-hover"
                    >
                      Copy
                    </button>
                    {mine && (
                      <button
                        type="button"
                        onClick={() => onEdit(message)}
                        className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-hover"
                      >
                        <Pencil size={14} /> Edit
                      </button>
                    )}
                    {mine && (
                      <button
                        type="button"
                        onClick={() => onDelete(message.id)}
                        className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-danger transition-colors hover:bg-danger-soft"
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export const MessageRow = memo(MessageRowImpl);
