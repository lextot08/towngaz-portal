-- Remarks of the Daily Sales Report, new meanings:
--   Utang        = money lent (the customer pays later): not counted in the Gross Sale
--   Bayad Utang  = that money was paid
--   Borrowed     = the customer kept the TANK (no empty given back): the Borrowed list,
--                  the EMPTIES Variance and REMARKS > Borrowed of the Stock Inventory
--   Thru Gcash   = paid through Gcash: not in the Gross Sale, in the Gcash column instead
--   Delivered    = (unchanged)
-- Needs supabase/delivery_remarks.sql and supabase/inventory_variance.sql (both run).
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- To undo: run supabase/revert_borrowed_gcash.sql

-- 1. Borrowed tank (its own mark: an order can be Utang and Borrowed at the same time)
alter table public.orders add column if not exists borrowed_tank boolean not null default false;

-- 2. The orders marked "Utang" so far meant a borrowed tank: they become Borrowed.
--    (Orders marked "Bayad Utang" so far meant the tank came back: that mark is cleared.)
update public.orders set borrowed_tank = true, utang_status = null where utang_status = 'utang';
update public.orders set utang_status = null where utang_status = 'bayad_utang';

-- 3. The Remark of a row: Utang / Bayad Utang (or none), Borrowed, Delivered, Thru Gcash
drop function if exists public.set_order_remarks(bigint[], text, boolean, boolean);
create or replace function public.set_order_remarks(p_order_ids bigint[], p_utang text, p_borrowed boolean, p_delivered boolean, p_gcash boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_utang is not null and p_utang not in ('utang', 'bayad_utang') then
    raise exception 'Remark must be Utang or Bayad Utang';
  end if;

  update orders o
  set utang_status = p_utang,
      borrowed_tank = coalesce(p_borrowed, false),
      paid_gcash = coalesce(p_gcash, false),
      delivery_status = case
        when coalesce(p_delivered, false) then 'delivered'
        when o.delivery_status = 'delivered' then
          case when o.customer_id is not null then 'out_for_delivery' else 'preparing' end
        else o.delivery_status
      end
  where o.id = any (p_order_ids)
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.status = 'approved'
        and (p.role = 'admin' or (p.role = 'staff' and p.branch = o.branch))
    );

  if not found then
    raise exception 'You are not allowed to change the remark of this order';
  end if;
end;
$$;

revoke all on function public.set_order_remarks(bigint[], text, boolean, boolean, boolean) from public;
grant execute on function public.set_order_remarks(bigint[], text, boolean, boolean, boolean) to authenticated;

-- 4. The EMPTIES: the tanks the customer kept are now the orders marked Borrowed
--    (same name as before, so the inventory functions keep working)
create or replace function public.utang_sold_between(p_branch smallint, p_size text, p_from timestamptz, p_to timestamptz)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(od.quantity), 0)::integer
  from public.orders od
  where od.branch = p_branch
    and od.item_name = 'LPG Cylinder ' || p_size
    and od.status = 'accepted'
    and od.borrowed_tank
    and od.accepted_at >= p_from
    and od.accepted_at < p_to;
$$;
