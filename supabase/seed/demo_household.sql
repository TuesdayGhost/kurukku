-- デモ用の家「豆田家」に入れる架空のデータ（11/4）
-- 人物・予定・本人情報はすべて架空。実在の家族の情報は含まない。
--   豆田 鳩蔵（お父さん・本人）／豆田 くる子（お母さん）／豆田 はと子（家族・シフト勤務）／鳩「はとやま」
-- 使い方：:demo_id を、デモ用の家の id に置き換えて実行する。
-- 家と「お父さん」「お母さん」は先にアプリから作っておく（ない人はここで作る）。
-- 10月のデイの行事など「先月の実際の予定をもとにしたサンプル」は、別のファイルで追加する。

do $$
declare
  hid uuid := :'demo_id';
  dad uuid; mom uuid; me uuid;
begin
  if exists (select 1 from public.schedules where household_id = hid) then
    raise exception 'この家にはすでに予定があります（二重に入れないため止めます）';
  end if;
  update public.households
     set is_demo = true, pigeon_name = coalesce(pigeon_name, 'はとやま'),
         weather_label = coalesce(weather_label, '東京都千代田区'),   -- 架空の家の地域。実在の家の地域はリポジトリに書かない
         weather_lat = coalesce(weather_lat, 35.6940), weather_lon = coalesce(weather_lon, 139.7536)
   where id = hid;

  select id into dad from public.people where household_id = hid and name = 'お父さん';
  if dad is null then insert into public.people (household_id, name, is_patient, sort_order) values (hid, 'お父さん', true, 0) returning id into dad; end if;
  select id into mom from public.people where household_id = hid and name = 'お母さん';
  if mom is null then insert into public.people (household_id, name, is_patient, sort_order) values (hid, 'お母さん', false, 1) returning id into mom; end if;
  select id into me from public.people where household_id = hid and name = 'はと子';
  if me is null then insert into public.people (household_id, name, is_patient, sort_order) values (hid, 'はと子', false, 2) returning id into me; end if;

  -- お父さんの毎日の予定（10月から）
  insert into public.schedules (household_id, person_id, title, kind, weekdays, valid_from, start_time, notify_from, notify_until) values
    (hid, dad, '朝ごはん',   'weekly', '{0,1,2,3,4,5,6}', '2026-10-01', '07:30', '07:20', '07:35'),
    (hid, dad, 'お薬',       'weekly', '{0,1,2,3,4,5,6}', '2026-10-01', '08:00', '07:55', '08:10'),
    (hid, dad, 'お昼ごはん', 'weekly', '{0,1,2,3,4,5,6}', '2026-10-01', '12:00', '11:50', '12:05'),
    (hid, dad, '夕ごはん',   'weekly', '{0,1,2,3,4,5,6}', '2026-10-01', '18:30', '18:20', '18:35');
  -- デイ（月・木）
  insert into public.schedules (household_id, person_id, title, display_text, kind, weekdays, valid_from, start_time, end_time, notify_from, notify_until) values
    (hid, dad, 'デイ', null, 'weekly', '{1,4}', '2026-10-01', '09:00', '17:00', '08:50', '09:05');
  -- お母さん：毎週水曜の買い物
  insert into public.schedules (household_id, person_id, title, kind, weekdays, valid_from, start_time, end_time) values
    (hid, mom, '買い物', 'weekly', '{3}', '2026-10-01', '14:00', '15:30');

  -- はと子：シフト勤務（10月〜11月上旬の架空のシフト）
  insert into public.schedules (household_id, person_id, title, kind, on_date, start_time, end_time)
  select hid, me, '仕事', 'once', d::date,
         case when extract(dow from d) in (2, 5) then '13:00'::time else '09:00'::time end,
         case when extract(dow from d) in (2, 5) then '21:30'::time else '18:00'::time end
    from generate_series('2026-10-01'::date, '2026-11-08'::date, interval '1 day') d
   where extract(dow from d) not in (0, 3)            -- 日・水は休み
     and d::date not in ('2026-10-13', '2026-10-24', '2026-11-04', '2026-11-07');  -- ほかの休み
  update public.schedules set end_time = '21:40'
   where household_id = hid and person_id = me and on_date = '2026-10-16';   -- 最遅の帰宅

  -- 本人情報（架空）。顔写真はイラストを後で登録する
  delete from public.rescue_profiles where household_id = hid and full_name is null;
  insert into public.rescue_profiles (household_id, full_name, birth_date,
      height_cm, height_approx, height_measured_on, weight_kg, weight_approx, weight_measured_on, shoe_cm,
      features, belongings, notes)
  values (hid, '豆田 鳩蔵', '1948-05-01',
      165, true, '2026-11-01', 58, true, '2026-10-15', 25.5,
      '白髪の短髪。黒縁の眼鏡。右足を少し引きずって歩く', '黒い手提げかばん、杖',
      '耳が少し遠いので、正面からゆっくり話しかけてください');
  insert into public.rescue_clothes (household_id, note, sort_order) values
    (hid, '紺のジャンパー', 0), (hid, 'グレーのセーター', 1), (hid, '茶色の帽子', 2);

  -- 10月の記録（架空）：鳩がつつかれた回数（42回）、カードを開いた回数（2回）
  insert into public.activity_log (household_id, kind, occurred_at)
  select hid, 'pigeon_tapped', '2026-10-01 10:00+09'::timestamptz + (i * interval '17 hours 13 minutes')
    from generate_series(0, 41) i;
  insert into public.activity_log (household_id, kind, occurred_at)
  values (hid, 'rescue_card_opened', '2026-10-09 20:10+09'), (hid, 'rescue_card_opened', '2026-10-27 21:05+09');
end $$;
