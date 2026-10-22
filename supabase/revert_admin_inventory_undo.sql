-- Undo supabase/admin_inventory_undo.sql: only the staff of the branch save its REMARKS again,
-- and the undo of returned tanks is removed.
-- Run in Supabase: Dashboard > SQL Editor > New query > paste > Run.

-- copied unchanged from supabase/backup_before_calculations.sql

CREATE OR REPLACE FUNCTION public.save_inventory_remarks(p_branch smallint, p_day date, p_remarks text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not coalesce(public.staff_branch() = p_branch, false) then
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
$function$
;

drop function if exists public.undo_tank_return(bigint);
