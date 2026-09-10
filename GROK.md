# Nasq project instructions

Read [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md) and [DESIGN.md](DESIGN.md).
Nuxt UI Dashboard is the approved foundation; follow the
[reference](docs/design-system/nuxt-ui-reference.md) and
[component catalog](docs/design-system/components.md). All new components
belong to the same Nasq theme; no extra UI library or new legacy consumers.
Run `python3 -B tools/ui_policy.py` plus behavioral and visual checks.
Follow the current UPDATE_POLICY: local install/build/preview/tests need no
update approval; GitHub source updates require review and approval in chat.
The isolated executable reference is in apps/web/design-preview, not a customer
app rollout. Do not restore the removed update hook.
