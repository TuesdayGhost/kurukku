-- 予定の読み上げボタン（11/5 決定）
-- 父が文字を読めなくなっても、お知らせを聞き逃しても、知りたいときに自分で聞けるように。
-- 父の部屋のタブレットはよく触るので、端末ごとに出す・出さないを家族が切り替える（初期値：居間は出す、父の部屋は出さない）。
alter table public.households
  add column read_button_living boolean not null default true,
  add column read_button_display boolean not null default false;

-- 押した記録（鳩月報の材料）を表示端末からも残せるようにする
drop policy activity_insert on public.activity_log;
create policy activity_insert on public.activity_log for insert to authenticated
  with check (
    household_id = (select private.my_household())
    and (
      (select private.my_role()) = 'family'
      or kind in ('notification_shown', 'pigeon_tapped', 'read_aloud')
    )
  );
