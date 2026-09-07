# nasq — Phase 3a: Project Administration — Design Spec

> UI authority update — 2026-09-07: [DESIGN.md](../../../DESIGN.md) supersedes this document's customer-UI appearance, component and navigation prescriptions wherever they conflict. Preserve historical implementation/verification evidence and still-valid API, permission, business and delivery contracts. This document is not a second theme source.

**Date:** 2026-09-05
**Target:** nasq `main` @ `v0.3.0-phase2` (`217d8bc`)
**Status:** Delivered 2026-09-05
**Parent spec:** `2026-09-03-nasq-platform-design.md` (binding). Phase 3 was
decomposed on 2026-09-05 into five packages; this is the first: **3a project
administration**. The others (3b platform settings: users + branding; 3c Today;
3d Reports; 3e PWA/polish) get their own specs. "People" and "Departments"
belong to the HR pillar and are not here.

## Goal

A customer must be able to run the project pillar without ever opening Odoo:
create a project, shape its stages, keep its settings, follow milestones,
post status updates, tag and retire tasks. Today only the vendor console can
do these. After 3a, project managers and `customer_admin` do all of it from
the Nuxt app, and a `customer_admin` sets the two company-wide project
policies in the first page of the **الإعدادات** section.

## Decisions (2026-09-05, delegated to the assistant: "sensible and flexible")

