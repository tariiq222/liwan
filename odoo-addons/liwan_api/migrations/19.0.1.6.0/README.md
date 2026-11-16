# 19.0.1.6.0

No data migration: `liwan.api.public.limit` (table `liwan_api_public_limit`, unique `(scope, res_id)`) is the one counter
behind the per-link rate limits of the public routes. It starts with no rows, and a counter is only a minute window, so
nothing needs carrying forward from the per-application counters it replaces (the Appointments counter table is dropped
by `liwan_appointments` 19.0.1.10.0).
