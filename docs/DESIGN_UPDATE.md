# Premium wellness redesign

The React frontend uses a unified forest green (`#143D2B`), sage (`#8FAF8B`), cream (`#F7F3E8`), and gold (`#D8B44A`) design system. `apps/web/src/style.css` covers the landing page, class catalog, booking flow, customer and staff dashboards, instructor profiles, studio page, navigation, footer, and dialogs. `apps/web/src/admin.css` applies the same identity to the administrator workspace. `apps/web/src/WellnessExtras.tsx` and `wellness-extras.css` add the Programs, Meditation, Progress, Community, and Profile views.

Five original local WebP images (`wellness-*.webp`) provide the forest hero, class, meditation, and retreat photography. Navigation includes a compact floating desktop bar and a five-item bottom menu on phones. Cards, buttons, forms, calendars, and page banners share rounded glass surfaces and restrained motion. Scroll reveal and reduced-motion behavior remain in place.

Existing API calls, authentication, permissions, booking, payment sandbox, intake review, staff, and admin workflows remain unchanged. The catalog drives class and program cards; instructor details use the catalog's actual biographies and qualifications. Dashboard and progress figures use bookings. The meditation timer and optional ambient audio run in the browser; meditation minutes are saved on that device only.

The current database has no rating, difficulty, wellness score, student-review, or community-post fields. The interface does not invent those values. Programs are curated presentations of existing services rather than a new backend product type.

## Verification

- `npm run typecheck -w @sahana/web`: passed.
- `npm run build -w @sahana/web`: passed after Vite was permitted to load its config outside the restricted filesystem sandbox.
- Local HTTP checks returned `200` for the frontend, hero image, and catalog; the catalog returned four services.
- Original generated images were visually inspected. Browser automation was unavailable in this session, so desktop and phone layout screenshots remain to be reviewed in a browser.
