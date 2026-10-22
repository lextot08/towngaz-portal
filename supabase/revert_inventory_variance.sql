-- Undo supabase/inventory_variance.sql: the EMPTIES go back to the restock_empties.sql version.
-- Run in Supabase: Dashboard > SQL Editor > New query > paste > Run.

-- the functions below are copied unchanged from supabase/restock_empties.sql

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
    + coalesce((select sum(od.quantity) from public.orders od
                where od.branch = p_branch
                  and od.item_name = 'LPG Cylinder ' || p_size
                  and od.status = 'accepted'
                  and od.accepted_at >= from_at
                  and od.accepted_at < to_at), 0)
    + coalesce((select -sum(mv.change) from public.stock_movements mv
                where mv.branch = p_branch
                  and mv.item_name = 'LPG Cylinder ' || p_size
                  and mv.kind = 'sale'
                  and mv.created_at >= from_at
                  and mv.created_at < to_at), 0)
    + public.pahiram_variance_between(p_branch, p_size, base_day, p_day)
    - public.refill_between(p_branch, p_size, from_at, to_at)
    - public.incoming_between(p_branch, p_size, from_at, to_at)
  )::integer;
end;
$$;

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
    d.total,
    0,
    b.val + f.val + v.val - rs.val,
    b.val + f.val + v.val - rs.val,
    v.val
  from public.lpg_prices p
  left join public.empties_days d
    on d.branch = p_branch and d.day = p_day and d.size = p.size
  cross join lateral (
    select coalesce(d.beginning, public.empties_carry(p_branch, p.size, p_day)) as val
  ) b
  cross join lateral (select public.filled_sales_on(p_branch, p.size, p_day) as val) f
  cross join lateral (select public.pahiram_variance_on(p_branch, p.size, p_day) as val) v
  cross join lateral (
    select public.refill_between(p_branch, p.size, from_at, to_at)
         + public.incoming_between(p_branch, p.size, from_at, to_at) as val
  ) rs
  order by p.sort_order;
end;
$$;

drop function if exists public.utang_sold_between(smallint, text, timestamptz, timestamptz);
drop function if exists public.filled_sold_between(smallint, text, timestamptz, timestamptz);
