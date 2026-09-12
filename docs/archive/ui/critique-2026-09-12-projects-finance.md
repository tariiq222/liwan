---
target: "http://localhost:3000/projects/40/finance"
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "url:http://localhost:3000/projects/40/finance"
timestamp: 2026-09-12T09-22-45Z
slug: localhost-projects-40-finance
---
# Critique: `/projects/:id/finance`

**Target:** `http://localhost:3000/projects/40/finance` · `apps/web/app/pages/projects/[id]/finance.vue`
**Mode:** Operate
**Method:** dual-agent

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | KPIs paint «غير معروف» / `0.00 SR` without saying the ledger is empty; filter↔summary decoupling is stripped from the section-root header |
| 2 | Match System / Real World | 3 | Planned/actual/remaining and «قيود» match a ledger; «غير معروف» on a zero ledger is analyst-speak |
| 3 | User Control and Freedom | 3 | URL keeps filters + returnTo; no business modal; EmptyState has no control of its own |
| 4 | Consistency and Standards | 2 | Kind lives in FilterBar `#search` as `UTabs`; popover/count/trash never appear until a filter is on; dual `SharedPageContainer`; cards/table skip Nasq recipes |
| 5 | Error Prevention | 2 | Empty page still offers «مصروف جديد» equal in presence to budget; unknown KPIs look like loaded data |
| 6 | Recognition Rather Than Recall | 2 | User must recall charter ≠ ledger and that kind/search do not change the three cards |
| 7 | Flexibility and Efficiency | 2 | Search + kind always on; no sort; two create targets; kind-as-tabs is a second strip under أقسام المشروع |
| 8 | Aesthetic and Minimalist Design | 2 | Nested cards, triple «غير معروف», desktop table chrome around empty; live overlay: 5 nested-cards + cramped `nasq-ui-record-surface` |
| 9 | Error Recovery | 2 | Retry/filtered-empty exist in source; this URL has nothing to recover. Delete confirm is on the entry sheet, not this list |
| 10 | Help and Documentation | 2 | Page description suppressed on section roots; empty hint has no action; charter line is the only teaching |
| **Total** | | **22/40** | **Acceptable** |

## Design Specificity Verdict

**Start here.** Mixed. Workspace chrome is authored for Nasq (RTL identity, `nasq-ui-tab-strip`, المالية as a group root with no sub-tabs, H1 once, RecordNumber LTR, money `dir=ltr` + `tabular-nums`). The Operate body is a generic SaaS KPI strip: three equal `UCard`s, a fourth nested charter `UCard`, Nuxt `UTabs` as a kind filter, and an empty `UTable` still wearing six column headers. Nothing about planned/actual/remaining is typeset as a Nasq metric tile. Live project `E2E admin create 1788577333724` with a fully empty ledger reads as a template, not a budget desk.

**LLM assessment:** Composition is category-interchangeable below the shell. Dual plus-icon creates, three equal unknown tiles, and kind-as-tabs could sit in any admin finance module. Missed Nasq character: one metric story (budget vs spend), FilterBar popover extras, `nasq-ui-card-header` / `nasq-ui-table-head` / `nasq-ui-segment`, EmptyState as the start scene.

**Deterministic scan:** CLI `impeccable detect --json` on `finance.vue` + `components/project/finance/` exited 0 with **0 findings** (static Vue is clean). Live overlay after `detect.js` injection reported **14 anti-patterns**. Detector caught what the LLM review treated as taste: 5× nested-cards, cramped padding on `nasq-ui-record-surface`, 4.4:1 contrast (`#ffffff` on `#2c867f`, need 4.5:1), undersized functional text in the shell (company name 9.66px, «طي القائمة الجانبية» 10.5px), clipped overflow + width transitions on `aside.nasq-module-rail`. Shell hits (rail, collapse, company wordmark) are not unique to finance; nested-cards and cramped record-surface are. No CLI false positives. Overlay hits on module-rail layout-transition/clip are likely shared chrome, not this page’s layout.

**Visual overlays:** Injection succeeded on a fresh tab. Overlays were in the page (14 overlay nodes / 13 visible) with labels: low contrast text, undersized functional text, layout property animation, positioned child clipped, cramped padding, nested cards ×5.

## Overall Impression

The project-space chrome is doing its job. The finance list is not. Biggest opportunity: when the ledger is empty, stop performing a dashboard of unknowns and make one «ابدأ السجل» scene — one primary create in the empty, one quiet path to charter, no fake KPIs.

## What's Working

- Project space is correct: identity + group tabs above content, المالية has no sub-tabs, single H1, settings icon-only with aria-label.
- RecordNumber first + LTR money + mobile `<768` drops table chrome and shows EmptyState only.
- One filled primary («بند ميزانية جديد») and one outline create; FilterBar search is visible; destructive delete is inline on the entry, not a list modal.

