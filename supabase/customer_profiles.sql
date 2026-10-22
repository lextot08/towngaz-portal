-- Customer Profile: profiles for customers who do not use the website (walk-in / phone).
-- Their order history is found by their contact number. (Website customers already have
-- an account, so their profile comes from their own orders.)
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- To undo: drop table if exists public.customer_profiles;

create table if not exists public.customer_profiles (
  id bigint generated always as identity primary key,
  branch smallint not null check (branch >= 1 and branch <= 7),
  full_name text not null,
  address text,
  contact text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists customer_profiles_branch on public.customer_profiles (branch);

-- The admin sees all branches; staff see and add only the profiles of their own branch.
alter table public.customer_profiles enable row level security;

drop policy if exists customer_profiles_branch_staff on public.customer_profiles;
create policy customer_profiles_branch_staff on public.customer_profiles
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'approved'
        and (p.role = 'admin' or (p.role = 'staff' and p.branch = customer_profiles.branch))
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status = 'approved'
        and (p.role = 'admin' or (p.role = 'staff' and p.branch = customer_profiles.branch))
    )
  );

grant select, insert, update, delete on public.customer_profiles to authenticated;
