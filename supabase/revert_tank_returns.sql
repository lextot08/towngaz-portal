-- Undo supabase/tank_returns.sql: the EMPTIES go back to the inventory_variance.sql version
-- and the recorded returns are deleted.
-- Run in Supabase: Dashboard > SQL Editor > New query > paste > Run.

-- the functions below are copied unchanged from supabase/inventory_variance.sql

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

drop function if exists public.tank_returned_between(smallint, text, timestamptz, timestamptz);
drop function if exists public.record_tank_return(bigint, integer);
drop table if exists public.tank_returns;
