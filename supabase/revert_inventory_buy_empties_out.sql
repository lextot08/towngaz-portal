-- Undo supabase/inventory_buy_empties_out.sql: the FILLED Incoming/Refill takes the empties by itself
-- again (and cannot be more than the empties), and the Buy boxes are gone. The typed empties out and
-- Buy numbers stay in the database but are no longer used. (Copied from supabase/swap_in.sql and
-- supabase/empties_reject.sql.)

drop function if exists public.buy_between(smallint, text, timestamptz, timestamptz);

-- 3. FILLED: Total = Beginning + Incoming + Refill + Swap in, Ending = Total - Sales
drop function if exists public.inventory_report(smallint, timestamptz, timestamptz);
create function public.inventory_report(p_branch smallint, p_from timestamptz, p_to timestamptz)
returns table(size text, beginning integer, incoming integer, refill integer, swap_in integer, total integer, sold integer, orders_sold integer, ending integer, actual integer, variance integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or coalesce(public.staff_branch() = p_branch, false)) then
    raise exception 'Not allowed';
  end if;

  return query
  select
    p.size,
    (n.stock_now - n.net_from),
    (n.normal_day + n.orders_sold),
    rf.val,
    sw.val,
    (n.stock_now - n.net_from) + (n.normal_day + n.orders_sold) + rf.val + sw.val,
    (n.orders_sold + n.extra_sold),
    n.orders_sold,
    (n.stock_now - n.net_from) + (n.normal_day + n.orders_sold) + rf.val + sw.val - (n.orders_sold + n.extra_sold),
    case when n.count_n > 0 then (n.stock_now - n.net_to) end,
    case when n.count_n > 0 then n.count_day end
  from public.lpg_prices p
  cross join lateral public.inv_numbers(p_branch, p.size, p_from, p_to) n
  cross join lateral (select public.refill_between(p_branch, p.size, p_from, p_to) as val) rf
  cross join lateral (select public.swap_in_between(p_branch, p.size, p_from, p_to) as val) sw
  order by p.sort_order;
end;
$$;

