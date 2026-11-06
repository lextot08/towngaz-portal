-- Daily Sales Report: the Gcash of a day can also be typed (for example a debt from before the
-- system paid through Gcash). The typed amount is added to the Gcash of the Daily Sales Log, and the
-- Monthly Sales Report adds it up.
-- Needs supabase/daily_report.sql (run).
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- To undo: run supabase/revert_daily_gcash.sql

-- 1. A typed number can now be the Gcash
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.daily_entries'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%key%'
  loop
    execute format('alter table public.daily_entries drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.daily_entries
  add constraint daily_entries_key_check check (key in ('benta', 'df', 'deposit', 'add', 'gcash'));

-- 2. Saving it (the staff of the branch, or the admin)
create or replace function public.set_daily_entry(p_day date, p_branch smallint, p_key text, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  labels jsonb := '{"benta": "Benta Tanke", "df": "DF", "deposit": "Deposit", "add": "Add Tanke", "gcash": "Gcash (typed)"}';
begin
  if not (public.is_admin() or coalesce(public.staff_branch() = p_branch, false)) then
    raise exception 'You can only edit the Daily Sales Report of your own branch';
  end if;
  if p_day is null or p_day > (now() at time zone 'Asia/Manila')::date then
    raise exception 'You cannot change a future date';
  end if;
  if p_key not in ('benta', 'df', 'deposit', 'add', 'gcash') then
    raise exception 'Invalid column';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'The amount cannot be negative';
  end if;

  if p_amount is null then
    delete from public.daily_entries where day = p_day and branch = p_branch and key = p_key;
  else
    insert into public.daily_entries (day, branch, key, amount)
    values (p_day, p_branch, p_key, p_amount)
    on conflict (day, branch, key)
    do update set amount = excluded.amount, updated_by = auth.uid(), updated_at = now();
  end if;

  perform public.log_staff_activity(
    p_branch, 'Edited daily sales report',
    (labels ->> p_key) || ' (' || p_day::text || '): '
      || coalesce('₱' || to_char(p_amount, 'FM999,999,990.00'), 'cleared')
  );
end;
$$;
