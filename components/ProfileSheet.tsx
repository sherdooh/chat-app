"use client";

import { useState } from "react";
import { LogOut, X } from "lucide-react";
import { Avatar } from "./Avatar";
import type { Profile } from "@/lib/chat";

const EMOJI_CHOICES = [
  "🌸",
  "💕",
  "🌿",
  "💚",
  "🥰",
  "✨",
  "🌙",
  "🦋",
  "🌻",
  "🫶",
];

type SaveResult = string | null;

type ProfileSheetProps = {
  profile: Profile;
  onSave: (next: {
    display_name: string;
    avatar_emoji: string | null;
    avatar_photo: string | null;
  }) => Promise<SaveResult>;
  onClose: () => void;
  onSignOut: () => void | Promise<void>;
};

export function ProfileSheet({
  profile,
  onSave,
  onClose,
  onSignOut,
}: ProfileSheetProps) {
  const [name, setName] = useState(profile.display_name);
  const [emoji, setEmoji] = useState(profile.avatar_emoji ?? "🌸");
  const [photo, setPhoto] = useState<string | null>(profile.avatar_photo);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 30) {
      setError("Name must be 1–30 characters.");
      return;
    }
    setError("");
    setSaving(true);
    const err = await onSave({
      display_name: trimmed,
      avatar_emoji: emoji || null,
      avatar_photo: photo,
    });
    setSaving(false);
    if (err) setError(err);
    else onClose();
  }

  async function handlePhoto(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please pick an image.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("That image is too large (max 8 MB).");
      return;
    }
    try {
      const dataUrl = await resizeImage(file, 200);
      if (dataUrl.length > 95_000) {
        setError("That image is too large after resizing.");
        return;
      }
      setPhoto(dataUrl);
      setError("");
    } catch {
      setError("Couldn't read that image.");
    }
  }

  return (
    <div
      className="sheet-layer fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="sheet w-full max-w-[400px] rounded-2xl border border-line bg-paper p-6 shadow-xl animate-sheet-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Your profile"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="m-0 text-lg font-semibold tracking-tight text-ink">
            Your profile
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-5 flex justify-center">
          <Avatar
            profile={{
              user_id: profile.user_id,
              display_name: name || profile.display_name,
              avatar_emoji: emoji,
              avatar_photo: photo,
            }}
            size={88}
            fallback="🌸"
          />
        </div>

        <div className="mb-4 grid gap-1.5">
          <label
            htmlFor="profile-name"
            className="text-[13px] font-medium text-ink"
          >
            Display name
          </label>
          <input
            id="profile-name"
            className="h-11 w-full rounded-lg border border-input-line bg-input px-3.5 text-[15px] text-ink transition-[border-color,background,box-shadow] placeholder:text-muted focus:border-accent focus:bg-paper focus:ring-2 focus:ring-accent/15 focus:outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
            autoFocus
          />
        </div>

        <div className="mb-4 grid gap-2">
          <span className="text-[13px] font-medium text-ink">Emoji</span>
          <div className="flex flex-wrap gap-1.5">
            {EMOJI_CHOICES.map((e) => {
              const active = !photo && emoji === e;
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    setEmoji(e);
                    setPhoto(null);
                  }}
                  className={`grid h-10 w-10 place-items-center rounded-lg border text-[18px] transition-colors ${
                    active
                      ? "border-accent bg-accent-soft"
                      : "border-line bg-paper hover:bg-hover"
                  }`}
                  aria-label={`Use ${e}`}
                >
                  {e}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-5 grid gap-2">
          <span className="text-[13px] font-medium text-ink">Photo</span>
          <div className="flex gap-2">
            <label className="flex-1 cursor-pointer rounded-lg border border-line bg-input px-3 py-2.5 text-center text-[13px] text-muted transition-colors hover:bg-hover hover:text-ink">
              {photo ? "Change photo" : "Upload photo"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handlePhoto(f);
                }}
              />
            </label>
            {photo && (
              <button
                type="button"
                onClick={() => setPhoto(null)}
                className="rounded-lg border border-line bg-paper px-3 py-2.5 text-[13px] text-muted transition-colors hover:bg-hover hover:text-ink"
              >
                Remove
              </button>
            )}
          </div>
        </div>

        {error && (
          <p
            className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px] text-danger"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void onSignOut()}
            className="grid h-11 w-11 place-items-center rounded-lg border border-line bg-paper text-muted transition-colors hover:bg-hover hover:text-ink"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={18} />
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-progress disabled:opacity-70"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

async function resizeImage(file: File, size: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.82);
}
