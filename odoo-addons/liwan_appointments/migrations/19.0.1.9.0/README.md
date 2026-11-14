# 19.0.1.9.0

The Appointments application depends on `liwan_products`, registers its feature key and `appointments.bookings.manage`
on `liwan.products.service`, and grants `products.manage` and `products.prices.manage` to its built-in manager role. The
grants are linked to that `noupdate` role by `_liwan_repair_builtin_role_grants` on every upgrade; no existing row
changes. The products a booking type names are adopted by the `end-` migration of `liwan_appointments_payments`.
