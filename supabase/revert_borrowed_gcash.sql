-- Undo supabase/borrowed_gcash.sql: "Utang" means a borrowed tank again.
-- Run in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Orders marked Borrowed become Utang again (a money Utang on them is replaced).

update public.orders set utang_status = 'utang' where borrowed_tank;

-- the remarks function of supabase/delivery_remarks.sql
drop function if exists public.set_order_remarks(bigint[], text, boolean, boolean, boolean);
create or replace function public.set_order_remarks(p_order_ids bigint[], p_utang text, p_delivered boolean, p_gcash boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_utang is not null and p_utang not in ('utang', 'bayad_utang') then
    raise exception 'Remark must be Utang or Bayad Utang';
  end if;

  update orders o
  set utang_status = p_utang,
      paid_gcash = coalesce(p_gcash, false),
      delivery_status = case
        when coalesce(p_delivered, false) then 'delivered'
        when o.delivery_status = 'delivered' then
          case when o.customer_id is not null then 'out_for_delivery' else 'preparing' end
        else o.delivery_status
      end
  where o.id = any (p_order_ids)
    and exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.status = 'approved'
        and (p.role = 'admin' or (p.role = 'staff' and p.branch = o.branch))
    );

  if not found then
    raise exception 'You are not allowed to change the remark of this order';
  end if;
end;
$$;

revoke all on function public.set_order_remarks(bigint[], text, boolean, boolean) from public;
grant execute on function public.set_order_remarks(bigint[], text, boolean, boolean) to authenticated;

-- the EMPTIES count the orders marked Utang again (supabase/inventory_variance.sql)
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

alter table public.orders drop column if exists borrowed_tank;
