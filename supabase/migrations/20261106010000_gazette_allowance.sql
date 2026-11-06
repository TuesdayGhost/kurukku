-- 鳩月報の生成を、許可した家だけ・月ごとの回数まで（11/6 外部レビュー）
-- 誰でも新規登録して自分の家を作れるため、家族の権限だけでは Claude API の費用を守れない。
-- 許可と回数は private スキーマに置き、利用者（API）からは読めない・書き換えられないようにする。

create table private.gazette_allowance (
  household_id uuid primary key references public.households (id) on delete cascade,
  monthly_limit int not null default 20 check (monthly_limit >= 0),
  note text,
  created_at timestamptz not null default now()
);

create table private.gazette_usage (
  household_id uuid not null references public.households (id) on delete cascade,
  period date not null,            -- 日本時間の月初め
  used int not null default 0,
  primary key (household_id, period)
);

revoke all on private.gazette_allowance, private.gazette_usage from public, anon, authenticated;

-- 鳩月報を作る前に Edge Function から呼ぶ。1回分を使い、残りの回数を返す。
-- 許可のない家・家族でない人・回数の上限は、例外で断る（このとき回数は増えない）。
-- 同時に呼ばれても、行の更新はひとつずつ行われるので、上限を超えて通ることはない。
create function public.gazette_claim()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid := (select private.my_household());
  lim int;
  n int;
  per date := date_trunc('month', now() at time zone 'Asia/Tokyo')::date;
begin
  if hid is null or (select private.my_role()) is distinct from 'family' then
    raise exception 'gazette_not_family' using errcode = '42501';
  end if;
  select monthly_limit into lim from private.gazette_allowance where household_id = hid;
  if lim is null then
    raise exception 'gazette_not_allowed' using errcode = '42501';
  end if;
  insert into private.gazette_usage as u (household_id, period, used) values (hid, per, 1)
    on conflict (household_id, period) do update set used = u.used + 1 where u.used < lim
    returning u.used into n;
  if n is null or n > lim then
    raise exception 'gazette_limit' using errcode = 'P0001';
  end if;
  return lim - n;
end;
$$;

revoke all on function public.gazette_claim() from public, anon;
grant execute on function public.gazette_claim() to authenticated;
