# Meeting workspace delivery — 2026-09-09

Implemented in `codex/meeting-filter-card`, `/Users/tariq/code/nasq-meeting-filter-card`. Preview: http://127.0.0.1:3969. Existing pending unified filters, number columns and sidebar changes were preserved.

## Delivered

- Shared FilterCard/FilterBar start collapsed across consumers; selected filter chips, count and clear action remain available.
- Periodic meetings: next nonterminal future occurrence, previous completed occurrence, overdue distinction, timeline/table, ordered groups, progressive pagination and URL-preserved filters/tabs.
- Follow-up lists the original recommendation records across sessions with projected state, active/overdue filtering before pagination and links to their origin.
- Structured minutes use existing meeting metadata and recommendation IDs. Ordered topics include discussion and optional project. Signoff fields remain editable before completion. Save-and-create recommendation persists all editor fields before navigation.
- Deadline or meaningful execution period is required; responsible remains required. Converted recommendation/assignee rights are preserved.
- Immutable finalized versions, server-generated event history, permission-filtered endpoints and protected raw backing fields. Both latest and version snapshots preserve captured task execution state.
- Company-branded print preview, Gregorian/Hijri date, landscape print CSS, repeating table headings, signature spaces and preservation of legacy content. Existing QWeb HTML report includes structured draft/final content and execution periods.

## Fresh verification

- Contracts: 157 tests passed.
- Web: 707 tests passed across 120 files, including existing editor/navigation/permission regressions and new minutes/timeline cases.
- Contract TypeScript build, web vue-tsc and Nuxt production build passed. Ruff and git diff checks passed. After the final display-only refinement, 29 focused editor/navigation/minutes tests and vue-tsc passed again.
- Isolated Odoo DB `webvue_meeting_workspace_test_20260909`: 84 meeting/history/permission/series tests passed. After event-label refinement, all 9 workspace tests passed again.
- Preview DB `webvue_filter_card_20260909` backed up before upgrade; main `odoo19` was not used for tests or modified by this task.
- Browser: collapsed filters, previous/next timeline selection, minutes editing and ordinary save return route, event history and version preview checked. Full chairperson input saved and read back through HTTP; legacy agenda and recommendation IDs retained; the previous version kept the original name.
- Verified history layout at 390px and desktop width; browser emulation was reset afterward.
- Actual QWeb report HTML returned 200 and contained the structured form, execution period and legacy agenda.

## Print limitation

Actual paginated PDF generation is unverified: wkhtmltopdf is absent locally and the embedded browser reports “Printing is not available” for Page.printToPDF. Print media layout and report HTML were verified. Browser print/Save as PDF should be used in a browser with printing support; this is not a verified server-PDF delivery.

## Review fixtures and evidence

- Periodic meeting preview: http://127.0.0.1:3969/meetings/series/324
- Minutes preview: http://127.0.0.1:3969/meetings/3180?tab=minutes
- Events/versions: same meeting, `tab=history` / `tab=versions`.
- Scratch evidence: `/tmp/webvue-meeting-workspace/` includes logs, pre-upgrade backup, runtime fixtures, QWeb HTML and screenshots. Fixtures are synthetic and isolated.

No commit, merge, push, deployment or worktree cleanup was performed for this task. Canonical main advanced independently from 5665902 to 508d256 (company/personal appearance settings). This candidate needs reconciliation against latest main before any future authorized merge.
