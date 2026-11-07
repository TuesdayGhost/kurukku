-- 予定を本人のふだんの画面に出すか（11/4 決定）
-- ごはん・お薬は「お知らせのときだけ」出し、ふだんの画面はその日の大事な予定だけにする。
-- 家族の画面（今日・予定一覧）にはすべての予定を出す。
alter table public.schedules add column show_on_home boolean not null default true;

-- 既存のごはん・お薬は、決定に合わせて「お知らせのときだけ」にする
update public.schedules set show_on_home = false where title ~ '(ごはん|食事|薬)';
