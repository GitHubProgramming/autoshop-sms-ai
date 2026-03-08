# Frontend Status

## Funnel Flow

Landing (`index.html`) → Demo (`demo.html`) → Login (`login.html`) → Dashboard (`app.html`)

---

## LAUNCH POLISH COMPLETED

Fixes implemented on 2026-03-08:

1. **Removed "Dashboard" nav link from landing page** (`index.html`)
   - Nav now shows only "Live Demo" and "Start Free Trial".
   - `/app.html` is not reachable from the landing page.

2. **Fixed login error shown on page load** (`login.html`)
   - Error message `#error-msg` has `display: none` by default.
   - It is only shown after a failed form submission.

3. **Replaced raw demo credentials with demo notice box** (`login.html`)
   - Removed visible `demo@autoshop.ai / autoshop2024` text.
   - Added a styled "Demo Access" box with a "Use Demo Account" button.
   - Button auto-fills the email and password fields via JS.

4. **Fixed pricing contradiction** (`index.html`)
   - Removed "Card on file. 14-day free trial starts immediately".
   - Single consistent message: "Start your 14-day free trial. No credit card required."

5. **Added simulation notice to demo banner** (`demo.html`)
   - Added second line: "This is a simulated dashboard based on typical repair shop data."
   - URL param `?shop=` personalisation preserved.

6. **Added frontend auth guard to app.html** (`app.html`)
   - On load, checks `localStorage.getItem('autoshop_demo_login') === 'true'`.
   - If missing, redirects to `/login.html` immediately.
   - Login sets the key; logout clears it.

7. **Funnel integrity confirmed**
   - Landing → Demo → Login → Dashboard path is the only navigable flow.
   - No direct shortcut to `/app.html` from public pages.
