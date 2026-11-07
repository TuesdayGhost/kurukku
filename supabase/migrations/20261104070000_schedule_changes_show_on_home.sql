-- 予定の変更で「ふだんの画面に出すか」も引き継ぐ（11/4）
-- 予定の中身として変えてよい欄だけを残す
create or replace function private.schedule_changes(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    from jsonb_each(coalesce(p, '{}'::jsonb))
   where key in ('title', 'display_text', 'weekdays', 'start_time', 'end_time', 'notify_from', 'notify_until',
                 'notify_sound', 'family_memo', 'memo_for_gazette', 'show_on_home')
$$;

-- この日だけ変える：その日の繰り返しを取りやめ、代わりの単発予定を作る
create or replace function public.change_schedule_once(p_id uuid, p_date date, p_changes jsonb)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  s public.schedules;
  n public.schedules;
  new_id uuid;
begin
  if (select private.my_role()) is distinct from 'family' then raise exception '予定の変更は家族だけができます'; end if;
  select * into s from public.schedules where id = p_id;
  if not found then raise exception '予定が見つかりません'; end if;
  if s.kind <> 'weekly' then raise exception '繰り返しの予定ではありません'; end if;
  if exists (select 1 from public.schedules where replaces_schedule_id = s.id and kind = 'once' and on_date = p_date) then
    raise exception 'この日はすでに変更済みです。変更した予定のほうを直してください';
  end if;
  n := jsonb_populate_record(s, private.schedule_changes(p_changes) - 'weekdays');
  insert into public.schedules (household_id, person_id, title, display_text, kind, on_date,
    start_time, end_time, notify_from, notify_until, notify_sound, family_memo, memo_for_gazette, show_on_home, replaces_schedule_id)
  values (s.household_id, s.person_id, n.title, n.display_text, 'once', p_date,
    n.start_time, n.end_time, n.notify_from, n.notify_until, n.notify_sound, n.family_memo, n.memo_for_gazette, n.show_on_home, s.id)
  returning id into new_id;
  insert into public.schedule_exceptions (schedule_id, on_date, household_id)
  values (s.id, p_date, s.household_id)
  on conflict (schedule_id, on_date) do nothing;
  return new_id;
end $$;

-- この日から先を変える：古い予定は前日で終わり、新しい予定がこの日から続く
create or replace function public.change_schedule_from(p_id uuid, p_from date, p_changes jsonb)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  s public.schedules;
  n public.schedules;
  new_id uuid;
begin
  if (select private.my_role()) is distinct from 'family' then raise exception '予定の変更は家族だけができます'; end if;
  select * into s from public.schedules where id = p_id;
  if not found then raise exception '予定が見つかりません'; end if;
  if s.kind <> 'weekly' then raise exception '繰り返しの予定ではありません'; end if;
  if s.valid_until is not null and p_from > s.valid_until then
    raise exception 'この予定はその日より前に終わっています';
  end if;
  n := jsonb_populate_record(s, private.schedule_changes(p_changes));
  if n.weekdays is null or cardinality(n.weekdays) = 0 then
    raise exception 'くりかえす曜日を選んでください';
  end if;

  -- まだ始まっていない予定なら、そのまま書き換える（過去の分がないため）
  if s.valid_from is not null and p_from <= s.valid_from then
    update public.schedules set title = n.title, display_text = n.display_text, weekdays = n.weekdays,
      start_time = n.start_time, end_time = n.end_time, notify_from = n.notify_from, notify_until = n.notify_until,
      notify_sound = n.notify_sound, family_memo = n.family_memo, memo_for_gazette = n.memo_for_gazette,
      show_on_home = n.show_on_home
     where id = s.id;
    return s.id;
  end if;

  update public.schedules set valid_until = p_from - 1 where id = s.id;
  insert into public.schedules (household_id, person_id, title, display_text, kind, weekdays, valid_from, valid_until,
    start_time, end_time, notify_from, notify_until, notify_sound, family_memo, memo_for_gazette, show_on_home, replaces_schedule_id)
  values (s.household_id, s.person_id, n.title, n.display_text, 'weekly', n.weekdays, p_from, s.valid_until,
    n.start_time, n.end_time, n.notify_from, n.notify_until, n.notify_sound, n.family_memo, n.memo_for_gazette, n.show_on_home, s.id)
  returning id into new_id;
  -- この日以降の「今日だけ中止」「この日だけ変更」は新しい予定に引き継ぐ
  update public.schedule_exceptions set schedule_id = new_id where schedule_id = s.id and on_date >= p_from;
  update public.schedules set replaces_schedule_id = new_id
   where replaces_schedule_id = s.id and kind = 'once' and on_date >= p_from;
  return new_id;
end $$;

