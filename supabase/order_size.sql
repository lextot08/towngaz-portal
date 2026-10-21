-- Daily Sales Report: change how many cylinders of a size a row (customer order) has.
--   * A size the row already has: its quantity is changed (0 removes that size).
--   * A size the row does not have yet: a new order for that size is added to the row
--     (same customer, time, type, remarks), so it stays ONE row in the report.
--   * Accepted orders take the cylinders from the stock (or give them back), on the day of the
--     order, so the Stock Inventory of that day stays right. Orders waiting for acceptance
--     do not touch the stock until they are accepted.
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- To undo: drop function if exists public.set_row_quantity(bigint[], text, integer);
-- (If orders.id is a uuid instead of a number, change bigint[] to uuid[] below.)

create or replace function public.set_row_quantity(p_order_ids bigint[], p_size text, p_quantity integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_branch smallint := public.staff_branch();
  item text := 'LPG Cylinder ' || p_size;
  base public.orders;
  existing public.orders;
  s public.stock;
  diff integer;
  grp uuid;
  new_id bigint;
  moved_at timestamptz;
begin
  if my_branch is null then raise exception 'Only approved staff can change orders'; end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception 'Quantity must be a whole number (0 or more)';
  end if;
  if not exists (select 1 from public.lpg_prices where size = p_size) then
    raise exception 'Invalid size';
  end if;
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'No order selected';
  end if;

  -- the first order of the row: its customer details are copied to a new size
  select * into base from public.orders
  where id = any (p_order_ids) and branch = my_branch
  order by id limit 1;
  if not found then raise exception 'Order not found'; end if;

  select * into existing from public.orders
  where id = any (p_order_ids) and branch = my_branch and item_name = item
  for update;

  -- ---- the row already has this size ----
  if found then
    diff := p_quantity - existing.quantity;
    if diff = 0 then return; end if;

    if p_quantity = 0 then
      if array_length(p_order_ids, 1) = 1 then
        raise exception 'This is the only size of the order. Use Delete to remove the whole order.';
      end if;
      perform public.delete_order(existing.id);
      return;
    end if;

    if coalesce(existing.discount, 0) >= p_quantity * existing.unit_price then
      raise exception 'The discount would be more than the new amount. Lower the discount first.';
    end if;

    if existing.status = 'accepted' then
      select * into s from public.stock where branch = my_branch and item_name = item for update;
      if not found then raise exception 'This size is not in stock'; end if;
      if diff > 0 and s.quantity < diff then
        raise exception 'Not enough stock for % (only % left)', p_size, s.quantity;
      end if;
      -- the stock change is dated on the day of the order
      moved_at := least(coalesce(existing.accepted_at, now()), now());
      perform set_config('towngaz.skip_movement', '1', true);
      update public.stock set quantity = quantity - diff where id = s.id;
      perform set_config('towngaz.skip_movement', '0', true);
      insert into public.stock_movements (branch, item_name, change, created_at, kind)
      values (my_branch, item, -diff, moved_at, 'normal');
    end if;

    update public.orders set quantity = p_quantity where id = existing.id;

    perform public.log_staff_activity(
      my_branch, 'Changed order quantity',
      'Order #' || existing.id::text || ' (' || item || ') for '
        || coalesce(existing.customer_name, 'customer') || ': '
        || existing.quantity::text || ' -> ' || p_quantity::text
    );
    perform public.check_restock(my_branch, p_size);
    return;
  end if;

  -- ---- a new size for this row ----
  if p_quantity = 0 then return; end if;

  select * into s from public.stock where branch = my_branch and item_name = item for update;
  if not found then raise exception '% is not in stock', p_size; end if;

  if base.status = 'accepted' then
    if s.quantity < p_quantity then
      raise exception 'Not enough stock for % (only % left)', p_size, s.quantity;
    end if;
    moved_at := least(coalesce(base.accepted_at, now()), now());
    perform set_config('towngaz.skip_movement', '1', true);
    update public.stock set quantity = quantity - p_quantity where id = s.id;
    perform set_config('towngaz.skip_movement', '0', true);
    insert into public.stock_movements (branch, item_name, change, created_at, kind)
    values (my_branch, item, -p_quantity, moved_at, 'normal');
  end if;

  -- the row becomes (or stays) a multiple order: all its sizes share one group
  grp := base.group_id;
  if grp is null then
    grp := gen_random_uuid();
    update public.orders set group_id = grp where id = any (p_order_ids) and branch = my_branch;
  end if;

  insert into public.orders
    (customer_id, branch, item_name, quantity, unit_price, discount, customer_type,
     customer_name, customer_address, customer_contact, remarks, utang_status,
     status, delivery_status, accepted_at, source, group_id, created_at)
  values
    (base.customer_id, my_branch, item, p_quantity, s.price, 0, base.customer_type,
     base.customer_name, base.customer_address, base.customer_contact, base.remarks, base.utang_status,
     base.status, base.delivery_status, base.accepted_at, base.source, grp, base.created_at)
  returning id into new_id;

  perform public.log_staff_activity(
    my_branch, 'Added size to order',
    'Order #' || new_id::text || ': ' || p_quantity::text || ' x ' || item
      || ' for ' || coalesce(base.customer_name, 'customer')
  );
  perform public.check_restock(my_branch, p_size);
end;
$$;
