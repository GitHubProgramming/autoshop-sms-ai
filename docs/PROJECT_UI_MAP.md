# PROJECT UI MAP

> Canonical source of truth for the AutoShop SMS AI frontend structure.
> Update only when the frontend architecture actually changes.

---

## 1. UI Entrypoint

| Property | Value |
|----------|-------|
| **File** | `apps/web/app.html` |
| **Type** | Single-page HTML application (no framework, no build step) |
| **Navigation** | URL-based routing via `/app/:view` routes + client-side `switchView(name)` |
| **Design system** | Premium Light SaaS theme, CSS custom properties in `:root` |

All pages, styles, and scripts live in `apps/web/app.html`, which is served via `/app/:view` routes.

### Route Architecture

| Route | Purpose | Source File |
|-------|---------|-------------|
| `/app/dashboard` | Main dashboard (default) | `apps/web/app.html` |
| `/app/conversations` | Conversation inbox | `apps/web/app.html` |
| `/app/appointments` | Appointments / bookings | `apps/web/app.html` |
| `/app/customers` | Customer list | `apps/web/app.html` |
| `/app/analytics` | Analytics / revenue | `apps/web/app.html` |
| `/app/billing` | Billing & plan | `apps/web/app.html` |
| `/app/settings` | Shop settings | `apps/web/app.html` |
| `/login` | Login (was `login.html`) | `apps/web/login.html` |
| `/signup` | Signup (was `signup.html`) | `apps/web/signup.html` |
| `/onboarding/business` | Onboarding (was `onboarding.html`) | `apps/web/onboarding.html` |

---

## 2. Page Map

| Page | View ID | Location | Line |
|------|---------|----------|------|
| **Dashboard** | `#view-dashboard` | `apps/web/app.html` | ~675 |
| **Conversations** | `#view-conversations` | `apps/web/app.html` | ~780 |
| **Appointments** | `#view-appointments` | `apps/web/app.html` | ~838 |
| **Customers** | `#view-customers` | `apps/web/app.html` | ~878 |
| **Analytics** | `#view-analytics` | `apps/web/app.html` | ~898 |
| **Revenue** (hidden alias) | `#view-revenue` | `apps/web/app.html` | ~967 |
| **Billing** | `#view-billing` | `apps/web/app.html` | ~970 |
| **Settings** | `#view-settings` | `apps/web/app.html` | ~979 |

Navigation is handled by `switchView(name)` (line ~1915), which:
- Hides all `.view` elements
- Shows the matching `#view-{name}`
- Updates sidebar active state
- Updates the browser URL to `/app/{name}`
- Supports aliases: `bookings` → `appointments`, `revenue` → `analytics`

Direct URL access (e.g. `/app/conversations`) loads `app.html` and auto-switches to the correct view.

---

## 3. Dashboard Render Functions

These functions populate the `#view-dashboard` section with live data:

| Function | Purpose | Target Element(s) |
|----------|---------|-------------------|
| `renderSystemHero()` | System status banner (active/error states) | `#systemHeroStrip`, `#heroStatusLabel`, `#heroDesc`, `#heroMetrics` |
| `renderLiveKPIs()` | 4-card KPI grid (revenue, bookings, calls, active) | `#kpiGrid` |
| `renderDashConvTable(data)` | Live conversations table on dashboard | `#dashConvBody` |
| `renderActionNeeded()` | Action-needed card (active convos, failed syncs) | `#actionNeededBody`, `#actionCount` |
| `renderTodayAppointments()` | Today's appointments card | `#todayApptsBody`, `#todayApptCount` |
| `renderLiveTodayActivity()` | Today activity grid | `#todayGrid` |
| `renderLivePipeline()` | Conversion pipeline funnel | `#pipelineWrap`, `#pipelineLabel` |
| `renderLiveRevenueBlocks()` | Revenue stats, shop name injection, subtitle updates | `#sinceActivationBlock` + multiple page elements |
| `renderHealthGrid()` | Integration health cards in system status panel | `#healthGrid` |

Supporting dashboard functions:

| Function | Purpose |
|----------|---------|
| `renderBanners()` | Top-of-page status banners (trial, suspended, usage) |
| `renderNav()` | Top navigation bar |
| `renderChecklist()` | Onboarding setup checklist |
| `checkActivationState()` | Show/hide checklist based on integration status |
| `filterConvTable(btn, status)` | Filter dashboard conversation table rows |

---

## 4. Other Page Render Functions

