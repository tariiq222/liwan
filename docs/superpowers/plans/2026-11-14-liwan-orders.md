# `liwan_orders` implementation plan

> PR 1 of [the sales application design](../specs/2026-11-14-liwan-sales-design.md), which the owner approved on 2026-11-14. Status: not started. It starts after products PR 2 (#722) is merged. Facts were read on `origin/claude/products-service-pr2` at `366053b67`, which is `origin/main` at `65cb936d0` plus products PR 2, and in the Odoo 19 checkout; none was run (section 9). Each task rechecks the facts it uses after that merge.

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
| D7 | Odoo upgrade cost | One stock method name, `_compute_tax_ids`. A rename shows as failing tests of this addon, not as a silent loss of the rule |

## 5. Tasks

The change decides what tax a customer is charged, so it takes the full path: failing tests first, one implementer, a tester, and a reviewer separate from the implementer.

Orchestrator files (one owner, edited once): `tools/arch_layers.json` (`"liwan_orders": 3`), `docs/agents/repository-layout.md`, each file of section 3 that lists installed addons, after checking how it lists `liwan_api_account`, and the evidence table of the sales design.

Server (one implementer). Files: `odoo-addons/liwan_orders/**`, `odoo-addons/liwan_payments/models/order_service.py`, `odoo-addons/liwan_payments/README.md` if it states the rule.

- [ ] Recheck section 3 on `origin/main` after products PR 2 is merged, the line numbers included.
- [ ] Failing tests first for every line of "PR 1 proves" below, in `odoo-addons/liwan_orders/tests/`, each test file imported by `tests/__init__.py`.
- [ ] The addon: manifest (D1), `models/sale_order_line.py` (D2), `README.md`. No data file and no security file: it adds no model.
- [ ] Remove the copy of the rule from the payments factory (D5).
- [ ] The orchestrator files.
- [ ] `python3 -B tools/arch_policy.py`. The baseline does not change.

## 6. PR 1 proves

Each line is a test. The amounts use a product at 115 with the 15% sale tax, as the products plan ran them on stock.

- A line of an unregistered establishment carries no tax under `tax_included` and under `tax_excluded`, and its total is 115.
- The same line still carries none after its product is changed, after its quantity is changed and after the order's fiscal position is changed and its taxes are updated.
- A line of a branch of an unregistered establishment carries none.
- A line of a registered establishment carries the stock taxes: 115 in all under `tax_included`, 132.25 under `tax_excluded`.
- An establishment that registers: a line made before keeps no tax, and a line made after is taxed. An establishment that deregisters: a line made before keeps its tax, and a line made after has none.
- A combo line and a line without a product carry none, as stock decides.
- The invoice of a confirmed order of an unregistered establishment carries no tax.
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

## 9. Evidence status

| Claim | Status |
| --- | --- |
| The payments factory, its copy of the rule, its two callers and its VAT tests | Read on `origin/claude/products-service-pr2` at `366053b67`; not run |
| `_liwan_vat_registered()` answers from the line's own company | Read in `liwan_core/models/res_company.py`; not run |
| The stock compute, its dependencies and the writable `tax_ids` | Read in Odoo 19 source; not run |
| An override that declares no dependency adds none | Inferred; the registration tests of section 6 |
| The rank rule, the two sides of a bridge and what the isolation check watches | Read in the tools; not run on a `liwan_orders` manifest |
| A rank-3 addon that installs itself passes the isolation checks and the module closure | Inferred; the first lines of section 6 |
| The amounts 115 and 132.25 | Run by the products plan on a throwaway database on 2026-11-13; not rerun here |
| Everything in sections 4 to 6 | Plan, not built |
