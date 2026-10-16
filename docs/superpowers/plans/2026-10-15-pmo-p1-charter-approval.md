# PMO phase 1 — Charter approval by the sponsor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project charter moves `draft → submitted → approved` through explicit actions, and, when the company requires it, only the project sponsor authorizes it (PMBOK "Develop Project Charter": the sponsor authorizes the project).

**Architecture:** New charter approval fields on `project.project` (extended in `webvue_pmo`), four transition routes under `/api/v1/projects/{id}/charter/*`, a PMO policy `require_charter_approval` (default off, so today's behaviour is unchanged), and an inline approval panel on the existing charter page. The state is no longer writable through `PATCH /projects/{id}`.

**Tech Stack:** Odoo 19 (`webvue_pmo`), zod contracts (`packages/contracts`), Nuxt 4 + Nuxt UI + TanStack Query (`apps/web`), Storybook, Vitest, Playwright mock stack.

**Spec:** [`2026-10-15-pmo-pmi-gaps-master.md`](2026-10-15-pmo-pmi-gaps-master.md), decisions D1, D2, D3, D7, D8.

## Global Constraints

- Branch `codex/pmo-charter-approval`, worktree from `npm run wt -- new pmo-charter-approval`; never test on `odoo19`.
- `webvue_pmo` version `19.0.1.5.0` → `19.0.1.6.0`, migration directory `migrations/19.0.1.6.0/` in the same commit as the schema change.
- Routes: `type='json2'`, `auth='user'`, explicit `methods`, `@api_handler`, `@requires_feature('pmo.enabled', operation='write')` (R10).
- No new `.sudo()` call anywhere (R7 baseline for `project_project.py` is 19 and only shrinks); the sponsor write reuses `_webvue_write_sudo`.
- Error statuses: `403 forbidden`, `404 not_found`, `409 stale_write` / `409 charter_state`, `422 invalid`.
- Arabic is the default locale; every user string through `t()` in `apps/web/i18n/locales/{ar,en}/projects.json` or `settings.json`.
- No dialogs: approve/return/withdraw are inline, return asks for its note inline (DESIGN.md).
- A new shared-looking component needs a Storybook story under `apps/web/stories/project/`.
- Commit subjects `type(pmo|web): …` ≤ 72 chars, ending with the `Co-Authored-By` trailer.

## Review Focus

1. **Saving an approved charter with unchanged values** (the wizard re-sends the whole charter) must keep it `approved` — owned by Task 2 (`test_unchanged_save_keeps_approval`).
2. **A sponsor who cannot read the project** (no `pmo.projects.read`, or `followers` visibility) must not get a charter they can never open: submit fails with `422 invalid` field `sponsor_id`, or subscribes the sponsor — Task 2 (`test_submit_requires_readable_sponsor`, `test_submit_subscribes_sponsor_on_private_project`).
3. **A manager editing while the sponsor approves** must get `409 stale_write`, not a silent overwrite — Task 3 (`test_approve_with_stale_token`).
4. **The sponsor changed while submitted**: the old sponsor can no longer approve, the new one can — Task 2 (`test_new_sponsor_reviews_after_change`).
5. **Policy turned off while a charter is submitted**: the sponsor can still approve or return it; the manager can withdraw — Task 2 (`test_submitted_survives_policy_off`).

---

### Task 1: PMO policy `require_charter_approval`

**Files:**
- Modify: `odoo-addons/webvue_pmo/models/webvue_settings.py` (constants block, `PSC_DEFAULTS`, `_company_psc_values`, `_validate_psc_payload`)
- Modify: `packages/contracts/src/pmo/settings.ts`
- Test: `odoo-addons/webvue_pmo/tests/test_settings.py`, `packages/contracts/src/pmo/__tests__/project-settings-controls.test.ts`

**Interfaces:**
- Produces: `env['webvue.pmo.settings'].get()['require_charter_approval'] -> bool`; `ProjectSettings.require_charter_approval: boolean`.

- [ ] **Step 1: Write the failing Odoo test** (append to the class that holds the GET/PATCH settings tests in `test_settings.py`)

```python
    def test_require_charter_approval_policy(self):
        self.authenticate('api_admin', 'api_admin_pass_123')
        body = self.api('GET', '/api/v1/settings/projects').json()
        self.assertIs(body['require_charter_approval'], False)
        res = self.api('PATCH', '/api/v1/settings/projects', {'require_charter_approval': True})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertIs(res.json()['require_charter_approval'], True)
        bad = self.api('PATCH', '/api/v1/settings/projects', {'require_charter_approval': 'yes'})
        self.assertEqual((bad.status_code, bad.json()['field']), (422, 'require_charter_approval'))
```

Use the admin login the other tests in that file already use (check the first `authenticate(` call in the file and copy it). Also add `'require_charter_approval'` to the key set asserted at `test_settings.py:52`.

- [ ] **Step 2: Run it, expect failure**

Run: `npm run test:odoo -- --addons webvue_pmo`
Expected: FAIL, `KeyError: 'require_charter_approval'`.

- [ ] **Step 3: Implement** in `webvue_settings.py`

```python
PARAM_REQUIRE_CHARTER_APPROVAL = 'webvue_pmo.require_charter_approval'
```

Add `'require_charter_approval': False,` to `PSC_DEFAULTS`, add to `_company_psc_values`:

```python
            'require_charter_approval': self._get_bool(PARAM_REQUIRE_CHARTER_APPROVAL, False),
```

and to `_validate_psc_payload`, before `return writes`:

```python
        if 'require_charter_approval' in vals:
            if not isinstance(vals['require_charter_approval'], bool):
                field, msg = 'require_charter_approval', "require_charter_approval must be a boolean"
                raise _invalid(field, msg)
            writes.append((
                self._company_key(PARAM_REQUIRE_CHARTER_APPROVAL),
                'true' if vals['require_charter_approval'] else 'false',
            ))
```

- [ ] **Step 4: Contract** — in `settings.ts` add `require_charter_approval: z.boolean(),` to `ProjectSettingsSchema` after `overdue_digest_enabled`. In `project-settings-controls.test.ts` add the key to every full `ProjectSettings` fixture, and add:

```ts
it('requires the charter approval policy flag', () => {
  const { require_charter_approval: _, ...rest } = validSettings
  expect(ProjectSettingsSchema.safeParse(rest).success).toBe(false)
})
```

(`validSettings` = the full settings fixture already defined in that file; if it has another name, use it.) Update the mock settings payload in `apps/web/e2e/internal-ui-audit-mock.mjs` (search `overdue_digest_enabled`) and `apps/web/stories/fixtures/pmo.ts` if it holds one.

- [ ] **Step 5: Run and pass**

Run: `npm run test:odoo -- --addons webvue_pmo` and `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add odoo-addons/webvue_pmo/models/webvue_settings.py odoo-addons/webvue_pmo/tests/test_settings.py packages/contracts/src/pmo apps/web/e2e/internal-ui-audit-mock.mjs apps/web/stories/fixtures
git commit -m "feat(pmo): add the require_charter_approval project policy"
```

---

### Task 2: Charter approval model, transitions and migration

**Files:**
- Modify: `odoo-addons/webvue_pmo/models/project_project.py` (constants :28-50, fields :139-145, `write()` :324-377, `_webvue_write_sudo` :421-441, `_webvue_lock_for_write` :709-728, new section after `# --- updates`)
- Modify: `odoo-addons/webvue_pmo/__manifest__.py` (`version`)
- Create: `odoo-addons/webvue_pmo/migrations/19.0.1.6.0/pre-charter_final_to_approved.py`
- Create: `odoo-addons/webvue_pmo/tests/test_charter_approval.py`; Modify: `odoo-addons/webvue_pmo/tests/__init__.py`

**Interfaces:**
- Consumes: `settings.get()['require_charter_approval']` (Task 1).
- Produces:
  - `CHARTER_STATES = ('draft', 'submitted', 'approved')`
  - `class WebVueCharterState(UserError)` — wrong state or locked content.
  - `project._webvue_charter_submit() / _webvue_charter_approve() / _webvue_charter_return(note: str) / _webvue_charter_withdraw()` → `self`
  - `project._webvue_can_review_charter() -> bool`
  - `project._webvue_lock_for_write(expected: str, *, require_manage: bool = True)`
  - fields `webvue_charter_submitted_by_id`, `webvue_charter_submitted_at`, `webvue_charter_approved_by_id`, `webvue_charter_approved_at`, `webvue_charter_return_note`.

- [ ] **Step 1: Write the failing tests** — `tests/test_charter_approval.py`

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_pmo.models.project_project import WebVueCharterState

from .common import WebVuePmoCase


@tagged('post_install', '-at_install', 'webvue')
class TestCharterApproval(WebVuePmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sponsor = new_test_user(
            cls.env, login='api_sponsor', password='api_sponsor_pass_123', name='Sara',
            groups='webvue_core.group_employee',
        )
        cls.project.write({'user_id': cls.manager.id, 'webvue_sponsor_id': cls.sponsor.id})

    def _policy(self, required):
        key = f'webvue_pmo.require_charter_approval.{self.env.company.id}'
        self.env['ir.config_parameter'].sudo().set_param(key, 'true' if required else 'false')

    def _as(self, user):
        return self.project.with_user(user)

    def test_submit_without_policy_approves_directly(self):
        self._policy(False)
        self._as(self.manager)._webvue_charter_submit()
        self.assertEqual(self.project.webvue_charter_state, 'approved')
        self.assertEqual(self.project.webvue_charter_approved_by_id, self.manager)

    def test_submit_with_policy_waits_for_sponsor(self):
        self._policy(True)
        self._as(self.manager)._webvue_charter_submit()
        self.assertEqual(self.project.webvue_charter_state, 'submitted')
        self.assertEqual(self.project.webvue_charter_submitted_by_id, self.manager)
        self.assertTrue(self._as(self.sponsor)._webvue_can_review_charter())
        self.assertFalse(self._as(self.manager)._webvue_can_review_charter())
        with self.assertRaises(AccessError):
            self._as(self.manager)._webvue_charter_approve()
        self._as(self.sponsor)._webvue_charter_approve()
        self.assertEqual(self.project.webvue_charter_state, 'approved')
        self.assertEqual(self.project.webvue_charter_approved_by_id, self.sponsor)

    def test_manager_who_is_sponsor_approves_directly(self):
        self._policy(True)
        self.project.webvue_sponsor_id = self.manager
        self._as(self.manager)._webvue_charter_submit()
        self.assertEqual(self.project.webvue_charter_state, 'approved')

    def test_submit_requires_sponsor_under_policy(self):
        self._policy(True)
        self.project.webvue_sponsor_id = False
        with self.assertRaises(ValidationError):
            self._as(self.manager)._webvue_charter_submit()
        self.assertEqual(self.project.webvue_charter_state, 'draft')

    def test_submit_requires_readable_sponsor(self):
        self._policy(True)
        outsider = new_test_user(self.env, login='api_portal_like', name='No PMO', groups='base.group_user')
        self.project.webvue_sponsor_id = outsider
        with self.assertRaises(ValidationError):
            self._as(self.manager)._webvue_charter_submit()

    def test_submit_subscribes_sponsor_on_private_project(self):
        self._policy(True)
        self.project.privacy_visibility = 'followers'
        self._as(self.manager)._webvue_charter_submit()
        self.assertIn(self.sponsor, self.project._webvue_followers())

    def test_return_needs_note_and_goes_back_to_draft(self):
        self._policy(True)
        self._as(self.manager)._webvue_charter_submit()
        with self.assertRaises(ValidationError):
            self._as(self.sponsor)._webvue_charter_return('   ')
        self._as(self.sponsor)._webvue_charter_return('Scope is unclear')
        self.assertEqual(self.project.webvue_charter_state, 'draft')
        self.assertEqual(self.project.webvue_charter_return_note, 'Scope is unclear')
        self._as(self.manager)._webvue_charter_submit()
        self.assertEqual(self.project.webvue_charter_return_note, '')

    def test_withdraw_by_manager_only(self):
        self._policy(True)
        self._as(self.manager)._webvue_charter_submit()
        with self.assertRaises(AccessError):
            self._as(self.sponsor)._webvue_charter_withdraw()
        self._as(self.manager)._webvue_charter_withdraw()
        self.assertEqual(self.project.webvue_charter_state, 'draft')
        self.assertFalse(self.project.webvue_charter_submitted_by_id)

    def test_wrong_state_transitions_raise(self):
        self._policy(True)
        with self.assertRaises(WebVueCharterState):
            self._as(self.sponsor)._webvue_charter_approve()
        with self.assertRaises(WebVueCharterState):
            self._as(self.manager)._webvue_charter_withdraw()
        self._policy(False)
        self._as(self.manager)._webvue_charter_submit()
        with self.assertRaises(WebVueCharterState):
            self._as(self.manager)._webvue_charter_submit()

    def test_submitted_charter_is_locked(self):
        self._policy(True)
        self._as(self.manager)._webvue_charter_submit()
        with self.assertRaises(WebVueCharterState):
            self._as(self.manager)._webvue_write_as_manager({'webvue_scope': 'Changed'})
        # Non-charter fields stay editable while waiting.
        self._as(self.manager)._webvue_write_as_manager({'tag_ids': [(6, 0, [])]})

    def test_change_reopens_approved_charter_under_policy(self):
        self._policy(True)
        self.project.webvue_sponsor_id = self.manager
        self._as(self.manager)._webvue_charter_submit()
        self._as(self.manager)._webvue_write_as_manager({'webvue_scope': 'Bigger scope'})
        self.assertEqual(self.project.webvue_charter_state, 'draft')
        self.assertFalse(self.project.webvue_charter_approved_by_id)

    def test_change_keeps_approval_without_policy(self):
        self._policy(False)
        self._as(self.manager)._webvue_charter_submit()
        self._as(self.manager)._webvue_write_as_manager({'webvue_scope': 'Bigger scope'})
        self.assertEqual(self.project.webvue_charter_state, 'approved')

    def test_unchanged_save_keeps_approval(self):
        self._policy(True)
        self.project.write({'webvue_sponsor_id': self.manager.id, 'webvue_scope': 'Same', 'webvue_objectives': [{'goal': 'G', 'metric': '', 'target': ''}]})
        self._as(self.manager)._webvue_charter_submit()
        self._as(self.manager)._webvue_write_as_manager({
            'webvue_scope': 'Same',
            'webvue_objectives': [{'goal': 'G', 'metric': '', 'target': ''}],
            'webvue_sponsor_id': self.manager.id,
            'name': self.project.name,
        })
        self.assertEqual(self.project.webvue_charter_state, 'approved')

    def test_new_sponsor_reviews_after_change(self):
        self._policy(True)
        self._as(self.manager)._webvue_charter_submit()
        other = new_test_user(self.env, login='api_sponsor2', name='Huda', groups='webvue_core.group_employee')
        # Changing the sponsor is not charter content locked by submission.
        self._as(self.manager)._webvue_write_as_manager({'webvue_sponsor_id': other.id})
        self.assertFalse(self._as(self.sponsor)._webvue_can_review_charter())
        self._as(other)._webvue_charter_approve()
        self.assertEqual(self.project.webvue_charter_state, 'approved')

    def test_submitted_survives_policy_off(self):
        self._policy(True)
        self._as(self.manager)._webvue_charter_submit()
        self._policy(False)
        self._as(self.sponsor)._webvue_charter_approve()
        self.assertEqual(self.project.webvue_charter_state, 'approved')

    def test_state_is_not_manager_writable(self):
        with self.assertRaises(AccessError):
            self.project.with_user(self.manager).write({'webvue_charter_state': 'approved'})

    def test_copy_starts_as_draft(self):
        self._policy(False)
        self._as(self.manager)._webvue_charter_submit()
        copy = self.project.copy()
        self.assertEqual(copy.webvue_charter_state, 'draft')
        self.assertFalse(copy.webvue_charter_approved_by_id)
```

Register it in `tests/__init__.py`: `from . import test_charter_approval`.

- [ ] **Step 2: Run, expect failure**

Run: `npm run test:odoo -- --addons webvue_pmo`
Expected: FAIL at import, `cannot import name 'WebVueCharterState'`.

- [ ] **Step 3: Constants and exception** — in `project_project.py` replace line 28 and the field sets:

```python
CHARTER_STATES = ('draft', 'submitted', 'approved')
CHARTER_RETURN_NOTE_MAX = 2000
```

Remove `'webvue_charter_state'` from `CHARTER_MANAGER_FIELDS`. After `PROTECTED_FIELDS` add:

```python
# Written only by the charter transitions (_webvue_charter_*), never by PATCH.
CHARTER_APPROVAL_FIELDS = {
    'webvue_charter_state', 'webvue_charter_submitted_by_id', 'webvue_charter_submitted_at',
    'webvue_charter_approved_by_id', 'webvue_charter_approved_at', 'webvue_charter_return_note',
}
# Content a submitted charter locks and an approved one reopens on change.
# The sponsor itself is excluded: replacing an unavailable sponsor must stay possible.
CHARTER_CONTENT_FIELDS = (CHARTER_MANAGER_FIELDS - {'webvue_sponsor_id'}) | {
    'name', 'description', 'user_id', 'date_start', 'date',
}
CHARTER_RESET_VALS = {
    'webvue_charter_state': 'draft',
    'webvue_charter_submitted_by_id': False, 'webvue_charter_submitted_at': False,
    'webvue_charter_approved_by_id': False, 'webvue_charter_approved_at': False,
}
```

Change `REVISION_CONTENT_FIELDS = MANAGER_WRITABLE | {'company_id'} | CHARTER_APPROVAL_FIELDS` (a transition invalidates open editors' write tokens). After `class WebVueStaleWrite` add:

```python
class WebVueCharterState(UserError):
    """The charter is not in a state that allows this action or edit."""
```

- [ ] **Step 4: Fields** — replace the `webvue_charter_state` field (:139-145):

```python
    # draft → submitted (waiting for the sponsor) → approved. Only the
    # _webvue_charter_* transitions write these; see CHARTER_APPROVAL_FIELDS.
    webvue_charter_state = fields.Selection(
        [('draft', 'Draft'), ('submitted', 'Submitted'), ('approved', 'Approved')],
        default='draft',
        required=True,
        copy=False,
    )
    webvue_charter_submitted_by_id = fields.Many2one('res.users', ondelete='set null', copy=False)
    webvue_charter_submitted_at = fields.Datetime(copy=False)
    webvue_charter_approved_by_id = fields.Many2one('res.users', ondelete='set null', copy=False)
    webvue_charter_approved_at = fields.Datetime(copy=False)
    webvue_charter_return_note = fields.Text(default='', copy=False)
```

- [ ] **Step 5: Whitelisted sudo write and revision lock**

Change `_webvue_write_sudo` signature and check (keep its single `self.sudo().write(vals)`):

```python
    def _webvue_write_sudo(self, vals, allowed=MANAGER_WRITABLE):
        ...
        self.ensure_one()
        bad = set(vals) - allowed
```

Add after `_webvue_write_as_manager`:

```python
    def _webvue_write_charter_approval(self, vals):
        """The *do* step of a charter transition: approval fields only.

        Documented PMO elevated case (charter approval): the sponsor is not a
        project manager and Odoo's ACL lets only the manager group write
        project.project. Every caller ran its own check first (manager for
        submit/withdraw, sponsor for approve/return).
        """
        return self._webvue_write_sudo(vals, allowed=CHARTER_APPROVAL_FIELDS)
```

Change `_webvue_lock_for_write(self, expected)` to `_webvue_lock_for_write(self, expected, *, require_manage=True)` and guard the manage call: `if require_manage: self._webvue_check_manage()`.

- [ ] **Step 6: Lock and reopen inside `write()`** — insert right after `self._webvue_prepare_charter_vals(vals, records=self)` (:355):

```python
        reopen = self._webvue_charter_guard(vals)
```

and right before `return result` at the end of `write()`:

```python
        for project in reopen:
            project._webvue_write_charter_approval(dict(CHARTER_RESET_VALS))
```

Add the helpers in a new section after `# --- updates` methods:

```python
    # --- charter approval ----------------------------------------------------
    def _webvue_charter_differs(self, vals, names):
        self.ensure_one()
        for name in names:
            field = self._fields[name]
            new = field.convert_to_record(field.convert_to_cache(vals[name], self), self)
            if new != self[name]:
                return True
        return False

    def _webvue_charter_guard(self, vals):
        """Lock submitted charters; return approved ones a change must reopen."""
        names = set(vals) & CHARTER_CONTENT_FIELDS
        if not names:
            return self.browse()
        changed = self.filtered(lambda project: project._webvue_charter_differs(vals, names))
        if any(project.webvue_charter_state == 'submitted' for project in changed):
            raise WebVueCharterState(self.env._("The charter is waiting for approval; withdraw it to edit."))
        if not self.env['webvue.pmo.settings'].get()['require_charter_approval']:
            return self.browse()
        return changed.filtered(lambda project: project.webvue_charter_state == 'approved')

    def _webvue_charter_approval_required(self):
        return self.env['webvue.pmo.settings'].get()['require_charter_approval']

    def _webvue_can_review_charter(self):
        self.ensure_one()
        return self.webvue_charter_state == 'submitted' and self.webvue_sponsor_id == self.env.user

    def _webvue_check_charter_reviewer(self):
        self._webvue_check_visible_current()
        if self.webvue_sponsor_id != self.env.user:
            raise AccessError(self.env._("Only the project sponsor can review the charter."))

    def _webvue_check_charter_state(self, state):
        if self.webvue_charter_state != state:
            raise WebVueCharterState(self.env._("The charter is not in the expected state."))

    def _webvue_charter_submit(self):
        self.ensure_one()
        self._webvue_check_manage()
        self._webvue_check_charter_state('draft')
        user, now = self.env.user, fields.Datetime.now()
        vals = {
            'webvue_charter_submitted_by_id': user.id,
            'webvue_charter_submitted_at': now,
            'webvue_charter_return_note': '',
        }
        sponsor = self.webvue_sponsor_id
        if not self._webvue_charter_approval_required() or sponsor == user:
            vals.update({
                'webvue_charter_state': 'approved',
                'webvue_charter_approved_by_id': user.id,
                'webvue_charter_approved_at': now,
            })
        else:
            service = self.env['webvue.access.service']
            if not sponsor or not sponsor.active or not service._webvue_has_capability(sponsor, 'pmo.projects.read'):
                raise ValidationError(self.env._("Choose a sponsor who can open projects before submitting the charter."))
            if self.privacy_visibility == 'followers' and sponsor not in self._webvue_followers():
                self._webvue_add_follower(sponsor)
            vals['webvue_charter_state'] = 'submitted'
        self._webvue_write_charter_approval(vals)
        return self

    def _webvue_charter_approve(self):
        self.ensure_one()
        self._webvue_check_charter_reviewer()
        self._webvue_check_charter_state('submitted')
        self._webvue_write_charter_approval({
            'webvue_charter_state': 'approved',
            'webvue_charter_approved_by_id': self.env.uid,
            'webvue_charter_approved_at': fields.Datetime.now(),
        })
        return self

    def _webvue_charter_return(self, note):
        self.ensure_one()
        self._webvue_check_charter_reviewer()
        self._webvue_check_charter_state('submitted')
        note = (note or '').strip() if isinstance(note, str) else ''
        if not note or len(note) > CHARTER_RETURN_NOTE_MAX:
            raise ValidationError(self.env._("A return note of 1 to 2000 characters is required."))
        self._webvue_write_charter_approval({**CHARTER_RESET_VALS, 'webvue_charter_return_note': note})
        return self

    def _webvue_charter_withdraw(self):
        self.ensure_one()
        self._webvue_check_manage()
        self._webvue_check_charter_state('submitted')
        self._webvue_write_charter_approval(dict(CHARTER_RESET_VALS))
        return self
```

Note for the implementer: `_webvue_check_manage` raises `AccessError`, which is what `test_withdraw_by_manager_only` expects for the sponsor.

- [ ] **Step 7: Migration and version** — `__manifest__.py`: `'version': '19.0.1.6.0',`. Create `migrations/19.0.1.6.0/pre-charter_final_to_approved.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Retire the charter state 'final': a finalized charter was the manager's
approval, so it becomes 'approved'. Approver and dates stay empty (unknown).
"""


def migrate(cr, version):
    if not version:
        return
    cr.execute(
        "UPDATE project_project SET webvue_charter_state = 'approved' WHERE webvue_charter_state = 'final'",
    )
```

- [ ] **Step 8: Run and pass**

Run: `npm run test:odoo -- --addons webvue_pmo`
Expected: the new class passes. `test_project_charter.py` tests that send `'state'` now fail; they are fixed in Task 3, so do not commit until Step 9.

- [ ] **Step 9: Make the old charter tests express the new rule** — in `test_project_charter.py`:
  - Remove `'state': 'final',` from the full roundtrip create (:78) and change the assertions at :87 and :102 to `'draft'`.
  - Replace `test_charter_state_draft_then_final` (:105-133) with a test that `PATCH {'charter': {'state': 'approved'}}` and `{'state': 'draft'}` both return `422` with `field == 'state'` (code `unknown_field`), and that create with `'charter': {'state': 'draft'}` returns `422` too.
  - Grep the other pmo tests and bridges for `charter_state` / `'final'` (`rg -n "'final'|charter_state" odoo-addons/*/tests`) and update them the same way.

These pass after Task 3 Step 3 (serializer). Run Task 3 before committing Task 2, or commit both together as below.

- [ ] **Step 10: Commit** (together with Task 3, after its tests pass)

---

### Task 3: Charter approval API and contracts

**Files:**
- Modify: `odoo-addons/webvue_pmo/serializers/project_charter.py`, `odoo-addons/webvue_pmo/serializers/project.py`
- Modify: `odoo-addons/webvue_pmo/controllers/projects.py` (token parsing, PATCH error mapping, list filter)
- Create: `odoo-addons/webvue_pmo/controllers/project_charter.py`; Modify: `odoo-addons/webvue_pmo/controllers/__init__.py`
- Modify: `packages/contracts/src/pmo/project-charter.ts`, `packages/contracts/src/pmo/project.ts`
- Test: `odoo-addons/webvue_pmo/tests/test_charter_approval.py` (new API class), `odoo-addons/webvue_pmo/tests/test_project_charter.py` (`CHARTER_KEYS`), `packages/contracts/src/pmo/__tests__/project-charter.test.ts`

**Interfaces:**
- Consumes: Task 2 model methods and `WebVueCharterState`.
- Produces (HTTP, all return `ProjectDetail` with status 200):
  - `POST /api/v1/projects/{id}/charter/submit` body `{expected_updated_at}`
  - `POST /api/v1/projects/{id}/charter/approve` body `{expected_updated_at}`
  - `POST /api/v1/projects/{id}/charter/return` body `{expected_updated_at, note}`
  - `POST /api/v1/projects/{id}/charter/withdraw` body `{expected_updated_at}`
  - `GET /api/v1/projects?charter_review=1` → projects whose charter waits for the caller.
  - Charter JSON adds `approval_required: bool`, `can_review: bool`, `submitted_by`, `submitted_at`, `approved_by`, `approved_at` (`UserRef|null`, ISO string|null), `return_note: str`; `state` is `'draft'|'submitted'|'approved'`. List items add `charter_state`.
  - zod: `ProjectCharterStateSchema = z.enum(['draft','submitted','approved'])`, `ProjectCharterTransitionSchema`, `ProjectCharterReturnSchema`; `ProjectCharterWriteSchema` has no `state`.

- [ ] **Step 1: Write the failing API tests** — append to `tests/test_charter_approval.py`:

```python
@tagged('post_install', '-at_install', 'webvue')
class TestCharterApprovalApi(WebVuePmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sponsor = new_test_user(
            cls.env, login='api_sponsor', password='api_sponsor_pass_123', name='Sara',
            groups='webvue_core.group_employee',
        )
        cls.project.write({'user_id': cls.manager.id, 'webvue_sponsor_id': cls.sponsor.id})
        key = f'webvue_pmo.require_charter_approval.{cls.env.company.id}'
        cls.env['ir.config_parameter'].sudo().set_param(key, 'true')

    def _post(self, action, body):
        return self.api('POST', f'/api/v1/projects/{self.project.id}/charter/{action}', body)

    def _token(self):
        return self.api('GET', f'/api/v1/projects/{self.project.id}').json()['updated_at']

    def test_full_flow_over_http(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        res = self._post('submit', {'expected_updated_at': self._token()})
        self.assertEqual(res.status_code, 200, res.text)
        charter = res.json()['charter']
        self.assertEqual((charter['state'], charter['approval_required'], charter['can_review']), ('submitted', True, False))
        self.assertEqual(charter['submitted_by']['id'], self.manager.id)
        locked = self.api('PATCH', f'/api/v1/projects/{self.project.id}', {
            'expected_updated_at': res.json()['updated_at'], 'charter': {'scope': 'x'},
        })
        self.assertEqual((locked.status_code, locked.json()['code']), (409, 'charter_state'))

        self.authenticate('api_sponsor', 'api_sponsor_pass_123')
        waiting = self.api('GET', '/api/v1/projects?charter_review=1').json()
        self.assertEqual([item['id'] for item in waiting['items']], [self.project.id])
        self.assertEqual(waiting['items'][0]['charter_state'], 'submitted')
        detail = self.api('GET', f'/api/v1/projects/{self.project.id}').json()
        self.assertTrue(detail['charter']['can_review'])
        res = self._post('approve', {'expected_updated_at': detail['updated_at']})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['charter']['state'], 'approved')
        self.assertEqual(res.json()['charter']['approved_by']['id'], self.sponsor.id)
        self.assertTrue(res.json()['charter']['approved_at'])

    def test_return_requires_note(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self._post('submit', {'expected_updated_at': self._token()})
        self.authenticate('api_sponsor', 'api_sponsor_pass_123')
        token = self._token()
        missing = self._post('return', {'expected_updated_at': token})
        self.assertEqual((missing.status_code, missing.json()['field']), (422, 'note'))
        res = self._post('return', {'expected_updated_at': token, 'note': 'Add the budget'})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((res.json()['charter']['state'], res.json()['charter']['return_note']), ('draft', 'Add the budget'))

    def test_approve_with_stale_token(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        submitted = self._post('submit', {'expected_updated_at': self._token()}).json()
        self.project.with_user(self.manager)._webvue_write_as_manager({'tag_ids': [(6, 0, [])]})
        self.authenticate('api_sponsor', 'api_sponsor_pass_123')
        res = self._post('approve', {'expected_updated_at': submitted['updated_at']})
        self.assertEqual((res.status_code, res.json()['code']), (409, 'stale_write'))

    def test_errors(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        token = self._token()
        self.assertEqual(self._post('approve', {'expected_updated_at': token}).status_code, 403)
        self.assertEqual(self._post('withdraw', {'expected_updated_at': token}).json()['code'], 'charter_state')
        self.assertEqual(self._post('submit', {}).status_code, 422)
        self.assertEqual(self._post('submit', {'expected_updated_at': token, 'x': 1}).status_code, 422)
        self.assertEqual(self.api('POST', '/api/v1/projects/999999/charter/submit', {'expected_updated_at': 'v1'}).status_code, 404)
```

In `test_project_charter.py` extend `CHARTER_KEYS` with `'approval_required', 'can_review', 'submitted_by', 'submitted_at', 'approved_by', 'approved_at', 'return_note'`. If `test_projects.py` asserts the list item key set, add `'charter_state'` there.

- [ ] **Step 2: Run, expect failure**

Run: `npm run test:odoo -- --addons webvue_pmo`
Expected: FAIL with 404 on `/charter/submit`, `KeyError: 'approval_required'`.

- [ ] **Step 3: Serializer** — `serializers/project_charter.py`:
  - import `iso` from `odoo.addons.webvue_api.serializers.common`;
  - remove `'state'` from `CHARTER_WRITE_FIELDS`, add it to `CHARTER_READONLY_FIELDS`, delete the `elif key == 'state':` branch;
  - in `dump_charter` replace the `'state'` line with:

```python
        'state': project.webvue_charter_state or 'draft',
        'approval_required': project._webvue_charter_approval_required(),
        'can_review': project._webvue_can_review_charter(),
        'submitted_by': dump_user_ref(project.webvue_charter_submitted_by_id),
        'submitted_at': iso(project.webvue_charter_submitted_at) if project.webvue_charter_submitted_at else None,
        'approved_by': dump_user_ref(project.webvue_charter_approved_by_id),
        'approved_at': iso(project.webvue_charter_approved_at) if project.webvue_charter_approved_at else None,
        'return_note': project.webvue_charter_return_note or '',
```

  - `CHARTER_STATES` import stays unused only if nothing else needs it; drop it from the import to keep ruff clean.

In `serializers/project.py`, `dump_project` dict: add `'charter_state': project.webvue_charter_state or 'draft',`. Add a shared token parser there:

```python
def parse_write_token(value):
    if not isinstance(value, str) or not value.startswith('v') or not value[1:].isdigit():
        raise ApiError(422, 'invalid', "expected_updated_at is not a valid write token", field='expected_updated_at')
    return value
```

- [ ] **Step 4: Controllers** — in `controllers/projects.py`:
  - add `'charter_review'` to `LIST_QUERY`; after the `mine_param` block:

```python
        review_param = args.get('charter_review')
        if review_param is not None and review_param not in ('1', 'true', '0', 'false'):
            raise ApiError(422, 'invalid', "charter_review must be '1', 'true', '0' or 'false'", field='charter_review')
```

  and after the `mine` domain line: `if review_param in ('1', 'true'): domain += [('webvue_sponsor_id', '=', request.env.uid), ('webvue_charter_state', '=', 'submitted')]`
  - in `patch_project` replace the inline token check with `parse_write_token(expected)`, and wrap the write:

```python
        try:
            project._webvue_write_as_manager(vals)
        except WebVueCharterState as e:
            raise ApiError(409, 'charter_state', str(e)) from e
```

  (import `WebVueCharterState` from the model module and `parse_write_token` from `serializers.project`).

Create `controllers/project_charter.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import ValidationError

from odoo.addons.webvue_api.controllers.common import ApiError, api_handler, get_record, requires_feature
from odoo.addons.webvue_pmo.models.project_project import WebVueCharterState, WebVueStaleWrite
from odoo.addons.webvue_pmo.serializers.project import dump_project_detail, parse_write_token

ACTIONS = {
    # action: (allowed body keys, the caller must manage the project)
    'submit': ({'expected_updated_at'}, True),
    'approve': ({'expected_updated_at'}, False),
    'return': ({'expected_updated_at', 'note'}, False),
    'withdraw': ({'expected_updated_at'}, True),
}


def _run(project_id, action, payload):
    allowed, manage = ACTIONS[action]
    payload.pop('project_id', None)
    unknown = set(payload) - allowed
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
    token = parse_write_token(payload.get('expected_updated_at'))
    project = get_record('project.project', project_id)
    try:
        project._webvue_lock_for_write(token, require_manage=manage)
    except WebVueStaleWrite as e:
        raise ApiError(409, 'stale_write', str(e), field='expected_updated_at') from e
    try:
        if action == 'submit':
            project._webvue_charter_submit()
        elif action == 'approve':
            project._webvue_charter_approve()
        elif action == 'return':
            note = payload.get('note')
            if not isinstance(note, str) or not note.strip():
                raise ApiError(422, 'invalid', "note is required", field='note')
            project._webvue_charter_return(note)
        else:
            project._webvue_charter_withdraw()
    except WebVueCharterState as e:
        raise ApiError(409, 'charter_state', str(e)) from e
    except ValidationError as e:
        field = 'note' if action == 'return' else 'sponsor_id'
        raise ApiError(422, 'invalid', str(e), field=field) from e
    return dump_project_detail(project)


class ProjectCharterController(http.Controller):

    @http.route('/api/v1/projects/<int:project_id>/charter/submit', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def submit_charter(self, project_id, **payload):
        return _run(project_id, 'submit', payload)

    @http.route('/api/v1/projects/<int:project_id>/charter/approve', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def approve_charter(self, project_id, **payload):
        return _run(project_id, 'approve', payload)

    @http.route('/api/v1/projects/<int:project_id>/charter/return', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def return_charter(self, project_id, **payload):
        return _run(project_id, 'return', payload)

    @http.route('/api/v1/projects/<int:project_id>/charter/withdraw', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('pmo.enabled', operation='write')
    def withdraw_charter(self, project_id, **payload):
        return _run(project_id, 'withdraw', payload)
```

Add `from . import project_charter` to `controllers/__init__.py`. `AccessError` from the model is mapped to 403 by `api_handler` (as for `patch_project`); confirm by `test_errors`.

- [ ] **Step 5: Contracts** — `project-charter.ts`:

```ts
export const ProjectCharterStateSchema = z.enum(['draft', 'submitted', 'approved'])
```

add to `ProjectCharterSchema` (after `state`):

```ts
  approval_required: z.boolean(),
  can_review: z.boolean(),
  submitted_by: CharterUserRefSchema.nullable(),
  submitted_at: z.string().nullable(),
  approved_by: CharterUserRefSchema.nullable(),
  approved_at: z.string().nullable(),
  return_note: z.string(),
```

remove `state` from `ProjectCharterWriteSchema`, and add:

```ts
export const CHARTER_RETURN_NOTE_MAX = 2000
export const ProjectCharterTransitionSchema = z.object({ expected_updated_at: z.string() }).strict()
export const ProjectCharterReturnSchema = ProjectCharterTransitionSchema.extend({
  note: z.string().trim().min(1).max(CHARTER_RETURN_NOTE_MAX),
}).strict()
export type ProjectCharterAction = 'submit' | 'approve' | 'return' | 'withdraw'
```

In `project.ts` add `charter_state: ProjectCharterStateSchema` to the list item schema (import it). Export new names from `pmo/index.ts` if it re-exports explicitly. In `__tests__/project-charter.test.ts`: update charter fixtures with the new keys; add cases that `ProjectCharterWriteSchema.safeParse({ state: 'approved' })` fails and `ProjectCharterReturnSchema.safeParse({ expected_updated_at: 'v2', note: ' ' })` fails. Update the mock `CHARTER` object (`apps/web/e2e/internal-ui-audit-mock.mjs:54`, `state: 'approved'` plus the new keys) and `stories/fixtures/pmo.ts`.

- [ ] **Step 6: Run and pass**

Run: `npm run test:odoo -- --addons webvue_pmo,webvue_tasks_pmo,webvue_meetings_pmo,webvue_operations_pmo` then `npm test`
Expected: PASS, nonzero test count.

- [ ] **Step 7: Commit Tasks 2 and 3**

```bash
git add odoo-addons/webvue_pmo packages/contracts/src/pmo apps/web/e2e/internal-ui-audit-mock.mjs apps/web/stories/fixtures
git commit -m "feat(pmo): add sponsor approval of the project charter"
```

---

### Task 4: Document the elevated case and pass the policy gates

**Files:**
- Modify: `AGENTS.md` (Product contracts, the PMO `sudo()` sentence)

- [ ] **Step 1:** In the bullet that starts "`webvue_hr`, `webvue_tasks`, `webvue_operations` and their bridges have no `sudo()` path", change "In PMO, only the documented manager-write, policy/config, …" to "In PMO, only the documented manager-write, charter-approval (sponsor approve/return through the manager-write whitelist), policy/config, …". The owner approves this wording during review (D7).
- [ ] **Step 2:** Run `python3 -B tools/arch_policy.py --base main` and `python3 -B tools/git_policy.py --base main`. Expected: both exit 0 (no R7 growth; the migration's SQL is exempt).
- [ ] **Step 3: Commit** — `git commit -m "docs(pmo): document the charter approval elevated write"`

---

### Task 5: Web — transitions composable and the wizard

**Files:**
- Modify: `apps/web/app/composables/useProjects.ts`
- Modify: `apps/web/app/utils/projectCharter.ts` (:424 and the full write ~:446)
- Modify: `apps/web/app/components/pmo/projects/ProjectCharterForm.vue` (:48-49, :144-149, :277-305, :434)
- Test: `apps/web/app/utils/__tests__/projectCharter.test.ts` (or the existing charter util test file — `rg -l "charterPatchBody" apps/web/app`), `apps/web/app/composables/__tests__/` for the composable if one exists for `useProjects`

**Interfaces:**
- Consumes: Task 3 HTTP routes and zod schemas.
- Produces: `useCharterTransition()` → mutation `({ id, action, expected, note? }) => ProjectDetail`; `ProjectCharterForm` emits `saved: [outcome: 'saved' | 'approved' | 'submitted']`.

- [ ] **Step 1: Failing unit tests** — in the charter util test file:

```ts
it('never writes the charter state', () => {
  const draft = { ...emptyDraft(), charterState: 'approved' as const, name: 'P' }
  expect('state' in charterCreateBody(draft).charter!).toBe(false)
  expect('state' in charterPatchBody(draft, 'v3', originalDates).charter!).toBe(false)
})
```

(reuse the draft/original-dates fixtures that file already builds; names may differ). Run `npm -w apps/web run test -- projectCharter` → FAIL.

- [ ] **Step 2: Implement** — delete line 424 (`if (draft.charterState === 'final') write.state = 'final'`) and the `state: draft.charterState,` line in the full write. In `useProjects.ts` add:

```ts
export function useCharterTransition() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({
    mutationFn: ({ id, action, expected, note }: { id: number; action: ProjectCharterAction; expected: string; note?: string }) =>
      $api(`/api/v1/projects/${id}/charter/${action}`, {
        method: 'POST',
        body: action === 'return' ? { expected_updated_at: expected, note } : { expected_updated_at: expected },
        schema: ProjectDetailSchema,
      }),
    onSuccess: (detail: ProjectDetail, { id }) => {
      qc.setQueryData(projectKeys.detail(id), detail)
      invalidateProjectCaches(qc)
    },
  })
}
```

Extend `ProjectListFilters` with `charterReview?: boolean` and `projectListQuery` with `...(filters.charterReview ? { charter_review: 1 } : {}),`.

- [ ] **Step 3: Wizard** — in `ProjectCharterForm.vue`:
  - `const { mutateAsync: transition, isPending: transitioning } = useCharterTransition()`; add `transitioning.value` to `pending`.
  - Rename `baselineFinal` → `baselineApproved = computed(() => props.mode === 'edit' && baseline.value.charterState === 'approved')`.
  - `finalLabel`: create mode keeps `projects.create.createFinal`; edit mode: `baselineApproved ? t('app.save') : t(submitsForApproval.value ? 'projects.charter.submitForApproval' : 'projects.charter.finalize')`, where `submitsForApproval = computed(() => !!props.project?.charter.approval_required && draft.value.sponsorId !== currentUserId.value)` (`currentUserId` from the session composable the app already uses for "me"; `rg -n "useSession|useAuth" apps/web/app/composables | head`).
  - `submit(token, state)` keeps its signature; after a successful save with `state === 'final'` (rename the literal to `'submit'`) and when `!baselineApproved.value`, call `transition({ id, action: 'submit', expected: detail.updated_at })` (create mode: `created.id`, `created.updated_at`). Emit `saved(result.charter.state === 'submitted' ? 'submitted' : 'approved')`, or `saved('saved')` for a plain save. A `409 charter_state` or `422 sponsor_id` from the transition shows `error.value = e.message` and keeps the saved draft (the content save already succeeded — say so with `t('projects.charter.savedNotSubmitted')`).
  - `charter.vue` `onSaved(outcome)`: toast `projects.charter.saved` / `.finalized` / `.submitted`.
- [ ] **Step 4:** `npm -w apps/web run test` and `cd apps/web && npm run lint` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): submit the project charter for approval from the wizard"`

---

### Task 6: Web — inline approval panel on the charter page

**Files:**
- Create: `apps/web/app/components/pmo/projects/CharterApprovalPanel.vue`
- Create: `apps/web/stories/project/CharterApprovalPanel.stories.ts`
- Create: `apps/web/app/components/pmo/projects/__tests__/CharterApprovalPanel.test.ts`
- Modify: `apps/web/app/pages/projects/[id]/charter.vue` (replace the draft banner, hide edit while submitted)
- Modify: `apps/web/i18n/locales/ar/projects.json`, `apps/web/i18n/locales/en/projects.json` (`projects.charter`)

**Interfaces:**
- Consumes: `ProjectDetail`, `useCharterTransition()`.
- Produces: `<CharterApprovalPanel :project="project" />`, no emits (the mutation updates the cache).

- [ ] **Step 1: Failing component test** (follow the mounting helper used by the other tests in `components/pmo/projects/__tests__`):

```ts
it('offers approve and return only to the reviewing sponsor', async () => {
  const w = await mountPanel(projectWith({ state: 'submitted', can_review: true }))
  expect(w.find('[data-testid="charter-approve"]').exists()).toBe(true)
  expect(w.find('[data-testid="charter-withdraw"]').exists()).toBe(false)
})
it('asks for a note inline before returning', async () => {
  const w = await mountPanel(projectWith({ state: 'submitted', can_review: true }))
  await w.find('[data-testid="charter-return"]').trigger('click')
  expect(w.find('[data-testid="charter-return-note"]').exists()).toBe(true)
  expect(w.find('[data-testid="charter-return-confirm"]').attributes('disabled')).toBeDefined()
})
it('shows the return note on a returned draft', async () => {
  const w = await mountPanel(projectWith({ state: 'draft', return_note: 'Add budget' }))
  expect(w.text()).toContain('Add budget')
})
it('offers withdraw to the manager while submitted', async () => {
  const w = await mountPanel(projectWith({ state: 'submitted', can_review: false }, { can_manage: true }))
  expect(w.find('[data-testid="charter-withdraw"]').exists()).toBe(true)
})
```

- [ ] **Step 2: Implement the panel** — one `UAlert` per state, actions in its `#actions` slot:
  - `draft` + `return_note`: color `warning`, title `projects.charter.returned`, description = the note.
  - `draft` without note: color `warning`, title `projects.charter.draftBanner` (existing key).
  - `submitted`: color `info`, title `projects.charter.waitingFor` `{ name: sponsor.name }`; `can_review` → buttons `charter-approve` (`projects.charter.approve`) and `charter-return` (`projects.charter.return`); `can_manage && !can_review` → `charter-withdraw`, with an inline "are you sure" row (`SharedInlineConfirm` if the story catalog has it, else the inline confirm pattern `ProjectArchiveAction.vue` uses).
  - Return: clicking reveals a `UTextarea` (`charter-return-note`, maxlength `CHARTER_RETURN_NOTE_MAX`) and `charter-return-confirm`, disabled while the trimmed note is empty.
  - `approved`: color `success`, title `projects.charter.approvedBy` `{ name, date }` when `approved_by` is set, else `projects.charter.state.approved`.
  - Every action calls `transition({ id: project.id, action, expected: project.updated_at, note })`; on `409 stale_write` show `projects.charter.staleReview` and refetch; other `ApiError` show `e.message`.
  - Class `webvue-print-hide` on the panel (the charter page prints).
- [ ] **Step 3: i18n** — `ar/projects.json` under `projects.charter` (and English equivalents in `en`):

```json
"state": { "draft": "مسودة", "submitted": "بانتظار الاعتماد", "approved": "معتمد" },
"submitForApproval": "إرسال للاعتماد",
"submitted": "أُرسل الميثاق إلى الراعي للاعتماد",
"savedNotSubmitted": "حُفظ الميثاق لكن لم يُرسل للاعتماد",
"waitingFor": "الميثاق بانتظار اعتماد {name}",
"approve": "اعتماد",
"return": "إرجاع مع ملاحظة",
"returnNote": "ما الذي يحتاج تعديلًا؟",
"returnConfirm": "إرجاع الميثاق",
"withdraw": "سحب الطلب",
"withdrawConfirm": "سحب الطلب وإعادة الميثاق مسودة؟",
"returned": "أعاد الراعي الميثاق للتعديل",
"approvedBy": "اعتمده {name} في {date}",
"staleReview": "تغيّر المشروع أثناء المراجعة. راجع النسخة الحالية ثم أعد المحاولة."
```

Remove the now-unused `"final"` state key.
- [ ] **Step 4: Page** — in `charter.vue`: replace the `UAlert` draft banner with `<CharterApprovalPanel v-if="project" :project="project" />`; hide the edit button when `charterState === 'submitted'`; badge tone `isDraft ? 'warning' : charterState === 'submitted' ? 'info' : 'success'` (check `SharedStatusBadge` tones in its story).
- [ ] **Step 5: Story** — `CharterApprovalPanel.stories.ts`, title `Project/CharterApprovalPanel`, stories: `Draft`, `Returned`, `WaitingForSponsor` (`can_review: true`), `WaitingManagerView` (`can_manage: true`), `Approved`; build the project from the existing pmo fixture with the charter overrides; `storyContext('apps/web/app/pages/projects/[id]/charter.vue:…')` like `ProjectCharterForm.stories.ts`.
- [ ] **Step 6:** `npm -w apps/web run test` and `cd apps/web && npm run lint` → PASS.
- [ ] **Step 7: Commit** — `git commit -m "feat(web): approve, return and withdraw the charter inline"`

---

### Task 7: Web — policy switch, "waiting for me" list, and browser proof

**Files:**
- Modify: `apps/web/app/components/settings/ProjectSettingsForm.vue` (:39 `onBool` union, approval section :134-142)
- Create: `apps/web/app/components/pmo/projects/dashboard/PendingCharterReviews.vue` (+ story under `apps/web/stories/project/dashboard/`)
- Modify: `apps/web/app/pages/projects/dashboard.vue` (before `ProjectDashboardRecentProjects`)
- Modify: `apps/web/i18n/locales/{ar,en}/settings.json`, `projects.json`
- Modify: `apps/web/e2e/internal-ui-audit-mock.mjs` (four charter routes and `charter_review`)
- Create: `apps/web/e2e/project-charter-approval.spec.ts`

- [ ] **Step 1: Settings switch** — add `'require_charter_approval'` to the `onBool` union and, inside the approval `SharedFormSection`:

```vue
        <USwitch
          data-testid="settings-require-charter-approval"
          :model-value="settings.require_charter_approval"
          :label="t('settings.projects.charterApproval.label')"
          :description="t('settings.projects.charterApproval.hint')"
          :disabled="!hydrated || isPending"
          @update:model-value="v => onBool('require_charter_approval', v)"
        />
```

`ar/settings.json`: `"charterApproval": { "label": "اعتماد الميثاق من الراعي", "hint": "عند التفعيل يرسل مدير المشروع الميثاق إلى الراعي، ولا يُعتمد إلا بموافقته." }`.

- [ ] **Step 2: Pending list** — `PendingCharterReviews.vue` uses `useProjectList(ref(false), { charterReview: true, limit: 20 })`, renders nothing when the list is empty or loading fails silently-free (show `SharedErrorState` on error), otherwise a `SharedFormSection`-styled card titled `projects.dashboard.pendingCharters` ("مواثيق بانتظار اعتمادك") with one link per project to `/projects/{id}/charter`. Place it in `dashboard.vue` with `class="@min-[768px]:col-span-2"` before the recent projects. Unit test: hidden when empty, one link per item.

- [ ] **Step 3: Mock API** — in `internal-ui-audit-mock.mjs` handle `POST /api/v1/projects/:id/charter/(submit|approve|return|withdraw)` by mutating the in-memory project's charter (`submitted`/`approved`/`draft` + `return_note`), bumping `updated_at`, and returning the detail; honour `charter_review=1` on the list by filtering `charter.state === 'submitted' && charter.can_review`.

- [ ] **Step 4: E2E** — `project-charter-approval.spec.ts` (same setup as `project-charter.spec.ts`): open a mock project whose charter is `submitted` with `can_review: true`; click `charter-return`, check `charter-return-confirm` is disabled, type a note, confirm, see the returned alert with the note; then from a `draft` charter with the manager view, finish the wizard and see the "بانتظار الاعتماد" badge. Run on the isolated mock stack (memory: `isolated-ui-mock-stack`), on free ports:

```bash
cd apps/web && E2E_BASE_URL=http://localhost:<nuxt> E2E_PROJECT_POPUPS=1 npx playwright test e2e/project-charter-approval.spec.ts e2e/project-charter.spec.ts e2e/tasmim6-charter.spec.ts
```

Expected: the new spec passes; for the two existing specs, compare failing titles with a pre-change worktree (known ~73 mock failures on `main`) — no new failures.

- [ ] **Step 5: Screenshots** — RTL light and dark, desktop and 375 px, of the charter page in `submitted` (sponsor view) and `draft` with a return note; attach to the review.
- [ ] **Step 6: Full gates** — `npm test`, `cd apps/web && npm run lint`, `npm run test:odoo -- --addons webvue_pmo`, `python3 -B tools/arch_policy.py --base main`, `python3 -B tools/git_policy.py --base main`, then the `odoo-reviewer` agent on the branch.
- [ ] **Step 7: Commit** — `git commit -m "feat(web): charter approval policy switch and pending reviews"`

---

## Self-review notes

- Spec coverage: D1 (Tasks 2, 3), D2 (Tasks 1, 2), D3 (Task 2 guard; phase 3 replaces the reopen rule), D7 (Tasks 2, 4), D8 (Task 6). The sponsor bell notification is phase 2 by design; until then the dashboard list (Task 7) is how a sponsor finds pending charters.
- Names used across tasks: `WebVueCharterState`, `CHARTER_APPROVAL_FIELDS`, `CHARTER_CONTENT_FIELDS`, `CHARTER_RESET_VALS`, `_webvue_charter_submit|approve|return|withdraw`, `_webvue_can_review_charter`, `_webvue_lock_for_write(..., require_manage=)`, `parse_write_token`, `useCharterTransition`, `ProjectCharterAction`, `charter_review`, `charter_state`, `CHARTER_RETURN_NOTE_MAX`.
- Known risk: `_webvue_charter_differs` compares through `convert_to_cache`; the `description` Html field may sanitize differently from what the wizard sends. Review Focus 1 pins the common fields; if `description` causes false reopens, exclude it from `CHARTER_CONTENT_FIELDS` and note why.
