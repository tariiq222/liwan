# Documents replacement acceptance gates

These scripts create only new `liwan_scratch_*` databases and retain their own
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
export LIWAN_OCA_DIR=/tmp/liwan-docs-oca-deps
python3 -B tools/oca_addons.py fetch --dest "$LIWAN_OCA_DIR"
python3 -B tools/oca_addons.py path --check
python3 -B tools/documents_acceptance/attachment_spike.py --worktree "$PWD" --database liwan_scratch_docs_fit --http-port 8294 --evidence-dir /tmp/liwan-docs-fit
python3 -B tools/documents_acceptance/attachment_spike.py --worktree "$PWD" --database liwan_scratch_docs_upstream --http-port 8294 --evidence-dir /tmp/liwan-docs-upstream --upstream
```

`attachment_spike --red` omits the disposable fixture adapter and proves the linked
directory assertions fail. The fixture is generated outside the repository and is
never installed into a customer database. It adds no `sudo` of its own.

A passing upstream suite is not acceptance of LiwanOS's grants, native routes, tokens,
concurrency, quotas, or tenant lifecycle; those require the later application tests.
OCA `has_access` can be broader than actual binary access. Test actual payloads and
never use it as LiwanOS's serializer or endpoint authorization decision.

Standalone application acceptance (only its declared dependencies, no HR):

```sh
python3 -B tools/documents_acceptance/attachment_spike.py --worktree "$PWD" --database liwan_scratch_docs_standalone --http-port 8294 --evidence-dir /tmp/liwan-docs-standalone --application --mode non_saas
```
