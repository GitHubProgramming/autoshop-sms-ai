# Current Focus

## Top Priority

**Verify the core missed call → SMS → AI → booking → calendar pipeline end-to-end.** All API endpoints are built and unit-tested (214/214 passing). The gap is between isolated tests and a working demo with real services.

## Phase

End-to-end pipeline verification. TEST sandbox workflows are the current mechanism, but any path that proves the pipeline works is valid.

## Why This Is the Priority

This is the entire revenue flow. Nothing else matters until a missed call can trigger an SMS, the customer can reply, AI detects booking intent, an appointment is created, and it syncs to Google Calendar. Every other feature (billing, admin, dashboards) depends on this working.

## What "Done" Looks Like

A missed call triggers SMS, customer replies, AI conversation runs, booking intent is detected, appointment is created, and Google Calendar event appears. Verified with real service calls, not just unit tests.

## Constraints

- n8n credentials (postgres, openai, twilio) must be manually configured — Human action required
- Google Calendar OAuth needs end-to-end verification — Human action required
- Until credentials are provided, Claude can only build/test code that doesn't require live service calls
