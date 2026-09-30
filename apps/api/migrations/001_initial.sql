CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'LKR', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL, address text NOT NULL, timezone text NOT NULL DEFAULT 'Asia/Colombo',
  contact text, active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), branch_id uuid NOT NULL REFERENCES branches(id),
  name text NOT NULL, capacity integer NOT NULL DEFAULT 1 CHECK (capacity > 0), active boolean NOT NULL DEFAULT true,
  UNIQUE(branch_id, name)
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
  password_hash text NOT NULL, name text NOT NULL, phone text,
  role text NOT NULL DEFAULT 'client' CHECK(role IN ('client','practitioner','receptionist','manager','admin')),
  branch_id uuid REFERENCES branches(id), locale text NOT NULL DEFAULT 'en' CHECK(locale IN ('en','si','ta')),
  birth_date date, verified_at timestamptz, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS practitioners (
  user_id uuid PRIMARY KEY REFERENCES users(id), bio text NOT NULL DEFAULT '',
  qualifications text NOT NULL DEFAULT '', languages text[] NOT NULL DEFAULT ARRAY['en'],
  photo_url text, active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, summary text NOT NULL,
  category text NOT NULL, kind text NOT NULL CHECK(kind IN ('private','group','online')),
  duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 15 AND 240),
  buffer_minutes integer NOT NULL DEFAULT 10 CHECK(buffer_minutes BETWEEN 0 AND 120),
  price_cents integer NOT NULL CHECK(price_cents >= 0), capacity integer NOT NULL DEFAULT 1 CHECK(capacity > 0),
  requires_review boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
  accent text NOT NULL DEFAULT 'sage', image_url text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS service_practitioners (
  service_id uuid NOT NULL REFERENCES services(id), practitioner_id uuid NOT NULL REFERENCES practitioners(user_id),
  PRIMARY KEY(service_id, practitioner_id)
);
CREATE TABLE IF NOT EXISTS availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practitioner_id uuid NOT NULL REFERENCES practitioners(user_id),
  branch_id uuid NOT NULL REFERENCES branches(id), weekday integer NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  start_time time NOT NULL, end_time time NOT NULL, CHECK (start_time < end_time),
  UNIQUE(practitioner_id, branch_id, weekday, start_time)
);
CREATE TABLE IF NOT EXISTS availability_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), practitioner_id uuid NOT NULL REFERENCES practitioners(user_id),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, reason text NOT NULL DEFAULT 'Unavailable',
  CHECK(starts_at < ends_at)
);
CREATE TABLE IF NOT EXISTS session_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), service_id uuid NOT NULL REFERENCES services(id),
  branch_id uuid NOT NULL REFERENCES branches(id), practitioner_id uuid NOT NULL REFERENCES practitioners(user_id),
  room_id uuid REFERENCES rooms(id), starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  occupied_start_at timestamptz NOT NULL, occupied_end_at timestamptz NOT NULL,
  capacity integer NOT NULL CHECK(capacity > 0), kind text NOT NULL CHECK(kind IN ('private','group','online')),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(occupied_start_at < occupied_end_at), CHECK(starts_at < ends_at),
  CONSTRAINT practitioner_no_overlap EXCLUDE USING gist
    (practitioner_id WITH =, tstzrange(occupied_start_at, occupied_end_at, '[)') WITH &&)
    WHERE(status = 'open'),
  CONSTRAINT room_no_overlap EXCLUDE USING gist
    (room_id WITH =, tstzrange(occupied_start_at, occupied_end_at, '[)') WITH &&)
    WHERE(status = 'open' AND room_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS slots_window_idx ON session_slots(branch_id, starts_at, status);
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slot_id uuid NOT NULL REFERENCES session_slots(id),
  client_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK(status IN ('pending_review','pending_payment','confirmed','checked_in','completed','cancelled','no_show')),
  review_status text NOT NULL CHECK(review_status IN ('not_required','pending','approved','declined','more_information')),
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','paid','refunded')),
  price_cents integer NOT NULL CHECK(price_cents >= 0), hold_expires_at timestamptz,
  booked_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  cancellation_reason text, UNIQUE(slot_id, client_id)
);
CREATE INDEX IF NOT EXISTS bookings_client_idx ON bookings(client_id, booked_at DESC);
CREATE INDEX IF NOT EXISTS bookings_status_expiry_idx ON bookings(status, hold_expires_at);
CREATE TABLE IF NOT EXISTS booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL REFERENCES bookings(id),
  actor_id uuid REFERENCES users(id), action text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS intake_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version integer NOT NULL UNIQUE,
  title text NOT NULL, questions jsonb NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS intake_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id),
  form_id uuid NOT NULL REFERENCES intake_forms(id), ciphertext text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id),
  client_id uuid NOT NULL REFERENCES users(id), policy_version text NOT NULL,
  agreed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS practitioner_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL REFERENCES bookings(id),
  practitioner_id uuid NOT NULL REFERENCES users(id), decision text NOT NULL,
  comment_ciphertext text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS session_notes (
  booking_id uuid PRIMARY KEY REFERENCES bookings(id), practitioner_id uuid NOT NULL REFERENCES users(id),
  ciphertext text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id),
  amount_cents integer NOT NULL, provider text NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','paid','failed','refunded')),
  idempotency_key text NOT NULL UNIQUE, external_reference text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payment_events (
  event_id text PRIMARY KEY, payment_id uuid NOT NULL REFERENCES payments(id),
  event_type text NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id),
  number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  amount_cents integer NOT NULL, issued_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), service_id uuid NOT NULL REFERENCES services(id),
  name text NOT NULL, sessions integer NOT NULL CHECK(sessions > 0), price_cents integer NOT NULL CHECK(price_cents >= 0),
  validity_days integer NOT NULL CHECK(validity_days > 0), active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS package_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), package_id uuid NOT NULL REFERENCES packages(id),
  client_id uuid NOT NULL REFERENCES users(id), remaining_sessions integer NOT NULL CHECK(remaining_sessions >= 0),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), service_id uuid NOT NULL REFERENCES services(id),
  client_id uuid NOT NULL REFERENCES users(id), desired_date date NOT NULL, branch_id uuid NOT NULL REFERENCES branches(id),
  status text NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','offered','fulfilled','expired','cancelled')),
  offer_expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_id, client_id, desired_date, branch_id)
);
CREATE TABLE IF NOT EXISTS notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  template text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', channel text NOT NULL DEFAULT 'in_app',
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','delivered','failed')),
  attempt_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz
);
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id),
  action text NOT NULL, entity_type text NOT NULL, entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS incident_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL REFERENCES bookings(id),
  reporter_id uuid NOT NULL REFERENCES users(id), ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
