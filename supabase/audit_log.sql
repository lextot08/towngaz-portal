-- Audit Log: records every change (add, change, delete) to the tables, with who did it.
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- It is safe to run again. Run it again after adding a new table, so that table is recorded too.

-- 1. The log
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid,            -- who did it (empty when the database did it by itself)
  actor_name text,
  actor_role text,          -- admin, staff, customer
  branch integer,           -- the branch of the changed row, when it has one
  table_name text not null,
  action text not null,     -- insert, update, delete
  record_id text,
  changed_columns text[],   -- for update: the columns that changed
  old_data jsonb,
  new_data jsonb
);

create index if not exists audit_log_created_at on public.audit_log (created_at desc);

-- Only the admin can read the log. Nobody can change or delete it from the app.
alter table public.audit_log enable row level security;

drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin' and p.status = 'approved'
    )
  );

grant select on public.audit_log to authenticated;

-- 2. Writes one line in the log for every changed row
create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[];
  v_name text;
  v_role text;
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from v_old -> n.key;
    if v_changed is null then
      return null; -- saved without any change: nothing to log
    end if;
  end if;

  select full_name, role into v_name, v_role from profiles where id = auth.uid();

  insert into audit_log (
    actor_id, actor_name, actor_role, branch, table_name, action,
    record_id, changed_columns, old_data, new_data
  ) values (
    auth.uid(), v_name, v_role,
    case when v_row ->> 'branch' ~ '^\d+$' then (v_row ->> 'branch')::integer end,
    tg_table_name, lower(tg_op),
    v_row ->> 'id', v_changed, v_old, v_new
  );
  return null;
end;
$$;

-- 3. Record every table in the public schema (except the log itself)
do $$
declare
  t text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'audit_log'
  loop
    execute format('drop trigger if exists audit_log_trigger on public.%I', t);
    execute format(
      'create trigger audit_log_trigger after insert or update or delete on public.%I '
      'for each row execute function public.write_audit_log()',
      t
    );
  end loop;
end;
$$;
