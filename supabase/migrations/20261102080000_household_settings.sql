-- 家の設定：天気の地域（地名と緯度経度）と、鳩の名前
-- 地域は公開リポジトリに書かず、ここ（家ごとのデータ）にだけ保存する。
alter table public.households
  add column weather_label text,
  add column weather_lat double precision check (weather_lat between -90 and 90),
  add column weather_lon double precision check (weather_lon between -180 and 180),
  add column pigeon_name text check (char_length(pigeon_name) <= 12);

-- 名前や地域を変えたら、表示端末にもすぐ反映する
alter publication supabase_realtime add table public.households;
