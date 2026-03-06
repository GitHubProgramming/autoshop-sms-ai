#!/usr/bin/env node
'use strict';
// Builds WF-004 (calendar-sync.json) and updates WF-003 (close-conversation.json)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

// ── WF-004: Calendar Sync + Confirmation SMS ────────────────────────────────
const wf004 = {
  name: "WF-004: Calendar Sync + Confirmation SMS",
  nodes: [
    {
      id: "webhook-trigger",
      name: "Webhook: Calendar Sync Trigger",
      type: "n8n-nodes-base.webhook",
      typeVersion: 1.1,
      position: [250, 300],
      parameters: {
        httpMethod: "POST",
        path: "calendar-sync",
        responseMode: "lastNode",
        options: {}
      },
      webhookId: "calendar-sync-wf004"
    },
    {
      id: "db-fetch-data",
      name: "DB: Fetch Appointment + Tokens",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.3,
      position: [500, 300],
      credentials: {
        postgres: { id: "postgres-creds", name: "AutoShop Postgres" }
      },
      parameters: {
        operation: "executeQuery",
        query: [
          "SET LOCAL app.current_tenant_id = '{{ $json.body.tenantId }}';",
          "SELECT",
          "  a.id               AS appointment_id,",
          "  a.customer_phone,",
          "  a.service_type,",
          "  a.scheduled_at,",
          "  a.duration_minutes,",
          "  t.shop_name,",
          "  t.timezone,",
          "  tpn.phone_number   AS our_phone,",
          "  tct.access_token,",
          "  tct.refresh_token,",
          "  tct.calendar_id,",
          "  tct.token_expiry",
          "FROM appointments a",
          "JOIN tenants t ON t.id = a.tenant_id",
          "JOIN tenant_phone_numbers tpn",
          "  ON tpn.tenant_id = a.tenant_id AND tpn.status = 'active'",
          "LEFT JOIN tenant_calendar_tokens tct",
          "  ON tct.tenant_id = a.tenant_id",
          "WHERE a.id        = '{{ $json.body.appointmentId }}'::uuid",
          "  AND a.tenant_id = '{{ $json.body.tenantId }}'::uuid;"
        ].join('\n'),
        options: {}
      }
    },
    {
      id: "code-calendar-sync",
      name: "Code: Calendar Sync",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [750, 300],
      parameters: {
        jsCode: [
          "// WF-004: Calendar Sync + Confirmation SMS",
          "// Fetches appointment, optionally writes to Google Calendar, always sends SMS",
          "const row = $('DB: Fetch Appointment + Tokens').first().json;",
          "const wh  = $('Webhook: Calendar Sync Trigger').first().json.body;",
          "",
          "// Format date/time for SMS",
          "const tz = row.timezone || 'America/Chicago';",
          "const scheduledAt = new Date(row.scheduled_at);",
          "const dateStr = scheduledAt.toLocaleDateString('en-US', {",
          "  weekday: 'long', month: 'long', day: 'numeric', timeZone: tz",
          "});",
          "const timeStr = scheduledAt.toLocaleTimeString('en-US', {",
          "  hour: 'numeric', minute: '2-digit', timeZone: tz",
          "});",
          "",
          "const serviceType  = row.service_type || 'General Service';",
          "const shopName     = row.shop_name    || 'Your Auto Shop';",
          "const customerPhone = row.customer_phone;",
          "const ourPhone      = row.our_phone;",
          "",
          "// Attempt Google Calendar sync only when all credentials are present",
          "const clientId     = $env.GOOGLE_CLIENT_ID;",
          "const clientSecret = $env.GOOGLE_CLIENT_SECRET;",
          "const canSync      = !!(clientId && clientSecret && row.refresh_token);",
          "",
          "let googleEventId  = '';",
          "let calendarSynced = false;",
          "",
          "if (canSync) {",
          "  try {",
          "    // Step 1: refresh access token",
          "    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {",
          "      method: 'POST',",
          "      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },",
          "      body: new URLSearchParams({",
          "        grant_type:    'refresh_token',",
          "        client_id:     clientId,",
          "        client_secret: clientSecret,",
          "        refresh_token: row.refresh_token,",
          "      }).toString(),",
          "    });",
          "    if (!tokenRes.ok) throw new Error('Token refresh failed: ' + await tokenRes.text());",
          "    const { access_token } = await tokenRes.json();",
          "",
          "    // Step 2: create calendar event",
          "    const endAt     = new Date(scheduledAt.getTime() + (row.duration_minutes || 60) * 60000);",
          "    const calId     = row.calendar_id || 'primary';",
          "    const eventBody = {",
          "      summary:     serviceType + ' — ' + customerPhone,",
          "      description: 'AutoShop AI booking. Service: ' + serviceType,",
          "      start: { dateTime: scheduledAt.toISOString(), timeZone: tz },",
          "      end:   { dateTime: endAt.toISOString(),       timeZone: tz },",
          "    };",
          "",
          "    const calRes = await fetch(",
          "      'https://www.googleapis.com/calendar/v3/calendars/' +",
          "        encodeURIComponent(calId) + '/events',",
          "      {",
          "        method: 'POST',",
          "        headers: {",
          "          'Authorization': 'Bearer ' + access_token,",
          "          'Content-Type':  'application/json',",
          "        },",
          "        body: JSON.stringify(eventBody),",
          "      }",
          "    );",
          "    if (!calRes.ok) throw new Error('Calendar create failed: ' + await calRes.text());",
          "    const calData  = await calRes.json();",
          "    googleEventId  = calData.id || '';",
          "    calendarSynced = true;",
          "",
          "  } catch (err) {",
          "    // Calendar sync failed — SMS still sends below",
          "    console.error('[WF-004] calendar sync error:', err.message);",
          "  }",
          "}",
          "",
          "const smsText = calendarSynced",
          "  ? `Your ${serviceType} appt is confirmed for ${dateStr} at ${timeStr}. Added to our calendar. See you then! - ${shopName}`",
          "  : `Your ${serviceType} appt is confirmed for ${dateStr} at ${timeStr}. See you then! - ${shopName}`;",
          "",
          "return [{",
          "  json: {",
          "    customerPhone,",
          "    ourPhone,",
          "    googleEventId,",
          "    calendarSynced,",
          "    smsText,",
          "    tenantId:      wh.tenantId,",
          "    appointmentId: wh.appointmentId,",
          "  }",
          "}];"
        ].join('\n')
      }
    },
    {
      id: "db-update-appointment",
      name: "DB: Update Appointment Sync",
      type: "n8n-nodes-base.postgres",
      typeVersion: 2.3,
      position: [1000, 300],
      credentials: {
        postgres: { id: "postgres-creds", name: "AutoShop Postgres" }
      },
      parameters: {
        operation: "executeQuery",
        query: [
          "SET LOCAL app.current_tenant_id = '{{ $json.tenantId }}';",
          "UPDATE appointments",
          "SET",
          "  google_event_id = CASE",
          "    WHEN '{{ $json.googleEventId }}' = '' THEN NULL",
          "    ELSE '{{ $json.googleEventId }}'",
          "  END,",
          "  calendar_synced = {{ $json.calendarSynced }}",
          "WHERE id = '{{ $json.appointmentId }}'::uuid;"
        ].join('\n'),
        options: {}
      }
    },
    {
      id: "twilio-send-confirmation",
      name: "Twilio: Send Confirmation SMS",
      type: "n8n-nodes-base.twilio",
      typeVersion: 1,
      position: [1250, 300],
      credentials: {
        twilioApi: { id: "twilio-creds", name: "AutoShop Twilio" }
      },
      parameters: {
        resource: "message",
        operation: "create",
        from: "={{ $json.ourPhone }}",
        to:   "={{ $json.customerPhone }}",
        body: "={{ $json.smsText }}"
      }
    },
    {
      id: "respond-ok",
      name: "Respond 200",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1,
      position: [1500, 300],
      parameters: {
        respondWith: "json",
        responseBody: "={ \"ok\": true }"
      }
    }
  ],
  connections: {
    "Webhook: Calendar Sync Trigger": {
      main: [[{ node: "DB: Fetch Appointment + Tokens", type: "main", index: 0 }]]
    },
    "DB: Fetch Appointment + Tokens": {
      main: [[{ node: "Code: Calendar Sync", type: "main", index: 0 }]]
    },
    "Code: Calendar Sync": {
      main: [[{ node: "DB: Update Appointment Sync", type: "main", index: 0 }]]
    },
    "DB: Update Appointment Sync": {
      main: [[{ node: "Twilio: Send Confirmation SMS", type: "main", index: 0 }]]
    },
    "Twilio: Send Confirmation SMS": {
      main: [[{ node: "Respond 200", type: "main", index: 0 }]]
    }
  },
  pinData: {},
  settings: {
    executionOrder: "v1",
    saveManualExecutions: true
  },
  tags: ["autoshop", "calendar", "core"],
  notes: [
    "Credential boundary: tenant_calendar_tokens must be populated via Google OAuth flow.",
    "If refresh_token is absent or GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET env vars are unset,",
    "calendar sync is skipped but the confirmation SMS is always sent.",
    "To enable calendar sync for a tenant: complete the OAuth flow and INSERT into tenant_calendar_tokens."
  ].join(' ')
};

