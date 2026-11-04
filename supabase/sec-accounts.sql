-- MANGO Sec. account storage, separate from MANGO FX practice_accounts.
create table public.mango_sec_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state_json jsonb not null check (jsonb_typeof(state_json) = 'object'),
  watchlist_json jsonb not null default '[]'::jsonb check (jsonb_typeof(watchlist_json) = 'array'),
  version bigint not null default 0 check (version >= 0 and version <= 9007199254740991),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mango_sec_accounts enable row level security;

revoke all on table public.mango_sec_accounts from public, anon, authenticated, service_role;
grant select on table public.mango_sec_accounts to authenticated;
grant select, insert, update on table public.mango_sec_accounts to service_role;

create policy mango_sec_read_own_account
  on public.mango_sec_accounts for select to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.mango_sec_accounts is
  'MANGO Sec simulation accounts. Writes are performed by the authenticated Edge Function after server-side quote and ownership checks.';

notify pgrst, 'reload schema';
