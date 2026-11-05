-- Undo supabase/past_day_orders.sql: "Add order" is for today only again.

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
