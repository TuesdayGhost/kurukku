-- 夜表示の時間帯（11/3 決定：初期値 21時〜翌6時、家族が変更できる）
alter table public.households
  add column night_start time not null default '21:00',
  add column night_end time not null default '06:00';
