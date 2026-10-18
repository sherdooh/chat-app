# Close: private chat for two people

A responsive, WhatsApp-inspired chat app built with Next.js, React, and Supabase Auth/Postgres/Realtime. Message history is stored in Postgres, loaded when a member signs in, and new messages stream to both signed-in users. Row-level security restricts access to the two UUIDs explicitly added to `public.chat_members`.

## What is included

- Email/password sign-in. No public sign-up form.
- Database-backed message history with server timestamps and stable chronological ordering.
- Realtime message delivery across both browsers/devices.
- Row-level security: only the two accounts inserted into `chat_members` can read or send.
- Client cannot update or delete messages.
- Responsive desktop/mobile layout, loading/empty/error states, and sign-out.

## 1. Create the Supabase project

1. Create a project at https://supabase.com/.
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it.
3. In **Authentication → Users**, create the two accounts using the email addresses for the two people. Use strong, unique passwords. Keep public sign-ups disabled.
4. Copy each account's UUID from Authentication → Users.
5. Run this SQL in the Supabase SQL Editor, replacing the sample UUIDs with the two actual user UUIDs:

```sql
insert into public.chat_members (user_id)
values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');
```

Only insert the two intended users. Do not put a service-role key in the frontend or in `.env.local`.

## 2. Configure the app

1. Install Node.js 20.9+.
2. Copy `.env.example` to `.env.local`.
3. In Supabase **Project Settings → API** (or **Connect**), copy the project URL and the publishable/anon key into `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

The publishable/anon key is designed to be used by the browser when Row Level Security is correctly configured. Never use the `service_role` secret here.

## 3. Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 on both devices and sign in using the two accounts. Messages should appear in both sessions and remain after refresh or returning later.

## 4. Deploy

Deploy the repository to Vercel or another Next.js host. Add the same two environment variables to the hosting project's environment settings, then redeploy. In Supabase Authentication → URL Configuration, add the deployed site's URL to the allowed Site URL / redirect URLs as appropriate.

## Security notes

- The app intentionally has no registration UI. Create accounts as an administrator in Supabase and add only those two account UUIDs to `chat_members`.
- RLS is the access-control boundary. Hiding the link or relying on a secret URL is not security.
- Use HTTPS in production, unique strong passwords, and enable MFA for the accounts if available.
- Supabase project administrators can access database contents. This implementation is access-controlled, but it is **not end-to-end encrypted**: the database provider can read stored messages. If you need protection from the hosting/database provider itself, add a reviewed end-to-end encryption design before using it for sensitive conversations.
- The page loads the latest 2,000 messages for practicality. Older messages remain stored in the database, but a production deployment with a very long history should add cursor-based pagination to browse older messages.
