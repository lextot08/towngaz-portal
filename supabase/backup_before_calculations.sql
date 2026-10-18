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

CREATE OR REPLACE FUNCTION public.add_additional_order(p_from_order_id bigint, p_size text, p_quantity integer, p_customer_type text, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_branch smallint := public.staff_branch();
  item text := 'LPG Cylinder ' || p_size;
  base public.orders;
  s public.stock;
  rule public.customer_types;
  new_id bigint;
  new_name text;
begin
  if my_branch is null then raise exception 'Only approved staff can add orders'; end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be a whole number of at least 1';
  end if;
  if p_source not in ('phone', 'walkin') then
    raise exception 'Please choose phone or walk-in';
  end if;

  select * into base from public.orders where id = p_from_order_id and branch = my_branch;
  if not found then raise exception 'Order not found'; end if;

  select * into rule from public.customer_types where type = p_customer_type;
  if not found then raise exception 'Please choose a customer type'; end if;

  select * into s from public.stock
  where branch = my_branch and item_name = item for update;
  if not found then raise exception 'This size is not in stock'; end if;
  if s.quantity < p_quantity then raise exception 'Not enough stock'; end if;

  update public.stock set quantity = quantity - p_quantity where id = s.id;

  new_name := regexp_replace(coalesce(base.customer_name, 'Customer'), '\s*\(additional\)$', '')
              || ' (additional)';

  insert into public.orders
    (customer_id, branch, item_name, quantity, unit_price, discount, customer_type,
     customer_name, customer_address, customer_contact,
     status, delivery_status, accepted_at, source)
  values
    (base.customer_id, my_branch, item, p_quantity, s.price, 0, p_customer_type,
     new_name, base.customer_address, base.customer_contact,
     'accepted', 'preparing', now(), p_source)
  returning id into new_id;

  perform public.log_staff_activity(
    my_branch, 'Added additional order',
    'Order #' || new_id::text || ': ' || p_quantity::text || ' x ' || item
      || ' for ' || new_name || ' (' || rule.label || ')'
  );

  perform public.check_restock(my_branch, p_size);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_lpg_stock(p_size text, p_quantity integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_branch smallint := public.staff_branch();
  the_price numeric;
begin
  if my_branch is null then raise exception 'Only approved staff can add stock'; end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be a whole number of at least 1';
  end if;

  select coalesce(bp.price, p.price) into the_price
  from public.lpg_prices p
  left join public.branch_prices bp on bp.size = p.size and bp.branch = my_branch
  where p.size = p_size;
  if not found then raise exception 'Invalid size'; end if;

  insert into public.stock (branch, item_name, quantity, price)
  values (my_branch, 'LPG Cylinder ' || p_size, p_quantity, the_price)
  on conflict (branch, item_name) do update
    set quantity = public.stock.quantity + excluded.quantity,
        price = excluded.price;

  perform public.log_staff_activity(
    my_branch, 'Added stock',
    p_quantity::text || ' x LPG Cylinder ' || p_size
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_manual_order(p_size text, p_quantity integer, p_name text, p_address text, p_contact text, p_customer_type text, p_source text, p_remarks text DEFAULT NULL::text, p_discount numeric DEFAULT 0, p_delivery_status text DEFAULT 'preparing'::text, p_time timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_branch smallint := public.staff_branch();
  item text := 'LPG Cylinder ' || p_size;
  s public.stock;
  rule public.customer_types;
  new_id bigint;
  disc numeric := coalesce(p_discount, 0);
  deliv text := coalesce(p_delivery_status, 'preparing');
  when_at timestamptz := now();
begin
  if my_branch is null then raise exception 'Only approved staff can add orders'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'Customer name is required'; end if;
  if p_address is null or trim(p_address) = '' then raise exception 'Address is required'; end if;
  if p_contact is null or trim(p_contact) = '' then raise exception 'Contact number is required'; end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be a whole number of at least 1';
  end if;
  if p_source not in ('phone', 'walkin') then
    raise exception 'Please choose phone or walk-in';
  end if;
  if deliv not in ('preparing', 'out_for_delivery', 'delivered') then
    raise exception 'Invalid delivery status';
  end if;

  select * into rule from public.customer_types where type = p_customer_type;
  if not found then raise exception 'Please choose a customer type'; end if;

  select * into s from public.stock
  where branch = my_branch and item_name = item for update;
  if not found then raise exception 'This size is not in stock'; end if;
  if s.quantity < p_quantity then raise exception 'Not enough stock'; end if;

  if disc < 0 then raise exception 'Discount cannot be negative'; end if;
  if disc <> round(disc, 2) then raise exception 'Discount can have at most 2 decimal places'; end if;
  if disc >= p_quantity * s.price then
    raise exception 'Discount must be less than the order amount';
  end if;

  -- the time shown when the row was started, as long as it is today and not in the future
  if p_time is not null
     and p_time <= now()
     and (p_time at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date then
    when_at := p_time;
  end if;

  update public.stock set quantity = quantity - p_quantity where id = s.id;

  insert into public.orders
    (customer_id, branch, item_name, quantity, unit_price, discount, customer_type,
     customer_name, customer_address, customer_contact, remarks,
     status, delivery_status, accepted_at, source)
  values
    (null, my_branch, item, p_quantity, s.price, disc, p_customer_type,
     trim(p_name), trim(p_address), trim(p_contact), nullif(trim(coalesce(p_remarks, '')), ''),
     'accepted', deliv, when_at, p_source)
  returning id into new_id;

  perform public.log_staff_activity(
    my_branch, 'Added manual order',
    'Order #' || new_id::text || ': ' || p_quantity::text || ' x ' || item
      || ' for ' || trim(p_name)
      || ' (' || case p_source when 'phone' then 'phone order' else 'walk-in order' end
      || ', ' || rule.label
      || case when disc > 0 then ', discount ₱' || to_char(disc, 'FM999,999,990.00') else '' end
      || ')'
  );

  perform public.check_restock(my_branch, p_size);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_manual_orders(p_items jsonb, p_name text, p_address text, p_contact text, p_customer_type text, p_source text, p_remarks text DEFAULT NULL::text, p_discount numeric DEFAULT 0, p_time timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_branch smallint := public.staff_branch();
  rule public.customer_types;
  disc numeric := coalesce(p_discount, 0);
  when_at timestamptz := now();
  grp uuid := gen_random_uuid();
  it jsonb;
  v_size text;
  v_qty integer;
  s public.stock;
  total_amount numeric := 0;
  allocated numeric := 0;
  biggest_idx integer := 1;
  biggest_amount numeric := -1;
  n integer;
  sizes text[] := '{}';
  qtys integer[] := '{}';
  prices numeric[] := '{}';
  amounts numeric[] := '{}';
  discs numeric[] := '{}';
  summary text := '';
begin
  if my_branch is null then raise exception 'Only approved staff can add orders'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'Customer name is required'; end if;
  if p_address is null or trim(p_address) = '' then raise exception 'Address is required'; end if;
  if p_contact is null or trim(p_contact) = '' then raise exception 'Contact number is required'; end if;
  if p_source not in ('phone', 'walkin') then raise exception 'Please choose phone or walk-in'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Please enter a quantity for at least one size';
  end if;

  select * into rule from public.customer_types where type = p_customer_type;
  if not found then raise exception 'Please choose a customer type'; end if;

  -- check every size: valid, entered once, a whole quantity, enough stock (the rows are locked)
  for it in select value from jsonb_array_elements(p_items) loop
    v_size := it->>'size';
    v_qty := nullif(it->>'quantity', '')::integer;
    if v_qty is null or v_qty < 1 then
      raise exception 'Quantity must be a whole number of at least 1';
    end if;
    if v_size = any(sizes) then
      raise exception 'Each size can only be entered once';
    end if;
    if not exists (select 1 from public.lpg_prices where size = v_size) then
      raise exception 'Invalid size';
    end if;

    select * into s from public.stock
    where branch = my_branch and item_name = 'LPG Cylinder ' || v_size for update;
    if not found then raise exception '% is not in stock', v_size; end if;
    if s.quantity < v_qty then
      raise exception 'Not enough stock for % (only % left)', v_size, s.quantity;
    end if;

    sizes := sizes || v_size;
    qtys := qtys || v_qty;
    prices := prices || s.price;
    amounts := amounts || (s.price * v_qty);
    total_amount := total_amount + s.price * v_qty;
  end loop;

  -- the discount is for the whole order of the customer; it is split between the sizes
  if disc < 0 then raise exception 'Discount cannot be negative'; end if;
  if disc <> round(disc, 2) then raise exception 'Discount can have at most 2 decimal places'; end if;

  n := array_length(sizes, 1);
  if disc > 0 then
    if disc >= total_amount then raise exception 'Discount must be less than the order amount'; end if;
    for i in 1..n loop
      discs := discs || round(disc * amounts[i] / total_amount, 2);
      allocated := allocated + discs[i];
      if amounts[i] > biggest_amount then
        biggest_amount := amounts[i];
        biggest_idx := i;
      end if;
    end loop;
    discs[biggest_idx] := discs[biggest_idx] + (disc - allocated);
    for i in 1..n loop
      if discs[i] < 0 or discs[i] >= amounts[i] then
        raise exception 'Discount is too large for one of the sizes. Please enter a smaller discount.';
      end if;
    end loop;
  else
    for i in 1..n loop
      discs := discs || 0::numeric;
    end loop;
  end if;

  -- the time shown when the row was started, as long as it is today and not in the future
  if p_time is not null
     and p_time <= now()
     and (p_time at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date then
    when_at := p_time;
  end if;

  for i in 1..n loop
    update public.stock set quantity = quantity - qtys[i]
    where branch = my_branch and item_name = 'LPG Cylinder ' || sizes[i];

    insert into public.orders
      (customer_id, branch, item_name, quantity, unit_price, discount, customer_type,
       customer_name, customer_address, customer_contact, remarks,
       status, delivery_status, accepted_at, source, group_id)
    values
      (null, my_branch, 'LPG Cylinder ' || sizes[i], qtys[i], prices[i], discs[i], p_customer_type,
       trim(p_name), trim(p_address), trim(p_contact), nullif(trim(coalesce(p_remarks, '')), ''),
       'accepted', 'preparing', when_at, p_source, grp);

    summary := summary || qtys[i]::text || ' x ' || sizes[i] || ', ';
    perform public.check_restock(my_branch, sizes[i]);
  end loop;

  perform public.log_staff_activity(
    my_branch, 'Added manual order',
    'For ' || trim(p_name) || ': ' || rtrim(summary, ', ')
      || ' (' || case p_source when 'phone' then 'phone order' else 'walk-in order' end
      || ', ' || rule.label
      || case when disc > 0 then ', discount ₱' || to_char(disc, 'FM999,999,990.00') else '' end
      || ')'
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.adjust_stock(p_branch smallint, p_size text, p_kind text, p_new_value integer, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  item text := 'LPG Cylinder ' || p_size;
  st public.stock;
  net_from bigint;
  net_to bigint;
  old_value integer;
  diff integer;
  moved_at timestamptz;
begin
  if not coalesce(public.staff_branch() = p_branch, false) then
    raise exception 'You can only adjust the stock of your own branch';
  end if;
  if p_kind not in ('beginning', 'ending') then raise exception 'Invalid change'; end if;
  if p_new_value is null or p_new_value < 0 then
    raise exception 'Stock cannot be negative';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'Invalid date'; end if;
  if p_from > now() then raise exception 'You cannot change a future date'; end if;
  if not exists (select 1 from public.lpg_prices where size = p_size) then
    raise exception 'Invalid size';
  end if;

  select * into st from public.stock
  where branch = p_branch and item_name = item for update;
  if not found then
    insert into public.stock (branch, item_name, quantity, price)
    values (
      p_branch, item, 0,
      coalesce(
        (select price from public.branch_prices where branch = p_branch and size = p_size),
        (select price from public.lpg_prices where size = p_size),
        0
      )
    )
    returning * into st;
  end if;

  select coalesce(sum(change), 0) into net_from from public.stock_movements
  where branch = p_branch and item_name = item and created_at >= p_from;
  select coalesce(sum(change), 0) into net_to from public.stock_movements
  where branch = p_branch and item_name = item and created_at >= p_to;

  if p_kind = 'beginning' then
    old_value := st.quantity - net_from;
    moved_at := p_from - interval '1 second';
  else
    old_value := st.quantity - net_to;
    moved_at := least(p_to - interval '1 second', now());
  end if;

  diff := p_new_value - old_value;

  if diff <> 0 then
    if st.quantity + diff < 0 then
      raise exception 'This would make the current stock negative';
    end if;
    perform set_config('towngaz.skip_movement', '1', true);
    update public.stock set quantity = quantity + diff where id = st.id;
    perform set_config('towngaz.skip_movement', '0', true);
  elsif p_kind = 'beginning' then
    return; -- nothing to record
  end if;

  -- a count is recorded even when it matches (change 0), so the day shows an Actual Count
  insert into public.stock_movements (branch, item_name, change, created_at, kind)
  values (p_branch, item, diff, moved_at, 'count');

  perform public.log_staff_activity(
    p_branch, 'Counted stock',
    'LPG Cylinder ' || p_size || ': '
      || case p_kind when 'beginning' then 'beginning' else 'actual count' end
      || ' of ' || to_char(p_from at time zone 'Asia/Manila', 'YYYY-MM-DD')
      || ' set to ' || p_new_value::text || ' (was ' || old_value::text || ')'
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o public.orders;
begin
  select * into o from public.orders
  where id = p_order_id and customer_id = auth.uid() for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'pending' then
    raise exception 'Only orders that are still waiting for staff can be cancelled';
  end if;

  update public.orders set status = 'cancelled' where id = o.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_restock(p_branch smallint, p_size text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record;
begin
  select * into r from public.recommendation_rows(p_branch) x where x.size = p_size;
  if not found or r.recommended_qty = 0 then return; end if;

  if exists (
    select 1 from public.staff_activity a
    where a.branch = p_branch
      and a.action = 'Restock recommendation'
      and a.details like 'LPG Cylinder ' || p_size || ':%'
      and a.created_at > now() - interval '24 hours'
  ) then
    return;
  end if;

  insert into public.staff_activity (branch, staff_id, staff_name, action, details)
  values (
    p_branch, null, 'System', 'Restock recommendation',
    'LPG Cylinder ' || p_size || ': add about ' || r.recommended_qty::text
      || ' (' || r.stock::text || ' left, ' || r.sold_30d::text || ' sold in 30 days)'
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clean_my_orders(p_order_ids bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
  update public.orders
  set customer_hidden = true
  where id = any(p_order_ids)
    and customer_id = auth.uid()
    and (status = 'cancelled' or (status = 'accepted' and delivery_status = 'delivered'));
  get diagnostics n = row_count;
  return n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_account(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare target public.profiles;
begin
  if p_user_id = auth.uid() then
    raise exception 'You cannot delete your own account';
  end if;

  select * into target from public.profiles where id = p_user_id;
  if not found then raise exception 'Account not found'; end if;

  if public.is_admin() then
    if target.role not in ('manager', 'staff') then
      raise exception 'Only manager and staff accounts can be deleted here';
    end if;
  elsif target.role = 'staff'
        and target.branch is not null
        and target.branch = public.manager_branch() then
    null; -- allowed
  else
    raise exception 'You are not allowed to delete this account';
  end if;

  delete from auth.users where id = p_user_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_order(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_branch smallint := public.staff_branch();
  o public.orders;
begin
  if my_branch is null then raise exception 'Only approved staff can delete orders'; end if;

  select * into o from public.orders where id = p_order_id and branch = my_branch for update;
  if not found then raise exception 'Order not found'; end if;

  if o.status = 'accepted' and o.delivery_status <> 'delivered' then
    update public.stock
    set quantity = quantity + o.quantity
    where branch = o.branch and item_name = o.item_name;
  end if;

  delete from public.orders where id = o.id;

  perform public.log_staff_activity(
    my_branch, 'Deleted order',
    'Order #' || o.id::text || ': ' || o.quantity::text || ' x ' || o.item_name
      || ' for ' || coalesce(o.customer_name, 'customer')
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_orders(p_order_ids bigint[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint;
begin
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'No order selected';
  end if;
  foreach v_id in array p_order_ids loop
    perform public.delete_order(v_id);
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.edit_order(p_order_id bigint, p_name text, p_remarks text, p_delivery_status text, p_discount numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_branch smallint := public.staff_branch();
  o public.orders;
  new_delivery text;
  new_discount numeric;
begin
  if my_branch is null then raise exception 'Only approved staff can edit orders'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'Customer name is required'; end if;

  select * into o from public.orders where id = p_order_id and branch = my_branch for update;
  if not found then raise exception 'Order not found'; end if;

  new_delivery := o.delivery_status;
  if o.status = 'accepted' then
    if p_delivery_status not in ('preparing', 'out_for_delivery', 'delivered') then
      raise exception 'Invalid delivery status';
    end if;
    new_delivery := p_delivery_status;
  end if;

  new_discount := coalesce(o.discount, 0);
  if p_discount is not null then
    if p_discount < 0 then
      raise exception 'Discount cannot be negative';
    end if;
    if p_discount <> round(p_discount, 2) then
      raise exception 'Discount can have at most 2 decimal places';
    end if;
    if p_discount >= o.quantity * o.unit_price then
      raise exception 'Discount must be less than the order amount';
    end if;
    new_discount := p_discount;
  end if;

  update public.orders
  set customer_name = trim(p_name),
      remarks = nullif(trim(coalesce(p_remarks, '')), ''),
      delivery_status = new_delivery,
      discount = new_discount
  where id = o.id;

  perform public.log_staff_activity(
    my_branch, 'Edited order',
    'Order #' || o.id::text || ' (' || o.item_name || ')'
      || case when new_delivery <> o.delivery_status
              then ': delivery status changed to ' || new_delivery
              else '' end
      || case when new_discount <> coalesce(o.discount, 0)
              then '; discount set to ₱' || to_char(new_discount, 'FM999,999,990.00')
              else '' end
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.edit_orders(p_order_ids bigint[], p_name text, p_remarks text, p_delivery_status text, p_discount numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ids bigint[] := '{}';
  amounts numeric[] := '{}';
  shares numeric[] := '{}';
  total_amount numeric := 0;
  allocated numeric := 0;
  biggest_idx integer := 1;
  biggest_amount numeric := -1;
  n integer;
  r record;
begin
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'No order selected';
  end if;

  for r in
    select od.id, (od.quantity * od.unit_price) as amount
    from unnest(p_order_ids) with ordinality as t(id, ord)
    join public.orders od on od.id = t.id
    order by t.ord
  loop
    ids := ids || r.id;
    amounts := amounts || r.amount;
    total_amount := total_amount + r.amount;
  end loop;

  n := coalesce(array_length(ids, 1), 0);
  if n <> array_length(p_order_ids, 1) then raise exception 'Order not found'; end if;

  if p_discount is not null then
    if p_discount < 0 then raise exception 'Discount cannot be negative'; end if;
    if p_discount <> round(p_discount, 2) then
      raise exception 'Discount can have at most 2 decimal places';
    end if;
    if p_discount > 0 and p_discount >= total_amount then
      raise exception 'Discount must be less than the order amount';
    end if;

    for j in 1..n loop
      if p_discount = 0 then
        shares := shares || 0::numeric;
      else
        shares := shares || round(p_discount * amounts[j] / total_amount, 2);
        allocated := allocated + shares[j];
        if amounts[j] > biggest_amount then
          biggest_amount := amounts[j];
          biggest_idx := j;
        end if;
      end if;
    end loop;

    if p_discount > 0 then
      shares[biggest_idx] := shares[biggest_idx] + (p_discount - allocated);
      for j in 1..n loop
        if shares[j] < 0 or shares[j] >= amounts[j] then
          raise exception 'Discount is too large for one of the sizes. Please enter a smaller discount.';
        end if;
      end loop;
    end if;
  end if;

  for j in 1..n loop
    perform public.edit_order(
      ids[j], p_name, p_remarks, p_delivery_status,
      case when p_discount is null then null else shares[j] end
    );
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.empties_carry(p_branch smallint, p_size text, p_day date)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  base_day date := date '2000-01-01';
  base_val integer := 0;
  b_day date;
  b_val integer;
begin
  select e.day, e.beginning into b_day, b_val
  from public.empties_days e
  where e.branch = p_branch and e.size = p_size and e.day < p_day and e.beginning is not null
  order by e.day desc
  limit 1;
  if found then
    base_day := b_day;
    base_val := b_val;
  end if;

  return (
    base_val
    + coalesce((select sum(od.quantity) from public.orders od
                where od.branch = p_branch
                  and od.item_name = 'LPG Cylinder ' || p_size
                  and od.status = 'accepted'
                  and od.accepted_at >= (base_day::timestamp at time zone 'Asia/Manila')
                  and od.accepted_at < (p_day::timestamp at time zone 'Asia/Manila')), 0)
    + coalesce((select -sum(mv.change) from public.stock_movements mv
                where mv.branch = p_branch
                  and mv.item_name = 'LPG Cylinder ' || p_size
                  and mv.kind = 'sale'
                  and mv.created_at >= (base_day::timestamp at time zone 'Asia/Manila')
                  and mv.created_at < (p_day::timestamp at time zone 'Asia/Manila')), 0)
    + public.pahiram_variance_between(p_branch, p_size, base_day, p_day)
  )::integer;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.empties_report(p_branch smallint, p_day date)
 RETURNS TABLE(size text, beginning integer, incoming integer, total integer, sales integer, ending integer, actual integer, variance integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_admin() or coalesce(public.staff_branch() = p_branch, false)) then
    raise exception 'Not allowed';
  end if;

  return query
  select
    p.size,
    b.val,
    d.incoming,
    d.total,
    0,
    b.val + f.val + v.val,
    b.val + f.val + v.val,
    v.val
  from public.lpg_prices p
  left join public.empties_days d
    on d.branch = p_branch and d.day = p_day and d.size = p.size
  cross join lateral (
    select coalesce(d.beginning, public.empties_carry(p_branch, p.size, p_day)) as val
  ) b
  cross join lateral (select public.filled_sales_on(p_branch, p.size, p_day) as val) f
  cross join lateral (select public.pahiram_variance_on(p_branch, p.size, p_day) as val) v
  order by p.sort_order;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.filled_sales_on(p_branch smallint, p_size text, p_day date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select (
    coalesce((select sum(od.quantity) from public.orders od
              where od.branch = p_branch
                and od.item_name = 'LPG Cylinder ' || p_size
                and od.status = 'accepted'
                and od.accepted_at >= (p_day::timestamp at time zone 'Asia/Manila')
                and od.accepted_at < ((p_day + 1)::timestamp at time zone 'Asia/Manila')), 0)
    +
    coalesce((select -sum(mv.change) from public.stock_movements mv
              where mv.branch = p_branch
                and mv.item_name = 'LPG Cylinder ' || p_size
                and mv.kind = 'sale'
                and mv.created_at >= (p_day::timestamp at time zone 'Asia/Manila')
                and mv.created_at < ((p_day + 1)::timestamp at time zone 'Asia/Manila')), 0)
  )::integer;
$function$
;

CREATE OR REPLACE FUNCTION public.get_recommendations(p_branch smallint DEFAULT NULL::smallint)
 RETURNS TABLE(branch smallint, size text, stock integer, low_level integer, sold_30d integer, avg_daily numeric, days_left numeric, pending_qty integer, status text, recommended_qty integer, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare mb smallint;
begin
  if public.is_admin() then
    return query select * from public.recommendation_rows(p_branch);
    return;
  end if;

  mb := public.manager_branch();
  if mb is null then
    raise exception 'Only the admin and managers can view recommendations';
  end if;
  return query select * from public.recommendation_rows(mb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  chosen_role text := coalesce(new.raw_user_meta_data->>'role', 'customer');
  chosen_branch smallint;
  final_role text;
  final_status text;
  final_branch smallint := null;
begin
  if lower(new.email) = lower('admin@towngaz.com') then
    final_role := 'admin';
    final_status := 'approved';
  elsif chosen_role in ('staff', 'manager') then
    begin
      chosen_branch := (new.raw_user_meta_data->>'branch')::smallint;
    exception when others then
      chosen_branch := null;
    end;
    -- branches 1 to 7 (7 = Truck)
    if chosen_branch is null or chosen_branch < 1 or chosen_branch > 7 then
      raise exception 'A branch from 1 to 7 is required for staff and manager accounts';
    end if;
    final_role := chosen_role;
    final_status := 'pending';
    final_branch := chosen_branch;
  else
    final_role := 'customer';
    final_status := 'approved';
  end if;

  insert into public.profiles (id, email, full_name, address, contact_number, role, status, branch)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'address',
    new.raw_user_meta_data->>'contact_number',
    final_role,
    final_status,
    final_branch
  );
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.inv_apply(p_branch smallint, p_item text, p_diff integer, p_kind text, p_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cur integer;
begin
  select quantity into cur from public.stock
  where branch = p_branch and item_name = p_item for update;
  if cur is null then raise exception 'This size is not in stock'; end if;
  if cur + p_diff < 0 then
    raise exception 'This change would make the current stock less than 0';
  end if;

  if p_diff <> 0 then
    perform set_config('towngaz.skip_movement', '1', true);
    update public.stock set quantity = quantity + p_diff
    where branch = p_branch and item_name = p_item;
    perform set_config('towngaz.skip_movement', '0', true);
  end if;

  insert into public.stock_movements (branch, item_name, change, created_at, kind)
  values (p_branch, p_item, p_diff, p_at, p_kind);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.inv_numbers(p_branch smallint, p_size text, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(stock_now integer, net_from integer, net_to integer, normal_day integer, count_day integer, count_n integer, extra_sold integer, orders_sold integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    coalesce((select st.quantity from public.stock st
              where st.branch = p_branch and st.item_name = 'LPG Cylinder ' || p_size), 0)::integer,
    coalesce(sum(case when mv.created_at >= p_from then mv.change else 0 end), 0)::integer,
    coalesce(sum(case when mv.created_at >= p_to then mv.change else 0 end), 0)::integer,
    coalesce(sum(case when mv.created_at >= p_from and mv.created_at < p_to and mv.kind = 'normal'
                      then mv.change else 0 end), 0)::integer,
    coalesce(sum(case when mv.created_at >= p_from and mv.created_at < p_to and mv.kind = 'count'
                      then mv.change else 0 end), 0)::integer,
    (count(*) filter (where mv.created_at >= p_from and mv.created_at < p_to and mv.kind = 'count'))::integer,
    (-coalesce(sum(case when mv.created_at >= p_from and mv.created_at < p_to and mv.kind = 'sale'
                        then mv.change else 0 end), 0))::integer,
    coalesce((select sum(od.quantity) from public.orders od
              where od.branch = p_branch
                and od.item_name = 'LPG Cylinder ' || p_size
                and od.status = 'accepted'
                and od.accepted_at >= p_from
                and od.accepted_at < p_to), 0)::integer
  from public.stock_movements mv
  where mv.branch = p_branch and mv.item_name = 'LPG Cylinder ' || p_size;
$function$
;

CREATE OR REPLACE FUNCTION public.inventory_report(p_branch smallint, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(size text, beginning integer, incoming integer, total integer, sold integer, orders_sold integer, ending integer, actual integer, variance integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_admin() or coalesce(public.staff_branch() = p_branch, false)) then
    raise exception 'Not allowed';
  end if;

  return query
  select
    p.size,
    (n.stock_now - n.net_from),
    (n.normal_day + n.orders_sold),
    (n.stock_now - n.net_from) + (n.normal_day + n.orders_sold),
    (n.orders_sold + n.extra_sold),
    n.orders_sold,
    (n.stock_now - n.net_from) + (n.normal_day + n.orders_sold) - (n.orders_sold + n.extra_sold),
    case when n.count_n > 0 then (n.stock_now - n.net_to) end,
    case when n.count_n > 0 then n.count_day end
  from public.lpg_prices p
  cross join lateral public.inv_numbers(p_branch, p.size, p_from, p_to) n
  order by p.sort_order;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'approved'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_approved()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.log_staff_activity(p_branch smallint, p_action text, p_details text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare who text;
begin
  select coalesce(nullif(trim(full_name), ''), email) into who
  from public.profiles where id = auth.uid();

  insert into public.staff_activity (branch, staff_id, staff_name, action, details)
  values (p_branch, auth.uid(), who, p_action, p_details);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.log_stock_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if current_setting('towngaz.skip_movement', true) = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.quantity <> 0 then
      insert into public.stock_movements (branch, item_name, change)
      values (new.branch, new.item_name, new.quantity);
    end if;
  elsif new.quantity <> old.quantity then
    insert into public.stock_movements (branch, item_name, change)
    values (new.branch, new.item_name, new.quantity - old.quantity);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.manager_branch()
 RETURNS smallint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select branch from public.profiles
  where id = auth.uid() and role = 'manager' and status = 'approved';
$function$
;

CREATE OR REPLACE FUNCTION public.no_new_managers()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.role = 'manager' then
    new.role := 'customer';
    new.status := 'approved';
    new.branch := null;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pahiram_add(p_items jsonb, p_time timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_branch smallint := public.staff_branch();
  it jsonb;
  v_size text;
  v_qty integer;
  seen text[] := '{}';
  new_id bigint;
  when_at timestamptz := now();
  summary text := '';
begin
  if my_branch is null then raise exception 'Only approved staff can add pahiram'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Please enter a quantity for at least one size';
  end if;

  -- the time shown when the row was started, as long as it is today and not in the future
  if p_time is not null
     and p_time <= now()
     and (p_time at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date then
    when_at := p_time;
  end if;

  insert into public.pahiram_rows (branch, created_at)
  values (my_branch, when_at)
  returning id into new_id;

  for it in select value from jsonb_array_elements(p_items) loop
    v_size := it->>'size';
    v_qty := nullif(it->>'quantity', '')::integer;
    if v_qty is null or v_qty < 1 then
      raise exception 'Quantity must be a whole number of at least 1';
    end if;
    if v_size = any(seen) then raise exception 'Each size can only be entered once'; end if;
    if not exists (select 1 from public.lpg_prices where size = v_size) then
      raise exception 'Invalid size';
    end if;
    seen := seen || v_size;

    insert into public.pahiram_items (row_id, size, borrowed) values (new_id, v_size, v_qty);
    summary := summary || v_qty::text || ' x ' || v_size || ', ';
  end loop;

  perform public.log_staff_activity(my_branch, 'Added pahiram', rtrim(summary, ', '));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pahiram_delete(p_row_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_branch smallint := public.staff_branch();
begin
  if my_branch is null then raise exception 'Only approved staff can delete pahiram'; end if;

  delete from public.pahiram_rows where id = p_row_id and branch = my_branch;
  if not found then raise exception 'Row not found'; end if;

  perform public.log_staff_activity(my_branch, 'Deleted pahiram', 'Row #' || p_row_id::text);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pahiram_list(p_branch smallint)
 RETURNS TABLE(row_id bigint, created_at timestamp with time zone, size text, borrowed integer, returned integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_admin() or coalesce(public.staff_branch() = p_branch, false)) then
    raise exception 'Not allowed';
  end if;

  return query
  select r.id, r.created_at, i.size, i.borrowed, i.returned
  from public.pahiram_rows r
  join public.pahiram_items i on i.row_id = r.id
  where r.branch = p_branch
  order by r.created_at desc, r.id desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pahiram_return(p_row_id bigint, p_returns jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_branch smallint := public.staff_branch();
  rw public.pahiram_rows;
  it public.pahiram_items;
  r jsonb;
  v_size text;
  v_total integer;
  delta integer;
  summary text := '';
begin
  if my_branch is null then raise exception 'Only approved staff can record returns'; end if;

  select * into rw from public.pahiram_rows
  where id = p_row_id and branch = my_branch for update;
  if not found then raise exception 'Row not found'; end if;

  for r in select value from jsonb_array_elements(p_returns) loop
    v_size := r->>'size';
    v_total := nullif(r->>'returned', '')::integer;
    if v_total is null then continue; end if;

    select * into it from public.pahiram_items where row_id = p_row_id and size = v_size for update;
    if not found then raise exception 'Nothing was borrowed for %', v_size; end if;

    if v_total < it.returned then
      raise exception 'Returned for % cannot be lowered (already %). To fix a mistake, delete the row and add it again.',
        v_size, it.returned;
    end if;
    if v_total > it.borrowed then
      raise exception 'Returned for % cannot be more than the borrowed (%)', v_size, it.borrowed;
    end if;

    delta := v_total - it.returned;
    if delta = 0 then continue; end if;

    update public.pahiram_items set returned = v_total where row_id = p_row_id and size = v_size;
    insert into public.pahiram_returns (row_id, size, qty) values (p_row_id, v_size, delta);
    summary := summary || delta::text || ' x ' || v_size || ', ';
  end loop;

  if summary <> '' then
    perform public.log_staff_activity(my_branch, 'Recorded pahiram return', rtrim(summary, ', '));
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pahiram_variance_between(p_branch smallint, p_size text, p_from date, p_to date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select (
    coalesce(-(select sum(i.borrowed)::integer
               from public.pahiram_items i
               join public.pahiram_rows r on r.id = i.row_id
               where r.branch = p_branch and i.size = p_size
                 and (r.created_at at time zone 'Asia/Manila')::date >= p_from
                 and (r.created_at at time zone 'Asia/Manila')::date < p_to), 0)
    +
    coalesce((select sum(t.qty)::integer
              from public.pahiram_returns t
              join public.pahiram_rows r on r.id = t.row_id
              where r.branch = p_branch and t.size = p_size
                and (t.returned_at at time zone 'Asia/Manila')::date >= p_from
                and (t.returned_at at time zone 'Asia/Manila')::date < p_to), 0)
  )::integer;
$function$
;

CREATE OR REPLACE FUNCTION public.pahiram_variance_on(p_branch smallint, p_size text, p_day date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.pahiram_variance_between(p_branch, p_size, p_day, p_day + 1);
$function$
;

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

CREATE OR REPLACE FUNCTION public.recommendation_rows(p_branch smallint DEFAULT NULL::smallint)
 RETURNS TABLE(branch smallint, size text, stock integer, low_level integer, sold_30d integer, avg_daily numeric, days_left numeric, pending_qty integer, status text, recommended_qty integer, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with combos as (
    select g::smallint as branch, p.size, p.low_stock_level as low_level, p.sort_order
    from generate_series(1, 6) as g
    cross join public.lpg_prices p
    where p_branch is null or g = p_branch
  ),
  base as (
    select
      c.branch, c.size, c.low_level, c.sort_order,
      coalesce(st.quantity, 0) as stock,
      coalesce((
        select sum(o.quantity) from public.orders o
        where o.branch = c.branch
          and o.item_name = 'LPG Cylinder ' || c.size
          and o.status = 'accepted'
          and o.accepted_at >= now() - interval '30 days'
      ), 0)::integer as sold_30d,
      coalesce((
        select sum(o.quantity) from public.orders o
        where o.branch = c.branch
          and o.item_name = 'LPG Cylinder ' || c.size
          and o.status = 'pending'
      ), 0)::integer as pending_qty
    from combos c
    left join public.stock st
      on st.branch = c.branch and st.item_name = 'LPG Cylinder ' || c.size
  ),
  calc as (
    select b.*,
      b.sold_30d / 30.0 as avg_daily,
      case when b.sold_30d > 0 then b.stock / (b.sold_30d / 30.0) end as days_left
    from base b
  )
  select
    k.branch, k.size, k.stock, k.low_level, k.sold_30d,
    round(k.avg_daily, 2),
    round(k.days_left, 1),
    k.pending_qty,
    case when k.stock = 0 then 'Out of stock'
         when k.stock <= k.low_level then 'Low stock'
         else 'OK' end,
    case when k.stock <= k.low_level
           or (k.days_left is not null and k.days_left < 7)
         then greatest(1, greatest(ceil(k.avg_daily * 14)::integer, k.low_level * 2) - k.stock)
         else 0 end,
    case when k.stock = 0 then 'Out of stock'
         when k.stock <= k.low_level then 'At or below the low-stock level'
         when k.days_left is not null and k.days_left < 7 then 'Less than 7 days of stock left'
         else null end
  from calc k
  order by k.branch, k.sort_order;
$function$
;

CREATE OR REPLACE FUNCTION public.save_empties_day(p_branch smallint, p_day date, p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb;
  v_size text;
  e public.empties_days;
  new_begin integer;
  new_inc integer;
  new_total integer;
  t text;
  changes text;
begin
  if not coalesce(public.staff_branch() = p_branch, false) then
    raise exception 'You can only edit the empties of your own branch';
  end if;
  if p_day is null or p_day > (now() at time zone 'Asia/Manila')::date then
    raise exception 'You cannot change a future date';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_size := r->>'size';
    if not exists (select 1 from public.lpg_prices where size = v_size) then
      raise exception 'Invalid size';
    end if;

    select * into e from public.empties_days
    where branch = p_branch and day = p_day and size = v_size;
    new_begin := e.beginning;
    new_inc := e.incoming;
    new_total := e.total;
    changes := '';

    t := nullif(r->>'beginning', '');
    if t is not null then
      if t::integer < 0 then raise exception 'Numbers cannot be negative'; end if;
      new_begin := t::integer;
      changes := changes || 'beginning ' || t || '; ';
    end if;

    t := nullif(r->>'incoming', '');
    if t is not null then
      if t = 'clear' then
        new_inc := null;
        changes := changes || 'incoming cleared; ';
      else
        if t::integer < 0 then raise exception 'Numbers cannot be negative'; end if;
        new_inc := t::integer;
        changes := changes || 'incoming ' || t || '; ';
      end if;
    end if;

    t := nullif(r->>'total', '');
    if t is not null then
      if t = 'clear' then
        new_total := null;
        changes := changes || 'total cleared; ';
      else
        if t::integer < 0 then raise exception 'Numbers cannot be negative'; end if;
        new_total := t::integer;
        changes := changes || 'total ' || t || '; ';
      end if;
    end if;

    if changes = '' then continue; end if;

    insert into public.empties_days (branch, day, size, beginning, incoming, total)
    values (p_branch, p_day, v_size, new_begin, new_inc, new_total)
    on conflict (branch, day, size) do update
      set beginning = excluded.beginning,
          incoming = excluded.incoming,
          total = excluded.total;

    perform public.log_staff_activity(
      p_branch, 'Edited empties',
      'LPG Cylinder ' || v_size || ' (' || p_day::text || '): ' || rtrim(changes, '; ')
    );
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_inventory_day(p_branch smallint, p_from timestamp with time zone, p_to timestamp with time zone, p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb;
  v_size text;
  item text;
  v_begin integer;
  v_inc integer;
  v_sales integer;
  v_var integer;
  n record;
  moved_at timestamptz;
  diff integer;
  ending_now integer;
  changes text;
begin
  if not coalesce(public.staff_branch() = p_branch, false) then
    raise exception 'You can only edit the inventory of your own branch';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'Invalid date'; end if;
  if p_from > now() then raise exception 'You cannot change a future date'; end if;
  moved_at := least(p_to - interval '1 second', now());

  for r in select value from jsonb_array_elements(p_rows) loop
    v_size := r->>'size';
    if not exists (select 1 from public.lpg_prices where size = v_size) then
      raise exception 'Invalid size';
    end if;
    item := 'LPG Cylinder ' || v_size;

    v_begin := nullif(r->>'beginning', '')::integer;
    v_inc := nullif(r->>'incoming', '')::integer;
    v_sales := nullif(r->>'sales', '')::integer;
    v_var := nullif(r->>'variance', '')::integer;
    if coalesce(v_begin, 0) < 0 or coalesce(v_inc, 0) < 0 or coalesce(v_sales, 0) < 0 then
      raise exception 'Numbers cannot be negative (only the variance can be)';
    end if;
    changes := '';

    insert into public.stock (branch, item_name, quantity, price)
    select p_branch, item, 0,
           coalesce((select price from public.branch_prices where branch = p_branch and size = v_size),
                    (select price from public.lpg_prices where size = v_size), 0)
    on conflict (branch, item_name) do nothing;

    -- Beginning
    if v_begin is not null then
      select * into n from public.inv_numbers(p_branch, v_size, p_from, p_to);
      diff := v_begin - (n.stock_now - n.net_from);
      if diff <> 0 then
        perform public.inv_apply(p_branch, item, diff, 'count', p_from - interval '1 second');
        changes := changes || 'beginning ' || (v_begin - diff)::text || ' -> ' || v_begin::text || '; ';
      end if;
    end if;

    -- Incoming / Refill
    if v_inc is not null then
      select * into n from public.inv_numbers(p_branch, v_size, p_from, p_to);
      diff := v_inc - (n.normal_day + n.orders_sold);
      if diff <> 0 then
        perform public.inv_apply(p_branch, item, diff, 'normal', moved_at);
        changes := changes || 'incoming ' || (v_inc - diff)::text || ' -> ' || v_inc::text || '; ';
      end if;
    end if;

    -- Sales (orders in the Daily Sales Report + extra paper sales)
    if v_sales is not null then
      select * into n from public.inv_numbers(p_branch, v_size, p_from, p_to);
      if v_sales < n.orders_sold then
        raise exception 'Sales for % cannot be lower than % (the orders already in the Daily Sales Report). Edit or delete those orders there.',
          v_size, n.orders_sold;
      end if;
      diff := (v_sales - n.orders_sold) - n.extra_sold;
      if diff <> 0 then
        perform public.inv_apply(p_branch, item, -diff, 'sale', moved_at);
        changes := changes || 'sales ' || (v_sales - diff)::text || ' -> ' || v_sales::text || '; ';
      end if;
    end if;

    -- Variance (the Actual Count is the Ending plus the variance)
    if v_var is not null then
      select * into n from public.inv_numbers(p_branch, v_size, p_from, p_to);
      ending_now := (n.stock_now - n.net_from) + (n.normal_day + n.orders_sold) - (n.orders_sold + n.extra_sold);
      if ending_now + v_var < 0 then
        raise exception 'The actual count for % cannot be below 0 (ending inventory is %)', v_size, ending_now;
      end if;
      diff := v_var - n.count_day;
      perform public.inv_apply(p_branch, item, diff, 'count', moved_at);
      changes := changes || 'variance '
        || case when n.count_n > 0 then n.count_day::text else 'none' end
        || ' -> ' || v_var::text || '; ';
    end if;

    if changes <> '' then
      perform public.log_staff_activity(
        p_branch, 'Edited inventory',
        'LPG Cylinder ' || v_size || ' ('
          || to_char(p_from at time zone 'Asia/Manila', 'YYYY-MM-DD') || '): '
          || rtrim(changes, '; ')
      );
      perform public.check_restock(p_branch, v_size);
    end if;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_inventory_remarks(p_branch smallint, p_day date, p_remarks text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not coalesce(public.staff_branch() = p_branch, false) then
    raise exception 'You can only edit the remarks of your own branch';
  end if;

  if p_remarks is null or trim(p_remarks) = '' then
    delete from public.inventory_remarks where branch = p_branch and day = p_day;
  else
    insert into public.inventory_remarks (branch, day, remarks)
    values (p_branch, p_day, trim(p_remarks))
    on conflict (branch, day) do update set remarks = excluded.remarks;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_customer_type()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare chosen text;
begin
  if new.role = 'customer' then
    select raw_user_meta_data->>'customer_type' into chosen
    from auth.users where id = new.id;
    if chosen in ('household', 'commercial', 'rto') then
      new.customer_type := chosen;
    else
      new.customer_type := 'household';
    end if;
  else
    new.customer_type := null;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_order_utang(p_order_ids bigint[], p_utang text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_utang is not null and p_utang not in ('utang', 'bayad_utang') then
    raise exception 'Remark must be Utang or Bayad Utang';
  end if;

  update orders o
  set utang_status = p_utang
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
$function$
;

CREATE OR REPLACE FUNCTION public.staff_branch()
 RETURNS smallint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when role = 'admin' then 1::smallint else branch end
  from public.profiles
  where id = auth.uid()
    and status = 'approved'
    and role in ('staff', 'admin');
$function$
;

CREATE OR REPLACE FUNCTION public.stock_low_alert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  sz text := replace(new.item_name, 'LPG Cylinder ', '');
  lvl integer;
begin
  select low_stock_level into lvl from public.lpg_prices where size = sz;
  lvl := coalesce(lvl, 5);

  if new.quantity = 0 and old.quantity > 0 then
    insert into public.staff_activity (branch, staff_id, staff_name, action, details)
    values (new.branch, null, 'System', 'Out of stock alert',
            'LPG Cylinder ' || sz || ' is out of stock');
  elsif new.quantity <= lvl and old.quantity > lvl then
    insert into public.staff_activity (branch, staff_id, staff_name, action, details)
    values (new.branch, null, 'System', 'Low stock alert',
            'LPG Cylinder ' || sz || ' is running low: ' || new.quantity::text
              || ' left (alert level: ' || lvl::text || ')');
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_stock_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.price is distinct from old.price then
    update public.stock
    set price = new.price
    where item_name = 'LPG Cylinder ' || new.size;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_delivery_status(p_order_id bigint, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_branch smallint := public.staff_branch();
  o public.orders;
  label text;
begin
  if my_branch is null then raise exception 'Only approved staff can update delivery'; end if;
  if p_status not in ('preparing', 'out_for_delivery', 'delivered') then
    raise exception 'Invalid delivery status';
  end if;

  select * into o from public.orders
  where id = p_order_id and branch = my_branch and status = 'accepted' for update;
  if not found then raise exception 'Order not found or not accepted yet'; end if;

  if o.delivery_status = p_status then return; end if;

  update public.orders set delivery_status = p_status where id = o.id;

  label := case p_status
    when 'preparing' then 'Preparing'
    when 'out_for_delivery' then 'Out for delivery'
    else 'Delivered'
  end;

  perform public.log_staff_activity(
    my_branch, 'Updated delivery status',
    'Order #' || o.id::text || ' (' || o.quantity::text || ' x ' || o.item_name
      || ') set to ' || label
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_price(p_size text, p_price numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare my_branch smallint := public.staff_branch();
begin
  if my_branch is null then raise exception 'Only approved staff can update prices'; end if;
  if p_price is null or p_price <= 0 then raise exception 'Price must be more than 0'; end if;
  if not exists (select 1 from public.lpg_prices where size = p_size) then
    raise exception 'Invalid size';
  end if;

  insert into public.branch_prices (branch, size, price)
  values (my_branch, p_size, round(p_price, 2))
  on conflict (branch, size) do update set price = excluded.price;

  update public.stock
  set price = round(p_price, 2)
  where branch = my_branch and item_name = 'LPG Cylinder ' || p_size;

  perform public.log_staff_activity(
    my_branch, 'Updated price',
    'LPG Cylinder ' || p_size || ' price set to ' || round(p_price, 2)::text
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.write_audit_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[];
  v_name text;
  v_role text;
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from v_old -> n.key;
    if v_changed is null then
      return null; -- saved without any change: nothing to log
    end if;
  end if;

  select full_name, role into v_name, v_role from profiles where id = auth.uid();

  insert into audit_log (
    actor_id, actor_name, actor_role, branch, table_name, action,
    record_id, changed_columns, old_data, new_data
  ) values (
    auth.uid(), v_name, v_role,
    case when v_row ->> 'branch' ~ '^\d+$' then (v_row ->> 'branch')::integer end,
    tg_table_name, lower(tg_op),
    v_row ->> 'id', v_changed, v_old, v_new
  );
  return null;
end;
$function$
;