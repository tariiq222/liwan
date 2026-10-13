# فهرس مكونات واجهة نسق

السلطة البصرية هي [DESIGN.md](../../DESIGN.md). هذا الفهرس جرد لملكية الكود
الحالي في `apps/web/app` ومساراته؛ لا يضيف سياسة ثانية، ولا مصدرًا بصريًا أو
بيانات تجريبية. المرجع البصري `/Users/tariq/Downloads/nasq-ui` للمقارنة فقط.

Storybook هو فهرس المكونات الملزم: كل وكيل يأخذ اللبنة من `apps/web/stories/<المجلد>/<المكوّن>.stories.ts` ولا ينسخها محليًا؛ المكوّن المشترك الجديد يُشحن مع قصته ويُضاف إلى القائمة الملزمة `STORYBOOK_COMPONENTS` في `tools/ui_policy.py`.

## الأساس المشترك

| المسؤولية | المكونات الفعلية | الأساس المستخدم |
| --- | --- | --- |
| الحاوية والعنوان والأقسام | `apps/web/app/components/shared/PageContainer.vue` (قصة: `apps/web/stories/shared/PageContainer.stories.ts`), `apps/web/app/components/shared/PageHeader.vue` (قصة: `apps/web/stories/shared/PageHeader.stories.ts`), `apps/web/app/components/shared/FormSection.vue` (قصة: `apps/web/stories/shared/FormSection.stories.ts`), `apps/web/app/components/shared/CreatePanel.vue` (قصة: `apps/web/stories/shared/CreatePanel.stories.ts`) | حاويات الصفحة، العنوان، أقسام النماذج، ولوحة الإنشاء (`USlideover`) |
| البحث والفلاتر والحالة | `apps/web/app/components/shared/FilterBar.vue` (قصة: `apps/web/stories/shared/FilterBar.stories.ts`), `apps/web/app/components/shared/FilterCard.vue`, `apps/web/app/components/shared/FilterField.vue` (قصة: `apps/web/stories/shared/FilterField.stories.ts`), `apps/web/app/components/shared/FilterChoice.vue` (قصة: `apps/web/stories/shared/FilterChoice.stories.ts`), `apps/web/app/components/shared/FilterChip.vue` (قصة: `apps/web/stories/shared/FilterChip.stories.ts`), `apps/web/app/components/shared/PageState.vue` (قصة: `apps/web/stories/shared/PageState.stories.ts`), `apps/web/app/components/shared/EmptyState.vue` (قصة: `apps/web/stories/shared/EmptyState.stories.ts`) | بحث، فلاتر (حقل بعنوان، اختيار مباشر، شريحة قابلة للإزالة)، تحميل، خطأ، فراغ وصلاحية |
| الحقول وحماية المسودة | `apps/web/app/components/shared/DateField.vue` (قصة: `apps/web/stories/shared/DateField.stories.ts`), `apps/web/app/components/shared/FileField.vue` (قصة: `apps/web/stories/shared/FileField.stories.ts`), `apps/web/app/components/shared/UnsavedChanges.vue` (قصة: `apps/web/stories/shared/UnsavedChanges.stories.ts`) | `DateField`: UPopover/UCalendar/UButton؛ `FileField`: UButton وحقل ملف مخفي؛ حارس المسودة |
| الإجراءات والتأكيد | `apps/web/app/components/shared/RowActions.vue` (قصة: `apps/web/stories/shared/RowActions.stories.ts`), `apps/web/app/components/shared/InlineConfirm.vue` (قصة: `apps/web/stories/shared/InlineConfirm.stories.ts`) | `RowActions`: UButton رابط لإجراء واحد أو UDropdownMenu «…» والهدّام آخرًا؛ `InlineConfirm`: UAlert subtle بالإلغاء أولًا ثم الإجراء |
| القوائم والمحتوى | `apps/web/app/components/shared/Pagination.vue` (قصة: `apps/web/stories/shared/Pagination.stories.ts`), `apps/web/app/components/shared/RichText.vue` (قصة: `apps/web/stories/shared/RichText.stories.ts`), `apps/web/app/components/shared/MetricTile.vue` (قصة: `apps/web/stories/shared/MetricTile.stories.ts`), `apps/web/app/components/shared/PersonPicker.vue` (قصة: `apps/web/stories/shared/PersonPicker.stories.ts`) | `Pagination`: UPagination مع «صفحة x من y»؛ `RichText`: HTML منقّى بتنسيق واحد؛ `MetricTile`: UCard لمؤشر واحد؛ `PersonPicker`: USelectMenu فوق `/api/v1/people` |
| هوية السجل والرسوم | `apps/web/app/components/shared/RecordNumber.vue` (قصة: `apps/web/stories/shared/RecordNumber.stories.ts`), `apps/web/app/components/shared/DashboardChart.client.vue` (قصة: `apps/web/stories/shared/DashboardChart.stories.ts`) | رقم السجل ومحولات الرسوم |
| محولات الرسوم | `apps/web/app/components/charts/ChartContainer.vue` (قصة: `apps/web/stories/charts/ChartContainer.stories.ts`), `apps/web/app/components/charts/ChartLegendContent.vue`, `apps/web/app/components/charts/ChartStyle.vue`, `apps/web/app/components/charts/ChartTooltipContent.vue` | Unovis وتوكنات الرسم المشتقة من الهوية |

