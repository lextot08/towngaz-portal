-- EMPTIES of the Stock Inventory, based on the customers:
--   Total     = Beginning + Incoming (typed) - the restock (FILLED Incoming/Refill takes empties)
--   Sales     = the empties given back = FILLED Sales - the cylinders sold as Utang
--   Ending    = Total + Sales
--   Variance  = the cylinders sold as Utang (the customer kept the tank; also in REMARKS > Borrowed)
--   Actual Count = Ending, and the next day's Beginning = the Actual Count.
-- (The FILLED Variance is typed by the staff: leaks, swaps between branches. That part was
--  already in the database: the FILLED Actual Count = Ending + Variance.)
-- Needs supabase/refill.sql and supabase/restock_empties.sql to have been run first (they are).
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- To undo: run supabase/revert_inventory_variance.sql

-- 1. Cylinders sold as Utang between two times (accepted orders whose Remark is Utang)
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
    and od.utang_status = 'utang'
    and od.accepted_at >= p_from
    and od.accepted_at < p_to;
$$;

-- 2. Filled cylinders sold between two times (orders + extra sales typed in the Stock Inventory)
create or replace function public.filled_sold_between(p_branch smallint, p_size text, p_from timestamptz, p_to timestamptz)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce((select sum(od.quantity) from public.orders od
              where od.branch = p_branch
                and od.item_name = 'LPG Cylinder ' || p_size
                and od.status = 'accepted'
                and od.accepted_at >= p_from
                and od.accepted_at < p_to), 0)
    + coalesce((select -sum(mv.change) from public.stock_movements mv
                where mv.branch = p_branch
                  and mv.item_name = 'LPG Cylinder ' || p_size
                  and mv.kind = 'sale'
                  and mv.created_at >= p_from
                  and mv.created_at < p_to), 0)
  )::integer;
$$;

-- 3. EMPTIES Beginning of a day = the last typed Beginning + every day's
--    (Incoming - restock + empties given back) since then
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
    + coalesce((select sum(e.incoming) from public.empties_days e
                where e.branch = p_branch and e.size = p_size
                  and e.day >= base_day and e.day < p_day), 0)
    - public.refill_between(p_branch, p_size, from_at, to_at)
    - public.incoming_between(p_branch, p_size, from_at, to_at)
    + public.filled_sold_between(p_branch, p_size, from_at, to_at)
    - public.utang_sold_between(p_branch, p_size, from_at, to_at)
  )::integer;
end;
$$;

-- 4. The EMPTIES of a day (same columns as before; "refill" is the restock taken out,
--    "sales" the empties given back, "variance" the cylinders sold as Utang)
create or replace function public.empties_report(p_branch smallint, p_day date)
returns table(size text, beginning integer, incoming integer, refill integer, total integer, sales integer, ending integer, actual integer, variance integer)
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
    s.val - u.val,
    b.val + coalesce(d.incoming, 0) - rs.val + (s.val - u.val),
    b.val + coalesce(d.incoming, 0) - rs.val + (s.val - u.val),
    u.val
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
  order by p.sort_order;
end;
$$;
