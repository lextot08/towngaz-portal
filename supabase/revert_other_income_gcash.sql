-- Undo supabase/other_income_gcash.sql (every Other Income counts as Cash again).
drop function if exists public.set_order_other_income(bigint[], text, boolean);
alter table public.orders drop column if exists other_income_gcash;
