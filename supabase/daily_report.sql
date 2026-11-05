-- Daily Sales Report: the numbers the staff type for each day of their branch
--   benta (Benta Tanke), df (delivery fee), deposit, add (Add Tanke)
-- The Monthly Sales Report adds them up for the month (Deposit, Benta Tanke, Add Tanke).
-- Nothing in the Stock Inventory or the Daily Sales Log is changed.
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- To undo: run supabase/revert_daily_report.sql

create table if not exists public.daily_entries (
  day date not null,
  branch smallint not null check (branch >= 1 and branch <= 7),
  key text not null check (key in ('benta', 'df', 'deposit', 'add')),
  amount numeric not null check (amount >= 0),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (day, branch, key)
);

create index if not exists daily_entries_branch_day on public.daily_entries (branch, day);

-- The admin sees every branch; the staff see their own branch. Changes go through the function below.
alter table public.daily_entries enable row level security;

drop policy if exists daily_entries_read on public.daily_entries;
create policy daily_entries_read on public.daily_entries
  for select
  to authenticated
  using (public.is_admin() or coalesce(public.staff_branch() = daily_entries.branch, false));

grant select on public.daily_entries to authenticated;

-- Save one typed number: the staff of the branch, or the admin. An empty number (null) removes it.
create or replace function public.set_daily_entry(p_day date, p_branch smallint, p_key text, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  labels jsonb := '{"benta": "Benta Tanke", "df": "DF", "deposit": "Deposit", "add": "Add Tanke"}';
begin
  if not (public.is_admin() or coalesce(public.staff_branch() = p_branch, false)) then
    raise exception 'You can only edit the Daily Sales Report of your own branch';
  end if;
  if p_day is null or p_day > (now() at time zone 'Asia/Manila')::date then
    raise exception 'You cannot change a future date';
  end if;
  if p_key not in ('benta', 'df', 'deposit', 'add') then
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

revoke all on function public.set_daily_entry(date, smallint, text, numeric) from public;
grant execute on function public.set_daily_entry(date, smallint, text, numeric) to authenticated;
