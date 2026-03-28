-- Add export_status and smartlead_status columns to lead_master
-- Required by WF-PREPARE-SMARTLEAD-EXPORT

ALTER TABLE lead_master
  ADD COLUMN IF NOT EXISTS export_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS smartlead_status TEXT DEFAULT 'none';

-- Index for the export workflow SELECT query
CREATE INDEX IF NOT EXISTS idx_lead_master_export_candidates
  ON lead_master (outreach_status, lead_status, email_status)
  WHERE outreach_status = 'none'
    AND lead_status = 'approved'
    AND email_status IN ('verified', 'risky')
    AND email IS NOT NULL
    AND domain IS NOT NULL;

COMMENT ON COLUMN lead_master.export_status IS 'pending | ready | blocked | duplicate';
COMMENT ON COLUMN lead_master.smartlead_status IS 'none | pending_export | exported | not_exportable';
