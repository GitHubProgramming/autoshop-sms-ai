-- 019_real_data_model.sql
-- Real data model: customers, vehicles, tenant_services, bookings
-- Adds proper pricing fields and booking metadata for real KPI computation.

BEGIN;

-- ── customers ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone           TEXT NOT NULL,
  name            TEXT,
  email           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, phone)
);

CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_customers_phone ON customers(tenant_id, phone);

-- ── vehicles ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  year            INT,
  make            TEXT,
  model           TEXT,
  vin             TEXT,
  license_plate   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, vin)
);

CREATE INDEX idx_vehicles_tenant ON vehicles(tenant_id);
CREATE INDEX idx_vehicles_customer ON vehicles(customer_id);

-- ── tenant_services ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_services (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_name    TEXT NOT NULL,
  default_price   NUMERIC(10,2),
  duration_minutes INT NOT NULL DEFAULT 60,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, service_name)
);

CREATE INDEX idx_tenant_services_tenant ON tenant_services(tenant_id);

-- ── bookings ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id         UUID REFERENCES customers(id),
  vehicle_id          UUID REFERENCES vehicles(id),
  tenant_service_id   UUID REFERENCES tenant_services(id),
  conversation_id     UUID REFERENCES conversations(id),

  -- Source tracking
  booking_source      TEXT NOT NULL DEFAULT 'manual'
                      CHECK (booking_source IN ('ai', 'sms_recovery', 'manual', 'walk_in', 'phone', 'web')),
  booking_status      TEXT NOT NULL DEFAULT 'booked'
                      CHECK (booking_status IN ('booked', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),

  -- Scheduling
  scheduled_start_at  TIMESTAMPTZ,
  scheduled_end_at    TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,

  -- Pricing (final_price is the ONLY source of truth for revenue)
  estimated_price     NUMERIC(10,2),
  quoted_price        NUMERIC(10,2),
  final_price         NUMERIC(10,2),

  -- Service details (denormalized for convenience)
  service_type        TEXT,
  customer_phone      TEXT,
  customer_name       TEXT,
  notes               TEXT,

  -- Calendar sync
  google_event_id     TEXT,
  calendar_synced     BOOLEAN NOT NULL DEFAULT FALSE,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot-path indexes
CREATE INDEX idx_bookings_tenant ON bookings(tenant_id);
CREATE INDEX idx_bookings_customer ON bookings(customer_id);
CREATE INDEX idx_bookings_completed_at ON bookings(tenant_id, completed_at);
CREATE INDEX idx_bookings_status ON bookings(tenant_id, booking_status);
CREATE INDEX idx_bookings_source ON bookings(tenant_id, booking_source);
CREATE INDEX idx_bookings_revenue ON bookings(tenant_id, booking_status, booking_source, completed_at)
  WHERE booking_status = 'completed';

-- ── RLS policies for new tables ─────────────────────────────────────────────
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_customers ON customers
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_vehicles ON vehicles
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_tenant_services ON tenant_services
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_bookings ON bookings
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

COMMIT;
