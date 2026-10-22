-- Undo supabase/delivery_remarks.sql: website orders wait for the staff again, and the
-- Delivered / Thru Gcash remarks are removed (the Gcash marks are lost).
-- Run in Supabase: Dashboard > SQL Editor > New query > paste > Run.

-- copied unchanged from supabase/backup_before_calculations.sql

CREATE OR REPLACE FUNCTION public.place_order(p_branch smallint, p_item_name text, p_quantity integer, p_name text, p_address text, p_contact text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     customer_name, customer_address, customer_contact)
  values
    (auth.uid(), p_branch, p_item_name, p_quantity, s.price, 0, ctype,
     trim(p_name), trim(p_address), trim(p_contact));
end;
$function$
;

drop function if exists public.set_order_remarks(bigint[], text, boolean, boolean);
alter table public.orders drop column if exists paid_gcash;
