-- Undo supabase/web_order_accept.sql: website orders are accepted at once again (stock taken,
-- out for delivery), accept_order is as before, and reject_order is removed.

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

  select * into s from public.stock where branch = p_branch and item_name = p_item_name for update;
  if not found then raise exception 'Item not found in that branch'; end if;
  if s.quantity < p_quantity then raise exception 'Not enough stock'; end if;

  update public.stock set quantity = quantity - p_quantity where id = s.id;

  insert into public.orders
    (customer_id, branch, item_name, quantity, unit_price, discount, customer_type,
     customer_name, customer_address, customer_contact,
     status, delivery_status, accepted_at)
  values
    (auth.uid(), p_branch, p_item_name, p_quantity, s.price, 0, ctype,
     trim(p_name), trim(p_address), trim(p_contact),
     'accepted', 'out_for_delivery', now());

  perform public.check_restock(p_branch, replace(p_item_name, 'LPG Cylinder ', ''));
end;
$$;

CREATE OR REPLACE FUNCTION public.accept_order(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_branch smallint := public.staff_branch();
  o public.orders;
begin
  if my_branch is null then raise exception 'Only approved staff can accept orders'; end if;

  select * into o from public.orders
  where id = p_order_id and branch = my_branch for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'pending' then raise exception 'Order was already accepted'; end if;

  update public.stock set quantity = quantity - o.quantity
  where branch = o.branch and item_name = o.item_name and quantity >= o.quantity;
  if not found then raise exception 'Not enough stock to accept this order'; end if;

  update public.orders
  set status = 'accepted', delivery_status = 'preparing', accepted_at = now()
  where id = o.id;

  perform public.log_staff_activity(
    my_branch, 'Accepted order',
    'Order #' || o.id::text || ': ' || o.quantity::text || ' x ' || o.item_name
      || ' for ' || coalesce(o.customer_name, 'customer')
  );

  perform public.check_restock(o.branch, replace(o.item_name, 'LPG Cylinder ', ''));
end;
$function$
;

drop function if exists public.reject_order(bigint);
