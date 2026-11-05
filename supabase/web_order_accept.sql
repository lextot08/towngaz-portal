-- Website orders wait for the staff again: Accept or Reject in the Daily Sales Log.
--   * A website order is "pending" (Waiting for staff): the stock is checked but not taken.
--   * Accept: the stock goes down at that moment, and the order goes out for delivery.
--   * Reject: the order is cancelled (the customer sees "Cancelled"); the stock is not touched.
-- Orders added by the staff in the Daily Sales Log are not changed.
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- To undo (website orders accepted at once again): run supabase/revert_web_order_accept.sql

-- 1. A website order: waiting for the staff, the stock is not taken yet
create or replace function public.place_order(p_branch smallint, p_item_name text, p_quantity integer, p_name text, p_address text, p_contact text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  s public.stock;
  ctype text;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'approved';
  if not found then raise exception 'Account not approved'; end if;
  if me.role <> 'customer' then raise exception 'Only customers can place orders'; end if;

  if p_name is null or trim(p_name) = '' then raise exception 'Full name is required'; end if;
  if p_address is null or trim(p_address) = '' then raise exception 'Address is required'; end if;
  if p_contact is null or trim(p_contact) = '' then raise exception 'Contact number is required'; end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be a whole number of at least 1';
  end if;

  ctype := coalesce(me.customer_type, 'household');

  select * into s from public.stock where branch = p_branch and item_name = p_item_name;
  if not found then raise exception 'Item not found in that branch'; end if;
  if s.quantity < p_quantity then raise exception 'Not enough stock'; end if;

  insert into public.orders
    (customer_id, branch, item_name, quantity, unit_price, discount, customer_type,
     customer_name, customer_address, customer_contact, status)
  values
    (auth.uid(), p_branch, p_item_name, p_quantity, s.price, 0, ctype,
     trim(p_name), trim(p_address), trim(p_contact), 'pending');
end;
$$;

-- 2. Accept: the stock goes down now (the Stock Inventory counts the order on this day), and a
--    website order goes out for delivery. The staff of the branch, or the admin.
create or replace function public.accept_order(p_order_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (public.is_admin() or coalesce(public.staff_branch() = o.branch, false)) then
    raise exception 'You can only accept the orders of your own branch';
  end if;
  if o.status <> 'pending' then raise exception 'This order was already accepted or rejected'; end if;

  update public.stock set quantity = quantity - o.quantity
  where branch = o.branch and item_name = o.item_name and quantity >= o.quantity;
  if not found then raise exception 'Not enough stock to accept this order'; end if;

  update public.orders
  set status = 'accepted',
      delivery_status = case when o.customer_id is not null then 'out_for_delivery' else 'preparing' end,
      accepted_at = now()
  where id = o.id;

  perform public.log_staff_activity(
    o.branch, 'Accepted order',
    'Order #' || o.id::text || ': ' || o.quantity::text || ' x ' || o.item_name
      || ' for ' || coalesce(o.customer_name, 'customer')
  );

  perform public.check_restock(o.branch, replace(o.item_name, 'LPG Cylinder ', ''));
end;
$$;

-- 3. Reject: the order is cancelled; nothing was taken from the stock
create or replace function public.reject_order(p_order_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (public.is_admin() or coalesce(public.staff_branch() = o.branch, false)) then
    raise exception 'You can only reject the orders of your own branch';
  end if;
  if o.status <> 'pending' then raise exception 'This order was already accepted or rejected'; end if;

  update public.orders set status = 'cancelled' where id = o.id;

  perform public.log_staff_activity(
    o.branch, 'Rejected order',
    'Order #' || o.id::text || ': ' || o.quantity::text || ' x ' || o.item_name
      || ' for ' || coalesce(o.customer_name, 'customer')
  );
end;
$$;

revoke all on function public.reject_order(bigint) from public;
grant execute on function public.reject_order(bigint) to authenticated;
