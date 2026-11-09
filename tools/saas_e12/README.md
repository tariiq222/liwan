# E12 shared worker crash acceptance

Run from a clean task worktree with independent dependencies, the Node version
in `.nvmrc`, and matching local images for the
[Foundation commercial fixture](../foundation_acceptance/README.md#commercial-acceptance).
The fixture must belong to this worktree and be fresh.

```sh
mkdir -p -m 700 .scratch/saas-e12
LIWAN_IMAGE_TAG=<matching-built-tag> FOUNDATION_OUTPUT_DIR="$PWD/.scratch/saas-e12" \
  node --import tsx tools/foundation_acceptance/provision_two_tenants.mjs --commercial
node --import tsx tools/saas_e12/recovery.mjs .scratch/saas-e12/<retained-run>
```

The second command starts only that run's Odoo and two PostgreSQL services. It
uses the commercial quote and payment services with the simulator, and starts
the foreground shared worker from the current commit. The fixture images can
be reused across control-plane-only changes. The command takes several minutes
because it waits for the two real worker leases.

- A test-only PostgreSQL trigger pauses the order transaction before `applied`.
  The test reads the committed Odoo row and the still-unpublished control state
  before sending SIGKILL. It compares the physical row version, receipt and
  billing after recovery and simulator redelivery.
- A second paid change pauses before `applying`. Odoo still carries the prior
  policy when the worker is killed. The restarted worker must honor an
  operator pause through lease expiry. Once operations are re-enabled, it
  must recover the same operation, write one policy revision and commit one
  receipt.
- A final paid change deliberately rolls back its target Odoo write. The test
  requires one full pending credit note and no successful application after
  restarting the worker and redelivering the simulated payment. The restart
  uses a deliberately missing journal to check that the already committed
  failed order is never sent back to Odoo.

The tool stops the shared worker and its Compose services and keeps the
databases and private evidence. Find `result.json` and worker logs in the
reported `e12-*` directory. These local cases cover paid user quota changes and
one injected rollback. A pending note is evidence of a compensation decision.
Recording a manual refund and transferring money through a payment provider
are separate checks.
