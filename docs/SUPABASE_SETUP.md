# Veyora Business — Supabase & Architecture Setup Guide

This document describes the Stage 1 foundation setup, required credentials, database migrations, multi-tenant Row Level Security (RLS) model, and the planned module roadmap.

---

## 1. Credentials & Environment Variables Still Needed

Veyora Business is pre-wired for Supabase Auth, PostgreSQL, and Storage, but **no live backend credentials are embedded in this repository**.

To connect your live Supabase project, create a `.env.local` file in the project root (based on `.env.example`) and supply:

| Variable | Visibility | Where to Find It | Purpose |
| :--- | :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | Client-safe | Supabase Dashboard → Project Settings → API → Project URL | Base HTTPS endpoint for Auth, PostgREST, and Storage |
| `VITE_SUPABASE_ANON_KEY` | Client-safe | Supabase Dashboard → Project Settings → API → `anon` `public` key | Browser client key; enforces PostgreSQL Row Level Security |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only** | Supabase Dashboard → Project Settings → API → `service_role` key | Privileged server/worker operations only. **Never prefix with `VITE_`.** |

---

## 2. Database Migrations & Row Level Security (RLS)

Apply the SQL migrations in order from `supabase/migrations/`:

1. `supabase/migrations/0001_initial_foundation.sql`
2. `supabase/migrations/0002_auth_onboarding_and_rbac_hardening.sql`

### Option A: Supabase Dashboard SQL Editor
1. Open your Supabase project.
2. Navigate to **SQL Editor** → **New Query**.
3. Run `0001_initial_foundation.sql`, then run `0002_auth_onboarding_and_rbac_hardening.sql`.

### Option B: Supabase CLI
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### What the Migrations Create
- **`public.profiles`**: Synced automatically from `auth.users` via `on_auth_user_created`; readable only by the user and active peers in the same organisation.
- **`public.organisations`**: Multi-tenant business entities (`name`, `slug`, `business_type`, `country`, `base_currency`, `timezone`, `business_email`, `business_phone`).
- **`public.organisation_roles`**: Explicit role lookup table (`owner`, `admin`, `manager`, `staff`).
- **`public.organisation_members`**: Role-based membership linking users to organisations, bound by foreign key to `organisation_roles`.
- **`public.audit_logs`**: Cross-module activity log scoped strictly by `organisation_id`.
- **RBAC & Anti-Privilege-Escalation**:
  - `enforce_membership_rbac()` trigger blocks users from changing their own role or removing/demoting the last active `owner`.
  - `org_members_insert_privileged` / `org_members_update_privileged` prevent `admin` users from assigning `owner` or `admin` roles.
  - `public.create_business_workspace(...)` RPC atomically creates a workspace, assigns the caller as `owner` server-side, and logs the creation event.

---

## 3. Authentication & Storage Checklist

1. **Email / Password Provider**: Confirm **Authentication → Providers → Email** is enabled in Supabase.
2. **Site URL & Password Reset Redirects**: Under **Authentication → URL Configuration**, set your development/production Site URL and add your app origin (e.g. `http://localhost:3000` and your deployed URL) to **Redirect URLs** so email confirmation and password reset links redirect back into the app's recovery flow.
3. **Private Storage Bucket**: Verify the `organisation-files` bucket exists under **Storage** and remains **Private** (`public = false`). All client uploads must follow the key path `<organisation_id>/<module>/<filename>` so RLS policies match cleanly.

---

## 4. Planned Module Roadmap (Future Phases)

Each business domain is isolated under `src/modules/<module_name>/` and connects through shared `organisation_id` foreign keys and domain events:

1. **Phase 2 — Inventory & Suppliers**: Product catalog, SKUs, categories, warehouses/locations, stock levels, supplier directory, and storage-backed product media.
2. **Phase 3 — Purchases**: Purchase orders, supplier bills, goods received notes (GRN), and automated inventory stock increments.
3. **Phase 4 — Customers & Sales**: Customer CRM, quotes, sales orders, POS/invoicing, fulfilment, and stock deductions.
4. **Phase 5 — Finance**: Chart of accounts, accounts receivable/payable, expense ledger, tax rules, and cashflow reconciliation.
5. **Phase 6 — Reports & Exports**: Margin analysis, inventory valuation, tax summaries, and CSV/PDF reporting.
