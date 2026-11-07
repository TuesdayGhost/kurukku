-- 通知表示の記録。端末（表示専用）は履歴を読めないため、
-- 「重複なら何もしない」書き込みを直接行うと権限エラーになる。
-- この関数で、同じ家の予定であることを確かめてから1件だけ記録する。
create or replace function public.log_notice(p_schedule_id uuid, p_on_date date)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  hid uuid := private.my_household();
  t text;
begin
  if hid is null then
    raise exception '家に登録されていません';
  end if;
  select title into t from public.schedules where id = p_schedule_id and household_id = hid;
  if not found then
    raise exception '予定が見つかりません';
  end if;
  insert into public.activity_log (household_id, kind, ref_table, ref_id, ref_date, dedupe_key, payload)
  values (hid, 'notification_shown', 'schedules', p_schedule_id, p_on_date,
          'notify:' || p_schedule_id || ':' || p_on_date, jsonb_build_object('title', t))
  on conflict (household_id, dedupe_key) do nothing;
end $$;
revoke execute on function public.log_notice(uuid, date) from public, anon;
grant execute on function public.log_notice(uuid, date) to authenticated;