-- 4. Saving the Stock Inventory: also saves the Swap in of a day
create or replace function public.save_inventory_day(p_branch smallint, p_from timestamptz, p_to timestamptz, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_size text;
  item text;
  v_begin integer;
  v_inc integer;
  v_refill integer;
  v_swap integer;
  swap_now integer;
  v_sales integer;
  v_var integer;
  n record;
  moved_at timestamptz;
  diff integer;
  ending_now integer;
  refill_now integer;
  restock_now integer;
  empties_before integer;
  v_day date;
  changes text;
begin
  -- the staff of the branch, or the admin (every branch)
  if not (public.is_admin() or coalesce(public.staff_branch() = p_branch, false)) then
    raise exception 'You can only edit the inventory of your own branch';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'Invalid date'; end if;
  if p_from > now() then raise exception 'You cannot change a future date'; end if;
  moved_at := least(p_to - interval '1 second', now());
  v_day := (p_from at time zone 'Asia/Manila')::date;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_size := r->>'size';
    if not exists (select 1 from public.lpg_prices where size = v_size) then
      raise exception 'Invalid size';
    end if;
    item := 'LPG Cylinder ' || v_size;

    v_begin := nullif(r->>'beginning', '')::integer;
    v_inc := nullif(r->>'incoming', '')::integer;
    v_refill := nullif(r->>'refill', '')::integer;
    v_swap := nullif(r->>'swap_in', '')::integer;
    v_sales := nullif(r->>'sales', '')::integer;
    v_var := nullif(r->>'variance', '')::integer;
    if coalesce(v_begin, 0) < 0 or coalesce(v_inc, 0) < 0 or coalesce(v_refill, 0) < 0 or coalesce(v_swap, 0) < 0
       or coalesce(v_sales, 0) < 0 then
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

    -- Incoming/Refill: never more than the empties of the branch
    if v_inc is not null then
      select * into n from public.inv_numbers(p_branch, v_size, p_from, p_to);
      diff := v_inc - (n.normal_day + n.orders_sold);
      if diff <> 0 then
        refill_now := public.refill_between(p_branch, v_size, p_from, p_to);
        restock_now := (n.normal_day + n.orders_sold) + refill_now;
        select er.actual + er.refill into empties_before
        from public.empties_report(p_branch, v_day) er where er.size = v_size;
        if v_inc + refill_now > coalesce(empties_before, 0) then
          raise exception 'Incoming/Refill for % cannot be more than the empties of the branch (%).',
            v_size, coalesce(empties_before, 0) - refill_now;
        end if;
        perform public.inv_apply(p_branch, item, diff, 'normal', moved_at);
        changes := changes || 'incoming ' || (v_inc - diff)::text || ' -> ' || v_inc::text || '; ';
      end if;
    end if;

    -- Refill (kept for the refills typed before; the screen now uses Incoming/Refill)
    if v_refill is not null then
      refill_now := public.refill_between(p_branch, v_size, p_from, p_to);
      diff := v_refill - refill_now;
      if diff <> 0 then
        select er.actual + er.refill into empties_before
        from public.empties_report(p_branch, v_day) er where er.size = v_size;
        select * into n from public.inv_numbers(p_branch, v_size, p_from, p_to);
        if v_refill + (n.normal_day + n.orders_sold) > coalesce(empties_before, 0) then
          raise exception 'Refill for % cannot be more than the empties of the branch.', v_size;
        end if;
        perform public.inv_apply(p_branch, item, diff, 'refill', moved_at);
        changes := changes || 'refill ' || refill_now::text || ' -> ' || v_refill::text || '; ';
      end if;
    end if;

    -- Swap in: filled tanks given by another branch (no empties go out)
    if v_swap is not null then
      swap_now := public.swap_in_between(p_branch, v_size, p_from, p_to);
      diff := v_swap - swap_now;
      if diff <> 0 then
        perform public.inv_apply(p_branch, item, diff, 'swap_in', moved_at);
        changes := changes || 'swap in ' || swap_now::text || ' -> ' || v_swap::text || '; ';
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
      ending_now := (n.stock_now - n.net_from) + (n.normal_day + n.orders_sold)
        + public.refill_between(p_branch, v_size, p_from, p_to)
        + public.swap_in_between(p_branch, v_size, p_from, p_to) - (n.orders_sold + n.extra_sold);
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
$$;

-- 2. Saving the EMPTIES of a day: also saves the Reject
create or replace function public.save_empties_day(p_branch smallint, p_day date, p_rows jsonb)
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
  new_reject integer;
  t text;
  changes text;
begin
  -- the staff of the branch, or the admin (every branch)
  if not (public.is_admin() or coalesce(public.staff_branch() = p_branch, false)) then
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
    new_reject := e.reject;
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

    -- Reject: defective empties given by customers (taken out of the Ending)
    t := nullif(r->>'reject', '');
    if t is not null then
      if t = 'clear' then
        new_reject := null;
        changes := changes || 'reject cleared; ';
      else
        if t::integer < 0 then raise exception 'Numbers cannot be negative'; end if;
        new_reject := t::integer;
        changes := changes || 'reject ' || t || '; ';
      end if;
    end if;

    if changes = '' then continue; end if;

    insert into public.empties_days (branch, day, size, beginning, incoming, total, reject)
    values (p_branch, p_day, v_size, new_begin, new_inc, new_total, new_reject)
    on conflict (branch, day, size) do update
      set beginning = excluded.beginning,
          incoming = excluded.incoming,
          total = excluded.total,
          reject = excluded.reject;

    perform public.log_staff_activity(
      p_branch, 'Edited empties',
      'LPG Cylinder ' || v_size || ' (' || p_day::text || '): ' || rtrim(changes, '; ')
    );
  end loop;
end;
$function$
;

-- 3. EMPTIES Beginning: also takes out the rejects of the days before
create or replace function public.empties_carry(p_branch smallint, p_size text, p_day date)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  base_day date := date '2000-01-01';
  base_val integer := 0;
  b_day date;
  b_val integer;
  from_at timestamptz;
  to_at timestamptz := (p_day::timestamp at time zone 'Asia/Manila');
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
  from_at := (base_day::timestamp at time zone 'Asia/Manila');

  return (
    base_val
    + coalesce((select sum(coalesce(e.incoming, 0) - coalesce(e.reject, 0)) from public.empties_days e
                where e.branch = p_branch and e.size = p_size
                  and e.day >= base_day and e.day < p_day), 0)
    - public.refill_between(p_branch, p_size, from_at, to_at)
    - public.incoming_between(p_branch, p_size, from_at, to_at)
    + public.filled_sold_between(p_branch, p_size, from_at, to_at)
    - public.utang_sold_between(p_branch, p_size, from_at, to_at)
    + public.tank_returned_between(p_branch, p_size, from_at, to_at)
  )::integer;
end;
$$;

-- 4. The EMPTIES of a day, with the Borrowed and the Reject of the Variance apart
--    ("sales" = the empties actually given back, "ending" = before the rejects,
--     "actual" = after the rejects, "variance" = borrowed + reject)
drop function if exists public.empties_report(smallint, date);
create function public.empties_report(p_branch smallint, p_day date)
returns table(size text, beginning integer, incoming integer, refill integer, total integer, sales integer, ending integer, actual integer, variance integer, borrowed integer, reject integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  from_at timestamptz := (p_day::timestamp at time zone 'Asia/Manila');
  to_at timestamptz := ((p_day + 1)::timestamp at time zone 'Asia/Manila');
begin
  if not (public.is_admin() or coalesce(public.staff_branch() = p_branch, false)) then
    raise exception 'Not allowed';
  end if;

  return query
  select
    p.size,
    b.val,
    d.incoming,
    rs.val,
    b.val + coalesce(d.incoming, 0) - rs.val,
    s.val - u.val + rt.val,
    b.val + coalesce(d.incoming, 0) - rs.val + (s.val - u.val + rt.val),
    b.val + coalesce(d.incoming, 0) - rs.val + (s.val - u.val + rt.val) - coalesce(d.reject, 0),
    u.val + coalesce(d.reject, 0),
    u.val,
    coalesce(d.reject, 0)
  from public.lpg_prices p
  left join public.empties_days d
    on d.branch = p_branch and d.day = p_day and d.size = p.size
  cross join lateral (
    select coalesce(d.beginning, public.empties_carry(p_branch, p.size, p_day)) as val
  ) b
  cross join lateral (
    select public.refill_between(p_branch, p.size, from_at, to_at)
         + public.incoming_between(p_branch, p.size, from_at, to_at) as val
  ) rs
  cross join lateral (select public.filled_sold_between(p_branch, p.size, from_at, to_at) as val) s
  cross join lateral (select public.utang_sold_between(p_branch, p.size, from_at, to_at) as val) u
  cross join lateral (select public.tank_returned_between(p_branch, p.size, from_at, to_at) as val) rt
  order by p.sort_order;
end;
$$;
