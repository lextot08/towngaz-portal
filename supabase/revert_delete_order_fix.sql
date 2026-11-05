-- Undo supabase/delete_order_fix.sql: deleted orders put their tanks back at the moment of deleting.

CREATE OR REPLACE FUNCTION public.delete_order(p_order_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_branch smallint := public.staff_branch();
  o public.orders;
begin
  if my_branch is null then raise exception 'Only approved staff can delete orders'; end if;

  select * into o from public.orders where id = p_order_id and branch = my_branch for update;
  if not found then raise exception 'Order not found'; end if;

  if o.status = 'accepted' and o.delivery_status <> 'delivered' then
    update public.stock
    set quantity = quantity + o.quantity
    where branch = o.branch and item_name = o.item_name;
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
