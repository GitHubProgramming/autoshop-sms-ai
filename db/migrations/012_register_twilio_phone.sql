-- Register production Twilio phone number for the admin tenant.
-- Idempotent: skips if phone number already exists.
-- Tenant: mantas.gipiskis@gmail.com (90d1e2f2-b499-4710-9134-bab0a9a5ab4c)
-- Phone: +13257523890 (Texas 325 area code)
-- Twilio SID: PNf77089f763ad788a2ea7bf65e71c181a

INSERT INTO tenant_phone_numbers (tenant_id, twilio_sid, phone_number, status)
VALUES (
  '90d1e2f2-b499-4710-9134-bab0a9a5ab4c',
  'PNf77089f763ad788a2ea7bf65e71c181a',
  '+13257523890',
  'active'
)
ON CONFLICT (phone_number) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  twilio_sid = EXCLUDED.twilio_sid,
  status = 'active';
