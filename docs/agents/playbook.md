# Task entry playbook

One gate at the start of a task. This page only routes and points: every rule stays in
its owning file, and where this page and an owner file disagree, the owner file wins.

## The gate

1. Pick the track from the request prefix. Without a prefix, classify the request
   yourself and state the track in one line before starting.
2. Read `AGENTS.md`, plus the track's references below — at least the layer rule that
   matches the files you will change.
3. Take a lane: `npm run wt -- take <branch> --holder <worker role(s)> --orchestrator <id>`.
   Implement through delegated workers in that lane ([parallel-work.md](../parallel-work.md#lane-pool)).
   The orchestrator commits locally on the task branch (standing authorization,
   [integration-rules.md](integration-rules.md#standing-authorization-owner-decision-2026-11-11)).
4. Run the track's checks, then report result, changed files and one evidence line per
   check.
5. Push, PR and ready follow automatically after a clean independent review; merge, auto-merge,
   release tags and deployments each need the owner's explicit words
   ([integration-rules.md](integration-rules.md)).

| Prefix | Track | When it applies |
| --- | --- | --- |
| «إصلاح:» | Fix | A defect: wrong behavior, a traceback, a failing test, a broken error state. |
| «ميزة:» | Feature | A new capability, endpoint or screen, or any change that adds product behavior. |
| «واجهة:» | UI | Customer-visible presentation in `apps/web`: pages, components, layout, locale strings. |
| «صيانة:» | Maintenance | Dependencies, docs, CI, tooling, cleanups, upgrades — no intended product behavior change. |

A request that spans tracks applies the union of their Read lists and runs the union of
their Verify commands. Report under the first track it matches in this order: Feature,
Fix, UI, Maintenance.

## Fix — «إصلاح:»

- Read: [AGENTS.md](../../AGENTS.md); the layer rule for the touched files
  ([odoo-rules.md](odoo-rules.md) or [web-rules.md](web-rules.md)); [testing.md](../testing.md)
  for check depth.
- Flow: reproduce the defect first, fix it in place per "Clean pre-release codebase"
  (`AGENTS.md`) — no parallel or compatibility copy — and pin it with a regression test.
- Verify: the policy commands plus `npm run check:fast`; `npm run test:odoo` when an
  addon changed, `npm -w apps/web run lint` when `apps/web` changed.
- Owner words: merge ([integration-rules.md](integration-rules.md)).

## Feature — «ميزة:»

- Read: [AGENTS.md](../../AGENTS.md) (architecture R1–R10, product contracts); both layer
  rules ([odoo-rules.md](odoo-rules.md), [web-rules.md](web-rules.md));
  [DESIGN.md](../../DESIGN.md) when the feature touches the UI; [testing.md](../testing.md).
- Flow: state scope and file ownership before editing. A user-visible behavior choice
  with materially different valid outcomes goes to the owner as options with a
  recommended default (`AGENTS.md`, "User-facing decisions").
- Verify: the policy commands plus `npm run check:fast` and the changed layer's checks
  (`npm run test:odoo`, `npm -w apps/web run lint`).
- Owner words: as for Fix.

## UI — «واجهة:»

- Read: [DESIGN.md](../../DESIGN.md) first (it owns presentation), then
  [web-rules.md](web-rules.md) and the product-contract part of `AGENTS.md`;
  [testing.md](../testing.md).
- Flow: components come from the Storybook catalog (`npm -w apps/web run storybook`);
  no local copy of a shared component; Arabic first with `$t()`/`t()` in the owning
  locale namespace.
- Verify: the policy commands plus `npm -w apps/web run lint` and `npm run check:fast`.
- Owner words: as for Fix.

## Maintenance — «صيانة:»

- Read: [AGENTS.md](../../AGENTS.md) (accumulation and shrink-only baselines);
  [testing.md](../testing.md) for what each command proves;
  [integration-rules.md](integration-rules.md) when the change touches CI gates or
  delivery.
- Flow: never widen a baseline or suppression list to make a check pass; instruction
  files keep their dead-reference check (`python3 -B tools/docs_policy.py`).
- Verify: the policy commands plus `npm run check:fast`.
- Owner words: as for Fix; weakening `tools/arch_layers.json` additionally needs the
  owner's `Architecture-approved-by:` trailer on the commit (never added by an agent).

## Verification commands

Run from the lane root; depth and evidence scope are owned by
[testing.md](../testing.md) ("Fast local loop"). Never run tests against `liwan_dev`
or `odoo19` — scratch databases only ([odoo-rules.md](odoo-rules.md)).

```sh
python3 -B tools/docs_policy.py
python3 -B tools/arch_policy.py --base origin/main
python3 -B tools/git_policy.py --base origin/main
npm run check:fast                     # selects checks by changed layer
npm run test:odoo                      # Odoo addon changes, on a scratch database
npm -w apps/web run lint               # web type check; never npx vue-tsc
```

Review before any push follows [REVIEW.md](../../REVIEW.md).
