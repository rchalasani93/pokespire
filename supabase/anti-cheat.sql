-- Server-checked scores.
-- The browser can't be trusted, so the database keeps its own record of each run (when it started,
-- its difficulty and how long it has actually been played) and caps the score a run can submit.
-- Leaderboard points can only be added through finish_run(); direct writes to history are blocked.

-- 1. Server-side run tracking
alter table public.runs add column if not exists run_key text;
alter table public.runs add column if not exists difficulty text;
alter table public.runs add column if not exists started_at timestamptz;
alter table public.runs add column if not exists active_sec integer not null default 0;
alter table public.runs add column if not exists last_at timestamptz;

-- Runs already in progress keep the play time they've had (up to 2 hours)
update public.runs
   set run_key = data->>'id',
       difficulty = coalesce(nullif(data->>'difficulty', ''), 'medium'),
       started_at = coalesce(started_at, updated_at, now()),
       active_sec = least(7200, greatest(0, extract(epoch from now() - coalesce((data->>'startedAt')::timestamptz, updated_at, now()))))::int,
       last_at = now()
 where run_key is null;

create or replace function public.track_run()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (new.data->>'id') is distinct from old.run_key then
    -- A new run: the server starts its own clock
    new.run_key := new.data->>'id';
    new.difficulty := coalesce(nullif(new.data->>'difficulty', ''), 'medium');
    new.started_at := now();
    new.active_sec := 0;
  else
    -- Same run: these can't be changed from the browser
    new.run_key := old.run_key;
    new.difficulty := old.difficulty;
    new.started_at := old.started_at;
    -- Play time grows with each save; gaps over 2 minutes count as 2 minutes
    new.active_sec := old.active_sec + least(120, greatest(0, extract(epoch from now() - old.last_at)))::int;
  end if;
  new.last_at := now();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists track_run on public.runs;
create trigger track_run before insert or update on public.runs
  for each row execute function public.track_run();

-- 2. Finishing a run is the only way to add leaderboard points
create or replace function public.finish_run(entry jsonb)
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  r public.runs;
  claimed integer := 0;
  mult numeric;
  mins numeric;
  cap integer;
  final integer := 0;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if jsonb_typeof(entry->'score') = 'number' then
    claimed := greatest(0, least(10000000, floor((entry->>'score')::numeric)))::integer;
  end if;

  select * into r from public.runs where user_id = auth.uid() for update;
  if found and r.run_key is not distinct from (entry->>'runId') then
    mult := case r.difficulty when 'easy' then 0.5 when 'hard' then 1.5 when 'hell' then 2.5 else 1 end;
    mins := (r.active_sec + least(120, greatest(0, extract(epoch from now() - r.last_at)))) / 60.0;
    -- At most 1,500 points per minute of play (before the difficulty bonus), and 25,000 per run
    cap := least(floor(25000 * mult), floor((300 + mins * 1500) * mult))::integer;
    final := least(claimed, cap);
  end if;
  if coalesce(entry->>'god', 'false') = 'true' then final := 0; end if;

  insert into public.history (user_id, result, data, score)
  values (auth.uid(), left(coalesce(entry->>'result', 'Ended'), 40), entry || jsonb_build_object('score', final), final);
  delete from public.runs where user_id = auth.uid();
  return final;
end;
$$;
revoke all on function public.finish_run(jsonb) from public, anon;
grant execute on function public.finish_run(jsonb) to authenticated;

-- 3. No direct writes to history, and no table-wide operations from the browser
drop policy if exists "add own history" on public.history;
revoke insert, update, delete, truncate on public.history from anon, authenticated;
revoke truncate on public.profiles, public.runs, public.friends from anon, authenticated;
revoke all on function public.track_run() from public, anon, authenticated;
