# API summary

All routes are under `/api/v1`. JSON errors use `{ "error": { "code": "...", "message": "..." } }`. Cookie sessions use `sahana_session`, and state-changing browser requests require a matching `Origin` header. Values ending in `Cents` are integer hundredths of a rupee.

| Method | Path | Access | Behavior |
| --- | --- | --- | --- |
| GET | `/health` | Public | Database health |
| POST | `/auth/register`, `/auth/login`, `/auth/logout` | Public/session | Client registration, sign-in/out |
| GET/PATCH | `/auth/me` | Session for PATCH | Profile |
| GET | `/catalog`, `/availability`, `/intake-form` | Public | Services, local-date availability, form version |
| POST/GET | `/bookings` | Client/staff | Reserve slot / list allowed bookings |
| GET | `/bookings/:id` | Owner/assigned/branch staff | Booking detail without private notes |
| GET/PATCH | `/bookings/:id/intake` | Client/assigned practitioner for GET; owner for PATCH | Encrypted intake read / information update |
| POST | `/bookings/:id/review` | Assigned practitioner | Approve, decline, or request information |
| POST | `/bookings/:id/pay` | Client owner | Sandbox payment; requires UUID idempotency key |
| POST | `/bookings/:id/cancel`, `/bookings/:id/reschedule` | Client owner or authorized staff for cancel | Manage booking |
| GET | `/bookings/:id/calendar.ics` | Authorized viewer | Minimal calendar event |
| POST | `/waitlist` | Client | Store a request; automatic offers are not implemented |
| GET | `/notifications` | Session | In-app messages |
| GET | `/staff/overview` | Staff | Branch or practitioner schedule and reviews |
| POST | `/staff/bookings/:id/status` | Authorized staff | Check in, complete, no-show |
| GET/PUT | `/staff/bookings/:id/notes` | Assigned practitioner | Encrypted session notes |
| POST | `/staff/bookings/:id/offline-payment` | Reception/manager/admin at branch | Record cash or bank transfer |
| POST | `/staff/time-off` | Practitioner/manager/admin | Blocks new time if no open slots overlap |
| POST | `/staff/classes` | Manager/admin | Create group class allocation |
| GET/POST | `/admin/schedules` | Admin | List weekly hours, upcoming classes and assignments; create recurring hours |
| PATCH/DELETE | `/admin/schedules/:id` | Admin | Edit time range or remove weekly hours; existing bookings remain |
| POST | `/admin/classes/:id/close` | Admin | Close a group class only when it has no booking history |
| GET/POST | `/admin/users` | Admin | Paginated searchable directory; create staff with branch and practitioner service assignments |
| PATCH | `/admin/users/:id` | Admin | Change display name, access role, or active status with administrator and booking guards |
| POST | `/admin/users/:id/reset-password` | Admin | Reset another user's password and revoke their sessions |
| GET | `/staff/reports`, `/staff/audit` | Manager/admin; admin for audit | Aggregates and audit events |
| POST | `/staff/incidents` | Assigned practitioner/manager/admin | Encrypted report |
| POST | `/payments/webhook` | Signed integration | HMAC-SHA256 event seam; no live checkout adapter |

Example booking request:

```json
{
  "serviceId": "service-uuid",
  "branchId": "branch-uuid",
  "practitionerId": "practitioner-uuid",
  "startsAt": "2026-10-01T09:00:00+05:30"
}
```

For group classes send `slotId` instead of `startsAt`. For a therapeutic service also send `formId`, `consent: true`, and `intake` answers for the active form. Check `/catalog`, `/availability`, and `/intake-form` first to obtain valid IDs. The sandbox payment response is a simulation, not a real transaction.

The admin calendar submits `localStart` as `YYYY-MM-DDTHH:mm` to `/staff/classes`; the API interprets it in the selected branch's timezone. `startsAt` with an explicit offset remains supported for existing clients. The admin account directory accepts `search`, `role`, and `offset` query parameters and returns 25 users per page. Changing a practitioner's role is restricted because practitioner service records need dedicated migration; create a new practitioner account with its assigned services instead.
