# `liwan_orders` implementation plan

> PR 1 of [the sales application design](../specs/2026-11-14-liwan-sales-design.md), which the owner approved on 2026-11-14. Status: built on 2026-11-14 in local commits on the branch `api-liwan-orders`, started before products PR 2 (#722) merged at the owner's request; nothing is pushed. The release-list copies and `docs/agents/repository-layout.md` are not done: another session holds them for #722, and they are synced after it merges (sections 5 and 9). Facts were first read on `origin/claude/products-service-pr2` at `366053b67` and rechecked on `origin/main` at `09ec47795` and on #722 at `817f64623` before the work started.

## 1. Goal

One addon, `liwan_orders`, holds the one LiwanOS rule of an order line's tax: a line of an establishment that is not registered for VAT carries no tax. The rule sits on the stock tax compute, so it holds for a line an online channel made and for a line a member of staff typed, when the line is created and after every edit. `liwan_payments` drops its own copy of the rule.

## 2. Scope

In: the addon with its extension of `sale.order.line`, its tests, its registration in the layers and in the lists of installed addons, and the removal of the rule's copy from the payments order factory.

Out, by the design: the order factory, which stays in `liwan_payments` until the store starts (foundation design, section 5); quotations, their routes, capabilities and settings (sales PR 2); invoices (sales PR 4); pricelists. The addon has no route, no capability, no feature key, no setting and no service model in this pull request, so R10 asks nothing of it yet.

## 3. Facts the plan rests on

"Read" means the code was opened; "inferred" means the first test of the task must confirm it.

The rule today (read):

- The payments factory adds a line with the product and the quantity only, lets stock compute its taxes, and then clears them for an establishment that is not registered (`liwan_payments/models/order_service.py:65-85`, the rule at `:82-83`). The factory has two callers, both rank-5 bridges (`liwan_inbox_payments/models/order.py:187-189`, `liwan_appointments_payments/models/resource_booking.py:70-71`).
- `res.company._liwan_vat_registered()` answers for the establishment from a derived field every company of it carries, so a branch session needs no read of the root (`liwan_core/models/res_company.py:44,67-75,183-195`).
- The payments tests prove the rule through the factory in fifteen tests: no tax under either tax mode, a branch of an unregistered establishment, every added line, the credit note, and both directions of a later change of registration, where an order issued before the change keeps what it was issued with (`liwan_payments/tests/test_vat_registered.py:67-188`). The customer messages bridge has its own VAT tests, which products PR 2 rewrites (`liwan_inbox_payments/tests/test_vat_registered.py`).

Stock (read in Odoo 19):

- `sale.order.line.tax_ids` is computed, stored and writable (`addons/sale/models/sale_order_line.py:162-170`). `_compute_tax_ids` depends on the line's product and company. It gives no tax to a combo line and to a line without a product, and otherwise the product's taxes of the company, mapped by the order's fiscal position (`:544-572`).
- A compute's dependencies are collected from every override of the method. Inferred from the ORM, not opened for this plan: an override that declares no dependency adds none.

Layers and CI (read):

- A layered addon reaches a strictly lower rank only, and `liwan_payments` is rank 3 (`tools/arch_policy.py:168-177`, `tools/arch_layers.json`). So payments cannot depend on `liwan_orders`.
- The bridge job accepts a rank-5 bridge with exactly two sides and installs only those (`tools/app_isolation.py`, `_bridge_sides`; `deploy/ci/odoo-bridge.sh:17-20`). Both payment bridges already name two LiwanOS modules, so neither can name `liwan_orders`.
- The isolation check watches applications and bridges. A shared service that a run installed counts as present, except in the standalone run of the foundation, which must stand without any shared service (`tools/app_isolation.py:177-195`). That run installs no stock `sale`.
- No rank-3 addon installs itself today. `liwan_api_account` (rank 5) installs itself with `liwan_api` and stock `account` through `'auto_install': ['liwan_api', 'account']`.
- Files outside the addons that name `liwan_api_account`, the nearest precedent of an addon that installs itself: `deploy/provision.sh`, `deploy/verification-checks.json`, `deploy/check_isolated.py`, `deploy/OPERATIONS.md`, `deploy/control-plane-outage/outage-fixture` and its `README.md`, `deploy/test_ci_stages.py`, `tools/liwan_cli/operator.py`, `tools/test_module_closure.py`, `tools/shared_acceptance_live/up.sh`, `docs/testing.md`, `docs/agents/odoo-rules.md`, `docs/agents/repository-layout.md`.
- A rank-3 name is not a commit scope; commits use `api` (products plan, section 3).

## 4. Design points

| # | Point | Decision |
| --- | --- | --- |
| D1 | Shape of the addon | Rank 3. `depends` and `auto_install` both name `liwan_api` and `sale`, so Odoo installs it wherever the two are. `liwan_sales` will depend on it by name |
| D2 | The rule | An override of `sale.order.line._compute_tax_ids` calls stock first, then clears `tax_ids` on the lines whose company answers `_liwan_vat_registered()` with no. It declares no dependency of its own |
| D3 | A later change of registration | Nothing is recomputed. A line keeps what it was issued with, and a line whose product or company is edited after the change follows the new answer. A dependency on the registration field is refused: it would recompute the lines of confirmed and invoiced orders |
| D4 | Elevation | None. The compute reads the line's own company, which answers by itself (section 3). `tools/arch_documented_sudo.json` does not change |
| D5 | Payments | `_liwan_add_line` loses its two lines of the rule and the part of its docstring that states it, with any import they alone used. The payments VAT tests stay as they are and must pass unchanged: they then prove the rule through `liwan_orders` in a database where it installed itself |
| D6 | A tax written by hand | `tax_ids` stays writable in stock and the compute does not see a direct write. No LiwanOS route accepts a tax for an order line today, and sales PR 2 keeps that with a test of its serializer. A constraint is not added here: it would refuse the legitimate rewrite of a line issued while the establishment was registered |
| D7 | Odoo upgrade cost | Two names: the stock compute `_compute_tax_ids` and the public ORM method `copy_data` (D8). A rename of the compute shows as failing tests of this addon, not as a silent loss of the rule |
| D8 | A copied line (added during the review of PR 1) | Stock copies `tax_ids` as an explicit value (`odoo/orm/fields.py:443-450`, `addons/sale/models/sale_order.py:1021-1031`), which skips the compute. `copy_data` removes the copied value for a line of an establishment that is not registered, unless the caller passed `tax_ids` in the defaults, so the copy carries no tax. A registered establishment's copy is stock's copy: a hand-set tax and a global discount line carry taxes the compute cannot reproduce from the product. Open limit, for the route of sales PR 2 that copies an order: an untaxed line issued before a registration is copied untaxed by stock, and that route recomputes the taxes of the copy |
| D9 | An existing database (found during the recheck) | Odoo installs an `auto_install` module only when one of its trigger dependencies is being installed in the same operation (`odoo/addons/base/models/ir_module.py:418-422`). A database that already has `liwan_api` and `sale` gets the addon only when `-i` names it, which the release module list does (`deploy/ci/upgrade.sh` passes the catalog's install closure to `-u` and `-i`). No migration is added: the product has no live tenant, and the release list is how every new addon arrives |

## 5. Tasks

The change decides what tax a customer is charged, so it takes the full path: failing tests first, one implementer, a tester, and a reviewer separate from the implementer.

Orchestrator files (one owner, edited once): `tools/arch_layers.json` (`"liwan_orders": 3`), `docs/agents/repository-layout.md`, each file of section 3 that lists installed addons, after checking how it lists `liwan_api_account`, and the evidence table of the sales design.

Server (one implementer). Files: `odoo-addons/liwan_orders/**`, `odoo-addons/liwan_payments/models/order_service.py`, `odoo-addons/liwan_payments/README.md` if it states the rule.

- [x] Recheck section 3, the line numbers included. Done on `origin/main` at `09ec47795` and on #722 at `817f64623`: every fact holds; the two-sides check of the bridge job is at `deploy/ci/odoo-bridge.sh:19-20`. It is repeated on the merged tree after #722.
- [x] Failing tests first for every line of "PR 1 proves" below, in `odoo-addons/liwan_orders/tests/`, discovered by `import_all_tests` in `tests/__init__.py`.
- [x] The addon: manifest (D1), `models/sale_order_line.py` (D2, D8), `README.md`. No data file and no security file: it adds no model.
- [x] Remove the copy of the rule from the payments factory (D5).
- [ ] The orchestrator files. Done: `tools/arch_layers.json` and the closure test in `tools/test_module_closure.py`. Waiting for #722: the eight release-list copies, rewritten by `python3 -B tools/catalog_check.py --sync-release-copies`, and `docs/agents/repository-layout.md`. Until the sync, `tools/catalog_check.py` and its two tests fail on those copies.
- [x] `python3 -B tools/arch_policy.py`. The baseline does not change.

## 6. PR 1 proves

Each line is a test. The amounts use a product at 115 with the 15% sale tax, as the products plan ran them on stock.

- A line of an unregistered establishment carries no tax under `tax_included` and under `tax_excluded`, and its total is 115.
- The same line still carries none after its product is changed, after its quantity is changed and after the order's fiscal position is changed and its taxes are updated.
- A line of a branch of an unregistered establishment carries none.
- A line of a registered establishment carries the stock taxes: 115 in all under `tax_included`, 132.25 under `tax_excluded`.
- An establishment that registers: a line made before keeps no tax, and a line made after is taxed. An establishment that deregisters: a line made before keeps its tax, and a line made after has none.
- A combo line and a line without a product carry none, as stock decides.
- The invoice of a confirmed order of an unregistered establishment carries no tax, and so does its down payment.
- A copy of an order made after a deregistration carries no tax on any line, a global discount line included, and the original keeps its tax. A copy in a registered establishment is stock's copy: a hand-set tax and the tax of a global discount line survive it, and an explicit tax in the copy's defaults is kept (D8).
- The payments VAT tests pass unchanged with the factory's copy of the rule removed.
- `liwan_orders` is installed in a database with `liwan_api` and `sale`, and is absent from one without `sale`.
- The bridge jobs of `liwan_inbox_payments` and `liwan_appointments_payments` pass their isolation check with `liwan_orders` installed, and the standalone run of the foundation installs no `liwan_orders`.
- Every tier of `tools/test_module_closure.py` that contains `sale` contains `liwan_orders`.
- The rule holds in `saas` and in `non_saas`: it reads no commercial mode.

## 7. Checks before the push

- The Odoo tests of `liwan_orders`, `liwan_payments`, `liwan_inbox_payments` and `liwan_appointments_payments` on a scratch database through `npm run test:odoo` (`tools/odoo_test.py`), under the limits of the shared machine.
- `python3 -B tools/arch_policy.py` and `npm test` for the tools tests: the module closure, the isolation tool and the sudo gate.
- `deploy/ci/odoo-bridge.sh liwan_inbox_payments` and `deploy/ci/odoo-bridge.sh liwan_appointments_payments`.

## 8. Risks

| Risk | Answer |
| --- | --- |
| `liwan_orders` is the first rank-3 addon that installs itself, and a check may assume none does | Section 3 read the isolation check as tolerant of an installed service. The closure and isolation lines of section 6 are written first; a refusal there returns to the coordinator before any model code |
| A caller writes `tax_ids` directly and the rule is bypassed | D6. The sales serializer test is a line of sales PR 2 |
| Products PR 2 changes the files this plan read | The first task rechecks every fact on `origin/main` |
| Odoo renames the compute | D7 |
| An existing database is upgraded with `-u` alone and runs payments without `liwan_orders` | D9. The release-list copies must be synced before this pull request is published, and a development database is updated with `-i liwan_orders` |
| Sales PR 2 adds a route that copies an order | D8: that route recomputes the taxes of the copy, with a test for an order issued before a registration |

## 9. Evidence status

| Claim | Status |
| --- | --- |
| The payments factory without its copy of the rule, and its VAT tests unchanged | Run on a scratch database on 2026-11-14 with `liwan_orders` installed: the tests pass. Run without it as a control: 13 of them fail with a taxed order |
| `_liwan_vat_registered()` answers from the line's own company | Run through the branch tests of `liwan_orders` as superuser; a branch-only user session is not covered, since no LiwanOS user holds a sales right before sales PR 2 |
| The stock compute, its dependencies and the writable `tax_ids` | Read in Odoo 19 source and run through the tests of `liwan_orders` |
| An override that declares no dependency adds none | Read in `odoo/orm/fields.py:584-598` and run: the registration tests of section 6 pass |
| The rank rule, the two sides of a bridge and what the isolation check watches | Run on 2026-11-14: `tools/arch_policy.py` passes with and without `--base origin/main` |
| A rank-3 addon that installs itself passes the isolation checks and the module closure | Run locally on 2026-11-14: `deploy/ci/odoo-bridge.sh` for both payment bridges installs `liwan_orders` without naming it and passes; `deploy/ci/odoo-app-standalone.sh liwan_api` installs none; the closure test passes. Not run in GitHub CI: nothing is pushed |
| The amounts 115 and 132.25 | Run in the tests of `liwan_orders` on 2026-11-14 |
| Everything in sections 4 to 6 | Built in local commits on `api-liwan-orders`, except the release-list copies and `docs/agents/repository-layout.md`; not pushed, not merged |
| The release-list copies name `liwan_orders` | Not done; `tools/catalog_check.py` fails on them until the sync after #722 |
