-- Add forward_to column to tenant_phone_numbers.
-- When a call arrives on the Twilio number, the voice webhook
-- dials this number (the shop's real phone) and waits for an answer.
-- If no answer → voice-status fires → missed-call SMS is sent.

ALTER TABLE tenant_phone_numbers
  ADD COLUMN IF NOT EXISTS forward_to TEXT;

-- Set the pilot shop's forwarding number to the owner's phone.
-- This can be updated per-tenant via admin settings later.
UPDATE tenant_phone_numbers
SET forward_to = (
  SELECT owner_phone FROM tenants WHERE id = tenant_phone_numbers.tenant_id
)
WHERE forward_to IS NULL
  AND EXISTS (
    SELECT 1 FROM tenants WHERE id = tenant_phone_numbers.tenant_id AND owner_phone IS NOT NULL
  );
