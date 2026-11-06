-- Run this file in the Supabase SQL Editor.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (
    username = btrim(username)
    and char_length(username) between 2 and 20
  ),
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username));

alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists avatar_generated_at timestamptz;

alter table public.profiles drop constraint if exists profiles_avatar_path_check;
alter table public.profiles add constraint profiles_avatar_path_check
  check (avatar_path is null or avatar_path = id::text || '/avatar.webp');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', true, 5242880, array['image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/webp'];

drop policy if exists "Avatar owners upload" on storage.objects;
create policy "Avatar owners upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-avatars' and name = (select auth.uid())::text || '/avatar.webp');
drop policy if exists "Avatar owners read" on storage.objects;
create policy "Avatar owners read" on storage.objects for select to authenticated
  using (bucket_id = 'profile-avatars' and name = (select auth.uid())::text || '/avatar.webp');
drop policy if exists "Avatar owners update" on storage.objects;
create policy "Avatar owners update" on storage.objects for update to authenticated
  using (bucket_id = 'profile-avatars' and name = (select auth.uid())::text || '/avatar.webp')
  with check (bucket_id = 'profile-avatars' and name = (select auth.uid())::text || '/avatar.webp');

create table if not exists public.game_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  score integer not null check (score >= 0),
  reached_stage text not null,
  created_at timestamptz not null default now()
);

create index if not exists game_records_user_score_idx
  on public.game_records (user_id, score desc, created_at asc);

alter table public.profiles enable row level security;
alter table public.game_records enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.game_records from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant insert on public.profiles to authenticated;
grant update (username, avatar_path) on public.profiles to authenticated;
grant select on public.game_records to anon, authenticated;
grant insert on public.game_records to authenticated;

drop policy if exists "Public profiles are readable" on public.profiles;
create policy "Public profiles are readable"
  on public.profiles for select
  to anon, authenticated
  using (true);

drop policy if exists "Users create their own profile" on public.profiles;
create policy "Users create their own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Public records are readable" on public.game_records;
create policy "Public records are readable"
  on public.game_records for select
  to anon, authenticated
  using (true);

drop policy if exists "Users submit their own records" on public.game_records;
create policy "Users submit their own records"
  on public.game_records for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create or replace function public.claim_profile_avatar_generation()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare claimed boolean;
begin
  update public.profiles
  set avatar_generated_at = now()
  where id = (select auth.uid())
    and (avatar_generated_at is null or avatar_generated_at < now() - interval '1 hour')
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;
revoke all on function public.claim_profile_avatar_generation() from public, anon;
grant execute on function public.claim_profile_avatar_generation() to authenticated;

create or replace view public.leaderboard
with (security_invoker = true)
as
select distinct on (r.user_id)
  r.user_id,
  p.username,
  r.score as best_score,
  r.reached_stage,
  r.created_at as achieved_at,
  p.avatar_path,
  p.avatar_generated_at
from public.game_records as r
join public.profiles as p on p.id = r.user_id
order by r.user_id, r.score desc, r.created_at asc;

revoke all on public.leaderboard from public, anon, authenticated;
grant select on public.leaderboard to anon, authenticated;
