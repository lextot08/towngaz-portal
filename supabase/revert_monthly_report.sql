-- Undo supabase/monthly_report.sql (the typed monthly numbers are deleted too).
drop function if exists public.monthly_receipts(timestamptz, timestamptz);
drop function if exists public.set_monthly_entry(date, smallint, text, numeric);
drop table if exists public.monthly_entries;
