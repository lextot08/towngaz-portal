-- Daily Sales Log: "Other Income" column (temporary). Extra money from another source, typed like
-- the Expenses ("load 50 tip 20" = 70). It is added to the Gross of the Daily Sales Report and the
-- Monthly Sales Report. Nothing else is changed.
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- To undo (the typed amounts are deleted too): run supabase/revert_other_income.sql

alter table public.orders add column if not exists other_income text;

-- Save the Other Income of a row (one order, or all sizes of a multiple order):
-- the staff of that branch, or the admin
create or replace function public.set_order_other_income(p_order_ids bigint[], p_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders o
  set other_income = nullif(trim(coalesce(p_text, '')), '')
  where o.id = any (p_order_ids)
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'approved'
        and (p.role = 'admin' or (p.role = 'staff' and p.branch = o.branch))
    );

  if not found then
    raise exception 'You are not allowed to change this order';
  end if;
end;
$$;

revoke all on function public.set_order_other_income(bigint[], text) from public;
grant execute on function public.set_order_other_income(bigint[], text) to authenticated;
