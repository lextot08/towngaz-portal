-- Undo supabase/refill.sql: puts the Stock Inventory calculations back exactly as before.
-- Run in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Refills already saved become normal Incoming (filled stays the same, empties are no longer deducted).

update public.stock_movements set kind = 'normal' where kind = 'refill';

drop function if exists public.inventory_report(smallint, timestamptz, timestamptz);
drop function if exists public.empties_report(smallint, date);

-- the functions below are copied unchanged from supabase/backup_before_calculations.sql

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

drop function if exists public.refill_between(smallint, text, timestamptz, timestamptz);
