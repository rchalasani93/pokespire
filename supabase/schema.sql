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

-- Admins get the in-game admin panel and God mode. Only the database owner can set this:
--   update public.profiles set is_admin = true where username = 'YourName';
alter table public.profiles add column if not exists is_admin boolean not null default false;

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

-- Players may only change their own save data, never their username or admin flag
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (data, updated_at) on public.profiles to authenticated;
revoke all on public.runs from anon;
revoke all on public.history from anon;

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

-- ---------------------------------------------------------------
-- Scores, leaderboard and friends
-- ---------------------------------------------------------------
-- Scores: best single run and lifetime points (runs + missions + achievements)
alter table public.profiles add column if not exists best_score integer not null default 0;
alter table public.profiles add column if not exists total_score bigint not null default 0;
alter table public.history add column if not exists score integer not null default 0 check (score between 0 and 1000000);

-- A finished run updates the player's best and total score
create or replace function public.apply_run_score()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.profiles
     set best_score = greatest(best_score, new.score),
         total_score = total_score + new.score
   where user_id = new.user_id;
  return new;
end;
$$;
revoke execute on function public.apply_run_score() from public, anon, authenticated;
drop trigger if exists on_history_score on public.history;
create trigger on_history_score after insert on public.history
  for each row execute function public.apply_run_score();

-- Leaderboard points come only from runs (missions and achievements give none)
drop function if exists public.claim_points(integer);

-- Public leaderboard (usernames and scores only)
create or replace function public.leaderboard(kind text default 'best', lim integer default 50)
returns table (user_id uuid, username text, best_score integer, total_score bigint)
language sql
stable
security definer set search_path = ''
as $$
  select p.user_id, p.username, p.best_score, p.total_score
    from public.profiles p
   where (case when kind = 'total' then p.total_score else p.best_score end) > 0
   order by case when kind = 'total' then p.total_score else p.best_score end desc, p.username
   limit least(greatest(lim, 1), 100);
$$;
revoke all on function public.leaderboard(text, integer) from public, anon;
grant execute on function public.leaderboard(text, integer) to authenticated;

-- Friends (one-way "added" list, like following)
create table if not exists public.friends (
  user_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
alter table public.friends enable row level security;
drop policy if exists "own friends" on public.friends;
create policy "own friends" on public.friends
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.friends from anon;
grant select, insert, delete on public.friends to authenticated;
create index if not exists friends_friend on public.friends (friend_id);

-- Find players by username
create or replace function public.search_players(q text)
returns table (user_id uuid, username text, best_score integer, is_friend boolean)
language sql
stable
security definer set search_path = ''
as $$
  select p.user_id, p.username, p.best_score,
         exists (select 1 from public.friends f where f.user_id = auth.uid() and f.friend_id = p.user_id)
    from public.profiles p
   where char_length(q) >= 2
     and p.username ilike '%' || replace(replace(q, '%', ''), '_', '\_') || '%'
     and p.user_id <> auth.uid()
   order by (lower(p.username) = lower(q)) desc, p.username
   limit 20;
$$;
revoke all on function public.search_players(text) from public, anon;
grant execute on function public.search_players(text) to authenticated;

-- My friends with their scores, plus who added me
create or replace function public.my_friends()
returns table (user_id uuid, username text, best_score integer, total_score bigint, added_me boolean, i_added boolean)
language sql
stable
security definer set search_path = ''
as $$
  with mine as (select friend_id as id from public.friends where user_id = auth.uid()),
       theirs as (select user_id as id from public.friends where friend_id = auth.uid())
  select p.user_id, p.username, p.best_score, p.total_score,
         p.user_id in (select id from theirs), p.user_id in (select id from mine)
    from public.profiles p
   where p.user_id in (select id from mine union select id from theirs)
   order by p.username;
$$;
revoke all on function public.my_friends() from public, anon;
grant execute on function public.my_friends() to authenticated;
