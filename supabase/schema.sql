-- HR electronic signature collection MVP schema
-- Run this in the Supabase SQL editor after enabling Auth.

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin');
create type public.campaign_status as enum ('draft', 'sending', 'active', 'completed', 'expired');
create type public.recipient_status as enum ('not_sent', 'sent', 'viewed', 'signed', 'expired');
create type public.email_type as enum ('initial', 'reminder');
create type public.email_status as enum ('queued', 'sent', 'failed');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role public.app_role not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.signature_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.users(id),
  title text not null,
  description text,
  due_at timestamptz,
  document_content text not null,
  document_version text not null default 'v1',
  original_document_hash text not null,
  status public.campaign_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.signature_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.signature_campaigns(id) on delete cascade,
  name text not null,
  email text not null,
  employee_no text,
  department text,
  title text,
  status public.recipient_status not null default 'not_sent',
  token_id uuid not null default gen_random_uuid(),
  token_hash text not null unique,
  token_expires_at timestamptz,
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, email)
);

create table public.signature_submissions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.signature_campaigns(id) on delete cascade,
  recipient_id uuid not null unique references public.signature_recipients(id) on delete restrict,
  signature_image_path text not null,
  signature_image_hash text not null,
  completed_document_path text,
  completed_document_hash text not null,
  consent_checked boolean not null,
  submitted_at timestamptz not null default now(),
  locked boolean not null default true,
  created_at timestamptz not null default now(),
  constraint signature_submissions_consent_true check (consent_checked is true),
  constraint signature_submissions_locked_true check (locked is true)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.signature_campaigns(id) on delete restrict,
  recipient_id uuid not null references public.signature_recipients(id) on delete restrict,
  submission_id uuid references public.signature_submissions(id) on delete restrict,
  signer_name text not null,
  signer_email text not null,
  employee_no text,
  department text,
  submitted_at timestamptz not null,
  ip_address inet,
  user_agent text,
  consent_checked boolean not null,
  document_version text not null,
  original_document_hash text not null,
  signature_image_hash text not null,
  completed_document_hash text not null,
  token_id uuid not null,
  edit_after_completion_allowed boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.email_logs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.signature_campaigns(id) on delete cascade,
  recipient_id uuid not null references public.signature_recipients(id) on delete cascade,
  to_email text not null,
  type public.email_type not null,
  provider text not null default 'resend',
  status public.email_status not null default 'queued',
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create index signature_campaigns_created_by_idx on public.signature_campaigns(created_by);
create index signature_recipients_campaign_id_idx on public.signature_recipients(campaign_id);
create index signature_recipients_status_idx on public.signature_recipients(status);
create index audit_logs_campaign_id_idx on public.audit_logs(campaign_id);
create index email_logs_campaign_id_idx on public.email_logs(campaign_id);

alter table public.users enable row level security;
alter table public.signature_campaigns enable row level security;
alter table public.signature_recipients enable row level security;
alter table public.signature_submissions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.email_logs enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create policy "admins can read users"
on public.users for select
to authenticated
using (public.is_admin());

create policy "users can read self"
on public.users for select
to authenticated
using (id = auth.uid());

create policy "admins manage campaigns"
on public.signature_campaigns for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "admins manage recipients"
on public.signature_recipients for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "admins read submissions"
on public.signature_submissions for select
to authenticated
using (public.is_admin());

create policy "admins read audit logs"
on public.audit_logs for select
to authenticated
using (public.is_admin());

create policy "admins read email logs"
on public.email_logs for select
to authenticated
using (public.is_admin());

-- Public signing pages should not get broad table access. Use RPCs instead.
revoke all on public.signature_campaigns from anon;
revoke all on public.signature_recipients from anon;
revoke all on public.signature_submissions from anon;
revoke all on public.audit_logs from anon;
revoke all on public.email_logs from anon;

create or replace function public.sha256_hex(value text)
returns text
language sql
immutable
as $$
  select encode(digest(value, 'sha256'), 'hex');
$$;

