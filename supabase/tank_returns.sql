-- Returned borrowed tanks: on the Borrowed page the staff find the customer and record the
-- tanks given back. On that day the EMPTIES go up by the same number.
-- Needs supabase/inventory_variance.sql and supabase/borrowed_gcash.sql (both run).
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- To undo: run supabase/revert_tank_returns.sql

-- 1. Every return (a customer can give the tanks back over several days)
create table if not exists public.tank_returns (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders (id) on delete cascade,
  branch smallint not null,
  size text not null,
  quantity integer not null check (quantity > 0),
  returned_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index if not exists tank_returns_branch_size_day on public.tank_returns (branch, size, returned_at);
create index if not exists tank_returns_order on public.tank_returns (order_id);

-- Staff read the returns of their own branch (the admin all); they are added through the function below.
alter table public.tank_returns enable row level security;

drop policy if exists tank_returns_read on public.tank_returns;
create policy tank_returns_read on public.tank_returns
  for select to authenticated
  using (public.is_admin() or coalesce(public.staff_branch() = branch, false));

grant select on public.tank_returns to authenticated;

-- 2. Record a return for one order (one size): never more than what is still borrowed
create or replace function public.record_tank_return(p_order_id bigint, p_quantity integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_branch smallint := public.staff_branch();
  o public.orders;
  given_back integer;
begin
  if my_branch is null then raise exception 'Only approved staff can record returns'; end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be a whole number of at least 1';
  end if;

  select * into o from public.orders where id = p_order_id and branch = my_branch for update;
  if not found then raise exception 'Order not found'; end if;
  if not o.borrowed_tank then raise exception 'This order has no borrowed tank'; end if;

  select coalesce(sum(quantity), 0) into given_back from public.tank_returns where order_id = o.id;
  if given_back + p_quantity > o.quantity then
    raise exception 'Only % of this size is still borrowed', o.quantity - given_back;
  end if;

  insert into public.tank_returns (order_id, branch, size, quantity)
  values (o.id, o.branch, replace(o.item_name, 'LPG Cylinder ', ''), p_quantity);

  perform public.log_staff_activity(
    my_branch, 'Recorded returned tank',
    p_quantity::text || ' x ' || o.item_name || ' from ' || coalesce(o.customer_name, 'customer')
      || ' (order #' || o.id::text || ')'
  );
end;
$$;

revoke all on function public.record_tank_return(bigint, integer) from public;
grant execute on function public.record_tank_return(bigint, integer) to authenticated;

-- 3. Tanks given back between two times
create or replace function public.tank_returned_between(p_branch smallint, p_size text, p_from timestamptz, p_to timestamptz)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(t.quantity), 0)::integer
  from public.tank_returns t
  where t.branch = p_branch and t.size = p_size
    and t.returned_at >= p_from and t.returned_at < p_to;
$$;

-- 4. EMPTIES Beginning: also adds the tanks given back on the days before
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
    + public.tank_returned_between(p_branch, p_size, from_at, to_at)
  )::integer;
end;
$$;

-- 5. EMPTIES of a day: Sales (empties given back) = FILLED Sales - Borrowed + returned tanks
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
    s.val - u.val + rt.val,
    b.val + coalesce(d.incoming, 0) - rs.val + (s.val - u.val + rt.val),
    b.val + coalesce(d.incoming, 0) - rs.val + (s.val - u.val + rt.val),
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
  cross join lateral (select public.tank_returned_between(p_branch, p.size, from_at, to_at) as val) rt
  order by p.sort_order;
end;
$$;
