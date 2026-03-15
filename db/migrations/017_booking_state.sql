-- Add booking_state column to appointments
-- Tracks whether the booking was confirmed via calendar or requires manual confirmation.
--
-- Values:
--   CONFIRMED_CALENDAR         — Google Calendar event created successfully
--   PENDING_MANUAL_CONFIRMATION — Calendar sync failed; shop must confirm manually
--   FAILED                     — Appointment creation or critical step failed

ALTER TABLE appointments
  ADD COLUMN booking_state TEXT NOT NULL DEFAULT 'CONFIRMED_CALENDAR';

-- Backfill: existing rows with calendar_synced = FALSE should be PENDING
UPDATE appointments
  SET booking_state = 'PENDING_MANUAL_CONFIRMATION'
  WHERE calendar_synced = FALSE AND google_event_id IS NULL;