## الغلاف والتنقل

| المسؤولية | المكونات الفعلية | الأساس المستخدم |
| --- | --- | --- |
| الغلاف | `apps/web/app/components/AppSidebar.vue`, `apps/web/app/components/shell/ShellHeader.vue`, `apps/web/app/components/AppAccountMenu.vue`, `apps/web/app/components/GlobalSearch.vue` | رأس واحد، الحساب، والبحث |
| التنقل | `apps/web/app/components/shell/ModuleRail.vue`, `apps/web/app/components/shell/ContextSidebar.vue`, `apps/web/app/components/shell/SidebarCreateAction.vue` (قصة: `apps/web/stories/shell/SidebarCreateAction.stories.ts`), `apps/web/app/components/shell/MobileNavigation.vue` | شريط الوحدات، السياق، الإنشاء؛ `MobileNavigation`: USlideover/UButton |
| مساحة المشروع | `apps/web/app/components/project/workspace/ProjectWorkspaceTabs.vue` (قصة: `apps/web/stories/project/ProjectWorkspaceTabs.stories.ts`), `apps/web/app/components/project/workspace/ProjectGovernanceTabs.vue` (قصة: `apps/web/stories/project/ProjectGovernanceTabs.stories.ts`) | تبويبات المشروع وتبويبات الحوكمة الفرعية |

## المشاريع والمهام

