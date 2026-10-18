-- Close: private two-person chat schema
-- Run this in Supabase SQL Editor BEFORE using the app.
-- Add exactly two Auth user UUIDs to public.chat_members after creating their accounts.

create table if not exists public.chat_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.chat_members(user_id) on delete restrict,
  content text not null check (char_length(trim(content)) between 1 and 10000),
  created_at timestamptz not null default now()
);

create index if not exists messages_created_at_id_idx on public.messages (created_at asc, id asc);

alter table public.chat_members enable row level security;
alter table public.messages enable row level security;

-- A signed-in user can only see their own membership row.
drop policy if exists "Members can view own membership" on public.chat_members;
create policy "Members can view own membership"
  on public.chat_members for select to authenticated
  using (user_id = (select auth.uid()));

-- Only the two UUIDs explicitly inserted into chat_members can read or send.
drop policy if exists "Chat members can read messages" on public.messages;
create policy "Chat members can read messages"
  on public.messages for select to authenticated
  using (exists (select 1 from public.chat_members m where m.user_id = (select auth.uid())));

drop policy if exists "Chat members can send as themselves" on public.messages;
create policy "Chat members can send as themselves"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (select 1 from public.chat_members m where m.user_id = (select auth.uid()))
  );

-- Prevent edits/deletes from the client. Messages remain in history.
revoke update, delete on public.messages from anon, authenticated;
revoke insert, update, delete on public.chat_members from anon, authenticated;
grant select on public.chat_members to authenticated;
grant select, insert on public.messages to authenticated;

-- Enable realtime delivery for newly inserted messages.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