| Function | Page | Purpose |
|----------|------|---------|
| `renderFullConvTable(data)` | Conversations | Full conversation list with search |
| `renderConvInbox()` | Conversations | 3-panel inbox view |
| `renderBookingsCalendarAlert()` | Appointments | Calendar sync warning banner |
| `renderBookings()` | Appointments | Bookings table |
| `renderAppointmentsPage()` | Appointments | Full appointments page with today + upcoming |
| `renderCustomers()` | Customers | Customer list derived from conversations + bookings |
| `renderBillingPage()` | Billing | Plan, usage, and payment details |

---

## 5. Global Layout Selectors

**DO NOT MODIFY** unless explicitly requested. These affect the entire application.

| Selector | Purpose | Line |
|----------|---------|------|
| `.topnav` | Sticky top navigation bar (52px height) | ~60 |
| `.layout` | Flex container for sidebar + main content | ~90 |
| `.sidebar` | Left navigation (220px, sticky) | ~91 |
| `.sidebar-item` | Navigation link styling | ~95 |
| `.sidebar-brand` | Brand/shop name block in sidebar | ~501 |
| `.main` | Primary content area (max-width 1280px, padding 24px 32px) | ~115 |
| `:root` CSS variables | Design tokens (colors, fonts, spacing, shadows) | ~14 |

---

## 6. Dashboard-Scoped Selectors

**Safe for dashboard redesign.** These only affect `#view-dashboard`.

| Selector | Purpose | Line |
|----------|---------|------|
| `.dash-welcome` | Welcome header block | ~131 |
| `.kpi-grid` | 4-column KPI card grid | ~136 |
| `.kpi-card` | Individual KPI card | (follows `.kpi-grid`) |
| `.dash-body` | Main 2-column layout (content + right sidebar) | ~175 |
| `.dash-right` | Right column (action needed + today appointments) | ~577 |
| `.dash-lower` | Lower 2-column grid (revenue chart + system status) | ~575 |
| `.system-hero` | System status banner at top of dashboard | (in CSS) |
| `.log-wrap` / `.log-table` | Conversations table container | (in HTML ~701) |
| `.action-card` | Action needed / today appointments cards | (in HTML ~720) |
| `.chart-wrap` / `.chart-svg` | Revenue analytics chart | (in HTML ~743) |
| `.integrations-panel` / `.int-grid` | System status health grid | (in HTML ~767) |
| `.pipeline-*` | Conversion pipeline funnel elements | (rendered by `renderLivePipeline`) |
| `.since-activation` | Performance since activation block | (rendered by `renderLiveRevenueBlocks`) |

---

## 7. Visual Reference

The official visual layout reference for dashboard UI redesigns is:

```
dashboard (4).tsx
```

Any dashboard redesign work should match this visual reference file.

---

## 8. Editing Rules

### If the task is dashboard UI work:

**DO:**
- Edit only `apps/web/app.html`
- Edit only the `#view-dashboard` section (lines ~675–777)
- Edit only dashboard render functions (see Section 3)
- Scope new CSS under `#view-dashboard` to prevent bleed

**NEVER:**
- Modify global layout width (`.main` max-width/padding)
- Modify `.topnav`, `.sidebar`, or `.layout`
- Modify other page views (`#view-conversations`, `#view-appointments`, etc.)
- Create parallel frontend apps or new HTML files
- Change backend logic while doing UI work

### If the task is a specific page (non-dashboard):

- Edit only the matching `#view-{page}` section
- Edit only the matching render function(s) from Section 4
- Scope CSS under the page's view ID

---

## 9. Workflow Rule

Before making **any** UI change, Claude must:

1. Read `docs/PROJECT_UI_MAP.md`
2. Locate the correct page section and render functions
3. Modify only that section
4. Avoid exploratory edits to unrelated sections
5. Scope all CSS changes to the target view

---

## 10. File Structure Summary

```
apps/web/
  app.html          ← THE frontend (all pages, styles, scripts)
                       Served via /app/:view routes (e.g. /app/dashboard)
  login.html        ← Login page, served via /login
  signup.html       ← Signup page, served via /signup
  onboarding.html   ← Onboarding page, served via /onboarding/business

docs/
  PROJECT_UI_MAP.md ← THIS file (UI structure reference)
```

There is no separate CSS file, no JS bundle, no component tree.
Everything is in `apps/web/app.html`. The server maps `/app/:view` routes
to this file, and the client-side JS reads the URL to show the correct view.
