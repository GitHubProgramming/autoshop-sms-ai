# Frontend Status

## FRONTEND CONNECTED

Multi-page app with URL-based routing:

| File | Route(s) | Purpose |
|------|----------|---------|
| `apps/web/index.html` | `/` | Landing page |
| `apps/web/login.html` | `/login` | Login page |
| `apps/web/signup.html` | `/signup` | Signup page |
| `apps/web/onboarding.html` | `/onboarding/business` | Onboarding flow |
| `apps/web/app.html` | `/app/dashboard` | Shop dashboard (default view) |
| `apps/web/app.html` | `/app/conversations` | Conversation inbox |
| `apps/web/app.html` | `/app/appointments` | Appointments / bookings |
| `apps/web/app.html` | `/app/customers` | Customer list |
| `apps/web/app.html` | `/app/analytics` | Analytics / revenue |
| `apps/web/app.html` | `/app/billing` | Billing & plan |
| `apps/web/app.html` | `/app/settings` | Shop settings |

## ROUTES WORKING

- Landing → Login: all CTA buttons, nav Login link, footer link → `/login`
- Landing → Signup: "Start Free Trial" pricing buttons → `/signup`
- Signup → Onboarding: after account creation → `/onboarding/business`
- Login → Dashboard: on successful auth → `/app/dashboard`
- Dashboard → Landing: logo + "Back to Website" → `/`
- Dashboard → Logout: "Log Out" clears session → `/login`
- Dashboard sidebar navigation: all views accessible via `/app/:view` routes (conversations, appointments, analytics, billing, settings, customers)

## LOGIN STATUS

**Implementation: localStorage demo session (pilot mode)**

- Demo credentials: `demo@autoshop.ai` / `autoshop2024`
- On login: stores JSON session in `localStorage.autoshop_session`
- Dashboard auth guard: checks localStorage on load, redirects to `/login` if no session
- Logout: clears localStorage, redirects to `/login`
- Already-logged-in redirect: `/login` redirects straight to `/app/dashboard` if session exists
- Session stores: email, name, initials, shopName, plan, loginAt

**What this is NOT:** Not a real auth system. No server-side session. No JWT. Password is hardcoded in client-side JS. Demo/pilot use only.

## DEPLOY STATUS

Ready for static hosting. No build step required.

**To serve locally:**
```bash
cd apps/web
npx serve . -p 8080
# Open http://localhost:8080
```

**To deploy:**
- Netlify: drag-and-drop `apps/web/` folder
- GitHub Pages: point to `apps/web/` directory
- Any Apache/Nginx static host: serve `apps/web/` as document root

## REMAINING FRONTEND GAPS

### Before full production frontend:

1. **Real authentication** — replace localStorage demo auth with:
   - POST `/auth/login` API endpoint (JWT or session cookie)
   - Token refresh logic
   - Secure httpOnly cookie instead of localStorage

2. **Live data** — dashboard currently shows hardcoded mock data. Wire to:
   - `GET /api/conversations` — conversation list
   - `GET /api/appointments` — bookings
   - `GET /api/stats` — usage metrics

3. **Signup flow** — `/signup` page exists; wire to POST `/auth/signup` or redirect to Stripe checkout for production

4. **Google OAuth** — "Connect Calendar" buttons call `showToast()` — wire to `GET /auth/google/connect?tenantId=...`

5. **Billing portal** — "Open Billing Portal" links to `/billing-portal` — wire to Stripe customer portal session creation

6. **Mobile nav** — landing page mobile menu toggle works; dashboard sidebar not optimized for mobile

7. **Real shop name** — nav shows "Austin Quick Lube (DEMO)" from session; production should fetch from API on login

8. **Error pages** — no 404 or error fallback pages

9. **Environment config** — no API base URL config; hardcoded to localhost-style paths

10. **Production CSP** — Helmet on the API will need CSP adjusted if frontend is served from same origin

## LAUNCH POLISH COMPLETED

Surgical edits applied to existing files (no pages created, no redesign):

1. **index.html — removed public Dashboard nav link**
   - Removed `<li><a href="app.html" class="nav-link-dashboard">Dashboard</a></li>` from nav
   - Login link remains in place

2. **index.html — fixed pricing contradiction**
   - Step 01 "Sign Up" description changed from "Enter your shop details. Card on file. 14-day free trial starts immediately." to "Start your 14-day free trial. No credit card required."
   - Now consistent with the pricing note at bottom of section

3. **login.html — demo-hint block replaced**
   - Removed raw credential display (Email/Password in plain text)
   - New copy: "Demo Access — Use the demo account to explore the dashboard."
   - Added "Use Demo Account" button that calls `fillDemoCredentials()` to auto-fill email and password fields
   - Added matching CSS for `.btn-demo-fill`

4. **login.html — error message behavior**
   - Error message already hidden on page load (CSS `display:none`, only `.visible` class shows it)
   - No change required — confirmed correct

5. **login.html — sets autoshop_demo_login=true on success**
   - `localStorage.setItem('autoshop_demo_login', 'true')` added alongside existing session storage

6. **app.html — frontend auth guard updated**
   - Guard now checks `localStorage.getItem('autoshop_demo_login') !== 'true'` (was checking `autoshop_session`)
   - Logout handler now also clears `autoshop_demo_login` from localStorage
   - Auth guard redirects to `/login` (not `login.html`)
