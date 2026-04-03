-- Lead master table for outreach pipeline
-- Used by: wf-scrape-texas-leads, wf-enrich-emails-basic, wf-prepare-smartlead-export, wf-export-to-smartlead

CREATE TABLE IF NOT EXISTS lead_master (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name   TEXT,
  website         TEXT,
  domain          TEXT,
  email           TEXT,
  email_status    TEXT NOT NULL DEFAULT 'missing',
  email_source_url TEXT,
  email_found_at  TIMESTAMPTZ,
  lead_status     TEXT NOT NULL DEFAULT 'new',
  outreach_status TEXT NOT NULL DEFAULT 'none',
  export_status   TEXT NOT NULL DEFAULT 'pending',
  smartlead_status TEXT NOT NULL DEFAULT 'none',
  needs_manual_review BOOLEAN NOT NULL DEFAULT false,
  phone           TEXT,
  address         TEXT,
  city            TEXT,
  state           TEXT,
  place_id        TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for enrichment workflow (fetch leads needing email)
CREATE INDEX IF NOT EXISTS idx_lead_master_enrichment
  ON lead_master (lead_status, email_status, outreach_status)
  WHERE website IS NOT NULL AND domain IS NOT NULL;

-- Index for export workflow (fetch export candidates)
CREATE INDEX IF NOT EXISTS idx_lead_master_export_candidates
  ON lead_master (outreach_status, lead_status, email_status)
  WHERE outreach_status = 'none'
    AND lead_status = 'approved'
    AND email_status IN ('verified', 'risky')
    AND email IS NOT NULL
    AND domain IS NOT NULL;
