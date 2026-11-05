-- Daily Sales Log: deleting an order puts its tanks back on the order's own day and time.
-- Before, they went back at the moment of deleting, so the Stock Inventory of that day showed them
-- as Incoming/Refill although nothing was delivered (and a deleted Delivered order gave nothing back).
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- To undo: run supabase/revert_delete_order_fix.sql

CREATE OR REPLACE FUNCTION public.delete_order(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'3
AS $function$
declare
  my_branch smallint := public.staff_branch();
  o public.orders;
begin
  if my_branch is null then raise exception 'Only approved staff can delete orders'; end if;

  select * into o from public.orders where id = p_order_id and branch = my_branch for update;
  if not found then raise exception 'Order not found'; end if;

  -- a deleted order never happened: its tanks go back on the order's own day and time, so its
  -- sale and the return cancel out there (and no other day shows them as Incoming/Refill)
  if o.status = 'accepted' then
    perform public.inv_apply(
      o.branch, o.item_name, o.quantity, 'normal', least(coalesce(o.accepted_at, now()), now())
    );
  end if;

  delete from public.orders where id = o.id;

  perform public.log_staff_activity(
    my_branch, 'Deleted order',
    'Order #' || o.id::text || ': ' || o.quantity::text || ' x ' || o.item_name
      || ' for ' || coalesce(o.customer_name, 'customer')
  );
end;
$function$
;
