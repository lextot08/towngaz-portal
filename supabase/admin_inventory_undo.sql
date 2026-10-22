-- 1. The admin can save the REMARKS of every branch's Stock Inventory (the numbers are in
--    supabase/swap_in.sql and supabase/empties_reject.sql).
-- 2. Undo a returned tank recorded by mistake (Borrowed page).
-- Run after supabase/swap_in.sql and supabase/empties_reject.sql:
-- Dashboard > SQL Editor > New query > paste > Run.
-- To undo: run supabase/revert_admin_inventory_undo.sql

create or replace function public.save_inventory_remarks(p_branch smallint, p_day date, p_remarks text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- the staff of the branch, or the admin (every branch)
  if not (public.is_admin() or coalesce(public.staff_branch() = p_branch, false)) then
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
$$;

-- Undo one recorded return: the tanks are borrowed again and the EMPTIES of that day go back down
create or replace function public.undo_tank_return(p_return_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tank_returns;
begin
  select * into t from public.tank_returns where id = p_return_id for update;
  if not found then raise exception 'Return not found'; end if;
  if not (public.is_admin() or coalesce(public.staff_branch() = t.branch, false)) then
    raise exception 'You can only undo the returns of your own branch';
  end if;

  delete from public.tank_returns where id = t.id;

  perform public.log_staff_activity(
    t.branch, 'Undid returned tank',
    t.quantity::text || ' x LPG Cylinder ' || t.size || ' (order #' || t.order_id::text || ')'
  );
end;
$$;

revoke all on function public.undo_tank_return(bigint) from public;
grant execute on function public.undo_tank_return(bigint) to authenticated;
