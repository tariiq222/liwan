# T15 image surface repair — narrow transport, not Odoo ACL acceptance

Two actual client consumers are admitted in shared guard only:

- `useBranding.ts` constructs GET/HEAD `/web/image/res.company/<positive-id>/logo/32x32?v=<version>` from the public branding logo. Version is actual serializer output: 20-digit timestamp (or `0`) + hyphen + 12 lowercase SHA256 hex characters. Exactly one `v`, no additional query keys.
- `EmployeeCard.vue` constructs GET/HEAD `/web/image/hr.employee/<positive-id>/avatar_128`, with no query parameters.

Generic image models/fields, alternate sizes, arbitrary binary URLs, access_token,
query model/id/field/db overrides, duplicate version parameters, mutation methods,
encoded path aliases and normalized traversal are denied. Registry host→database
and tenant-bound signed session enforcement remain unchanged. Numeric record IDs
stay inside the selected database; the guard does NOT decide company/role ACLs.
Dedicated routes/configuration are unchanged.

Read-only upstream evidence: `odoo/addons/base/models/ir_binary.py` `_find_record`
lines 43–55 resolves records; token or `_can_return_content` may grant stock sudo,
otherwise `check_access('read')` runs. `_record_to_stream` checks field read access
at lines 72–73. `addons/web/controllers/binary.py` lines 191–208 calls those helpers
and may return `web.image_placeholder` on UserError. Thus HTTP 200 is NOT proof that
requested private image bytes were authorized or returned. This repair adds no
sudo, public grants, access tokens or Odoo source modifications.

Tests assert exact distinctive MOCK_IMAGE_BYTES body and DB host/SID destination,
foreign-cookie rejection before mock upstream, HEAD empty body + content-type,
and narrow allowlist negatives. These fixture bytes are deliberately not real
images or an ACL oracle. Loopback tests use 127.0.0.1 ephemeral ports with bounded
HTTP timeouts and shutdown hooks. Real Odoo role/company permissions, actual image
bytes vs placeholder, browser caching/304 and production network: **NOT RUN**.
