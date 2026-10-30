-- Monthly Sales Report:
-- 1. monthly_entries: the numbers the admin types for a month
--    per branch:        deposit, benta (Benta Tanke), add (Add Tanke)
--    whole company (0): nawa (Nawa / Unwind collectibles), bivmc_purchases, t1, t2, t3 (target kg)
-- 2. monthly_receipts: the filled tanks received in a month (Incoming + Refill of the Stock
--    Inventory), per branch and size, for the BIVMC Receipts column.
-- Nothing in the Stock Inventory is changed.
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- To undo: run supabase/revert_monthly_report.sql

create table if not exists public.monthly_entries (
  month date not null,               -- the 1st day of the month
  branch smallint not null default 0 check (branch >= 0 and branch <= 7), -- 0 = whole company
  key text not null check (key in ('deposit', 'benta', 'add', 'nawa', 'bivmc_purchases', 't1', 't2', 't3')),
  amount numeric not null,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (month, branch, key)
);

-- The admin sees every number; the staff see the numbers of their own branch (read only).
alter table public.monthly_entries enable row level security;

drop policy if exists monthly_entries_read on public.monthly_entries;
create policy monthly_entries_read on public.monthly_entries
  for select
  to authenticated
  using (public.is_admin() or coalesce(public.staff_branch() = monthly_entries.branch, false));

grant select on public.monthly_entries to authenticated;

-- Save one typed number (admin only). An empty number (null) removes it.
create or replace function public.set_monthly_entry(p_month date, p_branch smallint, p_key text, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only the admin can edit the Monthly Sales Report';
  end if;

  if p_amount is null then
    delete from public.monthly_entries
    where month = date_trunc('month', p_month)::date and branch = p_branch and key = p_key;
  else
    insert into public.monthly_entries (month, branch, key, amount)
    values (date_trunc('month', p_month)::date, p_branch, p_key, p_amount)
    on conflict (month, branch, key)
    do update set amount = excluded.amount, updated_by = auth.uid(), updated_at = now();
  end if;
end;
$$;

revoke all on function public.set_monthly_entry(date, smallint, text, numeric) from public;
grant execute on function public.set_monthly_entry(date, smallint, text, numeric) to authenticated;

-- Filled tanks received from p_from to p_to (Incoming + Refill), per branch and size (admin only)
create or replace function public.monthly_receipts(p_from timestamptz, p_to timestamptz)
returns table(branch smallint, size text, quantity integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Not allowed';
  end if;

  return query
  select b.id::smallint,
         s.size,
         (public.incoming_between(b.id::smallint, s.size, p_from, p_to)
          + public.refill_between(b.id::smallint, s.size, p_from, p_to))::integer
  from generate_series(1, 7) as b(id)
  cross join (select distinct lp.size from public.lpg_prices lp) as s;
end;
$$;

revoke all on function public.monthly_receipts(timestamptz, timestamptz) from public;
grant execute on function public.monthly_receipts(timestamptz, timestamptz) to authenticated;
