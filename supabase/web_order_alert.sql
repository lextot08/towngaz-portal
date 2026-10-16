-- Live updates for the Daily Sales Report: a new order from the customer website
-- shows up in the report without pressing Refresh.
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- It is safe to run again.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;
