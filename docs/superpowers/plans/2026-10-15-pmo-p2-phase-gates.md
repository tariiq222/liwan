# PMO phase 2 — Lifecycle phases, gates and charter bell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every project shows where it stands in the PMBOK lifecycle (`initiating → planning → executing → closing → closed`), moves forward only through a gate whose checks pass, and the sponsor/manager get bell notifications for the charter approval flow.

**Architecture:** Two independent streams. Stream A (phases): a new `nasq_pmo/models/project_phase.py` (`_inherit project.project`) with the phase field, a gate-check registry and transitions; one route; a header stepper and a gate card on the project summary. Stream B (charter bell): three new notification kinds registered in the existing nasq_notify registry, delivered from the charter transitions through `super()` overrides in a new `models/charter_notifications.py`, rendered by the existing bell via the pmo app manifest.

**Tech Stack:** Odoo 19 (`nasq_pmo`, `nasq_notify` registry), zod (`packages/contracts`), Nuxt 4 + Nuxt UI + TanStack Query, Storybook, Vitest, Playwright mock stack.

**Spec:** [`2026-10-15-pmo-pmi-gaps-master.md`](2026-10-15-pmo-pmi-gaps-master.md) — decisions D4 (phases and gate registry), D7 (no new `sudo()`), D8 (inline UI, no dialogs); phase 1 plan [`2026-10-15-pmo-p1-charter-approval.md`](2026-10-15-pmo-p1-charter-approval.md) for the charter transitions this plan hooks into.

## Global Constraints

- `nasq_pmo` version `19.0.1.6.0` → `19.0.1.7.0` (Task A1 owns the bump and `migrations/19.0.1.7.0/README.md`; Task B1 adds a stored column in the same release and does not bump again).
- Clean pre-release codebase (AGENTS.md 2026-10-15): replace, don't layer; no unused fields, keys or files; one owner per file.
- Routes: `type='json2'`, `auth='user'`, explicit `methods`, `@api_handler`, `@requires_feature('pmo.enabled', operation=...)`.
- R7: no new `.sudo()`/`SUPERUSER_ID` call. Phase writes reuse `_nasq_write_sudo(vals, allowed=PHASE_FIELDS)` after `_nasq_check_manage()` (documented manager-write case). The bell candidate lookup reuses ONE shared recipient-owned `mail.notification` search (refactor the existing one in `notification_types.py`), so that file's sudo count does not grow.
- Errors: 403 forbidden, 404 not_found, 409 `stale_write` / `phase_gate` / `phase_step`, 422 invalid with field.
- Arabic default; every new string in `apps/web/i18n/locales/{ar,en}`. Server messages are never shown raw: the web maps check keys and error codes to `t()` keys.
- No dialogs; phase move and step back are inline with inline confirmation. New components get Storybook stories.
- Tests: Odoo `npm run test:odoo -- --addons nasq_pmo` (12 pre-existing errors on main: TestPmoAccessCapabilityModels x5, TestTaskBus x2, TestTransition x5 — no others allowed); web `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm test`, `cd apps/web && npm run lint`.
- Commits `type(pmo|web): …` ≤72 chars + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Legacy projects** load as `initiating` (column default); a project whose charter is already approved can move to planning at once — Task A1 `test_existing_project_starts_initiating`.
2. **Charter reopened after the project moved on:** the phase stays; the charter page shows the reopened state — Task A1 `test_reopened_charter_does_not_move_phase_back`.
3. **Two managers race a phase move** → second gets 409 `stale_write` — Task A1 `test_phase_move_with_stale_token`.
4. **Charter withdrawn/decided**: the sponsor's "review" bell row disappears from the bell (no stale "please approve") — Task B1 `test_review_bell_hidden_after_decision`.
5. **Sponsor without project read access** never sees a bell row for that project — Task B1 `test_bell_respects_project_visibility`.

---

## Stream A — lifecycle phases and gates

### Task A1: Phase field, gate registry, transition route (backend + contract)

