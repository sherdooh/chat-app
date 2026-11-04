import type { Profile } from "@/lib/chat";

type AvatarProps = {
  profile: Profile | null | undefined;
  size: number;
  ring?: boolean;
  fallback?: string;
};

export function Avatar({
  profile,
  size,
  ring = false,
  fallback = "💕",
}: AvatarProps) {
  const emoji = profile?.avatar_emoji ?? fallback;
  const photo = profile?.avatar_photo ?? null;
  const fontSize = Math.round(size * 0.5);
  const ringCls = ring ? "ring-2 ring-accent/30" : "ring-1 ring-line";
  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-peach-soft ${ringCls}`}
      style={{ width: size, height: size, fontSize }}
      aria-hidden="true"
    >
      {photo ? (
        <img
          src={photo}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        emoji
      )}
    </span>
  );
}
