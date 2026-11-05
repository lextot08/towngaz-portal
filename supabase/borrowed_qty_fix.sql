-- Fix for supabase/borrowed_qty.sql: typing the borrowed tanks in Customer Profile on an order that
-- was not marked Borrowed yet kept "all the tanks" instead of the number typed. The count now goes
-- back to "all the tanks" only when the Remark Borrowed is turned on or off in the Daily Sales Log.
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.

create or replace function public.reset_borrowed_qty()
returns trigger
language plpgsql
as $$
begin
  -- the Borrowed mark changed, and no number was typed with it
  if new.borrowed_tank is distinct from old.borrowed_tank
     and new.borrowed_qty is not distinct from old.borrowed_qty then
    new.borrowed_qty := null;
  end if;
  return new;
end;
$$;
