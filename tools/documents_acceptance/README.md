# Documents replacement acceptance gates

These scripts create only new `webvue_scratch_*` databases and retain their own
scratch database and filestore so failures and acceptance results can be inspected.
They refuse an existing name or occupied port. Logs, exact commands and JSON results
remain in the requested evidence folder. They do not read a named development
database or use its configuration. Remove only the specifically named scratch
database and its matching filestore after reviewing the evidence.

The transport matrix treats Odoo's JSON-RPC routing error as a closed route: direct
and dedicated listeners return HTTP 200 with JSON-RPC error code 404 and no `result`;
the shared edge rejects the same generic endpoint with HTTP 403 before Odoo.

Set `ODOO_ROOT` if the Odoo 19 checkout is not `/Users/tariq/code/odoo`; its
`.venv/bin/python` supplies Odoo and psycopg2. Run from the isolated worktree:

```sh
export WEBVUE_OCA_DIR=/tmp/webvue-docs-oca-deps
python3 -B tools/oca_addons.py fetch --dest "$WEBVUE_OCA_DIR"
python3 -B tools/oca_addons.py path --check
python3 -B tools/documents_acceptance/attachment_spike.py --worktree "$PWD" --database webvue_scratch_docs_fit --http-port 8294 --evidence-dir /tmp/webvue-docs-fit
python3 -B tools/documents_acceptance/attachment_spike.py --worktree "$PWD" --database webvue_scratch_docs_upstream --http-port 8294 --evidence-dir /tmp/webvue-docs-upstream --upstream
python3 -B tools/documents_acceptance/migration_order.py --baseline dc39a8eb734da4557d341fbe24b2fc63d773fbb1 --worktree "$PWD" --database-prefix webvue_scratch_docs_order --evidence-dir /tmp/webvue-docs-order
```

`attachment_spike --red` omits the disposable fixture adapter and proves the linked
directory assertions fail. The fixture is generated outside the repository and is
never installed into a customer database. It adds no `sudo` of its own.

`migration_order` installs baseline HR and pinned DMS in both orders and characterizes
a **pre-registry** table/model adoption before installing a disposable target model.
It verifies the document and ir.model IDs, HTML, expiry date, XML reference, attachment
ID/checksum/filestore object and repeat adoption. It rejects unrelated DMS resources.
The fixture temporarily preserves the old attachment relation solely to prove
identity transfer; the final product migration must replace that relation with DMS
and test capability and commercial-policy migration separately (plan Task 5).
The metadata SQL is confined to this scratch proof. It is not a release migration.

A passing upstream suite is not acceptance of WebVue's grants, native routes, tokens,
concurrency, quotas, or tenant lifecycle; those require the later application tests.
OCA `has_access` can be broader than actual binary access. Test actual payloads and
never use it as WebVue's serializer or endpoint authorization decision.

Standalone application acceptance (only its declared dependencies, no HR):

```sh
python3 -B tools/documents_acceptance/attachment_spike.py --worktree "$PWD" --database webvue_scratch_docs_standalone --http-port 8294 --evidence-dir /tmp/webvue-docs-standalone --application --mode non_saas
```
