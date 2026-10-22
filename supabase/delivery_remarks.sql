-- Website orders no longer wait for the staff, and the Remark column gets Delivered and Thru Gcash.
--   * An order from the customer website is accepted at once: the stock goes down right away
--     and its delivery status is "out_for_delivery".
--   * Remark "Delivered" sets the delivery status to "delivered"; "Thru Gcash" marks how it was paid.
--     A row can have several remarks at once (for example Utang + Delivered).
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- To undo: run supabase/revert_delivery_remarks.sql

-- 1. Paid through Gcash (a remark of the Daily Sales Report)
alter table public.orders add column if not exists paid_gcash boolean not null default false;

-- 2. A website order: accepted right away, taken from the stock, out for delivery
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

-- 3. The Remark of a row (one order, or all sizes of a multiple order):
--    Utang / Bayad Utang (or none), Delivered (yes/no), Thru Gcash (yes/no).
--    Allowed for approved staff of that branch, and for the admin.
create or replace function public.set_order_remarks(p_order_ids bigint[], p_utang text, p_delivered boolean, p_gcash boolean)
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

revoke all on function public.set_order_remarks(bigint[], text, boolean, boolean) from public;
grant execute on function public.set_order_remarks(bigint[], text, boolean, boolean) to authenticated;