| السطح | المكونات الفعلية | المسؤولية الحالية |
| --- | --- | --- |
| قوائم المشاريع وملخصها | `apps/web/app/components/project/ProjectTable.vue`, `apps/web/app/components/project/ProjectCards.vue`, `apps/web/app/components/project/ProjectStatusBadge.vue` (قصة: `apps/web/stories/project/ProjectStatusBadge.stories.ts`), `apps/web/app/components/project/ProjectStatusSelect.vue`, `apps/web/app/components/project/ProjectOverview.vue`, `apps/web/app/components/project/ProjectOverviewTasks.vue`, `apps/web/app/components/project/ProjectProgress.vue` | عرض السجلات والحالة والملخص والتقدم |
| نماذج المشروع وإعداداته | `apps/web/app/components/project/ProjectCreateForm.vue`, `apps/web/app/components/project/ProjectGeneralForm.vue`, `apps/web/app/components/project/ProjectSettingsForm.vue`, `apps/web/app/components/project/ProjectUpdateForm.vue`, `apps/web/app/components/project/StageListEditor.vue`, `apps/web/app/components/settings/ProjectSettingsForm.vue` | الإنشاء والتحرير والمراحل والإعدادات |
| ملف المشروع والحوكمة | `apps/web/app/components/project/ProjectCharterDisplay.vue`, `apps/web/app/components/project/ProjectCharterFields.vue`, `apps/web/app/components/project/ProjectCharterRows.vue`, `apps/web/app/components/project/ProjectCharterForm.vue` (قصة: `apps/web/stories/project/ProjectCharterForm.stories.ts`؛ معالج الميثاق على خطوات يحددها التصنيف مع حفظ المسودة), `apps/web/app/components/project/governance/StakeholderForm.vue`, `apps/web/app/components/project/governance/RegisterForm.vue`, `apps/web/app/components/project/FollowerList.vue`, `apps/web/app/components/project/ProjectFieldHelp.vue` (قصة: `apps/web/stories/project/ProjectFieldHelp.stories.ts`) | الملف، أصحاب المصلحة، السجل، المتابعون والمساعدة |
| الجدول الزمني والمعالم | `apps/web/app/components/project/schedule/ScheduleGantt.vue`, `apps/web/app/components/project/schedule/ScheduleTaskForm.vue`, `apps/web/app/components/project/MilestoneTable.vue`, `apps/web/app/components/project/MilestoneForm.vue` | الجدولة والمعالم |
| المالية والقوالب | `apps/web/app/components/project/finance/FinanceBudgetPicker.vue`, `apps/web/app/components/project/finance/FinanceEntryForm.vue`, `apps/web/app/components/project/finance/FinanceEntryTable.vue`, `apps/web/app/components/project/finance/FinanceSummaryCards.vue`, `apps/web/app/components/project/templates/ProjectTemplateEditor.vue` | الميزانية والقيود والملخص وقوالب المشاريع |
| لوحة المشروع | `apps/web/app/components/project/dashboard/DashboardChartPanel.vue` (قصة: `apps/web/stories/project/dashboard/DashboardChartPanel.stories.ts`), `apps/web/app/components/project/dashboard/ProjectDashboardCharts.vue`, `apps/web/app/components/project/dashboard/ProjectDashboardMetrics.vue`, `apps/web/app/components/project/dashboard/ProjectDashboardRecentProjects.vue` | مؤشرات ورسوم وسجلات حديثة |
| إجراءات المشروع | `apps/web/app/components/project/ProjectArchiveAction.vue`, `apps/web/app/components/project/ProjectMenu.vue` (قصة: `apps/web/stories/project/ProjectMenu.stories.ts`), `apps/web/app/components/project/ProjectUpdateList.vue` | إجراءات وأحداث وتحديثات المشروع |
| قوائم المهام ولوحتها | `apps/web/app/components/task/TaskTable.vue`, `apps/web/app/components/task/TaskBoard.vue`, `apps/web/app/components/task/TaskCard.vue` (قصة: `apps/web/stories/task/TaskCard.stories.ts`), `apps/web/app/components/task/TaskToolbar.vue`, `apps/web/app/components/task/Timeline.vue` | القائمة واللوحة والخط الزمني وأدوات العرض |
| تفاصيل المهمة | `apps/web/app/components/task/TaskDetailPage.vue`, `apps/web/app/components/task/TaskDetailPanel.vue`, `apps/web/app/components/task/TaskDetails.vue`, `apps/web/app/components/task/TaskDescription.vue`, `apps/web/app/components/task/TaskActivity.vue`, `apps/web/app/components/task/TaskDeliverables.vue`, `apps/web/app/components/task/TaskAttachments.vue`, `apps/web/app/components/task/SubtaskList.vue` | التفاصيل والوصف والنشاط والمرفقات والتسليمات |
| نماذج وتحكم المهمة | `apps/web/app/components/task/TaskCreateForm.vue`, `apps/web/app/components/task/StateBadge.vue` (قصة: `apps/web/stories/task/StateBadge.stories.ts`), `apps/web/app/components/task/StateMenu.vue` (قصة: `apps/web/stories/task/StateMenu.stories.ts`), `apps/web/app/components/task/PrioritySelect.vue` (قصة: `apps/web/stories/task/PrioritySelect.stories.ts`), `apps/web/app/components/task/AssigneePicker.vue`, `apps/web/app/components/task/TagPicker.vue` (قصة: `apps/web/stories/task/TagPicker.stories.ts`), `apps/web/app/components/task/MilestoneSelect.vue`, `apps/web/app/components/task/DeadlineBadge.vue` (قصة: `apps/web/stories/task/DeadlineBadge.stories.ts`), `apps/web/app/components/task/DependencyPicker.vue`, `apps/web/app/components/task/TaskCompletionApproval.vue`, `apps/web/app/components/task/CommentComposer.vue`, `apps/web/app/components/task/DescriptionEditor.vue` (قصة: `apps/web/stories/task/DescriptionEditor.stories.ts`) | الحقول والحالة والمكلّف والانتقالات والتعليقات |

## الاجتماعات والمحادثات والإشعارات

