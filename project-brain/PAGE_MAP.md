# Page Map

Dashboard UI map for `apps/web/app.html`. All 7 views are rendered client-side via `switchView()`.

Single data source: `fetch('/tenant/dashboard')` populates all views.

---

## 1. Dashboard

**Purpose:** AI receptionist performance overview for the shop owner.

**Main Components:**
- System hero strip — system health status (active/error), last AI response time
- KPI grid — recovered revenue, AI booked appointments, missed calls captured, active conversations
- Live conversations table — date, phone, issue, status, est. ARO, actions (filterable: all/active/booked/lost)
- Action needed card — items requiring operator attention
- Today's appointments card — appointments scheduled for today
- Revenue analytics chart (7D/30D toggle) — SVG line chart
- System health grid — Twilio webhooks, Google Calendar sync, AI engine, job queue status

**Backend Endpoint:** `GET /tenant/dashboard`

---

## 2. Conversations

**Purpose:** SMS thread management — view and manage all AI conversations.

**Main Components:**
- 3-panel layout:
  - Left: Inbox list (search by phone, filter: all/active/booked/no-reply/lost)
  - Center: Thread view (message bubbles — AI vs customer, timestamps, booking outcome)
  - Right: Customer details panel (phone, status, first contact, issue, duration, actions)

**Backend Endpoint:** Data from `GET /tenant/dashboard` → `recent_conversations`

---

## 3. Appointments

**Purpose:** View AI-booked appointments synced to Google Calendar.

**Main Components:**
- Calendar integration alert (warnings if calendar not connected)
- Today's appointments table — time, customer, service, source, status
- All appointments table — date/time, customer, service, source, vehicle, sync status, actions
- Filter chips: all/confirmed/pending/failed
- Booking states: CONFIRMED_CALENDAR, CONFIRMED_MANUAL, PENDING_MANUAL_CONFIRMATION, FAILED

**Backend Endpoint:** Data from `GET /tenant/dashboard` → `recent_bookings`

---

## 4. Customers

**Purpose:** Customer database derived from AI conversations.

**Main Components:**
- Search bar (search by name or phone)
- Customer table — name, phone, last interaction, appointment count, status, actions
- Status pills: booked, active, no-response, lost
- Data merged from conversations + bookings on phone number

**Backend Endpoint:** Derived client-side from `recent_conversations` + `recent_bookings`

---

## 5. Analytics

**Purpose:** Performance metrics and trends.

**Main Components:**
- KPI summary row — total conversations, total bookings, AI conversion rate, current plan
- Revenue trend chart (7D/30D/90D toggle) — SVG line chart
- Conversion pipeline — 4-stage funnel (conversations → active → booked → lost)
- Performance since activation — total bookings, conversations, days active
- Monthly performance + usage summary

**Backend Endpoint:** Data from `GET /tenant/dashboard` → `stats`

---

## 6. Billing

**Purpose:** Subscription, usage, and payment management.

**Main Components:**
- Current plan card — plan name, badge, price, usage bar (conversations used/limit)
- Warning banners (service paused, usage limit reached, approaching limit)
- Billing actions — open Stripe portal, view invoices, update payment
- Available plans section — Starter ($199), Pro ($299), Premium ($499) with upgrade buttons

**Backend Endpoints:**
- `POST /billing/checkout` — create Stripe checkout session
- `POST /billing/portal` — open Stripe customer portal

---

## 7. Settings

**Purpose:** Configure the AutoShop SMS AI system.

**Main Components (5 tabs):**

### Tab: Shop Profile
- Shop name, phone, address inputs
- Business hours (open/close time, operating days)

### Tab: AI & Automation
- Booking buffer time, default ARO, SMS response delay
- AI tone selection, shop name in messages

### Tab: Integrations
- Twilio SMS: number display, connection status
- Google Calendar: connect/disconnect, status display

### Tab: Notifications
- Email toggles: new booking alert, operator needed, calendar sync failure, daily summary
- SMS toggle: forward operator requests

### Tab: Setup (Activation Checklist)
- 4-step checklist with status pills:
  1. Connect Google Calendar (connect/reconnect/manage)
  2. Provision Twilio Number (provision/re-provision)
  3. Set Call Forwarding (view instructions)
  4. Send Test SMS (send/retry)
- Activation summary shown when all steps complete

**Backend Endpoints:**
- `POST /auth/google/url` — get Google OAuth URL
- `POST /auth/google/disconnect` — disconnect Google Calendar
