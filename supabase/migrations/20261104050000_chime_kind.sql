-- お知らせの音の種類（11/4 決定：通知音・鳩時計・振り子時計から家族が選ぶ。ブラウザで合成）
alter table public.households
  add column chime_kind text not null default 'chime' check (chime_kind in ('chime', 'pigeon_clock', 'pendulum'));