**Files:**
- Create: `odoo-addons/nasq_pmo/models/project_phase.py`; Modify: `models/__init__.py`
- Create: `odoo-addons/nasq_pmo/controllers/project_phase.py`; Modify: `controllers/__init__.py`
- Modify: `odoo-addons/nasq_pmo/serializers/project.py` (`dump_project`, `dump_project_detail`)
- Modify: `odoo-addons/nasq_pmo/__manifest__.py` (`19.0.1.7.0`); Create: `migrations/19.0.1.7.0/README.md`
- Create: `odoo-addons/nasq_pmo/tests/test_project_phase.py`; Modify: `tests/__init__.py`, key-set assertions in `tests/test_projects.py` / `test_project_charter.py` (`DETAIL_KEYS`, list item keys)
- Modify: `packages/contracts/src/pmo/project.ts` (+ `__tests__`), `apps/web/e2e/internal-ui-audit-mock.mjs` and `apps/web/stories/fixtures/pmo.ts` only as far as the strict schemas need the new keys

**Interfaces — Produces:**
- `PHASES = ('initiating', 'planning', 'executing', 'closing', 'closed')`, `PHASE_FIELDS = {'nasq_phase'}`
- `class NasqPhaseGate(UserError)` (unmet checks), `class NasqPhaseStep(UserError)` (not an adjacent phase)
- `project._nasq_gate_checks(target: str) -> list[dict]` — each `{'key': str, 'ok': bool}`; base: `planning → [{'key': 'charter_approved', 'ok': state == 'approved'}]`, every other target `[]`. Later phases extend it with `super()`.
- `project._nasq_move_phase(target: str) -> self` — manager only; `target` must be the next or the previous phase; forward requires every check ok; backward always allowed.
- `POST /api/v1/projects/{id}/phase` body `{phase, expected_updated_at}` → `ProjectDetail`; errors 409 `phase_gate` (body adds `checks`), 409 `phase_step`, 409 `stale_write`, 422 invalid field `phase`, 403.
- Detail JSON `phase`: `{ current, next, previous, next_checks: [{key, ok}] }` (`next`/`previous` null at the ends; `next_checks` for `next`). List items add `phase: <current>`.
- zod: `ProjectPhaseSchema = z.enum([...PHASES])`, `ProjectPhaseGateCheckSchema`, `ProjectPhaseStateSchema`; `ProjectSchema.phase` (string enum) and `ProjectDetailSchema.phase` (object) — use distinct names if the detail extends the list schema (e.g. list `phase`, detail `phase_state`); pick one and keep serializer and zod identical.

- [ ] **Step 1: failing tests** — `tests/test_project_phase.py` (model + HTTP), covering: default `initiating`; forward to planning blocked with `charter_approved` unmet (409 `phase_gate` with `checks`); allowed after charter approved (use the phase-1 transitions with the policy off); skipping a phase → 409 `phase_step`; backward one step allowed; employee (non-manager) → 403; stale token → 409; `closed` has no `next`; Review Focus 1–3 tests by name; PATCH `/projects/{id}` with `nasq_phase`/`phase` is rejected (not writable).
- [ ] **Step 2: run, expect failure** — `npm run test:odoo -- --addons nasq_pmo`.
- [ ] **Step 3: model** — `project_phase.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import UserError

PHASES = ('initiating', 'planning', 'executing', 'closing', 'closed')
PHASE_FIELDS = {'nasq_phase'}


class NasqPhaseGate(UserError):
    """The gate into the requested phase has unmet checks."""

    def __init__(self, message, checks):
        super().__init__(message)
        self.nasq_checks = checks


class NasqPhaseStep(UserError):
    """The requested phase is not adjacent to the current one."""


class ProjectPhase(models.Model):
    _inherit = 'project.project'

    # PMBOK process groups as a lifecycle; monitoring is continuous, not a phase.
    nasq_phase = fields.Selection(
        [(phase, phase.title()) for phase in PHASES],
        default='initiating', required=True, copy=False, index=True,
    )

    def _nasq_phase_neighbours(self):
        self.ensure_one()
        index = PHASES.index(self.nasq_phase)
        previous = PHASES[index - 1] if index > 0 else None
        following = PHASES[index + 1] if index + 1 < len(PHASES) else None
        return previous, following

    def _nasq_gate_checks(self, target):
        """Checks a project must pass to enter ``target``; extended per phase with super()."""
        self.ensure_one()
        if target == 'planning':
            return [{'key': 'charter_approved', 'ok': self.nasq_charter_state == 'approved'}]
        return []

    def _nasq_move_phase(self, target):
        self.ensure_one()
        self._nasq_check_manage()
        previous, following = self._nasq_phase_neighbours()
        if target not in (previous, following):
            raise NasqPhaseStep(self.env._("A project moves one phase at a time."))
        if target == following:
            checks = self._nasq_gate_checks(target)
            if not all(check['ok'] for check in checks):
                raise NasqPhaseGate(self.env._("The gate into this phase has unmet checks."), checks)
        self._nasq_write_sudo({'nasq_phase': target}, allowed=PHASE_FIELDS)
        self._nasq_bump_revision()
        return self
```

  Add `from . import project_phase` to `models/__init__.py` after `project_project`.
