-- Undo supabase/empties_reject.sql: the EMPTIES Variance is only the Borrowed again (the typed
-- rejects are deleted). Run in Supabase: Dashboard > SQL Editor > New query > paste > Run.

drop function if exists public.empties_report(smallint, date);

-- the functions below are copied unchanged from supabase/tank_returns.sql

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

-- copied unchanged from supabase/backup_before_calculations.sql

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

alter table public.empties_days drop column if exists reject;
