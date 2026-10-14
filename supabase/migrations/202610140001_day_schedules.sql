begin;
alter table public.taskkanri_documents add column if not exists legacy_payload jsonb;
create or replace function public.save_taskkanri_document(expected_revision bigint,mutation_id uuid,payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u uuid := auth.uid();
  r bigint;
  h text;
  previous public.taskkanri_mutations%rowtype;
  stamp timestamptz;
  object_keys text[] := array['weeklyTemplate','weeklyRules','dateOverrides','configEvents','calendarHolidays','customHolidays','dayProfiles','timeConfig','daySlotConfig','instructionDayConfig'];
  k text;
  new_contract boolean;
  existing_payload jsonb;
begin
  if u is null then raise exception 'authentication_required' using errcode='42501'; end if;
  -- Lock a row that already exists, including during concurrent first creation.
  perform 1 from public.taskkanri_allowed_users where user_id=u for update;
  if not found then raise exception 'user_not_allowed' using errcode='42501'; end if;
  if expected_revision is null or expected_revision<0 or mutation_id is null then raise exception 'invalid_request' using errcode='22023'; end if;
  if jsonb_typeof(payload) is distinct from 'object'
    or (((payload->'contractVersion' = '1'::jsonb and payload->'appSchemaVersion' = '7'::jsonb)
      or (payload->'contractVersion' = '2'::jsonb and payload->'appSchemaVersion' = '8'::jsonb)) is distinct from true)
    or not (payload ?& array['contractVersion','appSchemaVersion','state'])
    or jsonb_typeof(payload->'state') is distinct from 'object'
  then raise exception 'invalid_contract' using errcode='22023'; end if;
  new_contract := payload->'appSchemaVersion' = '8'::jsonb;
  if new_contract then
    object_keys := array['dateSchedules','configEvents','calendarHolidays','customHolidays','dayProfiles','timeConfig','daySlotConfig','instructionDayConfig'];
  end if;
  if (select count(*) from jsonb_object_keys(payload))<>3
    or (select count(*) from jsonb_object_keys(payload->'state'))<>(case when new_contract then 11 else 13 end)
    or jsonb_typeof(payload->'state'->'currentYear') is distinct from 'number'
    or jsonb_typeof(payload->'state'->'globalTaskData') is distinct from 'string'
    or jsonb_typeof(payload->'state'->'countSettings') is distinct from 'array'
  then raise exception 'invalid_shared_state' using errcode='22023'; end if;
  foreach k in array object_keys loop
    if jsonb_typeof(payload->'state'->k) is distinct from 'object' then raise exception 'invalid_shared_key: %',k using errcode='22023'; end if;
  end loop;
  select d.revision,d.payload into r,existing_payload from public.taskkanri_documents d where d.user_id=u;
  -- Check before duplicate receipts: an old client must visibly require an update.
  if not new_contract and existing_payload->'appSchemaVersion' = '8'::jsonb then
    raise exception 'app_update_required' using errcode='22023';
  end if;
  h := encode(sha256(convert_to(payload::text,'UTF8')),'hex');
  select m.* into previous from public.taskkanri_mutations m where m.user_id=u and m.mutation_id=save_taskkanri_document.mutation_id;
  if found then
    if previous.payload_hash<>h then raise exception 'mutation_id_reused' using errcode='22023'; end if;
    return jsonb_build_object('status','duplicate','appliedRevision',previous.applied_revision,'updatedAt',previous.created_at);
  end if;
  r := coalesce(r,0);
  if r<>expected_revision then return jsonb_build_object('status','conflict','currentRevision',r); end if;
  if r>=9007199254740991 then raise exception 'revision_limit' using errcode='22023'; end if;
  stamp := clock_timestamp();
  insert into public.taskkanri_documents(user_id,payload,revision,updated_at) values(u,save_taskkanri_document.payload,r+1,stamp)
    on conflict(user_id) do update set
      legacy_payload=case
        when public.taskkanri_documents.legacy_payload is null
          and public.taskkanri_documents.payload->'appSchemaVersion' = '7'::jsonb
          and excluded.payload->'appSchemaVersion' = '8'::jsonb
        then public.taskkanri_documents.payload
        else public.taskkanri_documents.legacy_payload end,
      payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at;
  insert into public.taskkanri_mutations(user_id,mutation_id,payload_hash,applied_revision,created_at)
    values(u,save_taskkanri_document.mutation_id,h,r+1,stamp);
  delete from public.taskkanri_mutations m where m.user_id=u and m.created_at<stamp-interval '7 days';
  return jsonb_build_object('status','saved','appliedRevision',r+1,'updatedAt',stamp);
end;
$$;
commit;
