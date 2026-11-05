-- Borrowed tanks per order: how many tanks of an order the customer kept (for example 5 sold,
-- 3 borrowed). Typed in Customer Profile (Borrowed column). The Remark "Borrowed" of the Daily
-- Sales Log still means all the tanks of the order, until a number is typed.
--   borrowed_qty: null = all the tanks of the order (when Borrowed), otherwise the number typed.
-- The EMPTIES Variance (Borrowed), the Borrowed page and the Tanks Count use this number.
-- Needs supabase/borrowed_gcash.sql and supabase/tank_returns.sql (both run).
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- To undo: run supabase/revert_borrowed_qty.sql

alter table public.orders add column if not exists borrowed_qty integer;

-- the borrowed tanks of an order
create or replace function public.borrowed_of(o public.orders)
returns integer
language sql
immutable
as $$
  select case when o.borrowed_tank then coalesce(o.borrowed_qty, o.quantity) else 0 end;
$$;

-- 1. Type how many tanks of an order are borrowed (0 = none, all = the whole order)
create or replace function public.set_borrowed_qty(p_order_id bigint, p_qty integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  given_back integer;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (public.is_admin() or coalesce(public.staff_branch() = o.branch, false)) then
    raise exception 'You can only change the orders of your own branch';
  end if;
  if p_qty is null or p_qty < 0 then raise exception 'Type a number from 0 to %', o.quantity; end if;
  if p_qty > o.quantity then
    raise exception 'Only % tanks were sold in this order', o.quantity;
  end if;

  select coalesce(sum(quantity), 0) into given_back from public.tank_returns where order_id = o.id;
  if p_qty < given_back then
    raise exception '% of these tanks were already returned (Borrowed page): the number cannot be lower', given_back;
  end if;

  update public.orders
  set borrowed_tank = p_qty > 0,
      borrowed_qty = case when p_qty > 0 and p_qty < o.quantity then p_qty end
  where id = o.id;

  perform public.log_staff_activity(
    o.branch, 'Changed borrowed tanks',
    'Order #' || o.id::text || ' (' || o.item_name || ') for ' || coalesce(o.customer_name, 'customer')
      || ': ' || public.borrowed_of(o)::text || ' -> ' || p_qty::text || ' borrowed'
  );
end;
$$;

revoke all on function public.set_borrowed_qty(bigint, integer) from public;
grant execute on function public.set_borrowed_qty(bigint, integer) to authenticated;

-- 2. The Remark "Borrowed" turned on or off in the Daily Sales Log: all the tanks again
create or replace function public.reset_borrowed_qty()
returns trigger
language plpgsql
as $$
begin
  if new.borrowed_tank is distinct from old.borrowed_tank then
    new.borrowed_qty := null;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_reset_borrowed_qty on public.orders;
create trigger orders_reset_borrowed_qty
  before update of borrowed_tank on public.orders
  for each row execute function public.reset_borrowed_qty();

-- 3. EMPTIES Variance (Borrowed): the borrowed tanks of the day's orders
create or replace function public.utang_sold_between(p_branch smallint, p_size text, p_from timestamptz, p_to timestamptz)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(public.borrowed_of(od)), 0)::integer
  from public.orders od
  where od.branch = p_branch
    and od.item_name = 'LPG Cylinder ' || p_size
    and od.status = 'accepted'
    and od.borrowed_tank
    and od.accepted_at >= p_from
    and od.accepted_at < p_to;
$$;

-- 4. Returned tanks: never more than the borrowed tanks of the order
create or replace function public.record_tank_return(p_order_id bigint, p_quantity integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_branch smallint := public.staff_branch();
  o public.orders;
  given_back integer;
begin
  if my_branch is null then raise exception 'Only approved staff can record returns'; end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be a whole number of at least 1';
  end if;

  select * into o from public.orders where id = p_order_id and branch = my_branch for update;
  if not found then raise exception 'Order not found'; end if;
  if not o.borrowed_tank then raise exception 'This order has no borrowed tank'; end if;

  select coalesce(sum(quantity), 0) into given_back from public.tank_returns where order_id = o.id;
  if given_back + p_quantity > public.borrowed_of(o) then
    raise exception 'Only % of this size is still borrowed', public.borrowed_of(o) - given_back;
  end if;

  insert into public.tank_returns (order_id, branch, size, quantity)
  values (o.id, o.branch, replace(o.item_name, 'LPG Cylinder ', ''), p_quantity);

  perform public.log_staff_activity(
    my_branch, 'Recorded returned tank',
    p_quantity::text || ' x ' || o.item_name || ' from ' || coalesce(o.customer_name, 'customer')
      || ' (order #' || o.id::text || ')'
  );
end;
$$;
