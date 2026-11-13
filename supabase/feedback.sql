-- Player feedback and bug reports, plus a log of admin actions on them.
-- Run in the Supabase SQL Editor after schema.sql. Safe to re-run.

create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('bug', 'pokemon', 'balance', 'idea', 'other')),
  message text not null check (char_length(btrim(message)) between 10 and 2000),
  context text not null default '' check (char_length(context) <= 120),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_user_time on public.feedback (user_id, created_at desc);
create index if not exists feedback_time on public.feedback (created_at desc);

alter table public.feedback enable row level security;

-- Players can send feedback as themselves. Nobody reads the table directly: admins use admin_feedback().
drop policy if exists "send own feedback" on public.feedback;
create policy "send own feedback" on public.feedback
  for insert to authenticated with check ((select auth.uid()) = user_id);

revoke all on public.feedback from anon, authenticated;
grant insert (kind, message, context) on public.feedback to authenticated;

-- Rate limit: 5 reports per hour and 20 per day for each player
create or replace function public.feedback_rate_limit()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if (select count(*) from public.feedback
       where user_id = new.user_id and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.feedback
       where user_id = new.user_id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'feedback rate limit' using errcode = 'P0001', hint = 'Too many reports. Please try again later.';
  end if;
  new.status := 'open';
  new.created_at := now();
  new.message := btrim(new.message);
  return new;
end;
$$;
revoke execute on function public.feedback_rate_limit() from public, anon, authenticated;
drop trigger if exists feedback_rate_limit on public.feedback;
create trigger feedback_rate_limit before insert on public.feedback
  for each row execute function public.feedback_rate_limit();

-- Append-only record of what admins did
create table if not exists public.admin_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (char_length(action) <= 60),
  target text not null default '' check (char_length(target) <= 120),
  created_at timestamptz not null default now()
);
alter table public.admin_log enable row level security;
revoke all on public.admin_log from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select coalesce((select is_admin from public.profiles where user_id = auth.uid()), false);
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Admins: latest reports with the sender's username
create or replace function public.admin_feedback(lim integer default 100)
returns table (id bigint, username text, kind text, message text, context text, status text, created_at timestamptz)
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select f.id, p.username, f.kind, f.message, f.context, f.status, f.created_at
      from public.feedback f
      left join public.profiles p on p.user_id = f.user_id
     order by f.created_at desc
     limit least(greatest(lim, 1), 200);
end;
$$;
revoke all on function public.admin_feedback(integer) from public, anon;
grant execute on function public.admin_feedback(integer) to authenticated;

-- Admins: mark a report open or resolved (logged)
create or replace function public.admin_set_feedback_status(fid bigint, new_status text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if new_status not in ('open', 'resolved') then
    raise exception 'bad status' using errcode = '22023';
  end if;
  update public.feedback set status = new_status where id = fid;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  insert into public.admin_log (admin_id, action, target)
  values (auth.uid(), 'feedback:' || new_status, 'feedback#' || fid);
end;
$$;
revoke all on function public.admin_set_feedback_status(bigint, text) from public, anon;
grant execute on function public.admin_set_feedback_status(bigint, text) to authenticated;
