-- Safety-first: change booking_state default from CONFIRMED_CALENDAR to PENDING_MANUAL_CONFIRMATION
-- Appointments must not default to "confirmed" — confirmation is earned by successful calendar sync.
-- Existing rows are NOT changed (only new rows affected).

ALTER TABLE appointments
  ALTER COLUMN booking_state SET DEFAULT 'PENDING_MANUAL_CONFIRMATION';
