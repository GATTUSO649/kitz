# Laundry Admin Role

The `laundry_admin` role is assignable by Super Admin through the existing administrator invitation and account-role controls. It has only `laundry.dashboard.view`, `laundry.bookings.manage`, `laundry.services.manage`, and `audit.view` by default. Role-number identifiers use the `LAUNDRY-` prefix.

The role-specific sign-in is `/laundry-admin/login`; the root application validates the role through the existing administrator session and portal guard. The protected landing page currently reports that booking tools are not connected. Laundry booking records remain browser-local, and no laundry booking API or shared operations dashboard is available yet. Do not treat this role as access to `/admin/laundry` on the separate platform service.

The additive migration `supabase/migrations/20261112000000_laundry_administrator_role.sql` updates the administrator role constraint and seeds the permission catalog/role grants without changing existing administrator rows. It has not been applied. Submit it through the repository's normal migration review and approval process before assigning `laundry_admin` against a database whose existing constraint does not include that role.
