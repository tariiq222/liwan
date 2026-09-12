> **سياق تاريخي للمنتج والتنفيذ.** قرارات الشكل القديمة هنا ليست تعليمات واجهة؛ اتبع [DESIGN.md](../../../DESIGN.md). تبقى العقود وقيود الأمن والبيانات خاضعة للمصادر الحالية في المشروع.

# Meeting workspace implementation plan

**Goal:** Deliver periodic meeting timeline, recommendation follow-up, integrated structured minutes, immutable final versions and an activity log; filters start collapsed.
**Architecture:** Extend existing meeting and recommendation entities behind /api/v1. UI routes and stored references remain stable. No duplicate recommendation graph. Native Luna High workers own isolated backend, timeline and minutes UI packages; coordinator owns shared components, query adapters, localization integration, review and verification.
**Tech stack:** Odoo 19, Nuxt/Vue, Zod, existing QWeb PDF reporting.
**Approved design:** User-approved organization in this conversation, refined by the shared contract below.

## Execution ledger
- [x] Preserve candidate source snapshot and prepare three isolated worktrees.
- [x] Define additive contract and delegate independent packages.
- [x] Set FilterCard and FilterBar defaultOpen=false; keep active summary and clear action visible.
- [x] Integrate timeline helper tests and new series workspace after diff review.
- [x] Integrate backend schema/model/controller/ACL/report changes and run isolated Odoo regression tests.
- [x] Integrate structured minutes UI and events/versions views; preserve legacy content.
- [x] Merge worker localization into canonical feature namespaces and verify types/contracts.
- [x] Verify frontend suite/build, backend regressions, browser save, immutable versions, report HTML and print CSS.
- [ ] Verify actual paginated PDF output: local wkhtmltopdf missing; embedded browser reports printing unavailable.
- [x] Record delivered and remaining behavior, preview state; no commit/merge/deploy.

## Verification cases
1. Previous session must be DONE, not a past draft; next must be nonterminal in future. Distinguish overdue uncompleted sessions.
2. Default filter fields hidden but mounted; active chips and reset reachable without expansion.
3. Save minutes form, reload, see same topic keys and existing recommendation IDs. Reject recommendations from another meeting and unauthorized project links; lock finalized/cancelled edits.
4. Finalize, reopen and finalize again: two immutable version numbers with different captured content. Current task execution updates do not rewrite captured prior text.
5. Events include actor/time/type; forbidden users cannot read event or version payloads via direct endpoint or ORM. Historical events are not fabricated.
6. Series recommendation filter applies before pagination and preserves total/same IDs.
7. Arabic landscape PDF uses current company identity, wraps long text, repeats table heading and preserves legacy minutes.
8. URL tabs/filters survive reload/back; no horizontal document overflow on mobile; no draft lost when leaving editor.

## Shared implementation contract

# Approved meeting workspace implementation contract

User approved: improve periodic meetings timeline and next/previous selection; follow-up SAME recommendation records across sessions; structured minutes integrated into meeting (never an independent duplicate module), branded A4 landscape PDF; append-only finalized minutes versions and meaningful activity history. Existing filters/numbers/sidebar changes in your checkout are baseline, preserve them. Canonical main and odoo19 untouched. Source reference scanned PDF was reviewed: meeting metadata + introduction, ordered discussion topics with recommendations/responsible/execution duration, closing and signoff. Do not copy real PDF personal data/signatures.

Read AGENTS.md, DESIGN.md, CLAUDE.md, docs/parallel-work.md and docs/design-system/components.md. You are NOT alone. Only owned files may change; never revert others. No spawning. No commit/merge/push/cleanup/runtime changes, no tests/build/lint runs in workers. Write meaningful tests where needed, coordinator runs all gates. Native Luna High only. Use current Nuxt/Vue/Odoo patterns; no new dependencies; normal page routes, inline destructive confirmations, SharedUnsavedChanges. Existing edit/lock/current-company and recommendation-task restrictions must survive.

