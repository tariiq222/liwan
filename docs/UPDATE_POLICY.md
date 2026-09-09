# Update review and explicit approval — 2026-09-09

This is the user's standing rule for **every AI tool, agent, delegate and
automation** working on Nasq, including all existing and future worktrees.
Read this policy before proposing or applying any upgrade. It supersedes earlier
general permission to apply security updates or refresh the internal runtime.

## Mandatory sequence

1. Inspect the installed versions/commits and the exact proposed versions/commits.
   Read official release notes, advisories and the actual intervening changes.
   Research and inventory are allowed; do not change dependencies or a running
   system to discover what an update does.
2. Produce a report in Arabic, with official evidence, using the fields described
   in `tools/update_gate/README.md`. Explicitly classify the proposal as
   **security-only**, **mixed security/maintenance/features**, **core/behavior
   change**, or **unknown**. A patch version, security label, or clean scanner
   result does not establish compatibility. Unknown changes remain unknown.
3. Assess every affected layer and existing customization: stock Odoo and its
   adapters, Cyan meetings and Nasq minutes/series/tasks, PMO, HR, access/company
   boundaries, chat, Nuxt/contracts, Arabic/RTL/theme, PDF/attachments, Python/JS
   dependencies, containers/runtime, migrations and stored data. Mark a layer
   unaffected only with a reason. Preserve source patches and explain vendor
   overwrite risk. Include exact actions, tests, backup and rollback plans.
4. Present the report and **stop before applying any update**. Ask Tariq to
   approve or reject that specific proposal. Security-only updates require the
   same approval. Silence, an older approval, a request to investigate, an agent's
   recommendation, a commit/merge request, or this hook-installation request is
   not approval to update.
5. After explicit approval, apply only the approved versions, scope, environment
   and actions. A changed target, additional dependency, changed report or wider
   impact needs a new report and approval. Validate the approved result and
   report what actually changed, tests, remaining risks and runtime state.

## Scope

Covered: Odoo upgrades/pulls/replacements, third-party addons, vendor/theme
regeneration, dependency manifest/lock/pin changes, package upgrades or new
resolution, container/base-image and toolchain changes, and Odoo database
module installation/upgrade (`-i`, `-u`, `--update`, ORM upgrade methods). This
includes internal, local, staging and production environments, and experiments
that install new versions. Loading a module into `odoo19` still requires approval.

Ordinary authorized product development is not an upstream upgrade. Read-only
audits, source inspection, tests on an already prepared isolated database and
exact frozen dependency replay are allowed. Fresh database initialization or
dependency changes required for a test must be included in the proposal first.
Never run tests against `odoo19`. Preserve stock Odoo's existing read-only rule.

## Hook rules and limits

Supported runners use a shared pre-tool gate. A denied action must not be
rerouted through another tool, MCP, script, interpreter, SSH, subagent or
automation. Never disable or edit guards, forge approval files, fill in a human
approval prompt, or grant yourself approval. A hook failure is a reason to stop
and diagnose, not to retry without protection. Delegation briefs must carry this
policy and the approved scope, if any. New tools must load this policy before
use and be added to the coverage inventory.

Approvals are bound to the report's digest and exact ordered actions and expire.
The human terminal confirmation is a procedural human gate; an AI must not
invoke it interactively or write its state. It is **not** cryptographic proof of
who typed a confirmation, and a project hook is not an OS sandbox against a
process with the same user's filesystem rights. Arbitrary code can hide updates;
command recognition cannot prove every possible program safe. Tools without a
verified pre-execution hook have instruction-only coverage. Never describe that
as universal enforced protection, and never assume a running session has reloaded
new hooks. See the installation report for verified adapters and limitations.
