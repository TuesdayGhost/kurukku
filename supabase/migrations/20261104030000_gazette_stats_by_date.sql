-- 月の集計の修正（11/4）：中止・この日だけ変更・通知は「操作した日」ではなく「その予定の日」で数える
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
    -- 予定に関する記録は「その予定の日」、それ以外は「起きた日」で数える
    select kind, count(*) as n from public.activity_log
     where household_id = hid and coalesce(ref_date, (occurred_at at time zone tz)::date) between m_start and m_end
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
