# SaaS commercial migration (C1) — verification

- Date: 2026-10-03
- Base SHA: `5dc1daef79ff4628f92d4b23a8dec2d27e3af1eb` (worktree dirty: uncommitted work from several agents)
- DB: scratch `nasq_control_scratch_commercialc` (schema reset; `migrate()` then schema_013 + schema_014 applied manually — TODO until registered in db.ts)

## Commands
| Command | Exit |
|---|---|
| `npx vitest run --no-file-parallelism src/__tests__/commercial-migration.test.ts` (apps/control-plane, CONTROL_TEST_DATABASE_URL overridden) | 0 — 6/6 passed |
| `npm -w apps/control-plane run build` | 0 |
| `python3 tools/saas_commercial_migration.py --dry-run --database-url postgres://x@127.0.0.1/prod` | 65 (refused, as designed) |

## Fixture counts (dry-run == run report)
saas_package 2, saas_catalog_only 2, non_saas 1, package_published 2, package_skipped 2, errors 0.
Final: 9 legacy_mappings, 2 legacy bundle revisions, 4 customers, 4 pending subscriptions.

## Assertions
| Assertion | Result |
|---|---|
| Dry-run writes nothing (mappings/customers/subscriptions/bundles/releases/runs unchanged) | PASS |
| Interrupt after 3 rows → 3 mappings persisted; resume converges to 9 | PASS |
| Rerun: same source_digest, same counts, nothing created, mappings identical | PASS |
| Published package → bundle (published, available=false, private `legacy:` audience, release resolved, payload has package_id/version/content_digest/source_sha256) | PASS |
| Draft/validated skipped (`none`); withdrawn published still mapped | PASS |
| Limits 0 and null preserved in mapping payload | PASS |
| SaaS tenants (package, catalog-only, no billing) → customer, setup_required=true, subscription pending, no revisions, legacy_source set | PASS |
| non_saas → `excluded_non_saas` mapping only, no customer | PASS |
| Zero rows in orders/invoices/invoice_lines/payment_attempts/payment_events/quotes/subscription_revisions/renewals | PASS |
| Tenant rows byte-identical; effective policy hash (observed ?? desired) unchanged | PASS |
| shared_jobs count unchanged; running job still `running` | PASS |
| `resolvePackageJobAuthority` still resolves for migrated tenant | PASS |

## Notes
Bundle audience uses `{kind:'customer', customer_id:'legacy:<package_id>'}` as the private legacy marker (schema allows only public|customer). Bundle selections/prices are empty (legacy packages carry limits, preserved in the mapping payload).
CLI: `migrate-saas-commercial --dry-run|--run [--report path]`; exit 2 if per-row errors.