## Priority Issues

### [P0] EmptyState has no action
- **What:** «لا قيود مالية بعد» is title+hint only. Create lives only in `SharedPageHeader`.
- **Why it matters:** Operate’s first job on a zero ledger is start. Casey never sees the CTA beside the message.
- **Fix:** Put one primary «بند ميزانية جديد» in EmptyState `#action`; keep header create.
- **Suggested command:** `$impeccable onboard`

### [P1] KPI theater of unknowns (nested cards)
- **What:** Three equal `UCard`s all saying «غير معروف», plus a nested charter `UCard` repeating «لا ميزانية محددة». Live detector: nested-cards ×5.
- **Why it matters:** Scan budget vs spend fails. Unknown tiles look like loaded data.
- **Fix:** If planned is unknown, one quiet call-to-budget (create + charter), not a 3+1 dashboard. Use Nasq metric / `nasq-ui-card-header`.
- **Suggested command:** `$impeccable distill`

### [P1] Kind filter is a second tab strip inside FilterBar
- **What:** `UTabs` (كل القيود / ميزانية / مصروف) sit in FilterBar `#search`. Default slot empty, so UPopover, count, and trash never appear until a filter is on. On 390px the three tabs wrap under search.
- **Why it matters:** Violates DESIGN.md list filters; extra decision strip under أقسام المشروع.
- **Fix:** Search only in `#search`; kind in popover or one `nasq-ui-segment` in actions.
- **Suggested command:** `$impeccable layout`

### [P2] Desktop empty still wears a six-column table
- **What:** `UTable` headers (الرقم، العنوان، النوع، المبلغ، التاريخ، بند الميزانية) wrap EmptyState. No `nasq-ui-table-head`. Detector also: cramped padding on `nasq-ui-record-surface`.
- **Why it matters:** Chrome without rows is noise; mobile already hides it.
- **Fix:** Same empty as compact path; apply quiet head when rows exist; give record-surface inset.
- **Suggested command:** `$impeccable quieter`

### [P2] Two names, two containers, 4.4:1 primary fill
- **What:** `[id].vue` and `finance.vue` each wrap `SharedPageContainer width="list"`. H1 «الميزانية والتكلفة» restates group «المالية». Overlay: `#ffffff` on `#2c867f` at 4.4:1 (need 4.5).
- **Why it matters:** Policy is one container at owner; two names for one root; DESIGN.md contrast floor fails on the filled create.
- **Fix:** One owner container; title = group name or drop H1 into identity; lift primary-fill contrast.
- **Suggested command:** `$impeccable clarify`

## Persona Red Flags

**Alex (Power User):** Cannot scan budget vs spend — planned/remaining/charter are «غير معروف», actual `0.00 SR`. Kind tabs always visible (good) but filtering will not change summary and that sentence is not on screen. Two create targets instead of one primary. Six-column empty table is a wasted scan. No utilization bar, no sort.

**Sam (Accessibility):** Kind is a `tablist` that acts as a filter. Desktop empty is a table + inner `role=status`. Compact rows are `<li @click>` with no row tabindex — only the inner title `UButton` is a nameable control. Primary fill misses 4.5:1. Shell collapse control and company wordmark render below 11px. Settings is icon-only but labeled.

**Casey (Distracted mobile):** 390×844: H1 then two wrapping CTAs, search, wrapping kind chips, three stacked unknown cards, charter card, empty below the fold. No create in the empty. Group tabs are a fifth competing strip. Distracted path is scroll-past-KPIs-and-leave.

## Minor Observations

- Live URL loaded an empty ledger; no rows, pagination, trash, or delete confirm on this list.
- `projects.finance.description` (filters do not change summary) is computed away on section roots.
- Charter CTA «عرض ملف المشروع» is an extra exit from Operate.
- Both creates use `i-lucide-plus`.
- Document title is company name, not المالية.
- Overlay also flagged module-rail clip/width transitions and body height transition — shared chrome, not finance-specific.

## Cognitive load

8/8 checklist failures (high). Decision point over 4: project group tabs (الملخص · التنفيذ · الحوكمة · المالية · التحديثات).

## Emotional journey

Peak on arrival: identity, المالية underline, H1, one filled create. Valley immediately: three identical unknown tiles, nested charter unknown, hollow table (desktop) or dashed empty (390px) with the next step stranded in the header. End is a distracted hop: pick budget vs expense from two plus buttons, or bounce to charter, without a budget-vs-spend story.

## Questions to Consider

- If the ledger is empty, why is the first screen a dashboard of unknowns instead of one «ابدأ السجل» scene?
- Why do «المالية» and «الميزانية والتكلفة» both name the same root?
- If extra filters belong in a popover, why is kind a second tab strip glued to search?
