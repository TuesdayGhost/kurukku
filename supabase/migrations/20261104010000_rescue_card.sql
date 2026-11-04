-- レスキュー対応カード（11/4）
-- 本人が外出先から戻らないとき、家族がすぐに見せる・読み上げる・送るための情報。
-- 家族の役割だけが読み書きできる。父の部屋・居間の端末からは見えない。
-- 写真は加工せず元の画像のまま非公開の保存場所に置く。

create table public.rescue_profiles (
  household_id uuid primary key default private.my_household() references public.households (id) on delete cascade,
  full_name text,
  address text,
  birth_date date,
  height_cm numeric(5,1), height_approx boolean not null default false, height_measured_on date,
  weight_kg numeric(5,1), weight_approx boolean not null default false, weight_measured_on date,
  shoe_cm numeric(4,1), shoe_approx boolean not null default false, shoe_measured_on date,
  belongings text,          -- いつもの持ち物
  features text,            -- 身体の特徴（髪型・眼鏡・歩き方など）
  notes text,               -- その他、伝えたいこと
  face_photo_path text,     -- 保存場所の中のパス（元の画像）
  face_photo_taken_on date, -- 撮影日（分かる範囲で）
  face_photo_uploaded_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null
);

-- よく着る服（毎日の入力はしない。事前に登録しておき「このうちどれか」として見せる）
create table public.rescue_clothes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default private.my_household() references public.households (id) on delete cascade,
  photo_path text,
  note text check (char_length(note) <= 60),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.rescue_clothes (household_id);

create trigger rescue_profiles_touch before update on public.rescue_profiles
  for each row execute function private.touch_updated_at();

alter table public.rescue_profiles enable row level security;
alter table public.rescue_clothes enable row level security;
create policy rescue_profiles_family on public.rescue_profiles for all to authenticated
  using (household_id = (select private.my_household()) and (select private.my_role()) = 'family')
  with check (household_id = (select private.my_household()) and (select private.my_role()) = 'family');
create policy rescue_clothes_family on public.rescue_clothes for all to authenticated
  using (household_id = (select private.my_household()) and (select private.my_role()) = 'family')
  with check (household_id = (select private.my_household()) and (select private.my_role()) = 'family');

-- 写真の保存場所（非公開）。パスは「家のID/…」とし、同じ家の家族だけが扱える
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rescue', 'rescue', false, 20971520, array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'])
on conflict (id) do nothing;

create policy rescue_photos_family_select on storage.objects for select to authenticated
  using (bucket_id = 'rescue' and (storage.foldername(name))[1] = (select private.my_household())::text and (select private.my_role()) = 'family');
create policy rescue_photos_family_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'rescue' and (storage.foldername(name))[1] = (select private.my_household())::text and (select private.my_role()) = 'family');
create policy rescue_photos_family_update on storage.objects for update to authenticated
  using (bucket_id = 'rescue' and (storage.foldername(name))[1] = (select private.my_household())::text and (select private.my_role()) = 'family');
create policy rescue_photos_family_delete on storage.objects for delete to authenticated
  using (bucket_id = 'rescue' and (storage.foldername(name))[1] = (select private.my_household())::text and (select private.my_role()) = 'family');
