-- くるっくー：最初のデータの土台
-- 家（household）単位でデータを分け、ログインした利用者の役割で読み書きを制限する。
--   family  : 家族のスマホ等。すべて管理できる
--   living  : 居間の端末。見る＋予定の追加だけ
--   display : 父の部屋の端末。見るだけ（通知表示・鳩タップの履歴だけ書ける）
-- 時刻（time 型）はすべて家のタイムゾーン（既定 Asia/Tokyo）で解釈する。

create schema if not exists private;

-- ========== 家と利用者 ==========
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Tokyo',
  created_at timestamptz not null default now()
);

create table public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  role text not null check (role in ('family', 'living', 'display')),
  display_name text not null,           -- 例：葵依、鳩A／父の部屋
  created_at timestamptz not null default now()
);
create index on public.members (household_id);

-- RLS から使う補助関数（API に公開しない private スキーマに置く）
create or replace function private.my_household() returns uuid
language sql stable security definer set search_path = '' as $$
  select household_id from public.members where user_id = auth.uid()
$$;

create or replace function private.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.members where user_id = auth.uid()
$$;

grant usage on schema private to authenticated;
grant execute on function private.my_household(), private.my_role() to authenticated;

-- 予定を表示する人（父・母・葵依など）
create table public.people (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default private.my_household() references public.households (id) on delete cascade,
  name text not null,
  is_patient boolean not null default false,   -- 本人（父）か
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.people (household_id);

-- ========== 予定 ==========
-- kind = 'once'   : date の一日だけ
-- kind = 'weekly' : weekdays（0=日〜6=土）に繰り返し。valid_from〜valid_until の間だけ有効
-- 「今後の繰り返しを変える」は、古い予定の valid_until を締めて新しい予定を作る。
-- 「この日だけ変える」は schedule_exceptions で取り消し、replaces_schedule_id 付きの once を作る。
create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default private.my_household() references public.households (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  title text not null,                     -- 例：お昼ごはん、デイ、買い物
  display_text text,                       -- 本人向けの表示文（空なら title を使う）
  kind text not null check (kind in ('once', 'weekly')),
  on_date date,                            -- once のとき
  weekdays smallint[],                     -- weekly のとき
  valid_from date,
  valid_until date,
  start_time time,                         -- 予定の時刻（空なら時刻なし）
  end_time time,                           -- 戻る予定・終わる時刻（空なら未定）
  notify_from time,                        -- お知らせ開始（空なら通知しない）
  notify_until time,                       -- お知らせ終了
  notify_sound boolean not null default true,
  family_memo text,                        -- 家族用メモ。本人画面には出さない
  memo_for_gazette boolean not null default false,  -- 月報に使ってよいか
  replaces_schedule_id uuid references public.schedules (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedules_once_has_date check (kind <> 'once' or on_date is not null),
  constraint schedules_weekly_has_days check (
    kind <> 'weekly' or (weekdays is not null and cardinality(weekdays) > 0 and weekdays <@ array[0,1,2,3,4,5,6]::smallint[])
  ),
  constraint schedules_notify_pair check ((notify_from is null) = (notify_until is null))
);
create index on public.schedules (household_id, kind);
create index on public.schedules (household_id, on_date);

-- 繰り返し予定のうち、特定の日だけ中止
create table public.schedule_exceptions (
  schedule_id uuid not null references public.schedules (id) on delete cascade,
  on_date date not null,
  household_id uuid not null default private.my_household() references public.households (id) on delete cascade,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (schedule_id, on_date)
);

-- ========== 家族からの短い知らせ ==========
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null default private.my_household() references public.households (id) on delete cascade,
  person_id uuid references public.people (id) on delete set null,  -- 誰からの知らせか
  body text not null check (char_length(body) between 1 and 200),
  show_from timestamptz not null default now(),
  show_until timestamptz not null,
  with_sound boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.messages (household_id, show_until);

-- ========== 履歴（鳩月報の材料） ==========
-- kind の例：schedule_created / schedule_cancelled / message_sent /
--            notification_shown / pigeon_tapped / rescue_card_opened
-- dedupe_key：同じ出来事を二重に数えないための鍵。
--   通知は 'notify:<schedule_id>:<日付>' とし、複数端末・再読込でも1件になる。
--   鳩タップは鍵なし（押した回数そのものを数える）。
create table public.activity_log (
  id bigint generated always as identity primary key,
  household_id uuid not null default private.my_household() references public.households (id) on delete cascade,
  kind text not null,
  occurred_at timestamptz not null default now(),
  actor uuid default auth.uid() references auth.users (id) on delete set null,
  ref_table text,
  ref_id uuid,
  ref_date date,
  dedupe_key text,
  payload jsonb not null default '{}'::jsonb,
  unique (household_id, dedupe_key)
);
create index on public.activity_log (household_id, occurred_at);

-- ========== updated_at ==========
create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger schedules_touch before update on public.schedules
  for each row execute function private.touch_updated_at();

-- ========== 保存と同時に履歴を残す ==========
create or replace function private.log_schedule_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.activity_log (household_id, kind, actor, ref_table, ref_id, ref_date, payload)
  values (new.household_id, 'schedule_created', new.created_by, 'schedules', new.id, new.on_date,
          jsonb_build_object('title', new.title, 'kind', new.kind, 'person_id', new.person_id));
  return new;
end $$;
create trigger schedules_log after insert on public.schedules
  for each row execute function private.log_schedule_created();

create or replace function private.log_schedule_cancelled() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.activity_log (household_id, kind, actor, ref_table, ref_id, ref_date)
  values (new.household_id, 'schedule_cancelled', new.created_by, 'schedules', new.schedule_id, new.on_date);
  return new;
end $$;
create trigger schedule_exceptions_log after insert on public.schedule_exceptions
  for each row execute function private.log_schedule_cancelled();

create or replace function private.log_message_sent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.activity_log (household_id, kind, actor, ref_table, ref_id, occurred_at)
  values (new.household_id, 'message_sent', new.created_by, 'messages', new.id, new.created_at);
  return new;
end $$;
create trigger messages_log after insert on public.messages
  for each row execute function private.log_message_sent();

-- ========== 行レベルセキュリティ ==========
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.people enable row level security;
alter table public.schedules enable row level security;
alter table public.schedule_exceptions enable row level security;
alter table public.messages enable row level security;
alter table public.activity_log enable row level security;

-- 見る：同じ家の利用者なら誰でも
create policy households_read on public.households for select to authenticated
  using (id = (select private.my_household()));
create policy members_read on public.members for select to authenticated
  using (household_id = (select private.my_household()));
create policy people_read on public.people for select to authenticated
  using (household_id = (select private.my_household()));
create policy schedules_read on public.schedules for select to authenticated
  using (household_id = (select private.my_household()));
create policy exceptions_read on public.schedule_exceptions for select to authenticated
  using (household_id = (select private.my_household()));
create policy messages_read on public.messages for select to authenticated
  using (household_id = (select private.my_household()));
-- 履歴を読めるのは家族だけ
create policy activity_read on public.activity_log for select to authenticated
  using (household_id = (select private.my_household()) and (select private.my_role()) = 'family');

-- 書く：家族
create policy households_family_update on public.households for update to authenticated
  using (id = (select private.my_household()) and (select private.my_role()) = 'family');
create policy people_family_write on public.people for all to authenticated
  using (household_id = (select private.my_household()) and (select private.my_role()) = 'family')
  with check (household_id = (select private.my_household()) and (select private.my_role()) = 'family');
create policy schedules_family_write on public.schedules for all to authenticated
  using (household_id = (select private.my_household()) and (select private.my_role()) = 'family')
  with check (household_id = (select private.my_household()) and (select private.my_role()) = 'family');
create policy exceptions_family_write on public.schedule_exceptions for all to authenticated
  using (household_id = (select private.my_household()) and (select private.my_role()) = 'family')
  with check (household_id = (select private.my_household()) and (select private.my_role()) = 'family');
create policy messages_family_write on public.messages for all to authenticated
  using (household_id = (select private.my_household()) and (select private.my_role()) = 'family')
  with check (household_id = (select private.my_household()) and (select private.my_role()) = 'family');

-- 書く：居間の端末は予定の「追加」だけ
create policy schedules_living_insert on public.schedules for insert to authenticated
  with check (household_id = (select private.my_household()) and (select private.my_role()) = 'living');

-- 書く：履歴。家族は何でも、端末は通知表示と鳩タップだけ
create policy activity_insert on public.activity_log for insert to authenticated
  with check (
    household_id = (select private.my_household())
    and (
      (select private.my_role()) = 'family'
      or kind in ('notification_shown', 'pigeon_tapped')
    )
  );

-- 最初の家族が家を作るための関数（まだどの家にも属していない人だけ）
create or replace function public.create_household(household_name text, my_name text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'すでに家に登録されています';
  end if;
  insert into public.households (name) values (household_name) returning id into hid;
  insert into public.members (user_id, household_id, role, display_name)
    values (auth.uid(), hid, 'family', my_name);
  return hid;
end $$;
revoke execute on function public.create_household(text, text) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;

-- ========== 端末間の同期（Realtime） ==========
alter publication supabase_realtime add table public.schedules, public.schedule_exceptions, public.messages, public.people;
