-- Postgres side of the fixture. Applied before metadata.json, which references
-- both the table and the computed-field function.

create table if not exists patient_consent (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null,
  granted_at timestamptz,
  note       text
);

-- Backs the `is_active` computed field. The parameter cannot be named `row` —
-- that is reserved, and Postgres rejects the definition.
create or replace function consent_is_active(pc patient_consent)
returns boolean as $$
  select pc.granted_at is not null
$$ language sql stable;

-- Two rows share a patient_id and one does not, so the dry-run test compares a
-- predicted count against a subset rather than against every row.
insert into patient_consent (patient_id)
select v.patient_id
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid),
  ('11111111-1111-1111-1111-111111111111'::uuid),
  ('22222222-2222-2222-2222-222222222222'::uuid)
) as v(patient_id)
where not exists (select 1 from patient_consent);