const wf004Path = path.join(root, 'n8n/workflows/calendar-sync.json');
fs.writeFileSync(wf004Path, JSON.stringify(wf004, null, 2));
// Validate
JSON.parse(fs.readFileSync(wf004Path, 'utf8'));
console.log('calendar-sync.json: OK (' + wf004.nodes.length + ' nodes)');

// ── Update WF-003: close-conversation.json ──────────────────────────────────
// After "DB: Create Appointment" insert the "Trigger: Calendar Sync (WF-004)" node,
// then chain into the existing "Respond 200".
const wf003Path = path.join(root, 'n8n/workflows/close-conversation.json');
const wf003 = JSON.parse(fs.readFileSync(wf003Path, 'utf8'));

// 1. Add the new HTTP trigger node
const calSyncTriggerNode = {
  id: "trigger-calendar-sync",
  name: "Trigger: Calendar Sync (WF-004)",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.1,
  position: [1250, 200],
  parameters: {
    method: "POST",
    url: "http://n8n:5678/webhook/calendar-sync",
    sendBody: true,
    bodyParameters: {
      parameters: [
        {
          name: "tenantId",
          value: "={{ $('Webhook: Close Conversation').first().json.body.tenantId }}"
        },
        {
          name: "appointmentId",
          value: "={{ $('DB: Create Appointment').first().json.id }}"
        }
      ]
    },
    options: {}
  },
  notes: "Calls WF-004 to write Google Calendar event + send confirmation SMS"
};

