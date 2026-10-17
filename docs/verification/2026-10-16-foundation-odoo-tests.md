# Odoo test run — 2026-10-16

> Historical evidence imported on 2026-10-17 from documentation commit
> `ad0bed8144ec599e2be3f3c0c5b91f957552f9d9`. The runs below concern source
> `67902a053821ea4895047c804015addcc2e4f15a` and the explicitly named tool
> commits, before the WebVue source/name reconciliation. They were not rerun
> for current WebVue. Results, old NASQ names, commands and source paths are
> retained as historical identifiers, not current operating instructions.
> Tool source is preserved in Git at `002fee8c7a08a63bc4077f9f107819169ef91aa6`;
> The original seven-file implementation is not imported. Current tools are a
> narrower provisioning-only adaptation with separate, fresh evidence requirements.
> This record does not establish current acceptance, merge, deployment or release approval.

- Source: main at 67902a05 (/Users/tariq/code/nasq)
- Database: fresh scratch nasq_audit_scratch_1016, -i of all release modules, NASQ_COMMERCIAL_CONFIG from deploy/classification.py fixture --mode saas
- Command: odoo-bin -c odoo.conf -d nasq_audit_scratch_1016 -i "$(python3 -B tools/catalog_check.py --release-modules)" --test-tags /<each module> --http-port=8179
- Exit code: 0. Logged `ERROR:` SQL lines come from tests asserting constraint violations.
- Local scratch evidence for the Odoo layer only; not production evidence.

```
odoo.tests.stats: nasq_ai: 65 tests 4.81s 16278 queries
odoo.tests.stats: nasq_api: 104 tests 8.94s 19392 queries
odoo.tests.stats: nasq_chat: 25 tests 2.73s 8264 queries
odoo.tests.stats: nasq_core: 53 tests 0.98s 3426 queries
odoo.tests.stats: nasq_directory: 9 tests 0.62s 1787 queries
odoo.tests.stats: nasq_hr: 96 tests 7.48s 21197 queries
odoo.tests.stats: nasq_meetings: 140 tests 17.95s 63404 queries
odoo.tests.stats: nasq_meetings_pmo: 56 tests 28.89s 56267 queries
odoo.tests.stats: nasq_notify: 25 tests 2.90s 10832 queries
odoo.tests.stats: nasq_operations: 28 tests 2.06s 8625 queries
odoo.tests.stats: nasq_operations_pmo: 6 tests 1.24s 4417 queries
odoo.tests.stats: nasq_platform: 88 tests 3.53s 6332 queries
odoo.tests.stats: nasq_pmo: 532 tests 89.54s 195477 queries
odoo.tests.stats: nasq_pmo_ai: 7 tests 0.40s 1145 queries
odoo.tests.stats: nasq_tasks: 165 tests 32.15s 64118 queries
odoo.tests.stats: nasq_tasks_pmo: 85 tests 16.12s 27866 queries
odoo.tests.result: 0 failed, 0 error(s) of 1192 tests when loading database 'nasq_audit_scratch_1016'
```
