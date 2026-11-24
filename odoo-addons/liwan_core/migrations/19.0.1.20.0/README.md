# 19.0.1.20.0 — a mobile number carries a verified stamp, and a code carries its purpose

`res.users` gains `liwan_mobile_verified_at`, and `liwan.login.code` gains `purpose` (`signin | verify_mobile`). No data is migrated: a number saved before this version has no verified stamp and stays unverified, so its holder verifies it once through the two-step `/api/v1/me/mobile/code` and `/api/v1/me/mobile/verify` routes before it may carry a sign-in code; the existing codes take the field default `signin`, which is what they were.
