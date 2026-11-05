-- Daily Sales Log: Other Income can be Cash or Gcash.
--   Cash: added to the Gross (as before). Gcash: added to the Gcash column instead (like the
--   orders marked Thru Gcash).
-- Needs supabase/other_income.sql (run).
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- To undo: run supabase/revert_other_income_gcash.sql

alter table public.orders add column if not exists other_income_gcash boolean not null default false;

-- Save the Other Income of a row (one order, or all sizes of a multiple order), with Cash or Gcash:
-- the staff of that branch, or the admin
create or replace function public.set_order_other_income(p_order_ids bigint[], p_text text, p_gcash boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders o
  set other_income = nullif(trim(coalesce(p_text, '')), ''),
      other_income_gcash = coalesce(p_gcash, false)
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

revoke all on function public.set_order_other_income(bigint[], text, boolean) from public;
grant execute on function public.set_order_other_income(bigint[], text, boolean) to authenticated;
