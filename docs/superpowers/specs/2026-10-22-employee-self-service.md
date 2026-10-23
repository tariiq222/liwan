# Employee self-service

Owner-approved direction: conversation 01a16432, 2026-10-22. The owner approved the layout and then chose the name **الخدمة الذاتية** instead of صفحتي/ملفي. English: Self-service.

## Outcome

Clicking the signed-in employee's name/avatar opens `/account`, their own employment services. This applies equally to HR staff, finance, reception and project managers. Work tasks and work requests/documents stay in their applications. Administrative HR actions stay in HR; remove its own-assets/own-payslips subsection.

The account landing page has identity, relevant attention, leave balance, own personal requests and upcoming schedule; other available services are reachable from a stable local navigation. Destinations: overview, profile, leave, requests, pay, assets, documents, schedule, settings. The owner's six content groups are preserved; assets/documents/schedule are separate direct destinations. Arabic subtitle: بياناتك وخدماتك الوظيفية في مكان واحد.

## Interaction

- Use the existing shell context navigation on desktop and the existing mobile section selector/drawer. Do not introduce another shell or horizontal overflowing tabs.
- Data/actions appear only with their application feature, capability and record access. Empty data, no employee linkage, unavailable feature and request failure are distinct states. No fake runtime data.
- Every detail/create route supports direct entry, refresh and Back. Reuse the route-backed create panel and existing record components.
- Personal settings contain existing password, language, theme, font size and sign-out controls. Preserve existing persistence and logout cleanup.
- Leave: own balance and requests; new leave uses own identity. HR management views are separate. Show actual backend status, never claim payment or approval absent from data.
- Requests: employee affairs only. Explicit process purpose `work | employee`; snapshot onto requests. Existing processes default to work. An author's work request does not become a personal employee request.
- Documents: explicit employee relationship in the documents–HR bridge. Existing visibility/grants and current-company checks still apply. Do not classify all accessible documents as personal or introduce a second file engine.
- Pay: existing own approved payslips; no amount shown on the landing summary. Keep payroll feature/capability protection independent of general HR access.
- Profile: resolve current user's employee in the current company on the server. Do not scan the employee directory or confuse employee and user IDs. Display only approved fields. Editable actions only where a real allowed mutation exists.
- Customize overview card order only; navigation names/order stay stable. Preference is scoped to user and company; malformed or stale preferences fall back safely.

## Acceptance

1. Name/avatar opens Self-service; all enabled personal destinations are reachable without entering HR management.
2. An HR manager sees only their own records in Self-service; management still works in HR. Another employee/company cannot be read by changing IDs.
3. Personal vs work requests are separated by explicit purpose and remain stable if a process is reconfigured; pending administrative approvals still include authorized requests.
4. Personal documents are explicitly employee linked, restricted and only returned through ordinary authorized access; contracts/files belonging to another employee are excluded.
5. Feature-disabled services neither render links nor issue summary requests. Missing employee linkage is explained.
6. No old personal HR navigation, stale links, duplicate data stores or dead services page remain. Work tasks remain work.
7. Focused unit/contracts/Odoo tests plus integrated type/policy checks and live desktop/mobile acceptance pass. Record anything unavailable separately.

## Authorization and preservation

Implement in existing integration worktree; preserve the pre-existing rail/launcher changes. No commit, push, branch merge, release, production operation, branch/worktree cleanup or new paid service is authorized by this specification. No payroll/private data in general profile responses; no new sudo bypass.

## Subsequent delivery authorization

On 2026-10-22 the owner requested a local commit of the completed work. This supersedes the earlier no-commit boundary for this delivery only. Push, merge, deployment and cleanup remain outside this authorization.
