-- デモ用の家「豆田家」：10月のデイの行事（11/4）
-- 由来：企画者の父が実際に10月にデイで参加した行事の種類（芋煮会＋運動会、床屋）をもとにしたサンプル。
--       施設名・ほかの利用者・実際の日付は含めない。日付はデモ用に月・木のデイの日へ仮に置いた。
-- 「この日だけ変更」として入れるため、デイの予定回数は二重に数えない。家族メモは月報に使う。
-- 注意：この処理を確認用の begin…rollback と同じ実行にまとめると、一緒に取り消される（11/4 に一度起きた）。単独で実行すること。
do $$
declare
  hid uuid := :'demo_id';
  day uuid; dad uuid;
begin
  select id, person_id into day, dad from public.schedules where household_id = hid and kind = 'weekly' and title = 'デイ' limit 1;
  if day is null then raise exception 'デイの予定が見つかりません'; end if;
  if exists (select 1 from public.schedules where replaces_schedule_id = day and on_date in ('2026-10-19','2026-10-29')) then
    raise exception 'すでに入っています';
  end if;
  insert into public.schedules (household_id, person_id, title, display_text, kind, on_date, start_time, end_time, notify_from, notify_until, family_memo, memo_for_gazette, replaces_schedule_id) values
    (hid, dad, 'デイ', '芋煮会と運動会', 'once', '2026-10-19', '09:00', '17:00', '08:50', '09:05', '芋煮会と運動会', true, day),
    (hid, dad, 'デイ', '床屋さん', 'once', '2026-10-29', '09:00', '17:00', '08:50', '09:05', '床屋', true, day);
  insert into public.schedule_exceptions (schedule_id, on_date, household_id) values (day, '2026-10-19', hid), (day, '2026-10-29', hid);
end $$;
