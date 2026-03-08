# Frontend Status

## FRONTEND CONNECTED

Three-page app wired and functional:

| File | Route | Purpose |
|------|-------|---------|
| `apps/web/index.html` | `/` | Landing page |
| `apps/web/login.html` | `/login.html` | Login page |
| `apps/web/app.html` | `/app.html` | Shop dashboard |

## ROUTES WORKING

- Landing → Login: all CTA buttons, nav Login link, footer link → `login.html`
- Landing → Signup (demo): "Start Free Trial" pricing buttons → `login.html` (demo only)
- Login → Dashboard: on successful auth → `app.html`
- Dashboard → Landing: logo + "Back to Website" → `index.html`
- Dashboard → Logout: "Log Out" clears session → `login.html`
- Dashboard sidebar navigation: all `switchView()` calls work (conversations, bookings, revenue, billing, settings)

## LOGIN STATUS

**Implementation: localStorage demo session (pilot mode)**

- Demo credentials: `demo@autoshop.ai` / `autoshop2024`
- On login: stores JSON session in `localStorage.autoshop_session`
- Dashboard auth guard: checks localStorage on load, redirects to `login.html` if no session
- Logout: clears localStorage, redirects to `login.html`
- Already-logged-in redirect: `login.html` redirects straight to `app.html` if session exists
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

3. **Signup flow** — "Start Free Trial" should POST to `/auth/signup` or redirect to Stripe checkout, not to login

4. **Google OAuth** — "Connect Calendar" buttons call `showToast()` — wire to `GET /auth/google/connect?tenantId=...`

5. **Billing portal** — "Open Billing Portal" links to `/billing-portal` — wire to Stripe customer portal session creation

6. **Mobile nav** — landing page mobile menu toggle works; dashboard sidebar not optimized for mobile

7. **Real shop name** — nav shows "Austin Quick Lube (DEMO)" from session; production should fetch from API on login

8. **Error pages** — no 404 or error fallback pages

9. **Environment config** — no API base URL config; hardcoded to localhost-style paths

10. **Production CSP** — Helmet on the API will need CSP adjusted if frontend is served from same origin
