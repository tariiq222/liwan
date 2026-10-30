# Stricter branch scopes

The ORM creates `liwan.access.branch.strict`, one row per application scope a tenant keeps out of
branch inheritance. No row exists after the upgrade, so inheritance behaves exactly as before until a
tenant switches a scope on. No data transformation or stock Odoo table SQL is needed.