| Question | Decision |
|---|---|
| Who creates projects | Default: `project.group_project_manager` or `nasq_core.group_customer_admin`. **Flexible:** a company policy `project_creators` = `managers` (default) \| `employees` in الإعدادات › المشاريع lets every employee create projects. |
| Who manages a project | `_nasq_can_manage(project)`: manager group, `customer_admin`, **or the project's own `user_id`** (a project manager by assignment, even outside the group). Replaces the phase-2 group-only rule everywhere it is used (project status, and now settings/stages/milestones/updates/archive). |
| Project creation | Name only. `user_id` = creator, `privacy_visibility` = `employees`, `allow_milestones` = True, stages copied from the company's **default stages** policy. |
| Project settings | One dialog from `⋯` in the project header, tabs **عام** · **المراحل** · **المتابعون**. Fields: name, description (rich text), manager, visibility (`employees` \| `followers`), date_start, date (end), tags. |
| Archive | Projects and tasks are archived (`active = False`), never deleted. Projects table gets an **المؤرشفة** filter (managers only); unarchive from there. Tasks: archive from `⋯` in the task modal (manager of the project or the task's creator); no unarchive UI in 3a (vendor console). |
| Stages | Per project: add, rename, reorder (drag), fold, delete when empty. A stage with tasks refuses deletion (422 `stage_not_empty` with the count). |
| Milestones | Tab **المعالم**: name, deadline, reached, linked-task count. Task modal gets a milestone picker. |
| Project updates | Tab **التحديثات**: chronological list (status badge, title, rich text, date, author). **تحديث جديد** (managers) = status + title + text. The phase-2 quick status Select stays and still creates a text-less update through `project.write`. |
| Tags | Task modal gets a tag picker (multi); managers may create a tag by typing a new name. Colour = Odoo's default. |
| Policies storage | `ir.config_parameter`: `nasq_pmo.project_creators` (`managers`/`employees`) and `nasq_pmo.default_stages` (JSON `[{name, fold}]`). No new model, no schema. Read through a model helper with `sudo()` (config, not business data — the one documented `sudo()` besides the phase-2 display-name/stage lookups). |
| Employees creating projects | When the policy is `employees`, `project.project.create` runs `sudo()` for the create call only, then the record is re-browsed as the user. Odoo's ACL gives create to managers only; the policy deliberately widens it, so the widening is explicit and audited (`create_uid` is still the employee). |
| Members | No separate member list. Visibility `followers` uses Odoo followers; the **المتابعون** tab adds/removes followers through the phase-1 people picker. |

## Screens

### المشاريع — table (`/projects`), additions

- Primary action **مشروع جديد** for users allowed by the policy (`can_create` on the list response); a small dialog with the name only; success navigates to `/projects/{id}`.
- Filter chip **المؤرشفة** (visible to `can_manage` users of any project = managers/admin): shows archived projects; row `⋯` → **إلغاء الأرشفة**.

### المشروع — header (`/projects/{id}`), additions

- `⋯` menu (when `can_manage`): **إعدادات المشروع**, **أرشفة المشروع** (confirm dialog; then navigate to `/projects`).
- Two new tabs after قائمة / لوحة: **المعالم**, **التحديثات**. `?tab=milestones|updates`.

### إعدادات المشروع — dialog

- **عام**: name (Input), description (Tiptap, same editor as tasks), manager (people picker), visibility (Select: كل الموظفين / المتابعون فقط), start/end dates (Calendar pickers), tags (tag picker). Autosave on blur/change (optimistic for text fields, replaced by the server response); no Save button.
- **المراحل**: ordered list; drag handle (vue-draggable-plus, same as the board) → `PUT` the full order; inline rename; fold toggle; **+ مرحلة**; delete icon disabled with a tooltip "المرحلة تحتوي N مهمة" when the stage has tasks.
- **المتابعون**: list of followers who are internal users (name); **+ إضافة** via the people picker; remove icon. Shown only when visibility is `followers` or when followers exist.

### المعالم — tab

- Table: الاسم · الموعد (deadline badge tones reused) · المهام (n) · الحالة (تم / لم يتم). Row `⋯`: تعديل، تم/إعادة فتح، حذف (only when no linked tasks; else 422 `milestone_has_tasks`).
- Primary action **معلم جديد** (managers): name + deadline.
- Task modal: **المعلم** Select listing the project's milestones + "بلا معلم".

### التحديثات — tab

- Timeline cards: status badge (phase-2 vocabulary), title, author, date, rich text body.
- Primary action **تحديث جديد** (managers): dialog with status Select (five values), title, Tiptap body. Success prepends the update, refreshes the header status.

### الإعدادات › المشاريع (`/settings/projects`)

- Sidebar entry **الإعدادات** appears for role `admin` and `vendor` only (the `nav.*` exception in `common.json` — one key `nav.settings`). The page itself 403s for others (empty state with a message).
- **من يستطيع إنشاء المشاريع**: radio (المديرون / كل الموظفين).
- **المراحل الافتراضية للمشاريع الجديدة**: ordered editable list (name, fold), same widget as the project stages tab. Default seed: جديد · قيد التنفيذ · مراجعة · منجز (مطوي).
- Autosave; a toast confirms.

## API v1

All `type='json2'`, `auth='user'`, errors `{code, message, field?}`, real HTTP
status, whitelisted serializers, no `sudo()` except the two documented
cases above.

```
Projects
GET    /api/v1/projects?minimal=1|archived=1        KEEP; `archived=1` (managers) lists archived; response gains
                                                     `can_create` when not minimal:  { items: Project[], can_create }   ← shape change, see below
POST   /api/v1/projects {name}                      → ProjectDetail (201); 403 create_forbidden when the policy denies
PATCH  /api/v1/projects/{id} {name?, description?, user_id?, privacy_visibility?, date_start?, date?, tag_ids?}
                                                     → ProjectDetail; 403 forbidden (not can_manage); 422 per field
POST   /api/v1/projects/{id}/archive                → ProjectDetail (active=false)
POST   /api/v1/projects/{id}/unarchive              → ProjectDetail
POST   /api/v1/projects/{id}/status {status}        KEEP (phase 2)

Stages (project-scoped)
POST   /api/v1/projects/{id}/stages {name, fold?}   → ProjectStage (201), appended last
PATCH  /api/v1/projects/{id}/stages/{stage_id} {name?, fold?} → ProjectStage
PUT    /api/v1/projects/{id}/stages/order {ids: number[]}     → ProjectStage[] (must be a permutation of the project's stage ids → else 422)
DELETE /api/v1/projects/{id}/stages/{stage_id}      → 204; 422 stage_not_empty {count} when tasks use it

Followers
GET    /api/v1/projects/{id}/followers               → PersonRef[] (internal users only)
POST   /api/v1/projects/{id}/followers {user_id}     → PersonRef[]
DELETE /api/v1/projects/{id}/followers/{user_id}     → PersonRef[]

Milestones
GET    /api/v1/projects/{id}/milestones              → Milestone[]
POST   /api/v1/projects/{id}/milestones {name, deadline?}         → Milestone (201)
PATCH  /api/v1/projects/{id}/milestones/{mid} {name?, deadline?, is_reached?} → Milestone
DELETE /api/v1/projects/{id}/milestones/{mid}        → 204; 422 milestone_has_tasks {count}

Updates
GET    /api/v1/projects/{id}/updates                 → ProjectUpdate[] (newest first, limit 50)
POST   /api/v1/projects/{id}/updates {status, name, description?} → ProjectUpdate (201); managers only (403 status_forbidden)

Tasks (additions)
POST   /api/v1/tasks/{id}/archive                    → TaskDetail; 403 forbidden unless can_manage(project) or create_uid == uid
PATCH  /api/v1/tasks/{id} {…, milestone_id?, tag_ids?} milestone must belong to the task's project (422)
GET    /api/v1/tags?q=                               → Tag[] (company-wide, name asc, limit 100)
POST   /api/v1/tags {name}                           → Tag (201); managers only; 422 duplicate name

Settings
GET    /api/v1/settings/projects                     → ProjectSettings; admin only (403)
PATCH  /api/v1/settings/projects {project_creators?, default_stages?} → ProjectSettings
```

**`GET /projects` shape change.** Phase 2 returned a bare array. 3a returns
`{ items: Project[], can_create: boolean }` for the full shape; `?minimal=1`
stays a bare `ProjectRef[]` (pickers). The web `useProjectList()` and the
e2e contract test change in the same task. `Project` gains `active: boolean`
and `can_manage: boolean` (so the table can show `⋯` per row); `ProjectDetail`
gains `description_html`, `manager: PersonRef | null`, `privacy_visibility`,
`date_start`, `date_end`, `tags`, `followers_count`, `milestone_count`.

Shapes (zod, `packages/contracts/src/pmo/`):

```
Project         + { active, can_manage }
ProjectDetail   + { description_html, manager, privacy_visibility: 'employees'|'followers', date_start, date_end, tags: Tag[], followers_count, milestone_count }
ProjectListSchema { items: Project[], can_create: boolean }
ProjectPatch    { name?, description?, user_id?: number|null, privacy_visibility?, date_start?: string|null, date?: string|null, tag_ids?: number[] }
Milestone       { id, name, deadline: string|null, is_reached, reached_date: string|null, task_count, done_task_count }
ProjectUpdate   { id, name, status: ProjectStatus, description_html, date, author: PersonRef }
ProjectSettings { project_creators: 'managers'|'employees', default_stages: {name, fold}[] }
TaskDetail      + { milestone: RefSchema|null }   (list item unchanged)
TaskPatch       + { milestone_id?: number|null }
StageOrderBody  { ids: number[] }
```

Dates: `date_start`/`date`/`deadline` are calendar dates (`YYYY-MM-DD`), not
instants — unlike task deadlines. The client sends the local calendar date.

## Odoo side (`nasq_pmo`)

- `models/project_project.py`: `_nasq_can_manage()` becomes per-record
  (`self.ensure_one()`; group OR admin OR `self.user_id == env.user`);
  `_nasq_create_from_policy(name)` (policy check, default stages, the
  documented `sudo()` create when the policy is `employees`);
  `_nasq_archive()/_nasq_unarchive()`; `_nasq_reorder_stages(ids)`;
  `_nasq_delete_stage(stage)` (count check); `_nasq_post_update(status, name, description)`
  (creates `project.update`; Odoo recomputes `last_update_status`).
- `models/project_task.py`: `_nasq_can_archive()` (manage OR creator),
  `_nasq_archive()`.
- `models/nasq_settings.py` (AbstractModel `nasq.pmo.settings`): `get()` /
  `set(vals)` over the two `ir.config_parameter` keys with validation
  (`default_stages` non-empty, names non-blank, ≤ 20 entries).
- Serializers: `project.py` extended; new `milestone.py`, `project_update.py`,
  `settings.py`; `task.py` adds `milestone`, `_parse_milestone`, `tag_ids`
  stays.
- Controllers: `projects.py` extended; new `project_stages.py`,
  `project_followers.py`, `milestones.py`, `project_updates.py`, `tags.py`,
  `settings.py`.
- Bus: no new channel. Project-level changes invalidate locally on mutation
  success (same rule as phase-2 status).
- `nasq_pmo/data/nasq_pmo_data.xml` seeds the two config parameters
  (`noupdate="1"`).

## Frontend

- Routes: `/settings/projects` (new `pages/settings/projects.vue`); the
  project tabs extend `pages/projects/[id].vue`.
- Data: `useProjectList()` → `{items, can_create}`; `useCreateProject()`,
  `useUpdateProject()` (optimistic text fields), `useArchiveProject()`,
  `useProjectStages()` mutations (add/rename/fold/reorder/delete),
  `useProjectFollowers()`, `useMilestones(projectId)`, `useProjectUpdates(projectId)`,
  `useTags()`, `useCreateTag()`, `useProjectSettings()`, `useArchiveTask()`.
  Keys under `projectKeys` (`['project', id, 'stages'|'followers'|'milestones'|'updates']`)
  and `['tags']`, `['settings','projects']`.
- Components: `project/ProjectSettingsDialog.vue` (+ `ProjectGeneralForm`,
  `StageListEditor` — reused by settings page — `FollowerList`),
  `project/CreateProjectDialog.vue`, `project/MilestoneTable.vue`,
  `project/MilestoneDialog.vue`, `project/ProjectUpdateList.vue`,
  `project/ProjectUpdateDialog.vue`, `task/TagPicker.vue`,
  `task/MilestoneSelect.vue`, `settings/ProjectSettingsForm.vue`.
- Nav: `nav.settings` (→ `/settings/projects`) for `admin`/`vendor`;
  `useNav` gains the role check.
- i18n: `projects.json` grows (settings, stages, milestones, updates,
  archive); `tasks.json` grows (tags picker, milestone, archive); one key
  `nav.settings` in `common.json`. New `settings.json` namespace for the
  settings section (shared touchpoint: one `files` entry per locale).
- Hydration gates, logical properties, tokens, one primary action per screen
  (the header's `⋯` holds the secondary actions), empty states with one
  action — all as before.

## Testing

- **Odoo**: policy (`managers` denies employee 403 `create_forbidden`;
  `employees` lets the employee create and `create_uid` is the employee;
  default stages copied in order with `fold`); `can_manage` true for the
  assigned `user_id` outside the group; PATCH whitelist and per-field 422s;
  archive hides from list, `archived=1` requires manager; stage CRUD, order
  permutation check, `stage_not_empty`; followers add/remove and the
  `followers` visibility effect on an employee's list; milestones CRUD,
  `milestone_has_tasks`, `milestone_id` must belong to the project; updates
  create (status change reflected on the project, `status_forbidden` for
  employees), list order; task archive rules (creator yes, other employee
  403, manager yes); tag create manager-only; settings 403 for employee,
  validation 422s.
- **Contracts**: every new schema against a fixture; `ProjectListSchema`
  rejects the phase-2 bare array.
- **Web unit**: stage-order helper (pure), date helpers (calendar date ↔
  input), `useNav` role gating.
- **e2e**: create a project from the table → land on it with default stages;
  settings dialog rename + visibility; add/reorder/delete a stage and see
  the board columns follow; add a milestone and link a task; post an update
  and see the header badge change; archive a task and see it leave the list;
  `/settings/projects` as admin changes the default stages and the next new
  project gets them; employee has no "مشروع جديد" and no الإعدادات entry.

Gate as before: Odoo fresh `-i`, ruff, contracts, web unit, vue-tsc, e2e.

## Out of scope (3b–3e and later)

Users and branding settings (3b), Today (3c), Reports (3d), PWA/polish (3e),
project templates, Gantt, recurring tasks, task hard delete, project
duplication, sub-task tree editing beyond phase 1, portal users, initiatives.

## Open items (decided by default)

- Archived tasks stay linked to milestones and count in `task_count`
  only while active (Odoo default); accepted.
- Deleting a stage that only archived tasks use: refused too (count includes
  archived tasks via `active_test=False`); accepted for safety.
