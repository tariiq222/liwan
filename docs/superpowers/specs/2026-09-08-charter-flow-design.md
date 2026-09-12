> **سياق تاريخي للمنتج والتنفيذ.** قرارات الشكل القديمة هنا ليست تعليمات واجهة؛ اتبع [DESIGN.md](../../../DESIGN.md). تبقى العقود وقيود الأمن والبيانات خاضعة للمصادر الحالية في المشروع.

# Charter, milestones and tasks

Approved in the current user conversation on 2026-09-08; the user explicitly requested execution. No further approval ceremony is needed for this agreed scope.

## Behavior

The project charter is an ordinary printable project document, without document approval. Simplify its editor to name, description, native project manager (`user_id`), rationale, goals, scope/exclusions, dates and optional estimated budget. Keep automatic code. Remove sponsor and advanced fields from this compact editor without deleting stored historical values. Existing hidden values must survive edits. Goals may keep existing metric/target values without requiring them. New deliverables are entered only once, on milestones, and the charter summarizes them from milestones. Legacy charter deliverables remain readable as legacy unassigned outputs; do not delete or silently migrate them.

After creating a project, navigate to its milestones tab, preserving the originating project-list return URL. The milestones view offers create/edit with outputs and a clear next action to create tasks. These are normal internal pages, not modal wizards.

Milestones extend stock `project.milestone`, with `nasq_start_date` (Date) and `nasq_deliverables` (Json array). The API exposes `start_date: string|null` and `deliverables: Array<{name:string,done:boolean}>`, in addition to existing milestone fields. Checklist states do not change task state, milestone reach state, or any progress metric. Existing `is_reached` behavior is preserved independently. UI labels distinguish checklist completion and task progress. No scoring, weights, acceptance criteria or approvals for outputs.

Dates obey project start <= milestone start <= milestone deadline <= project end. Task planned start/end use existing `nasq_planned_start` and `date_deadline` schedule semantics and must lie inside their linked milestone bounds. Include all linked tasks (including archived/hidden) when validating parent shrinking; do not expose their private content. Cross-project milestone assignments remain invalid. Changing parent dates, changing task milestone, direct task deadline writes and schedule writes cannot bypass bounds. Do not silently shift children.

Compatibility: existing undated projects/milestones/tasks remain readable and ordinary non-date edits remain possible. Empty schedules can remain empty; when both milestone dates are supplied validate them and parent bounds. UI new milestone workflow requires project dates and a full milestone date pair; existing incomplete legacy milestones can be corrected explicitly. Bounds that exist must always be enforced, even for deadline-only legacy tasks. Guided project task creation selects a milestone and captures start/end; retain unrelated personal/legacy task behavior. No destructive data backfill or source Odoo edits.

## Frozen contracts

`MilestoneSchema`: add required serialized keys `start_date` nullable ISO day, `deliverables` array of strict `{name,done}` objects. Schemas may use defaults for missing new keys to preserve old mocked and cached payloads, but the server always returns keys. `MilestoneBodySchema` and `MilestonePatchSchema` accept new optional keys. `useCreateMilestone` accepts `{projectId,name,deadline?,start_date?,deliverables?}`. Milestone schedule payload can expose start_date consistently if needed.

Task create may accept `planned_start` as ISO calendar day, paired with existing UTC `date_deadline`; serialize `planned_start` in task detail. Preserve dedicated schedule authorization; new date support must not create a capability bypass. If this requires a contract refinement, coordinator decides once and informs UI owner before implementation diverges.

## Safety and validation

Use stock Odoo 19 CE models through nasq_pmo only. Preserve company/record authorization and hydration, RTL/English, return filters and shared page components. No commit, merge, push, deployment, main restart, destructive cleanup, tests on odoo19, provider API fallback, or extra agents from workers. Coordinator alone runs checks. Workers write tests first and request the coordinator to execute the targeted red gate before implementation. Final checks include contracts/web, Python lint, isolated Odoo tests and browser flow at 390/768/1440 pixels.

## Approved task content follow-up

Task details show a sanitized static description. Authorized users edit it inline with explicit Save/Cancel and unsaved-change protection. New task forms include a plain description textarea and optional task outputs. Description uses native Odoo HTML storage after escaping textarea input. Task outputs use a separate task nasq_deliverables Json field, exposed as deliverables: [{name,done}] with empty-array compatibility. Create and patch validate exact row shapes and preserve existing task permissions. Output toggles do not change task completion, milestone reached state or project progress. Task detail displays supplied outputs as a checklist. No new approval workflow.