- [ ] **Step 4: route** — `controllers/project_phase.py`: one `POST /api/v1/projects/<int:project_id>/phase` handler; unknown body keys → 422 `unknown_field`; `phase` must be in `PHASES` (422 field `phase`); `parse_write_token`; `project._nasq_lock_for_write(token)` (manager); map `NasqStaleWrite`→409 `stale_write`, `NasqPhaseGate`→409 `phase_gate` with `checks` in the error body (check how `ApiError` carries extra keys; add an `extra`/`details` only if `ApiError` supports it, else return `make_json_response({...}, status=409)` in the shape `api_handler` uses), `NasqPhaseStep`→409 `phase_step`. Returns `dump_project_detail`.
- [ ] **Step 5: serializer + contract** per Interfaces; migration README one line: "19.0.1.7.0 adds project.project.nasq_phase (default initiating) and mail.message.nasq_project_id; no data to move."
- [ ] **Step 6: run and pass**; `python3 -B tools/arch_policy.py --base main`; `npm test`.
- [ ] **Step 7: commit** `feat(pmo): add project lifecycle phases with gate checks`.

### Task A2: Phase stepper and gate card (web)

**Files:**
- Create: `apps/web/app/components/pmo/projects/ProjectPhaseStepper.vue` (+ `__tests__`, story `apps/web/stories/project/ProjectPhaseStepper.stories.ts`)
- Create: `apps/web/app/components/pmo/projects/ProjectPhaseGate.vue` (+ `__tests__`, story)
- Modify: `apps/web/app/composables/useProjects.ts` (`useMoveProjectPhase()`), `apps/web/app/pages/projects/[id].vue` (stepper in the header band, under the meta line), `apps/web/app/pages/projects/[id]/index.vue` (gate card on the summary), `apps/web/i18n/locales/{ar,en}/projects.json` (`projects.phase.*`)
- Modify: `apps/web/e2e/internal-ui-audit-mock.mjs` (phase on mock projects + `POST …/phase` mirroring the server rules), Create: `apps/web/e2e/project-phase.spec.ts`

**Interfaces — Consumes:** Task A1 HTTP + zod. **Produces:** `useMoveProjectPhase()` mutation `({ id, phase, expected }) => ProjectDetail`.

- [ ] Stepper: five steps, current highlighted, done steps checked, RTL order right-to-left, compact on phone (current label only + "n/5"). Display only.
- [ ] Gate card (summary page): title `projects.phase.gateTitle` («الانتقال إلى مرحلة {phase}»); lists `next_checks` with ✓/✗ and a fix link per key (`charter_approved` → `/projects/{id}/charter`, label «اعتماد الميثاق»); primary button `projects.phase.moveTo` enabled only when all checks ok and `can_manage`; secondary «رجوع إلى {previous}» with inline confirm (`SharedInlineConfirm`); hidden actions for non-managers; `closed` shows «المشروع مغلق».
- [ ] Errors: 409 `phase_gate` → refetch and show the unmet checks; `stale_write` → toast `projects.phase.stale` + refetch; others → mapped `t()` keys, never raw server text.
- [ ] Arabic labels: initiating «البدء», planning «التخطيط», executing «التنفيذ», closing «الإغلاق», closed «مغلق».
- [ ] Tests: unit for the derivation helpers (step states, button enabled rule) and SSR render of both components; e2e: move a mock project from البدء to التخطيط after its charter is approved, and see the blocked state with the fix link when not.
- [ ] Checks: `npm test`, `npm run lint`, Playwright on the mock stack (`isolated-ui-mock-stack` recipe; baseline failures in `project-charter.spec.ts` lines 145,161,187,227,255,315 are known).
- [ ] Commit `feat(web): show the project phase and its gate`.