// Check if already added (idempotent re-run)
if (!wf003.nodes.find(n => n.id === 'trigger-calendar-sync')) {
  wf003.nodes.push(calSyncTriggerNode);
}

// 2. Move "Respond 200" node to the right to make room
const respondNode = wf003.nodes.find(n => n.id === 'respond-ok');
if (respondNode) {
  respondNode.position = [1500, 300];
}

// 3. Rewire connections:
//    OLD: "DB: Create Appointment" -> "Respond 200"
//    NEW: "DB: Create Appointment" -> "Trigger: Calendar Sync (WF-004)" -> "Respond 200"
wf003.connections["DB: Create Appointment"] = {
  main: [[{ node: "Trigger: Calendar Sync (WF-004)", type: "main", index: 0 }]]
};
wf003.connections["Trigger: Calendar Sync (WF-004)"] = {
  main: [[{ node: "Respond 200", type: "main", index: 0 }]]
};

fs.writeFileSync(wf003Path, JSON.stringify(wf003, null, 2));
JSON.parse(fs.readFileSync(wf003Path, 'utf8'));
console.log('close-conversation.json: OK (WF-003 updated with calendar sync trigger)');

// ── Verify connections are correct ──────────────────────────────────────────
const wf003check = JSON.parse(fs.readFileSync(wf003Path, 'utf8'));
const trigNode = wf003check.nodes.find(n => n.id === 'trigger-calendar-sync');
const dbConn = wf003check.connections['DB: Create Appointment'];
const trigConn = wf003check.connections['Trigger: Calendar Sync (WF-004)'];

console.log('WF-003 trigger node present:', !!trigNode);
console.log('WF-003 DB->CalSync connection:', JSON.stringify(dbConn?.main[0]));
console.log('WF-003 CalSync->Respond connection:', JSON.stringify(trigConn?.main[0]));
console.log('All JSON valid. Done.');
