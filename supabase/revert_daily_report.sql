-- Undo supabase/daily_report.sql (the typed daily numbers are deleted too).
drop function if exists public.set_daily_entry(date, smallint, text, numeric);
drop table if exists public.daily_entries;
