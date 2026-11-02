-- 招待コード：家族が端末（鳩A／父の部屋など）や他の家族を家に登録するための短いコード
create table public.invites (
  code text primary key default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  household_id uuid not null default private.my_household() references public.households (id) on delete cascade,
  role text not null check (role in ('family', 'living', 'display')),
  display_name text not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 day',
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz
);
create index on public.invites (household_id);

alter table public.invites enable row level security;
create policy invites_family on public.invites for all to authenticated
  using (household_id = (select private.my_household()) and (select private.my_role()) = 'family')
  with check (household_id = (select private.my_household()) and (select private.my_role()) = 'family');

-- コードを使って家に参加する（まだどの家にも属していない人だけ）
create or replace function public.join_household(invite_code text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invites;
begin
  if auth.uid() is null then
    raise exception 'ログインが必要です';
  end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'すでに家に登録されています';
  end if;
  select * into inv from public.invites
   where code = upper(trim(invite_code)) and used_by is null and expires_at > now()
   for update;
  if not found then
    raise exception '招待コードが見つからないか、期限切れです';
  end if;
  insert into public.members (user_id, household_id, role, display_name)
    values (auth.uid(), inv.household_id, inv.role, inv.display_name);
  update public.invites set used_by = auth.uid(), used_at = now() where code = inv.code;
  return inv.role;
end $$;
revoke execute on function public.join_household(text) from public, anon;
grant execute on function public.join_household(text) to authenticated;
