-- Undo supabase/other_income.sql (the typed Other Income amounts are deleted too).
drop function if exists public.set_order_other_income(bigint[], text);
alter table public.orders drop column if exists other_income;
