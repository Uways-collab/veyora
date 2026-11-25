-- Enforce the image upload limit in Storage itself. PDF/document uploads retain their existing limits.
create or replace function public.enforce_storage_image_upload_size_limit()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  v_mime text;
  v_size_text text;
  v_size bigint;
  v_is_image boolean;
begin
  v_mime := lower(coalesce(new.metadata->>'mimetype',''));
  v_size_text := coalesce(
    nullif(new.metadata->>'size',''),
    nullif(new.metadata->>'contentLength','')
  );
  v_is_image := v_mime like 'image/%'
    or lower(new.name) ~ '\.(avif|bmp|gif|jpe?g|png|svg|tiff?|webp)$';

  if not v_is_image then
    return new;
  end if;

  if v_size_text is null then
    raise exception 'IMAGE_UPLOAD_SIZE_REQUIRED: image uploads must include a verifiable byte size.'
      using errcode='22023';
  end if;

  begin
    v_size := v_size_text::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'IMAGE_UPLOAD_SIZE_INVALID: image upload size could not be verified.'
      using errcode='22023';
  end;

  if v_size < 0 or v_size > 102400 then
    raise exception 'IMAGE_UPLOAD_TOO_LARGE: images must be compressed to 100 KB or less before upload.'
      using errcode='22023';
  end if;

  return new;
end;
$function$;

drop trigger if exists enforce_storage_image_upload_size_limit on storage.objects;
create trigger enforce_storage_image_upload_size_limit
before insert or update of bucket_id,name,metadata on storage.objects
for each row execute function public.enforce_storage_image_upload_size_limit();

-- Receipt-logo uploads also require an active subscription, in addition to owner/admin role.
drop policy if exists org_admin_upload_receipt_logos on storage.objects;
create policy org_admin_upload_receipt_logos
on storage.objects for insert to authenticated
with check (
  bucket_id='organisation-files'
  and (storage.foldername(name))[2]='settings'
  and storage.filename(name) like 'receipt-logo-%'
  and has_sales_role((storage.foldername(name))[1]::uuid,array['owner','admin']::text[])
  and private.organization_has_access((storage.foldername(name))[1]::uuid,null)
);

revoke all on function public.enforce_storage_image_upload_size_limit() from public,anon,authenticated;