| السطح | المكونات الفعلية | المسؤولية الحالية |
| --- | --- | --- |
| الاجتماعات | `apps/web/app/components/meetings/MeetingEventList.vue`, `apps/web/app/components/meetings/MeetingMinutesDocument.vue`, `apps/web/app/components/meetings/MeetingMinutesForm.vue`, `apps/web/app/components/meetings/MeetingPeopleFields.vue` (قصة: `apps/web/stories/meetings/MeetingPeopleFields.stories.ts`), `apps/web/app/components/meetings/MeetingProjectFilter.vue` (قصة: `apps/web/stories/meetings/MeetingProjectFilter.stories.ts`), `apps/web/app/components/meetings/MeetingTimeline.vue`, `apps/web/app/components/meetings/MeetingVersionList.vue` | الحدث، الأشخاص، المشروع، المحضر، الخط الزمني والنسخ |
| المحادثات | `apps/web/app/components/chat/ChatAttachment.vue` (قصة: `apps/web/stories/chat/ChatAttachment.stories.ts`), `apps/web/app/components/chat/ChatWorkspace.vue`, `apps/web/app/components/chat/ConversationList.vue`, `apps/web/app/components/chat/MessageComposer.vue`, `apps/web/app/components/chat/MessageHistory.vue` | مساحة المحادثة والرسائل والمرفقات |
| الإشعارات | `apps/web/app/components/notifications/NotificationCenter.vue` | مركز الإشعارات |

## المؤسسة والوصول والحساب

| السطح | المكونات الفعلية | المسؤولية الحالية |
| --- | --- | --- |
| دليل المؤسسة | `apps/web/app/components/hr/DirectoryTable.vue`, `apps/web/app/components/hr/EmployeeCard.vue`, `apps/web/app/components/hr/AccessBadge.vue` (قصة: `apps/web/stories/hr/AccessBadge.stories.ts`), `apps/web/app/components/hr/EmployeeGeneralForm.vue` | الموظفون والحالة ونموذج البيانات العامة |
| الهيكل والمستندات | `apps/web/app/components/hr/DepartmentTree.vue`, `apps/web/app/components/hr/DepartmentOrgChart.vue`, `apps/web/app/components/hr/DepartmentTable.vue`, `apps/web/app/components/hr/DepartmentForm.vue`, `apps/web/app/components/hr/DocumentList.vue`, `apps/web/app/components/hr/DocumentReader.vue`, `apps/web/app/components/hr/DocumentEditor.vue`, `apps/web/app/components/hr/DocumentCreateForm.vue` | الأقسام والمستندات والإنشاء والتحرير |
| إدارة الوصول | `apps/web/app/components/access/AccessStateBadge.vue` (قصة: `apps/web/stories/access/AccessStateBadge.stories.ts`), `apps/web/app/components/access/audit/AuditTable.vue`, `apps/web/app/components/access/roles/RolePermissionForm.vue`, `apps/web/app/components/access/roles/RoleTable.vue`, `apps/web/app/components/access/users/UserAccessForm.vue`, `apps/web/app/components/access/users/UserSecurityForm.vue`, `apps/web/app/components/access/users/UserTable.vue` | المستخدمون والأدوار والصلاحيات والتدقيق |
| الإعدادات والحساب | `apps/web/app/components/settings/SettingsLayout.vue` (قصة: `apps/web/stories/settings/SettingsLayout.stories.ts`), `apps/web/app/components/shell/AppearanceMenu.vue` (قائمة المظهر في الهيدر: وضع العرض وحجم الخط لكل مستخدم), `apps/web/app/components/settings/BrandingForm.vue`, `apps/web/app/components/settings/BrandingPreview.vue`, `apps/web/app/components/settings/ProjectCharterReferenceForm.vue`, `apps/web/app/components/account/PasswordForm.vue` | المظهر والهوية وإعدادات المشروع وكلمة المرور |
| المهام الشخصية | `apps/web/app/components/my-tasks/MyTaskRow.vue` | صف قائمة «مهامي»: العنوان والحالة والأولوية والموعد والمكلّفون، ويربط مهمة المشروع بمسارها من الخادم |

## قاعدة التسجيل

استخدم مكونات Nuxt UI مباشرة عندما تكفي. أي مكوّن مركب جديد يسجل هنا بمساره
الكامل ووظيفته ومكونات الأساس التي يستخدمها؛ ويكفي هذا الجرد لتلبية تسجيل
المسار في `tools/ui_policy.py`.

