> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Shared sidebar create action

Implemented uncommitted in `/Users/tariq/code/nasq-sidebar-create`, branch `codex/sidebar-create`, based on main `810c21a`. No commit, merge or deployment.

`SidebarCreateAction.vue` owns the transparent brand-text Plus link, bottom separator only (no enclosing border or rounded corners), hover and active presentation. The user's final visual revision keeps the background transparent on hover and selection, emphasizing the bottom line. ContextSidebar places creation below its heading and before section links. Projects creation now precedes statistics; Tasks gains task creation. Chat, Meetings and HR employee/department/document creation use the same component, subject to existing capabilities. Settings and project detail contexts do not gain unrelated creation actions. Task return guards now allow the archived task list so cancellation/back preserves that context. Existing page header actions remain unchanged.

Fresh verification:

- `npm test`: 128 contracts and 615 web tests passed.
- `npm -w apps/web run lint`: exit 0.
- `npm run build`: exit 0.
- `git diff --check`: exit 0.
- Independent read-only review found the archived-task return issue; it was corrected in task creation/detail guards and verified by the coordinator.
- Mocked browser check covered seven module/HR creation destinations, first-link position, transparent resting background, task creation and return links including archived filters, department-filtered document creation, mobile Chat root link retention, no fake Settings action, and widths 390/768/1440 with no document overflow or page errors. Cream mode with teal institution branding was visually inspected.

Preview `http://127.0.0.1:3499` uses mock upstream `4499`, fake database name `nasq_ui_mock_only`, and mock login admin/admin. No Odoo database was tested or mutated. Logs, scripts and screenshots are under `/tmp/nasq-sidebar-create/`. These checks establish the mocked UI layer, not backend acceptance or deployment. Canonical main remains unchanged.
