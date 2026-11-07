-- Monthly Sales Report for the staff: the BIVMC Receipts of their own branch (Volume vs Target).
-- The admin still gets every branch; a staff member gets only their branch.
-- Needs supabase/monthly_report.sql (run).
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- To undo (admin only again): run the monthly_receipts part of supabase/monthly_report.sql again.

create or replace function public.monthly_receipts(p_from timestamptz, p_to timestamptz)
returns table(branch smallint, size text, quantity integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  own smallint := public.staff_branch();
begin
  if not public.is_admin() and own is null then
    raise exception 'Not allowed';
  end if;

  return query
  select b.id::smallint,
         s.size,
         (public.incoming_between(b.id::smallint, s.size, p_from, p_to)
          + public.refill_between(b.id::smallint, s.size, p_from, p_to))::integer
  from generate_series(1, 7) as b(id)
  cross join (select distinct lp.size from public.lpg_prices lp) as s
  where public.is_admin() or b.id = own;
end;
$$;
