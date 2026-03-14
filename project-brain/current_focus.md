# Current Focus

## Top Priority

**LT Proteros sandbox SMS test flows** — building and validating TEST workflows for the missed call → SMS → AI → booking pipeline.

## Phase

TEST environment stabilization and SMS flow validation.

## Why This Is the Priority

The core revenue flow (missed call → SMS → AI → booking → calendar) has all API endpoints built and tested (214/214 tests passing), but has never been verified end-to-end with real services. The TEST sandbox workflows are the bridge between unit-tested code and a working demo.

## What "Done" Looks Like

All TEST workflow JSONs committed, importable into n8n, executing successfully in sandbox with test credentials. A missed call can trigger SMS, receive a reply, detect booking intent, create an appointment, and sync to Google Calendar.

## Constraints

- n8n credentials (postgres, openai, twilio) must be manually configured — Human action required
- Google Calendar OAuth needs end-to-end verification — Human action required
- Until credentials are provided, Claude can only build/test code that doesn't require live service calls
