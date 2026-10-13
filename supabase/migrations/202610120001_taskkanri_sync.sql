begin;
create table public.taskkanri_allowed_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table public.taskkanri_documents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  revision bigint not null check(revision between 1 and 9007199254740991),
  updated_at timestamptz not null default now()
);
create table public.taskkanri_mutations (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  payload_hash text not null,
  applied_revision bigint not null,
  created_at timestamptz not null default now(),
  primary key(user_id,mutation_id)
);
alter table public.taskkanri_allowed_users enable row level security;
alter table public.taskkanri_documents enable row level security;
alter table public.taskkanri_mutations enable row level security;
revoke all on public.taskkanri_allowed_users,public.taskkanri_documents,public.taskkanri_mutations from public,anon,authenticated;
grant select on public.taskkanri_documents to authenticated;

create function public.taskkanri_is_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.taskkanri_allowed_users where user_id=auth.uid());
$$;
revoke all on function public.taskkanri_is_allowed() from public,anon;
grant execute on function public.taskkanri_is_allowed() to authenticated;
create policy taskkanri_read_own on public.taskkanri_documents for select to authenticated
  using(user_id=auth.uid() and public.taskkanri_is_allowed());

create function public.save_taskkanri_document(expected_revision bigint,mutation_id uuid,payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  r bigint;
  h text;
  previous public.taskkanri_mutations%rowtype;
  stamp timestamptz;
  object_keys text[] := array['weeklyTemplate','weeklyRules','dateOverrides','configEvents','calendarHolidays','customHolidays','dayProfiles','timeConfig','daySlotConfig','instructionDayConfig'];
  k text;
begin
  if u is null then raise exception 'authentication_required' using errcode='42501'; end if;
  -- Lock a row that already exists, including during concurrent first creation.
  perform 1 from public.taskkanri_allowed_users where user_id=u for update;
  if not found then raise exception 'user_not_allowed' using errcode='42501'; end if;
  if expected_revision is null or expected_revision<0 or mutation_id is null then raise exception 'invalid_request' using errcode='22023'; end if;
  if jsonb_typeof(payload) is distinct from 'object'
    or payload->'contractVersion' is distinct from '1'::jsonb
    or payload->'appSchemaVersion' is distinct from '7'::jsonb
    or jsonb_typeof(payload->'state') is distinct from 'object'
  then raise exception 'invalid_contract' using errcode='22023'; end if;
  if (select count(*) from jsonb_object_keys(payload))<>3
    or (select count(*) from jsonb_object_keys(payload->'state'))<>13
    or jsonb_typeof(payload->'state'->'currentYear') is distinct from 'number'
    or jsonb_typeof(payload->'state'->'globalTaskData') is distinct from 'string'
    or jsonb_typeof(payload->'state'->'countSettings') is distinct from 'array'
  then raise exception 'invalid_shared_state' using errcode='22023'; end if;
  foreach k in array object_keys loop
    if jsonb_typeof(payload->'state'->k) is distinct from 'object' then raise exception 'invalid_shared_key: %',k using errcode='22023'; end if;
  end loop;
  h := encode(sha256(convert_to(payload::text,'UTF8')),'hex');
  select m.* into previous from public.taskkanri_mutations m where m.user_id=u and m.mutation_id=save_taskkanri_document.mutation_id;
  if found then
    if previous.payload_hash<>h then raise exception 'mutation_id_reused' using errcode='22023'; end if;
    return jsonb_build_object('status','duplicate','appliedRevision',previous.applied_revision,'updatedAt',previous.created_at);
  end if;
  select d.revision into r from public.taskkanri_documents d where d.user_id=u;
  r := coalesce(r,0);
  if r<>expected_revision then return jsonb_build_object('status','conflict','currentRevision',r); end if;
  if r>=9007199254740991 then raise exception 'revision_limit' using errcode='22023'; end if;
  stamp := clock_timestamp();
  insert into public.taskkanri_documents(user_id,payload,revision,updated_at) values(u,save_taskkanri_document.payload,r+1,stamp)
    on conflict(user_id) do update set payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at;
  insert into public.taskkanri_mutations(user_id,mutation_id,payload_hash,applied_revision,created_at)
    values(u,save_taskkanri_document.mutation_id,h,r+1,stamp);
  delete from public.taskkanri_mutations m where m.user_id=u and m.created_at<stamp-interval '7 days';
  return jsonb_build_object('status','saved','appliedRevision',r+1,'updatedAt',stamp);
end;
$$;
revoke all on function public.save_taskkanri_document(bigint,uuid,jsonb) from public,anon;
grant execute on function public.save_taskkanri_document(bigint,uuid,jsonb) to authenticated;
commit;
