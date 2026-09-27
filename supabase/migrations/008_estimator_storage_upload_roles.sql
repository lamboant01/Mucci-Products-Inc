-- The public estimator can be opened in a browser that also has an active
-- administrator session. Preserve the existing anonymous upload policy and
-- grant authenticated sessions the identical narrow upload permission.

create policy "authenticated uploads print estimate files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'print-estimate-files'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(stl|3mf|obj|step|stp)$'
);