## Shared wire contract (additive, parent will supply composables)
Existing MeetingDetail gains optional `minutes_form: MeetingMinutesForm`; MeetingPatch gains optional same field. Plain text form (escaped output, not raw HTML):
```
{ opening: string, closing: string, chairperson: string, approver_name: string, approver_title: string,
  topics: [{ key: string, title: string, discussion: string, project_id: number|null, resolution_ids: number[] }] }
```
Stable client topic keys crypto.randomUUID; unique keys, unique recommendation assignment across topics, max100 topics, max200 recommendations per topic; max50000chars text, max500chars title/name, refuse foreign-meeting recommendation IDs and inaccessible/cross-company projects. No duplicate recommendation text in form; resolution_ids link existing recommendations. Metadata (date/time/place/attendees/secretary/reference/name) always existing meeting. Existing agenda/minutes rich text must remain readable/editable for older records; never silently convert or drop it. Topics should be explicit (legacy agenda rich text cannot reliably be split automatically); offer opening/reading existing agenda while adding topics.
Existing recommendation create/patch/detail gains optional `execution_period: string` (max500) and `project_id:number|null` on write, `project: {id,name}|null` on read, only authorized visible current-company references. Keep existing mandatory responsible/deadline validation; UI supports period text in addition to deadline, no weakening existing guards. Form topic project can be set independently.
Minutes snapshots gain optional `minutes_form` and snapshot recommendation optional `execution_period`, `project` (permission-safe). Save finalized immutable versions EACH successful confirmed->done, preserving existing latest snapshot. Never expose protected backing fields or trust client version/event payloads.

Endpoints (backend worker owns contracts):
- GET `/api/v1/meetings/:id/events?limit=25&offset=0` and `/api/v1/meeting-series/:id/events?...`: `{items: MeetingEvent[],total:number}` where MeetingEvent `{id:number, meeting_id:number, meeting_name:string, occurred_at:string, actor:{id:number,name:string}|null, kind:string, summary:string}`. New events at least meeting edits/state transitions, form saved, recommendation create/decision/execution changes. Server-side audited, permission-filtered, descending with id tie-break; legacy events must not be fabricated. Summary plain and non-sensitive, no raw payload leak. Allowed kind values open string (UI localized lookup with safe generic fallback). Use English stable kind and localized UI headings; summary may be simple server descriptive text.
- GET `/api/v1/meetings/:id/versions?...`: `{items:[{id:number,number:number,captured_at:string,actor:Person|null,snapshot:MeetingMinutesSnapshot}],total:number}` descending; historical data re-projected with current visibility. Versions cannot be written by caller.
- GET `/api/v1/meeting-series/:id/resolutions?limit=25&offset=0&q=&state=`: `{items: MeetingPreviousResolution[],total:number}` each has original meeting_id/meeting_name, same resolution ID, state projections and project permissions. No N+1 front-end requests. Filter BEFORE pagination; no cap masquerading as total.
Parent supplies new `app/composables/useMeetingWorkspace.ts` exports `useMeetingEvents(id, params?, series=false)`, `useMeetingVersions(id,params?)`, `useMeetingSeriesResolutions(id,params)`; params MaybeRefOrGetter<{limit?,offset?,q?,state?}>. Existing usePatchMeeting picks additive contract.
Shared presentational components owned minutes-ui: `MeetingEventList.vue` props `{events, loading?, error?, total?, page?, pageSize?}`, emits retry/page; and `MeetingVersionList.vue` props `{versions,loading?,error?,total?,page?,pageSize?}`, emits retry/page. series worker imports EventList; dependency fixed interface so work can proceed independently.
Translations: DO NOT edit common.json. Write exact JSON objects to `/tmp/nasq-meeting-workspace/<package>-ar.json` and `<package>-en.json` to merge under unique namespace `meetingTimeline` (timeline), `meetingMinutesForm` (minutes-ui). Parent owns locale merge.

## Final reconciliation
- Recommendation requires a deadline OR nonblank execution_period; responsible remains mandatory.
- Added single-version endpoint and useMeetingVersion; active/overdue follow-up filters apply projected state before pagination.
- Final evidence: docs/meeting-workspace-delivery-2026-09-09.md.
- Main advanced independently to 508d256 during work; this candidate remains unmerged and must be reconciled against the latest main when integration is authorized.
