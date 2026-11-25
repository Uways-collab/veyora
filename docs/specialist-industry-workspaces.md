# Specialist industry workspaces — initial release

Veyora's shared Inventory, Sales, Purchases, Customers and Finance modules remain the common foundation. The Industry Workspaces area adds a first operational register for each specialist category selected by an organisation.

## Initial workflows

| Category | Register | Main fields and lifecycle |
|---|---|---|
| Hotels & hospitality | Reservations | Confirmation, room, guest contact, check-in/out, party size, booking total; booked → checked in → checked out, with cancel/no-show paths |
| Car dealerships | Vehicle stock | Stock number, optional VIN, make/model/year, mileage, cost/asking price; in stock → reserved/sold/in service |
| Real estate | Leases | Property/unit, tenant contact, lease dates, rent, deposit, due day; draft → active → ended/terminated |
| Restaurants & cafés | Orders | Order number/type, table/pickup, items summary, total; new → accepted → preparing → ready → served → completed |
| Logistics & fleet | Delivery jobs | Tracking number, recipient, origin/destination, dispatch time, delivery state, HTTPS proof-of-delivery URL |
| Manufacturing | Production orders | Order number, product, planned/completed quantity, planned start/due date; planned → released → in progress → quality check → completed |

## Access controls

All six tables:
- Carry an organisation foreign key and have RLS enabled.
- Require a matching organisation membership for reads and writes.
- Allow members to create records.
- Allow owners, admins and managers to update records.
- Allow only owners and admins to delete records.
- Enforce category-specific status transitions in a database trigger, so invalid transitions cannot be bypassed by calling the REST API directly.

## Deliberate boundaries

This is an initial operational-register release, not the complete specialist ERP suite. It does not yet:
- prevent room booking overlaps or manage room inventory/housekeeping;
- create dealership leads, sales contracts, deposits or service jobs;
- create property/unit master records, rent invoices or payment receipts;
- manage restaurant menus, recipes, kitchen tickets or ingredient stock deductions;
- assign drivers/vehicles, optimize routes or collect native proof-of-delivery uploads;
- manage bills of materials, material consumption, production costing or finished-goods receipts;
- post any specialist transaction into Finance or silently change core Inventory.

These integrations need their own atomic database workflows, audit events and rollback tests before being enabled. The current registers never create finance entries, stock movements or payments.

## Testing performed

- Verified all six tables and their columns exist in Supabase.
- Verified each table has four RLS policies covering SELECT, INSERT, UPDATE and DELETE.
- In a transaction that was rolled back, tested all six tables under the Wearspiration owner membership: insert/read succeeded.
- In a separate rollback-only transaction, tested one allowed and one disallowed state transition for each category; valid transitions succeeded and invalid transitions were rejected.
- ProductProHub was not queried or modified by these tests.