---

## Stream B — charter approval bell

### Task B1: Charter notification kinds (backend + contract)

**Files:**
- Modify: `odoo-addons/nasq_pmo/models/mail_notification_nasq.py` (selection_add `charter_review`, `charter_approved`, `charter_returned`; field `nasq_project_id = fields.Many2one('project.project', index=True, copy=False, ondelete='cascade')`)
- Modify: `odoo-addons/nasq_pmo/models/notification_types.py` (register kinds with `model='project.project'`, `feature_key='pmo.enabled'`; visible domain branch; dump) — refactor `recipient_candidate_task_ids` into one shared recipient-owned lookup used by both task and project kinds (no new sudo call)
- Create: `odoo-addons/nasq_pmo/models/charter_notifications.py` (`_inherit project.project`, overrides `_nasq_charter_submit/_approve/_return` via `super()` and delivers)
- Modify: `odoo-addons/nasq_pmo/serializers/notification.py` (project kinds dump)
- Create: `odoo-addons/nasq_pmo/tests/test_charter_notifications.py`; Modify: `tests/__init__.py`
- Modify: `packages/contracts/src/pmo/notification.ts` (+ `__tests__`)

**Interfaces — Produces:**
- Kinds: `charter_review` (to the sponsor when the state becomes `submitted`), `charter_approved` and `charter_returned` (to the submitter, when the sponsor decides; nothing when the manager self-approves).
- Delivery via `env['nasq.notify.service']._nasq_deliver('project.project', project.id, kind, partner, body, key=..., values={'nasq_project_id': project.id}, replace=True)`; keys `charter_review:{project_id}:{partner_id}`, `charter_decision:{project_id}:{partner_id}`.
- Visible rows: `charter_review` only while that project's charter is `submitted` and the caller is its sponsor; the two decision kinds for any caller-readable active current-company project (`pmo.projects.read` + ordinary search in the caller's env).
- Dump: `{id, kind, project_id, project_name, body, created_at, is_read}`; zod `ProjectCharterNotificationSchema` added to the `NotificationSchema` union and `NotificationKindSchema`; export `ProjectNotificationKindSchema`.

- [ ] Tests first: delivery on submit (sponsor), none when self-approved, approve/return notify the submitter, withdraw removes nothing but hides the review row, Review Focus 4–5, `GET /api/v1/notifications` returns the serialized shape, mark-read works for the new kinds, R7 count unchanged (`python3 -B tools/arch_policy.py --base main`).
- [ ] Commit `feat(pmo): notify the sponsor and manager about charter approval`.

### Task B2: Bell rendering of the charter kinds (web)

**Files:**
- Modify: `apps/web/app/modules/pmo/manifest.ts` (bell kinds → `href: /projects/{project_id}/charter`, `title: project_name`)
- Modify: `apps/web/app/utils/notificationPresentation.ts` (caption key for project kinds → `notifications.preview.<kind>`)
- Modify: `apps/web/i18n/locales/{ar,en}/notifications.json` (ar: charter_review «ميثاق بانتظار اعتمادك», charter_approved «اعتُمد الميثاق», charter_returned «أُعيد الميثاق للتعديل»)
- Modify: mock bell rows in `apps/web/e2e/internal-ui-audit-mock.mjs` if the bell e2e lists kinds; tests next to the existing manifest/presentation tests

- [ ] Tests: caption keys, href/title from a row, manifest test lists the kinds; `npm test`, `npm run lint`.
- [ ] Commit `feat(web): show charter approval notifications in the bell`.

---

## Self-review notes

- Spec coverage: D4 (A1 registry, A2 UI), D7 (A1 manager-write path, B1 shared lookup), D8 (inline gate, no dialog). Later phases extend `_nasq_gate_checks` (phase 4 baseline → executing, phase 6 closure → closed).
- File ownership: Stream A never edits `notification_types.py`, `mail_notification_nasq.py`, `notification.ts`, `manifest.ts`; Stream B never edits `project_phase.py`, `project.ts`, the stepper/gate. Shared only: `tests/__init__.py`, `models/__init__.py` (one-line imports) and the e2e mock — merged by the controller.
