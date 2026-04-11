# WF-LT-ZADARMA-MISSED-CALL

LT pilot missed-call handler: Zadarma → n8n webhook → SMS reply → internal log.

**Status:** Step 1 of 3 — SMS sender is a placeholder (httpbin.org/post). Step 2 replaces it with the real Zadarma SMS API.

## Webhook URL

```
https://bandomasis.app.n8n.cloud/webhook/lt-zadarma-missed-call
```

Configure this URL in the Zadarma PBX notification settings for the LT DID `+37045512300`.

## Required n8n credentials (create manually before import)

Both credentials use the **Header Auth** type. Create them in n8n before importing this workflow, otherwise the webhook and logging nodes will fail on first execution.

| Credential name          | Header name        | Header value                                         |
|--------------------------|--------------------|------------------------------------------------------|
| `zadarma-webhook-secret` | `x-zadarma-secret` | Shared secret agreed with Zadarma (inbound guard)    |
| `internal-api-key`       | `x-internal-key`   | Internal API key for `autoshop-api-7ek9.onrender.com`|

## Flow

1. **Webhook: Zadarma Missed Call** — POST `/webhook/lt-zadarma-missed-call`, gated by `x-zadarma-secret` Header Auth.
2. **Parse Zadarma payload** — extracts `caller_number`, `called_number`, `event_type`, `call_status`, `call_start`.
3. **Is missed call?** — requires `call_status ∈ {"no answer","busy","cancel"}`, non-empty `caller_number`, and `caller_number != called_number`.
4. **Build SMS payload** — LT-language reply from `+37045512300` for tenant `lt-proteros-servisas`.
5. **Send SMS via Zadarma** — **PLACEHOLDER** → `https://httpbin.org/post`. Replaced in Step 2.
6. **Log to internal API** → `POST /internal/lt-log-conversation` with `x-internal-key` header.
7. **Respond: OK** → `200 { "ok": true }`.
8. **Respond: Skipped** (false branch) → `200 { "ok": true, "skipped": true, "reason": "not a missed call" }`.

## Test curl — sample Zadarma NOTIFY_END payload

```bash
curl -X POST "https://bandomasis.app.n8n.cloud/webhook/lt-zadarma-missed-call" \
  -H "Content-Type: application/json" \
  -H "x-zadarma-secret: REPLACE_WITH_SHARED_SECRET" \
  -d '{
    "event": "NOTIFY_END",
    "caller_id": "+37067577829",
    "called_did": "+37045512300",
    "disposition": "no answer",
    "call_start": "2026-04-11T10:15:00+03:00",
    "call_id": "zd-test-0001"
  }'
```

Expected response:

```json
{ "ok": true }
```

### Negative test (should take false branch)

```bash
curl -X POST "https://bandomasis.app.n8n.cloud/webhook/lt-zadarma-missed-call" \
  -H "Content-Type: application/json" \
  -H "x-zadarma-secret: REPLACE_WITH_SHARED_SECRET" \
  -d '{
    "event": "NOTIFY_END",
    "caller_id": "+37067577829",
    "called_did": "+37045512300",
    "disposition": "answered",
    "call_start": "2026-04-11T10:15:00+03:00"
  }'
```

Expected response:

```json
{ "ok": true, "skipped": true, "reason": "not a missed call" }
```

## Notes

- The `Send SMS via Zadarma` node is intentionally `continueOnFail: true` so the logging node still runs even if the placeholder endpoint is unreachable.
- Workflow ships with `active: false` — activate manually in n8n after credentials are created and a dry-run test passes.
- Step 2 will swap the httpbin URL for the real Zadarma SMS API and move the shared secret out of the curl example into an env reference.
- Step 3 will wire the inbound SMS side (customer replies) back into the SMS AI conversation loop.
