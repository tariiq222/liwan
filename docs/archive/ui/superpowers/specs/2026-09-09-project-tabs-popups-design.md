> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Project tabs and popups

> تاريخي. السياسة الحالية: [DESIGN.md](../../../../../DESIGN.md). لا تغميق/شيت بلا خلفية ولا حصر بالمشاريع — أُلغيا لاحقًا.

Approved by user in this conversation: practical tabs and popups across projects first, shortest workflows; other modules later. This explicitly overrides former no-popup project workflow policy.

Project list offers All/My tabs with existing filters. Project opens task workspace with direct tabs: tasks, summary, milestones, stakeholders/RACI, risks, finance, charter, settings. Keep workspace mounted beneath one route-backed dialog for item/create/edit workflows. Existing URLs continue to work; fullPage=1 requests standalone route. Direct popup links reconstruct correct parent context. Close and browser navigation preserve filters and scrolling. Existing dirty guards protect drafts on any navigation. No stacked business dialogs.

Reuse current routed content and permission-aware forms rather than fork business logic. Condensed project creation keeps required basics visible and optional charter sections collapsible. Task creation keeps existing atomic create behavior and date/milestone policy; the current create API does not accept assignee/priority, so those remain in detail editing. Detailed editing remains within the same dialog. Project templates belong to project creation/list context. Institution settings and all other modules retain current presentation.

Final approved presentation: a full-height Side Sheet attached to the MAIN MODULE RAIL, not the contextual sidebar. It begins beneath the header, can cover the contextual sidebar, and extends left by a content-appropriate width. There is no dimming backdrop. It enters from the right and leaves toward the left, clipped to the workspace below the header. Respect reduced motion. Header and module navigation remain usable; only the retained background work area is inert. This is the final presentation for the Projects pilot.

Acceptance: list to project to record; Side Sheet aligned with the module rail, safe close/Escape/back, focus restoration, direct URL/reload, no duplicate forms exposed, save updates current data, denied/error remain explicit; Arabic/English and theme support; local tests/build/browser evidence. No commit/merge/deploy authorized.