تبقى خصائص Nuxt UI و`props` و`emits` و`slots` و`data-testid` والعقود والصلاحيات
ملكًا للمكوّن الحالي. التوثيق لا يثبت قبولًا بصريًا أو سلوكيًا أو جاهزية نشر.


## مكونات الإدارة والاشتراك التجاري — 2026-10-04

الجرد التالي مشتق من المكونات والقصص الموجودة في المصدر الموحّد. الخصائص والأحداث والتفاصيل في `catalog.json` المولّد؛ وجود القصة لا يثبت اكتمال بوابات قبول المنتج.

| المكوّن | القصة | مكونات الأساس المستخدمة فعليًا |
| --- | --- | --- |
| `apps/web/app/components/vendor/BundleForm.vue` | `apps/web/stories/vendor/BundleForm.stories.ts` | `SharedFormSection`, `SharedUnsavedChanges`, `UAlert`, `UButton`, `UCheckbox`, `UFormField`, `UIcon`, `UInput`, `USelect`, `UTextarea` |
| `apps/web/app/components/vendor/CapacityLimitsEditor.vue` | `apps/web/stories/vendor/CapacityLimitsEditor.stories.ts` | `UFormField`, `UInput`, `USelect` |
| `apps/web/app/components/vendor/CustomerTermsForm.vue` | `apps/web/stories/vendor/CustomerTermsForm.stories.ts` | `SharedFormSection`, `SharedUnsavedChanges`, `UAlert`, `UButton`, `UFormField`, `UInput`, `USelect`, `UTextarea` |
| `apps/web/app/components/vendor/EntitlementSummary.vue` | `apps/web/stories/vendor/EntitlementSummary.stories.ts` | `UBadge` |
| `apps/web/app/components/vendor/InvoiceLines.vue` | `apps/web/stories/vendor/InvoiceLines.stories.ts` | `UBadge` |
| `apps/web/app/components/vendor/LifecycleBadge.vue` | `apps/web/stories/vendor/LifecycleBadge.stories.ts` | `UBadge` |
| `apps/web/app/components/vendor/LifecyclePanel.vue` | `apps/web/stories/vendor/LifecyclePanel.stories.ts` | `SharedFormSection`, `SharedInlineConfirm`, `SharedUnsavedChanges`, `UAlert`, `UButton`, `UFormField`, `UTextarea` |
| `apps/web/app/components/vendor/OrderStateBadge.vue` | `apps/web/stories/vendor/OrderStateBadge.stories.ts` | `UBadge` |
| `apps/web/app/components/vendor/PlanForm.vue` | `apps/web/stories/vendor/PlanForm.stories.ts` | `SharedFormSection`, `SharedUnsavedChanges`, `UAlert`, `UButton`, `UCheckbox`, `UFormField`, `UInput`, `USelect`, `UTextarea` |
| `apps/web/app/components/vendor/PriceBreakdown.vue` | `apps/web/stories/vendor/PriceBreakdown.stories.ts` | `UAlert`, `UButton` |
| `apps/web/app/components/vendor/PriceListEditor.vue` | `apps/web/stories/vendor/PriceListEditor.stories.ts` | `UButton`, `UFormField`, `UInput`, `USelect` |
| `apps/web/app/components/vendor/SubscriptionSummary.vue` | `apps/web/stories/vendor/SubscriptionSummary.stories.ts` | `UAlert`, `UBadge` |
| `apps/web/app/components/vendor/UsageMeters.vue` | `apps/web/stories/vendor/UsageMeters.stories.ts` | `UBadge`, `UProgress` |
| `apps/web/app/components/subscription/AutoRenewControl.vue` | `apps/web/stories/subscription/AutoRenewControl.stories.ts` | `UBadge`, `UButton`, `UCheckbox` |
| `apps/web/app/components/subscription/BranchSummary.vue` | `apps/web/stories/subscription/BranchSummary.stories.ts` | `UBadge` |
| `apps/web/app/components/subscription/InvoiceLines.vue` | `apps/web/stories/subscription/InvoiceLines.stories.ts` |  |
| `apps/web/app/components/subscription/StateBadge.vue` | `apps/web/stories/subscription/StateBadge.stories.ts` | `UBadge` |
| `apps/web/app/components/subscription/UsagePanel.vue` | `apps/web/stories/subscription/UsagePanel.stories.ts` | `UBadge` |
