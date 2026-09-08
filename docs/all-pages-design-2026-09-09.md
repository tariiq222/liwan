# توحيد وضوح أقسام الصفحات — 2026-09-09

تطبيق توجيه المستخدم بتعميم التصميم المنظم على واجهة نسق. تستخدم الأقسام رؤوسًا محايدة واضحة، وتجمع بيانات السجل وإجراءاته، وتبقي الجداول والتقويم قابلة للتمرير الداخلي.

## النطاق

حُصرت 88 صفحة: 32 مشاريع، 32 موارد بشرية وإدارة، و24 عامة. التغطية مراجعة للمصدر والمكونات التي تملك العرض؛ لا تعني مشاهدة 88 صفحة ببيانات فعلية في المتصفح. الصفحات المتوافقة أو المستفيدة من المكونات المشتركة لا تحتاج تعديل ملفها مباشرة. تشمل التعديلات السابقة المحفوظة تفاصيل الاجتماع والمهمة.

لم تتغير عقود API أو إضافات Odoo أو بيانات الأعمال أو منح الصلاحيات. نُظمت واجهات الأدوار والوصول، وحُفظت شروط الحماية والمعاينة والحفظ. أضيف تعطيل تفاعل إنشاء الدور قبل اكتمال hydration وأثناء الحفظ.

## التحقق الجديد

- `npm -w apps/web run test`: 650 اختبارًا، 113 ملفًا، exit 0.
- `npm -w apps/web run lint`: vue-tsc، exit 0.
- `npm -w apps/web run build`: نجح، exit 0.
- `git diff --check`: نجح.
- تطابق قوائم التغطية مع حصر ملفات الصفحات: 88/88 بلا تكرار.
- فحص تحميل وعرض أولي لـ26 مسارًا بثلاثة عروض 390/768/1440 (78 قياسًا)، دون تجاوز أفقي للمستند. هذه قياسات التخطيط الأولي، وبعضها أثناء تحميل بيانات السجل.
- فحص إضافي بعد تحميل البيانات: الاجتماع 1، ملف الموظف 1، المشروع 1 والانتقال من الملخص إلى المهام، المالية، إعدادات المشاريع، إنشاء سلسلة ودور، حساب الموظف 5 وتعديل الوصول. عُرضت الأوضاع الفاتح والكريمي والداكن والخط الكبير، ثم أُعيد الفاتح والخط الصغير.
- أُصلح فقدان تباعد الحقول في نماذج السلسلة والتوصيات الذي اكتُشف بصريًا.

## حدود التحقق

لم تُنفذ عمليات حفظ أو منح صلاحيات أو حذف ضمن هذه الجولة البصرية. لم تُشغل مجموعة Playwright الكاملة أو اختبارات Odoo أو PDF أو cron. لا توجد معاينة إنجليزية جديدة لهذه الجولة. ظهرت تحذيرات hydration في سجل التطوير أثناء التنقل المتكرر؛ لم تُحسم علاقتها بخط الأساس، ولذلك لا يدّعي هذا التقرير خلو المتصفح من التحذيرات. لم تمنع الصفحات والتفاعلات المذكورة من الظهور والعمل.

العمل غير مكومت. تقدم main أثناء العمل إلى `4dc72be` من مهمة جدول الاجتماعات؛ حُفظ ذلك التغيير مع تعديلات التصميم، ولم تُحذف مساحات عمل المهمة الأخرى. لا نشر أو push.

الأدلة المحلية: `/Users/tariq/code/nasq-design-review-20260909`، وتشمل سجلات الاختبارات والأنواع والبناء، و`browser-matrix.json`، وقوائم التغطية، ولقطة الوضع الداكن.

## سجل تغطية المصدر