create or replace function public.get_signing_request(p_token text)
returns table (
  campaign_id uuid,
  recipient_id uuid,
  title text,
  description text,
  due_at timestamptz,
  document_content text,
  document_version text,
  original_document_hash text,
  signer_name text,
  signer_email text,
  employee_no text,
  department text,
  signer_title text,
  status public.recipient_status
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text := public.sha256_hex(p_token);
  v_recipient_id uuid;
begin
  update public.signature_recipients
  set status = 'expired'
  where token_hash = v_token_hash
    and status <> 'signed'
    and token_expires_at is not null
    and token_expires_at < now();

  update public.signature_recipients
  set status = 'viewed',
      viewed_at = coalesce(viewed_at, now())
  where token_hash = v_token_hash
    and status = 'sent'
    and (token_expires_at is null or token_expires_at >= now())
  returning id into v_recipient_id;

  return query
  select
    c.id,
    r.id,
    c.title,
    c.description,
    c.due_at,
    c.document_content,
    c.document_version,
    c.original_document_hash,
    r.name,
    r.email,
    r.employee_no,
    r.department,
    r.title,
    r.status
  from public.signature_recipients r
  join public.signature_campaigns c on c.id = r.campaign_id
  where r.token_hash = v_token_hash
    and r.status in ('sent', 'viewed')
    and (r.token_expires_at is null or r.token_expires_at >= now());
end;
$$;

create or replace function public.submit_signature(
  p_token text,
  p_signature_image_path text,
  p_signature_image_hash text,
  p_completed_document_hash text,
  p_consent_checked boolean,
  p_user_agent text,
  p_ip_address inet default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text := public.sha256_hex(p_token);
  v_recipient public.signature_recipients%rowtype;
  v_campaign public.signature_campaigns%rowtype;
  v_submission_id uuid;
begin
  if p_consent_checked is not true then
    raise exception 'consent_required';
  end if;

  select * into v_recipient
  from public.signature_recipients
  where token_hash = v_token_hash
  for update;

  if not found then
    raise exception 'invalid_token';
  end if;

  if v_recipient.status = 'signed' then
    raise exception 'already_signed';
  end if;

  if v_recipient.token_expires_at is not null and v_recipient.token_expires_at < now() then
    update public.signature_recipients set status = 'expired' where id = v_recipient.id;
    raise exception 'expired_token';
  end if;

  select * into v_campaign from public.signature_campaigns where id = v_recipient.campaign_id;

  insert into public.signature_submissions (
    campaign_id,
    recipient_id,
    signature_image_path,
    signature_image_hash,
    completed_document_hash,
    consent_checked
  )
  values (
    v_campaign.id,
    v_recipient.id,
    p_signature_image_path,
    p_signature_image_hash,
    p_completed_document_hash,
    true
  )
  returning id into v_submission_id;

  update public.signature_recipients
  set status = 'signed',
      signed_at = now()
  where id = v_recipient.id;

  insert into public.audit_logs (
    campaign_id,
    recipient_id,
    submission_id,
    signer_name,
    signer_email,
    employee_no,
    department,
    submitted_at,
    ip_address,
    user_agent,
    consent_checked,
    document_version,
    original_document_hash,
    signature_image_hash,
    completed_document_hash,
    token_id,
    edit_after_completion_allowed
  )
  values (
    v_campaign.id,
    v_recipient.id,
    v_submission_id,
    v_recipient.name,
    v_recipient.email,
    v_recipient.employee_no,
    v_recipient.department,
    now(),
    p_ip_address,
    p_user_agent,
    true,
    v_campaign.document_version,
    v_campaign.original_document_hash,
    p_signature_image_hash,
    p_completed_document_hash,
    v_recipient.token_id,
    false
  );

  return v_submission_id;
end;
$$;

grant execute on function public.get_signing_request(text) to anon, authenticated;
grant execute on function public.submit_signature(text, text, text, text, boolean, text, inet) to anon, authenticated;

-- Private storage buckets. Create in Supabase Storage UI or with service role:
-- signatures: private, stores signature PNGs by campaign/recipient/submission.
-- completed-documents: private, stores generated signed PDFs when PDF generation is added.

-- TODO(security): send emails from a Supabase Edge Function using service role.
-- TODO(security): hash recipient tokens before insertion; never store raw tokens in this table.
-- TODO(security): add company email OTP or magic-link verification before submit_signature for production.
