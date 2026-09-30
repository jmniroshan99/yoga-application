# Verification report

This report distinguishes local evidence from unverified production behavior.

| Check | Result | Evidence and limit |
| --- | --- | --- |
| TypeScript type check | Passed | `npm run typecheck`, both workspaces |
| Production build | Passed | `npm run build`, API and Vite client |
| Unit tests | Passed | `npm test`: Sri Lanka local-day UTC bounds, cancellation cutoff, review state |
| Local PostgreSQL setup | Partial | `npm run setup:local -- --help` passed; isolated checks confirmed missing `.env` is not written without a connection and existing placeholders are reported without altering `.env`; existing-configuration connection failure was diagnosed. This workspace could not launch PostgreSQL as a non-root service user, so fresh provisioning remains to be verified on a local PostgreSQL service |
| Windows launchers | Partial | `DATABASE_SETUP.bat` and `RUN_SYSTEM.bat` are included. The Node configuration helper passed isolated checks for selecting an older Sahana folder, a quoted path with spaces, an existing configuration, a new database choice, and a missing path. Port preflight ran. Native `cmd.exe` execution remains to be checked on Windows. |
| Local demo admin reset | Passed on disposable PostgreSQL-compatible test server | Seeded an administrator with an old password, ran `scripts/reset-admin.mjs` against a separate local test configuration, reconnected and verified the documented password, rejected old password, deleted old admin sessions, preserved the organization, and updated the test `.env`. Repeat on real PostgreSQL before deployment. |
| API smoke | Passed | `bash scripts/run-embedded-smoke.sh`: registration, catalog, slot conflict, access denial, sandbox payment idempotency, intake review, note access, leave conflict, last group seat |
| Admin smoke | Passed | The same disposable database harness runs `scripts/admin-smoke.mjs`: weekly hour create/update/delete and overlap rejection, branch-local class creation/closure, prevention of closing booked classes or suspending clients with upcoming bookings, role authorization, user create/role change/suspend, password reset, and session revocation |
| Real PostgreSQL migration | Unverified | Embedded engine omits `btree_gist` exclusion constraints; the environment could not launch PostgreSQL as a non-root service user |
| Real parallel database race | Partial | Concurrent HTTP requests passed while the embedded test used one DB connection; multi-connection PostgreSQL behavior remains to be tested |
| Browser accessibility and responsive visual QA | Unverified | The browser preview could not reach the local server in this workspace; it reported `ERR_BLOCKED_BY_CLIENT`. Build success does not prove WCAG conformance or appearance across devices. Inspect desktop and 360 px mobile widths on the target machine. |
| Dependency vulnerability scan | Passed at scan time | `npm audit --omit=dev --audit-level=high`: 0 reported vulnerabilities |
| Live payments and notifications | Not implemented | Sandbox payments and in-app message storage only |
| Backups and restoration | Unverified | Local PostgreSQL backup and restore rehearsal not performed |

Before deployment, execute migration on PostgreSQL 16, run the smoke test against a disposable real database with multiple pooled connections, test overlapping practitioner and room bookings, verify group last-seat behavior, review the data-protection workflow, and conduct browser accessibility checks.
