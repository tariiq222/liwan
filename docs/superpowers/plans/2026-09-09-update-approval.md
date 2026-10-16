# Update approval gate

The user's 2026-09-09 request authorizes implementing this gate, not any further
upgrades. Every security, maintenance, major, vendor-addon, Odoo-core, database
module-load and runtime/dependency update requires an exact report and a fresh
explicit human decision. No security-only shortcut. Research stays read-only.

## Design and ownership

- Coordinator: shared policy, runner adapters/settings, installation, final checks.
- Luna high: `tools/update_gate/gate.py` and `tools/update_gate/test_gate.py` only.
- Read-only Astra: inspect installed runner support; no writes.

One standard-library Python gate accepts normalized shell/edit payloads. It
blocks recognized update operations by default and protects dependency/vendor
files against direct editor tools. All tools get an instruction entrypoint.
Supported pre-tool hooks call the same gate; unsupported tools have policy-only
coverage, explicitly documented. Arbitrary shell programs and agents with the
same filesystem permissions cannot be securely sandboxed by a project hook.

Reports identify exact versions/commits, official release/advisory evidence,
security-only/mixed/core/unknown classification, all WebVue module and customization
impacts, tests, backup/rollback, and exact ordered tool actions. Unknown changes
are never called security-only. A human-only terminal approval prints the report
and asks for its digest; approval binds to its unchanged content and ordered
actions, expires, and is consumed per action. Agents must never create approval
records, answer the prompt, disable hooks, or use a different tool to evade a
denial. This is an accidental-update guard, not authentication against a malicious
same-user process. Native runner approval remains an additional boundary.

## Acceptance

1. No report/approval: update commands and protected-file edits deny.
2. Read-only audit/inventory and ordinary product work remain available.
3. Missing report details, changed report, expired approval, wrong action/cwd,
   replay and malformed payloads deny.
4. Approval CLI rejects non-interactive invocation; hook cannot mint approval.
5. Preserve existing Odoo source and database safety hook.
6. Exercise actual adapter payloads, compile/check adapters, run focused tests.
7. Install only this gate's scoped files after reviewing the worktree result;
   no dependency updates, runtime restart, commit, Git merge or push.
