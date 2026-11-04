-- 鳩月報の土台（11/4）
-- ・日付ごとのひとこと・写真（任意。片方だけでも、何もない日があってもよい）
-- ・月報（対象月、発行日、見出しと記事、そのときの集計）
-- ・集計はデータベースのコードで行い、Claude には集計結果と選んだメモだけを渡す
-- すべて家族の役割だけが読み書きできる。

create table public.daily_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default private.my_household() references public.households (id) on delete cascade,
  on_date date not null,
  body text check (char_length(body) <= 200),
  photo_path text,
  photo_taken_on date,
  use_in_gazette boolean not null default true,   -- 月報に使ってよいか
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint daily_notes_not_empty check (body is not null or photo_path is not null)
);
create index on public.daily_notes (household_id, on_date);

create table public.gazettes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default private.my_household() references public.households (id) on delete cascade,
  month date not null check (extract(day from month) = 1),   -- 対象月（1日で表す）
  issued_on date,                                            -- 発行日（保存した日）
  headline text,
  subheadline text,
  articles jsonb not null default '[]'::jsonb,               -- [{ title, body }]
  photo_path text,                                           -- 紙面に使う写真（元の写真への参照）
  stats jsonb not null default '{}'::jsonb,                  -- 生成したときの集計（あとで見返せるように保存）
  material jsonb not null default '{}'::jsonb,               -- Claude に渡した材料（選んだメモなど）
  model text,
  generated_at timestamptz,
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (household_id, month)
);
create trigger gazettes_touch before update on public.gazettes
  for each row execute function private.touch_updated_at();

alter table public.daily_notes enable row level security;
alter table public.gazettes enable row level security;
create policy daily_notes_family on public.daily_notes for all to authenticated
  using (household_id = (select private.my_household()) and (select private.my_role()) = 'family')
  with check (household_id = (select private.my_household()) and (select private.my_role()) = 'family');
create policy gazettes_family on public.gazettes for all to authenticated
  using (household_id = (select private.my_household()) and (select private.my_role()) = 'family')
  with check (household_id = (select private.my_household()) and (select private.my_role()) = 'family');

-- ひとこと・写真の保存も履歴に残す（月報の材料の数）
create or replace function private.log_note_added() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.activity_log (household_id, kind, actor, ref_table, ref_id, ref_date)
  values (new.household_id, 'note_added', new.created_by, 'daily_notes', new.id, new.on_date);
  return new;
end $$;
create trigger daily_notes_log after insert on public.daily_notes
  for each row execute function private.log_note_added();

-- 日々の写真の保存場所（非公開・家族だけ）。パスは「家のID/…」
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memories', 'memories', false, 20971520, array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'])
on conflict (id) do nothing;
create policy memories_family_select on storage.objects for select to authenticated
  using (bucket_id = 'memories' and (storage.foldername(name))[1] = (select private.my_household())::text and (select private.my_role()) = 'family');
create policy memories_family_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'memories' and (storage.foldername(name))[1] = (select private.my_household())::text and (select private.my_role()) = 'family');
create policy memories_family_delete on storage.objects for delete to authenticated
  using (bucket_id = 'memories' and (storage.foldername(name))[1] = (select private.my_household())::text and (select private.my_role()) = 'family');

-- 月の集計（家族だけ）。数字はここで数え、AIには推測させない。
-- 予定は「予定○回」であって出席の実績ではない。カードを開いた回数は緊急事態の件数ではない。
create or replace function public.gazette_stats(p_month date)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  hid uuid := private.my_household();
  m_start date := date_trunc('month', p_month)::date;
  m_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  tz text;
  result jsonb;
begin
  if (select private.my_role()) is distinct from 'family' then raise exception '月報は家族だけが作れます'; end if;
  select coalesce(timezone, 'Asia/Tokyo') into tz from public.households where id = hid;

  with days as (
    select d::date as d from generate_series(m_start, m_end, interval '1 day') d
  ),
  occ as (   -- その月に予定が入っていた日（毎週の予定を日付に展開し、中止を除く）
    select s.id, s.person_id, s.title, s.start_time, s.end_time, days.d
      from public.schedules s
      join days on (
        (s.kind = 'once' and s.on_date = days.d)
        or (s.kind = 'weekly' and extract(dow from days.d)::smallint = any (s.weekdays)
            and (s.valid_from is null or days.d >= s.valid_from)
            and (s.valid_until is null or days.d <= s.valid_until))
      )
     where s.household_id = hid
       and not exists (select 1 from public.schedule_exceptions e where e.schedule_id = s.id and e.on_date = days.d)
  ),
  by_title as (
    select p.id as person_id, p.name, p.is_patient, o.title, count(*) as times,
           max(o.end_time) as latest_end, min(o.start_time) as earliest_start
      from occ o join public.people p on p.id = o.person_id
     group by p.id, p.name, p.is_patient, o.title
  ),
  logs as (
    select kind, count(*) as n from public.activity_log
     where household_id = hid and (occurred_at at time zone tz)::date between m_start and m_end
     group by kind
  )
  select jsonb_build_object(
    'month', to_char(m_start, 'YYYY-MM'),
    'days_in_month', (m_end - m_start + 1),
    'schedules', coalesce((select jsonb_agg(jsonb_build_object(
        'person', name, 'is_patient', is_patient, 'title', title, 'planned_times', times,
        'latest_end', to_char(latest_end, 'HH24:MI'), 'earliest_start', to_char(earliest_start, 'HH24:MI'))
        order by is_patient desc, name, times desc) from by_title), '[]'::jsonb),
    'messages_sent', (select count(*) from public.messages where household_id = hid and (created_at at time zone tz)::date between m_start and m_end),
    'notices_shown', coalesce((select n from logs where kind = 'notification_shown'), 0),
    'changed_once', coalesce((select n from logs where kind = 'schedule_changed_once'), 0),
    'cancelled', coalesce((select n from logs where kind = 'schedule_cancelled'), 0),
    'rescue_card_opened', coalesce((select n from logs where kind = 'rescue_card_opened'), 0),
    'pigeon_tapped', coalesce((select n from logs where kind = 'pigeon_tapped'), 0),
    'notes', (select count(*) from public.daily_notes where household_id = hid and on_date between m_start and m_end),
    'photos', (select count(*) from public.daily_notes where household_id = hid and on_date between m_start and m_end and photo_path is not null)
  ) into result;
  return result;
end $$;
revoke execute on function public.gazette_stats(date) from public, anon;
grant execute on function public.gazette_stats(date) to authenticated;