| ملف الصفحة | المعالجة | السبب |
| --- | --- | --- |
| `project-templates/[id]/apply.vue` | already | Internal apply form already uses page header, guarded state, unsaved-change protection, and a bounded form surface. |
| `project-templates/[id]/edit.vue` | already | Internal edit form already uses page state, return navigation, permission gating, and the shared template editor. |
| `project-templates/[id].vue` | changed | Template summary and definition areas now have explicit panel headers, labeled metrics, and bounded content bodies. |
| `project-templates/index.vue` | already | Catalog already follows list header, shared filter bar, retryable state, cards, and preserved pagination. |
| `project-templates/new.vue` | already | Create route already uses a dedicated form page, permission state, shared editor, and unsaved-change guard. |
| `projects/[id]/charter.vue` | already | Project file already separates read and edit modes, uses shared page state and charter form, and keeps print behavior. |
| `projects/[id]/finance/[entryId]/edit.vue` | already | Finance edit route already uses an internal form page, guarded state, refresh recovery, and shared finance form sections. |
| `projects/[id]/finance/[entryId].vue` | changed | Finance detail now presents the amount summary in an explicit panel header and a separate metadata body. |
| `projects/[id]/finance/new.vue` | already | Finance creation already has a dedicated page, return link, permission/error states, and shared form composition. |
| `projects/[id]/finance.vue` | already | Finance list already uses summary metrics, shared filter toolbar, bounded table overflow, pagination, and capability-gated actions. |
| `projects/[id]/milestones/[milestoneId]/edit.vue` | already | Milestone edit already uses an internal form route, shared state, bounded form card, and inline delete confirmation. |
| `projects/[id]/milestones/new.vue` | already | Milestone create already uses the shared form page recipe and project permission/error guards. |
| `projects/[id]/raci.vue` | changed | RACI legend, empty state, and inline delete confirmation now use explicit panel headers and bounded bodies while the matrix keeps horizontal scrolling. |
| `projects/[id]/register/[registerId]/edit.vue` | already | Register edit already uses internal navigation, permission state, and shared form sections. |
| `projects/[id]/register/[registerId].vue` | changed | Register detail now separates summary, description, and response plan into titled panel headers and bodies. |
| `projects/[id]/register/index.vue` | changed | Register list now frames the data table with a titled panel body and bounded horizontal overflow. |
| `projects/[id]/register/new.vue` | already | Register creation already uses an internal form page, capability gate, shared form, and return navigation. |
| `projects/[id]/schedule/tasks/[taskId].vue` | already | Schedule task edit already uses a dedicated page, guarded state, bounded form, and shared unsaved-change protection. |
| `projects/[id]/schedule.vue` | already | Schedule already combines the project context header, view switch, retryable state, and the bounded Gantt surface. |
| `projects/[id]/settings.vue` | already | Project settings already use a dedicated form route, scope explanation, permission guard, and shared settings form sections. |
| `projects/[id]/stakeholders/[stakeholderId]/edit.vue` | already | Stakeholder edit already uses internal navigation, permission state, and shared form sections. |
| `projects/[id]/stakeholders/[stakeholderId].vue` | changed | Stakeholder identity and contact information now use explicit panel headers with separate readable bodies. |
| `projects/[id]/stakeholders/index.vue` | changed | Stakeholder list now frames its table with a titled panel header and padded body while keeping filter and pagination controls. |
| `projects/[id]/stakeholders/new.vue` | already | Stakeholder creation already uses an internal form page, capability guard, shared form sections, and return navigation. |
| `projects/[id]/tasks/[taskId].vue` | shared | Nested task details reuse the existing shared TaskDetailPage; task components are outside this package ownership. |
| `projects/[id]/tasks/new.vue` | already | Task creation already uses the internal form page recipe, project guards, shared task form, and preserved return context. |
| `projects/[id]/updates/index.vue` | already | Updates list already delegates timeline rows to the shared project update component and keeps a capability-gated create action. |
| `projects/[id]/updates/new.vue` | already | Update creation already uses an internal page, project permission state, shared form, and preserved return navigation. |
| `projects/[id].vue` | changed | Project task workspace now gives the task section an accessible heading and a bounded content region around the task controls and views. |
| `projects/dashboard.vue` | changed | Dashboard analytics error and empty states now use the same titled panel anatomy as the chart and recent-project surfaces. |
| `projects/index.vue` | already | All-projects list already uses shared header, filter/view toolbar, responsive table/cards, result count, pagination, and preserved query links. |
| `projects/new.vue` | already | Project creation already uses a dedicated internal form page, permission state, shared charter form, and return navigation. |
| `account.vue` | changed | Kept the account and password panels while strengthening their section headings. |
| `hr/departments/[departmentId]/documents/[documentId]/edit.vue` | changed | Uses the edit workflow title and existing unsaved form sections. |
| `hr/departments/[departmentId]/documents/[documentId].vue` | changed | Groups the document reader under a visible content section. |
| `hr/departments/[departmentId]/documents/new.vue` | already | Already uses an internal page, page header, state, permission gate, and form component. |
| `hr/departments/[departmentId]/edit.vue` | already | Already uses the form page recipe, inline state, back preservation, and unsaved form component. |
| `hr/departments/[departmentId].vue` | changed | Separates department overview metadata from the document list with panel headers. |
| `hr/departments/index.vue` | changed | Root page now starts with its single title and keeps filters and views as data tools. |
| `hr/departments/new.vue` | already | Already uses the shared form page and internal return route. |
| `hr/documents/index.vue` | changed | Root page removes generic repeated description and bounds the table with horizontal overflow. |
| `hr/documents/new.vue` | already | Already uses a form section, department state, hydration gate, and internal return route. |
| `hr/employees/[employeeId]/access.vue` | redirect | Correctly redirects this access entry point to the settings account workflow while preserving return context. |
| `hr/employees/[employeeId]/edit.vue` | already | Already uses the shared form page, state, back preservation, and employee form sections. |
| `hr/employees/[employeeId].vue` | changed | Adds explicit overview and account panel headers without changing employee data or access behavior. |
| `hr/employees/new.vue` | already | Already uses the shared form page, employee form, cancel route, and capability handling. |
| `hr/index.vue` | changed | Root page now starts with its single title while keeping the directory filters and actions. |
| `settings/access-log/[eventId].vue` | changed | Adds a clear heading to the audit event section while preserving before and after data. |
| `settings/access-log/index.vue` | already | Already uses settings layout, filter surface, audit table, pagination, and permission gates. |
| `settings/appearance.vue` | already | Already composes appearance and branding sections through shared settings forms. |
| `settings/branding.vue` | redirect | Compatibility route intentionally redirects to the merged appearance branding section. |
| `settings/projects/catalogs/[resource]/[referenceId]/edit.vue` | already | Already uses an internal settings form route, protected state, return preservation, and unsaved form component. |
| `settings/projects/catalogs/[resource]/index.vue` | already | Already uses shared header, filter bar, bounded list, pagination, and inline destructive confirmation. |
| `settings/projects/catalogs/[resource]/new.vue` | already | Already uses protected internal creation route, shared form component, and preserved return route. |
| `settings/projects.vue` | already | Already delegates the settings sections to ProjectSettingsForm and keeps catalog links separate. |
| `settings/roles/[roleId]/edit.vue` | already | Already uses protected detail form state, internal back route, and shared role form. |
| `settings/roles/[roleId]/index.vue` | changed | Makes assigned users a distinct headed section while preserving role actions and capability data. |
| `settings/roles/index.vue` | changed | Root page now starts with its single title while retaining filters, pagination, and permission gates. |
| `settings/roles/new.vue` | changed | Groups role identity and permission selection into shared form sections and gates first interaction on hydration. |
| `settings/users/[userId]/access.vue` | already | Already uses protected internal access workflow, shared state, return route, and UserAccessForm. |
| `settings/users/[userId]/index.vue` | changed | Uses stronger section headers for account, roles/scopes, and capabilities without changing access data. |
| `settings/users/[userId]/security.vue` | already | Already uses protected internal security workflow, shared state, inline confirmations, and success feedback. |
| `settings/users/index.vue` | changed | Root page now starts with its single title while retaining filters, table, pagination, and access gates. |
| `settings/users/new.vue` | changed | Groups employee, role, password, and resulting-capability areas into shared form sections without changing grant logic. |
| `archived-tasks.vue` | already | List page already uses SharedPageHeader, SharedPageState, a bounded panel, preserved query filters, and hydrated restore actions. |
| `chat/[id]/index.vue` | already | Delegates to the dedicated ChatWorkspace route while preserving direct conversation loading and access handling. |
| `chat/[id]/info.vue` | already | Uses an internal page header with back navigation and SharedFormSection blocks for members and attachments. |
| `chat/index.vue` | already | Dedicated chat workspace is intentionally a compact conversation surface rather than a generic card layout. |
| `chat/new.vue` | changed | Grouped recipient selection and optional group naming with SharedFormSection, clearer selected state, focus feedback, and wrapped pagination controls. |
| `index.vue` | redirect | Access-aware root redirect intentionally renders no business surface. |
| `login.vue` | already | Standalone authentication surface keeps its existing auth, MFA, hydration, and error behavior. |
| `meetings/[id]/edit.vue` | already | Form already groups schedule, people, agenda, and minutes with SharedFormSection and shared unsaved-change protection. |
| `meetings/[id]/resolutions/[resolutionId]/edit.vue` | changed | Decision fields now have a meaningful recommendations section while execution notes retain their existing section and capability gate. |
| `meetings/[id]/resolutions/new.vue` | changed | Recommendation fields are grouped in a SharedFormSection while preserving responsible-person validation and the internal return route. |
| `meetings/[id].vue` | already | Existing approved detail layout has distinct summary, agenda, minutes, recommendations, attachments, and historical sections. |
| `meetings/calendar.vue` | changed | Calendar grid now has an internal horizontal scroll surface and focus-visible meeting links so narrow screens do not compress or leak the document. |
| `meetings/index.vue` | changed | Meeting table is bounded by an internal horizontal scroll wrapper at narrow widths while keeping filters, pagination, and route return state. |
| `meetings/new.vue` | already | Form already separates schedule, attendees, and agenda with shared sections and preserves series defaults and unsaved changes. |
| `meetings/series/[id].vue` | changed | Series metadata now has a distinct panel header and occurrence rows wrap long names and status data with keyboard focus feedback. |
| `meetings/series/index.vue` | changed | Series list rows now wrap long content, retain readable alignment, and expose visible keyboard focus. |
| `meetings/series/new.vue` | changed | Series creation now groups schedule/recurrence and people fields with SharedFormSection without changing recurrence or save behavior. |
| `notification-digests/[id].vue` | already | Digest detail uses an internal page header, bounded scrollable task list, retry states, and preserved back navigation. |
| `notifications.vue` | already | Full notification page already uses bounded scrolling, distinct unread semantics, retry/load-more states, and real destination actions. |
| `reports.vue` | redirect | Legacy reports route intentionally redirects to the project statistics dashboard while preserving query parameters. |
| `search.vue` | already | Search page has an internal header, grouped navigation/project results, scoped loading/error states, and query-preserving back behavior. |
| `tasks/[id].vue` | already | Task detail delegates to the approved TaskDetails composition with distinct data sections, actions, and preserved list context. |
| `tasks/new.vue` | already | Internal create route uses SharedPageHeader, a bounded form surface, TaskCreateForm, and return-to query preservation. |
| `tasks.vue` | already | Task list already uses the shared header, toolbar, table/board semantics, capability-gated creation, hydration protection, and query-preserving navigation. |
