# 19.0.1.2.0 — the LiwanOS second sign-in step replaces the TOTP route

`auth_totp` is no longer a dependency: `/api/v1/auth/totp` and its five tests are gone, and the
second step is `liwan_core`'s sign-in code and remembered device. No column of this addon changes.
A database that still has `auth_totp` installed keeps its own `res_users.totp_secret` column and
`auth_totp.device` rows; nothing in LiwanOS reads them, and an operator removes the module when it
is no longer wanted.
