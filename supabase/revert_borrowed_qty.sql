-- Undo supabase/borrowed_qty.sql: Borrowed means all the tanks of an order again (the typed numbers
-- are deleted). (Copied from supabase/borrowed_gcash.sql and supabase/tank_returns.sql.)

drop trigger if exists orders_reset_borrowed_qty on public.orders;
drop function if exists public.reset_borrowed_qty();
drop function if exists public.set_borrowed_qty(bigint, integer);

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
  if given_back + p_quantity > o.quantity then
    raise exception 'Only % of this size is still borrowed', o.quantity - given_back;
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

drop function if exists public.borrowed_of(public.orders);
alter table public.orders drop column if exists borrowed_qty;
