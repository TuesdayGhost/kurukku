-- デモ用の家の印（11/4）。画面に「デモ用データ」と出し、本番の家と見分ける。
alter table public.households add column is_demo boolean not null default false;
