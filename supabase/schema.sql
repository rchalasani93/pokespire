-- PokéSpire database schema for Supabase.
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to re-run.

-- Player profile: username, settings, starter pool (caught Pokémon), Hall of Fame, stats
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  data jsonb not null default '{}'::jsonb check (octet_length(data::text) < 400000),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

-- The in-progress run (one per player)
create table if not exists public.runs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null check (octet_length(data::text) < 400000),
  updated_at timestamptz not null default now()
);

-- Finished runs
create table if not exists public.history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  result text not null check (char_length(result) <= 40),
  data jsonb not null check (octet_length(data::text) < 100000),
  created_at timestamptz not null default now()
);
create index if not exists history_user on public.history (user_id, id desc);

-- Row Level Security: players can only see and change their own rows
alter table public.profiles enable row level security;
alter table public.runs enable row level security;
alter table public.history enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own run" on public.runs;
create policy "own run" on public.runs
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "read own history" on public.history;
create policy "read own history" on public.history
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "add own history" on public.history;
create policy "add own history" on public.history
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- Create the profile row (with the chosen username) when an account is created
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
-- Only the trigger should run this, never the public API
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Lets the sign-up form check a username before creating the account.
-- Callable without signing in on purpose; it only answers yes or no.
create or replace function public.username_available(name text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(name));
$$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
