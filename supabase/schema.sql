-- ============================================================================
-- TruePose AI — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- OWNERS: one row per signed-up business, 1:1 with auth.users
-- status: 'pending' until you approve, then 'approved' (credits become usable)
-- ---------------------------------------------------------------------------
create table if not exists public.owners (
    id             uuid primary key references auth.users(id) on delete cascade,
    email          text not null,
    business_name  text,
    credit_balance integer not null default 0,
    status         text not null default 'pending',   -- 'pending' | 'approved' | 'blocked'
    storage_used   integer not null default 0,         -- count of stored files (images+videos+models)
    created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- TRANSACTIONS: every credit movement (topup / deduction / refund)
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
    id         bigserial primary key,
    owner_id   uuid not null references public.owners(id) on delete cascade,
    type       text not null,                          -- 'topup' | 'deduction' | 'refund'
    credits    integer not null,                       -- positive number
    reason     text,
    created_at timestamptz not null default now()
);
create index if not exists idx_tx_owner_time on public.transactions(owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- GENERATIONS: every produced asset (image / model / video)
-- r2_key points to the object in the R2 bucket
-- ---------------------------------------------------------------------------
create table if not exists public.generations (
    id              bigserial primary key,
    owner_id        uuid not null references public.owners(id) on delete cascade,
    kind            text not null,                     -- 'image' | 'model' | 'video'
    credits_charged integer not null default 0,
    r2_key          text not null,
    meta            jsonb,                             -- pose, category, location fingerprint, etc.
    status          text not null default 'complete',  -- 'complete' | 'failed'
    created_at      timestamptz not null default now()
);
create index if not exists idx_gen_owner_time on public.generations(owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- SIGNUP TRIGGER: auto-create an owner row (pending, 0 credits) on auth signup
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.owners (id, email, business_name, status, credit_balance)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'business_name', ''), 'pending', 0)
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- ATOMIC DEDUCT: check status + balance, then decrement in ONE transaction.
-- Called by the Worker (service role). Raises on insufficient balance so two
-- concurrent requests can never push the balance negative.
--   p_min_balance = the "must keep at least this many" floor (default 5).
-- Returns the new balance.
-- ---------------------------------------------------------------------------
create or replace function public.deduct_credits(
    p_owner       uuid,
    p_amount      integer,
    p_reason      text,
    p_min_balance integer default 5
)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
    v_status  text;
    v_balance integer;
begin
    select status, credit_balance into v_status, v_balance
    from public.owners where id = p_owner for update;   -- row lock

    if v_status is null then
        raise exception 'OWNER_NOT_FOUND';
    end if;
    if v_status <> 'approved' then
        raise exception 'NOT_APPROVED';
    end if;
    -- Must have enough to cover the cost AND stay at/above the floor to start
    if v_balance < p_amount or v_balance < p_min_balance then
        raise exception 'INSUFFICIENT_CREDITS';
    end if;

    update public.owners
       set credit_balance = credit_balance - p_amount
     where id = p_owner;

    insert into public.transactions (owner_id, type, credits, reason)
    values (p_owner, 'deduction', p_amount, p_reason);

    return v_balance - p_amount;
end;
$$;

-- ---------------------------------------------------------------------------
-- ADD CREDITS: used for admin top-ups AND automatic refunds on API failure.
-- ---------------------------------------------------------------------------
create or replace function public.add_credits(
    p_owner  uuid,
    p_amount integer,
    p_type   text,      -- 'topup' | 'refund'
    p_reason text
)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
    v_balance integer;
begin
    update public.owners
       set credit_balance = credit_balance + p_amount
     where id = p_owner
    returning credit_balance into v_balance;

    if v_balance is null then
        raise exception 'OWNER_NOT_FOUND';
    end if;

    insert into public.transactions (owner_id, type, credits, reason)
    values (p_owner, p_type, p_amount, p_reason);

    return v_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Frontend uses the anon key + the logged-in user's JWT: each owner can read
-- ONLY their own rows. The Worker uses the service_role key which bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.owners       enable row level security;
alter table public.transactions enable row level security;
alter table public.generations  enable row level security;

drop policy if exists owners_self_select on public.owners;
create policy owners_self_select on public.owners
    for select using (auth.uid() = id);

drop policy if exists tx_self_select on public.transactions;
create policy tx_self_select on public.transactions
    for select using (auth.uid() = owner_id);

drop policy if exists gen_self_select on public.generations;
create policy gen_self_select on public.generations
    for select using (auth.uid() = owner_id);

-- NOTE: no INSERT/UPDATE/DELETE policies for anon users on purpose.
-- All writes go through the Worker (service role) so credits can't be forged.

-- ---------------------------------------------------------------------------
-- USAGE SUMMARY (last 30 days) — convenience view the dashboard can query.
-- ---------------------------------------------------------------------------
create or replace view public.usage_last_30d as
select
    owner_id,
    count(*) filter (where kind = 'image')                          as images,
    count(*) filter (where kind = 'model')                          as models,
    count(*) filter (where kind = 'video')                          as videos,
    coalesce(sum(credits_charged), 0)                               as credits_spent
from public.generations
where created_at >= now() - interval '30 days'
  and status = 'complete'
group by owner_id;
