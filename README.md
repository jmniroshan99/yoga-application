# Sahana Yoga Booking System

A responsive yoga and wellness booking application with a React/TypeScript client, Express/TypeScript API, and PostgreSQL database. The bundled studio identity and all sample practitioners are fictional. This is a **working development build**, with a sandbox payment flow; see [limitations](#scope-and-limitations) before using real client data.

## Quick start on Windows 10/11

Requirements: Node.js 20 or newer, npm, and **local PostgreSQL 16 or later** installed and running on `localhost:5432`. During PostgreSQL installation, remember the password you set for its `postgres` administrator. No container software is needed.

1. Extract the ZIP. Double-click **`DATABASE_SETUP.bat`** in the extracted folder.
2. If the setup lists an older Sahana folder with a private `.env`, enter its number to **keep using that database and its bookings**. You can also paste the full path of an older project folder or its `.env`; paths with spaces and parentheses are supported. Enter `N` only for a **separate empty database**.
3. If creating a new database, enter the local PostgreSQL `postgres` password when prompted (typing is hidden).
4. After setup succeeds, double-click **`RUN_SYSTEM.bat`**. Keep the window open and visit **http://localhost:5173/**. The run file rechecks the database and applies pending migrations automatically.

The same steps in Command Prompt are:

   ```bat
   DATABASE_SETUP.bat
   RUN_SYSTEM.bat
   ```

The database setup installs project packages and checks the private `.env`. On first-time setup it creates a separate, randomly named app role and database, writes private database credentials and a valid 64-character encryption key into `.env`, runs migrations and seed, then verifies the connection. The PostgreSQL administrator password is never saved. Later runs check the existing `.env` and database and apply pending migrations. Never put commands inside `.env` or share that file.

**Local demo administrator login** (after `npm run setup:local`):

| Field | Value |
| --- | --- |
| Email / username | `admin@example.test` |
| Password | `SahanaAdmin2026!` |

This is a shared **development-only** password. Change it before any deployment. If you already used an older ZIP, its existing database still has the password generated at that time. From that project's folder, run `npm run admin:reset` to set the documented demo password on the existing local database, update `.env`, and sign out prior admin sessions. It preserves bookings and other data. The command requires `SANDBOX_PAYMENTS=true` and a local `DATABASE_URL`; it will not create a missing admin account. Keep using the same project folder and database. The practitioner and reception demo password is generated on first setup and stored in `.env` as `DEMO_PASSWORD`.

Open **http://localhost:5173** (the equivalent local address **http://127.0.0.1:5173** is also accepted during development). The API health check is at **http://localhost:4000/api/v1/health**. If port 5173 is already in use, stop the earlier server with Ctrl+C before restarting; the development server is fixed to that port so its browser origin matches `WEB_ORIGIN`. Keep the terminal running while using the site. For a compiled build, run `npm run build`, then `npm start`; production accepts only the explicitly configured HTTPS browser origin.

### Upgrading an existing local installation

If you extracted a new numbered folder such as `Sahana_Yoga_Green_Animated_Fullstack (5)` while an earlier `(4)` folder holds your data, run `DATABASE_SETUP.bat` in `(5)` and select `(4)` from its list. It copies the older folder’s private `.env`, verifies the same PostgreSQL database, and keeps bookings and account credentials. The ZIP does not include `.env`. This update uses the existing schema; no new migration is needed. **Do not choose `N` or run `node scripts/setup-local.mjs --new-database` if you intend to keep the old database.** Then run `RUN_SYSTEM.bat` and sign in using the credentials from the older installation.

### Existing `.env` or connection errors

- `DATABASE_URL must be configured`, invalid encryption key, or seed password error: run `npm run setup:local`. If an existing `.env` has placeholders, the command names the settings to fix; edit with `notepad .env` and rerun.
- `role "JM PC" does not exist` after extracting a new ZIP: the new folder has no valid `.env`, so PostgreSQL falls back to your Windows username. Run `DATABASE_SETUP.bat` and select the older Sahana folder to reuse its database. Running `npm run db:migrate` before configuration cannot fix this.
- `role "sahana" does not exist` or an old `.env` points to an unusable database: run `node scripts/setup-local.mjs --new-database` to provision a **separate empty database**. This backs up the existing `.env` as `.env.backup-*`; it does not move data from the old database. Keep the backup private.
- PostgreSQL connection refused: check that the local PostgreSQL Windows service is running and is listening on port 5432. PostgreSQL's installer includes pgAdmin, where you can verify that the `postgres` administrator can connect. The setup command accepts `SAHANA_PG_PORT` (and `SAHANA_PG_HOST` for a local address) if yours differs.
- Vite `/api` proxy `ECONNREFUSED`: the API did not start. Check the `[0]` error in the `npm run dev` terminal, then rerun setup. If 5173 is occupied, stop the older Vite instance before starting this one.
- `Port 4000/5173 already in use`: close the terminal running an older Sahana folder with Ctrl+C. The batch launcher stops before starting a second instance; it does not kill other processes.
- Administrator sign-in fails on an existing database: run `npm run admin:reset` from the project folder containing its `.env`, then sign in with the local demo login above. Changing `ADMIN_PASSWORD` in `.env` alone does not change a previously seeded password hash.

If you want to manage the database manually, create a PostgreSQL role with `LOGIN`, create a database owned by that role, copy `.env.example` to `.env`, and set `DATABASE_URL`, a 64-character hexadecimal `DATA_ENCRYPTION_KEY`, and a 12-character-or-longer `DEMO_PASSWORD`. The example includes the local demo `ADMIN_PASSWORD`; replace it with your own password if preferred before seeding. Then run `npm run db:migrate`, `npm run db:seed`, and `npm run dev`. Keep the same encryption key for any database containing encrypted intake data.

The original npm commands remain available. Run them only from a folder with a configured `.env`. `RUN_SYSTEM.bat` expects the development ports `4000` and `5173`, matching the Vite proxy. For custom ports, update Vite proxy and `WEB_ORIGIN` together and use the npm commands directly.

Seeded staff logins use `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the administrator, `maya@sahana.test` or `arun@sahana.test` and `DEMO_PASSWORD` for practitioners, and `desk@sahana.test` with `DEMO_PASSWORD` for reception. Customers can register in the interface. Seed is idempotent only at the organization level: if an organization exists, it skips all demo inserts.

## What works

- Public service catalog, practitioner profiles, branch details, responsive booking UI and core English/Sinhala/Tamil navigation labels.
- Customer registration, sign-in, session cookies, age-18 registration rule, account and booking dashboards.
- Real-time availability from practitioner weekly schedules and time off; private, online, and pre-scheduled group sessions.
- PostgreSQL resource overlap constraints for practitioner and room; group capacity checked under a row lock; client overlap checked while locking the client account.
- Short reservation holds, automatic expiry on booking/availability requests, cancellation and rescheduling rules, waitlist registration endpoint.
- Encrypted therapeutic intake answers and practitioner-only review; approval, request for more information, decline; encrypted private session notes.
- Sandbox booking payment with idempotency, invoices, offline payment recording endpoint, sandbox refund on cancellation, signed generic webhook seam, calendar file download.
- Staff review/attendance dashboard, practitioner leave conflict check, class creation endpoint, branch reports and audit history endpoint.
- Administrator workspace with a live overview, recurring practitioner hours, branch-local group class scheduling, staff account creation, searchable account directory, role/status changes and password reset. Admin-only routes audit changes, block overlapping hours, protect the current/last administrator, and end sessions after access or password changes.

## Scope and limitations

**Do not enter real health information until the privacy, operations, and deployment work is completed.** Sandbox payment means there is no money transfer. The signed webhook route is an integration seam; a real payment checkout adapter and provider reconciliation are not included. Cash and bank-transfer entries are records, not bank verification; these are not automatically refunded. The package catalog and purchase tables exist, but package checkout/redemption is not implemented. Waitlist enrollment is stored, but offer promotion is not automated. Notifications are stored for in-app display; email, SMS, WhatsApp, retries, and a delivery worker are not connected. These functions must be completed before promising them to customers.

Self-service password reset, verified email, MFA, guardian consent, deposits, promotional codes, tax calculations, retention automation, data subject export/deletion, incident response operations, comprehensive translation of service content, UI controls for every management endpoint, and automated accessibility/browser testing are not complete. Administrators can reset other account passwords inside the admin workspace. The system has not been assessed for legal compliance or clinical suitability. Therapeutic yoga review is a human decision; this app does not diagnose or prescribe.

**PostgreSQL integration requirement:** Use a locally installed or managed PostgreSQL 16+ server. The provided embedded smoke test exercises the API with a PostgreSQL-compatible engine that does **not** support the `btree_gist` exclusion constraints. A live PostgreSQL migration and concurrency rehearsal remains required before deployment.

## Quality checks

```bash
npm run typecheck
npm test
npm run build
```

The embedded API smoke test is for an isolated disposable database only. It creates customers and bookings, uses one database connection, and omits production PostgreSQL exclusion constraints:

```bash
bash scripts/run-embedded-smoke.sh
```

For a real PostgreSQL test, provision a disposable PostgreSQL 16 database, run `npm run db:migrate`, `npm run db:seed`, start the API, and adapt `scripts/smoke.mjs` with `TEST_DATABASE=true`, `DATABASE_URL`, and `BASE_URL`. Do not run destructive smoke tests on live data.

## Project layout

```text
apps/api/src/         API, authentication, scheduling, booking and staff workflows
apps/api/migrations/  PostgreSQL schema and exclusion constraints
apps/web/src/         Responsive React client and visual design
scripts/              Local PostgreSQL setup and disposable embedded smoke-test harness
DATABASE_SETUP.bat     Windows installer and existing .env import
RUN_SYSTEM.bat         Windows database preflight and full-stack launcher
docs/                 Architecture, API, test evidence and next steps
.env.example           Local PostgreSQL connection and application settings template
```

## Security and deployment notes

Set `COOKIE_SECURE=true`, `WEB_ORIGIN` to the HTTPS site origin, and `SANDBOX_PAYMENTS=false` when preparing a real deployment. Turning sandbox payments off **does not** enable a real gateway; an adapter must be built first. Store `DATA_ENCRYPTION_KEY` outside source control and back it up securely; losing it makes encrypted intake and notes unreadable. Rotate keys with a planned re-encryption process. Use TLS, managed PostgreSQL backups, least-privilege database credentials, monitored logs, rate limits at the edge, and a formal privacy/legal review before storing sensitive information.

See [architecture](docs/ARCHITECTURE.md), [API routes](docs/API.md), and [test report](docs/TEST_REPORT.md).


Use this prompt to redesign your existing yoga web application with the same premium style:

---

## Prompt: Premium Yoga Wellness Web Application Redesign

**Redesign the entire existing yoga web application into a premium luxury wellness platform UI inspired by modern glassmorphism, nature, and mindfulness aesthetics. Do not change the existing functionality, backend APIs, database, authentication, or business logic. Only transform the complete frontend user experience and visual design.**

### Design Identity

Create a **high-end yoga, meditation, and wellness ecosystem** with:

- Premium glassmorphism UI
- Nature-inspired luxury design
- Calm and peaceful user experience
- Modern responsive layouts
- Professional wellness brand feeling
- Apple Health + Calm + luxury resort style inspiration

### Color System

Use:

- Deep Forest Green: `#143D2B`
- Sage Green: `#8FAF8B`
- Soft Cream: `#F7F3E8`
- Gold Accent: `#D8B44A`
- White Glass: transparent layered surfaces
- Natural shadows and blur effects

Avoid:
- Bright neon colors
- Heavy gradients
- Corporate dashboard appearance

---

# Global UI Transformation

Apply the new design system to every page:

## Navigation Bar

Create:

- Transparent floating glass navbar
- Rounded pill shape
- Logo with minimal leaf/yoga icon
- Smooth hover animations
- Menu:
  - Home
  - Classes
  - Programs
  - Instructors
  - Meditation
  - Progress
  - Community
  - Profile

Buttons:

Primary:
"Start Your Journey"

Secondary:
"Explore Classes"

---

# Landing Page Design

Create an immersive hero section:

## Hero Layout

Left:

Large elegant heading:

"Balance Your Body  
Calm Your Mind"

Subheading:

"Discover personalized yoga practices, guided meditation, and wellness programs designed for your journey."

Buttons:

- Explore Classes
- Watch Introduction

Right:

Large realistic yoga practitioner image:

- Forest background
- Morning sunlight
- Natural environment
- Premium wellness photography

Add:

- Floating glass statistics cards

Example:

```
10,000+
Happy Members

250+
Yoga Classes

50+
Expert Instructors
```

---

# Class Discovery Page

Redesign as a premium booking marketplace.

Features:

## Search Area

Glass search container:

"Find your perfect yoga practice"

Filters:

- Beginner
- Intermediate
- Advanced
- Meditation
- Strength
- Flexibility
- Stress Relief


## Class Cards

Create luxury cards:

Each card contains:

- Yoga image
- Class name
- Instructor
- Duration
- Difficulty
- Rating
- Price
- Book button

Example:

```
Vinyasa Flow Yoga

60 Minutes
Intermediate

★★★★★

LKR 2500

Book Session
```

---

# Instructor Profile Page

Create elegant instructor profiles.

Include:

Large profile image

Information:

- Experience
- Certifications
- Specializations
- Student reviews

Sections:

- About Instructor
- Available Classes
- Reviews
- Schedule

---

# Booking Experience

Create a smooth booking flow:

Step 1:
Select Class

↓

Step 2:
Choose Date & Time

↓

Step 3:
Payment

↓

Step 4:
Confirmation


Use:

- Glass calendar
- Animated selection states
- Success confirmation screen

---

# User Dashboard

Replace normal dashboards with wellness intelligence dashboard.

Layout:

## Welcome Card

```
Good Morning Samantha 🌿

Your wellness journey continues.
```

Statistics:

Cards:

- Classes Completed
- Practice Hours
- Wellness Score
- Current Streak


## Progress Analytics

Create:

- Weekly activity chart
- Meditation minutes
- Yoga improvement
- Personal goals


## Upcoming Sessions

Beautiful timeline:

```
Tomorrow

06:30 AM

Morning Vinyasa

with Maya Sen
```

---

# Meditation Page

Create a calm immersive experience:

Features:

- Background nature images
- Breathing animation
- Meditation timer
- Sound options
- Progress tracking


---

# Mobile Responsive Design

Create mobile-first layouts:

Mobile navigation:

Bottom floating glass menu:

Icons:

Home
Classes
Booking
Progress
Profile

---

# Animation Requirements

Add smooth animations:

- Glass card hover
- Floating elements
- Page transitions
- Scroll reveal animations
- Button micro-interactions
- Smooth loading states

Use:

- Framer Motion style animations
- Parallax hero effects
- Soft fade transitions

---

# Component Design System

Create reusable components:

## Buttons

Variants:

- Primary Gold
- Glass
- Outline

## Cards

Variants:

- Class Card
- Instructor Card
- Program Card
- Analytics Card

## Forms

Modern:

- Rounded inputs
- Floating labels
- Glass backgrounds

---

# Technical Requirements

Preserve:

✅ Existing React/Vue/Angular structure  
✅ Existing routes  
✅ Existing API calls  
✅ Authentication  
✅ Database integration  
✅ User permissions  
✅ Existing workflows  

Only replace:

- UI components
- Styling
- Layout
- Animations
- UX flow

---

# Final Output

Deliver:

1. Complete redesigned frontend
2. Responsive desktop + mobile UI
3. Premium yoga brand identity
4. Component library
5. Smooth user journey
6. Production-ready modern wellness application interface

**Target feeling:**
"Luxury yoga retreat meets modern digital wellness platform."

---

This prompt can be used directly with **Cursor, Claude Code, Lovable, Replit AI, Figma AI, or frontend redesign agents**.