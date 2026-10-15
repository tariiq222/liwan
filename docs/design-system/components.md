# فهرس مكونات واجهة نسق

السلطة البصرية هي [DESIGN.md](../../DESIGN.md). هذا الفهرس جرد لملكية الكود
الحالي في `apps/web/app` ومساراته؛ لا يضيف سياسة ثانية، ولا مصدرًا بصريًا أو
بيانات تجريبية. المرجع البصري `/Users/tariq/Downloads/nasq-ui` للمقارنة فقط.

Storybook هو فهرس المكونات الملزم: كل وكيل يأخذ اللبنة من `apps/web/stories/<المجلد>/<المكوّن>.stories.ts` ولا ينسخها محليًا؛ المكوّن المشترك الجديد يُشحن مع قصته ويُضاف إلى القائمة الملزمة `STORYBOOK_COMPONENTS` في `tools/ui_policy.py`.

## الأساس المشترك

| المسؤولية | المكونات الفعلية | الأساس المستخدم |
| --- | --- | --- |
| الحاوية والعنوان والأقسام | `apps/web/app/components/shared/PageContainer.vue` (قصة: `apps/web/stories/shared/PageContainer.stories.ts`), `apps/web/app/components/shared/PageHeader.vue` (قصة: `apps/web/stories/shared/PageHeader.stories.ts`), `apps/web/app/components/shared/FormSection.vue` (قصة: `apps/web/stories/shared/FormSection.stories.ts`), `apps/web/app/components/shared/CreatePanel.vue` (قصة: `apps/web/stories/shared/CreatePanel.stories.ts`) | حاويات الصفحة، العنوان، أقسام النماذج، ولوحة الإنشاء (`USlideover`) |
| البحث والفلاتر والحالة | `apps/web/app/components/shared/FilterBar.vue` (قصة: `apps/web/stories/shared/FilterBar.stories.ts`), `apps/web/app/components/shared/FilterField.vue` (قصة: `apps/web/stories/shared/FilterField.stories.ts`), `apps/web/app/components/shared/FilterChoice.vue` (قصة: `apps/web/stories/shared/FilterChoice.stories.ts`), `apps/web/app/components/shared/FilterChip.vue` (قصة: `apps/web/stories/shared/FilterChip.stories.ts`), `apps/web/app/components/shared/PageState.vue` (قصة: `apps/web/stories/shared/PageState.stories.ts`) (واجهة رقيقة فوق LoadingSkeleton وErrorState وForbiddenState وNotFoundState وEmptyState), `apps/web/app/components/shared/EmptyState.vue` (قصة: `apps/web/stories/shared/EmptyState.stories.ts`) | بحث، فلاتر (حقل بعنوان، اختيار مباشر، شريحة قابلة للإزالة)، تحميل، خطأ، فراغ وصلاحية |
| الحقول وحماية المسودة | `apps/web/app/components/shared/DateField.vue` (قصة: `apps/web/stories/shared/DateField.stories.ts`), `apps/web/app/components/shared/FileField.vue` (قصة: `apps/web/stories/shared/FileField.stories.ts`), `apps/web/app/components/shared/UnsavedChanges.vue` (قصة: `apps/web/stories/shared/UnsavedChanges.stories.ts`), `apps/web/app/components/shared/DescriptionEditor.vue` (قصة: `apps/web/stories/shared/DescriptionEditor.stories.ts`), `apps/web/app/components/shared/TagPicker.vue` (قصة: `apps/web/stories/shared/TagPicker.stories.ts`) | `DateField`: UPopover/UCalendar/UButton؛ `FileField`: UButton وحقل ملف مخفي؛ حارس المسودة |
| الإجراءات والتأكيد | `apps/web/app/components/shared/RowActions.vue` (قصة: `apps/web/stories/shared/RowActions.stories.ts`), `apps/web/app/components/shared/InlineConfirm.vue` (قصة: `apps/web/stories/shared/InlineConfirm.stories.ts`) | `RowActions`: UButton رابط لإجراء واحد أو UDropdownMenu «…» والهدّام آخرًا؛ `InlineConfirm`: UAlert subtle بالإلغاء أولًا ثم الإجراء |
| القوائم والمحتوى | `apps/web/app/components/shared/Pagination.vue` (قصة: `apps/web/stories/shared/Pagination.stories.ts`), `apps/web/app/components/shared/RichText.vue` (قصة: `apps/web/stories/shared/RichText.stories.ts`), `apps/web/app/components/shared/MetricTile.vue` (قصة: `apps/web/stories/shared/MetricTile.stories.ts`), `apps/web/app/components/shared/PersonPicker.vue` (قصة: `apps/web/stories/shared/PersonPicker.stories.ts`) | `Pagination`: UPagination مع «صفحة x من y»؛ `RichText`: HTML منقّى بتنسيق واحد؛ `MetricTile`: UCard لمؤشر واحد؛ `PersonPicker`: USelectMenu فوق `/api/v1/people` |
| هوية السجل والرسوم | `apps/web/app/components/shared/RecordNumber.vue` (قصة: `apps/web/stories/shared/RecordNumber.stories.ts`), `apps/web/app/components/shared/DashboardChart.client.vue` (قصة: `apps/web/stories/shared/DashboardChart.stories.ts`) | رقم السجل ومحولات الرسوم |
| محولات الرسوم | `apps/web/app/components/charts/ChartContainer.vue` (قصة: `apps/web/stories/charts/ChartContainer.stories.ts`), `apps/web/app/components/charts/ChartLegendContent.vue`, `apps/web/app/components/charts/ChartStyle.vue`, `apps/web/app/components/charts/ChartTooltipContent.vue` | Unovis وتوكنات الرسم المشتقة من الهوية |
| الهوية المؤقتة | `apps/web/app/components/shared/BrandWordmark.vue` (قصة: `apps/web/stories/shared/BrandWordmark.stories.ts`) | علامة نصية `نَسَق` مع نقطة ليمون زخرفية حتى يتوفر شعار SVG؛ الوضع المعكوس للشريط الداكن |

## الغلاف والتنقل

| المسؤولية | المكونات الفعلية | الأساس المستخدم |
| --- | --- | --- |
| الغلاف | `apps/web/app/components/shell/ShellFrame.vue` (قصة: `apps/web/stories/shell/ShellFrame.stories.ts`), `apps/web/app/components/shell/AppSidebar.vue` (قصة: `apps/web/stories/shell/AppSidebar.stories.ts`), `apps/web/app/components/shell/ShellHeader.vue` (قصة: `apps/web/stories/shell/ShellHeader.stories.ts`), `apps/web/app/components/shell/ShellBreadcrumb.vue` (قصة: `apps/web/stories/shell/ShellBreadcrumb.stories.ts`), `apps/web/app/components/shell/MobileNavigation.vue` (قصة: `apps/web/stories/shell/MobileNavigation.stories.ts`), `apps/web/app/components/shell/AppearanceMenu.vue` (قصة: `apps/web/stories/shell/AppearanceMenu.stories.ts`), `apps/web/app/components/shell/AppAccountMenu.vue` (قصة: `apps/web/stories/shell/AppAccountMenu.stories.ts`), `apps/web/app/components/shell/GlobalSearch.vue` (قصة: `apps/web/stories/shell/GlobalSearch.stories.ts`) | إطار ثلاثي الطبقات؛ هيدر 48px بمسار الصفحة ولوحة الأوامر ⌘K (UCommandPalette) والحساب؛ UBreadcrumb/UBadge |
| التنقل | `apps/web/app/components/shell/ModuleRail.vue` (قصة: `apps/web/stories/shell/ModuleRail.stories.ts`), `apps/web/app/components/shell/ContextSidebar.vue` (قصة: `apps/web/stories/shell/ContextSidebar.stories.ts`), `apps/web/app/components/shell/SidebarCreateAction.vue` (قصة: `apps/web/stories/shell/SidebarCreateAction.stories.ts`), `apps/web/app/components/shell/MobileNavigation.vue` | شريط 64px ثابت، قائمة 232px بأقسام وعدّادات و`[`، درج جوال واحد؛ USlideover/UButton/UTooltip |
| لوحة الأوامر والاختصارات | `apps/web/app/components/shell/GlobalSearch.vue` (قصة: `apps/web/stories/shell/GlobalSearch.stories.ts`), `apps/web/app/composables/shortcuts/keymap.ts`, `apps/web/app/composables/useShellShortcuts.ts`, `apps/web/app/composables/usePalette.ts`, `apps/web/app/composables/useRowNavigation.ts` (قصة: `apps/web/stories/shell/RowNavigation.stories.ts`) | UCommandPalette داخل UModal؛ طبقة اختصارات واحدة؛ UKbd/UTooltip |
| مساحة المشروع | `apps/web/app/components/project/workspace/ProjectWorkspaceTabs.vue` (قصة: `apps/web/stories/project/ProjectWorkspaceTabs.stories.ts`) | تبويبات المشروع والحوكمة عبر `level="sections"` أو `level="governance"`، ومكوّن `apps/web/app/components/shared/RouteTabs.vue` |

## القوالب والحالات — Tasmim الخطة 4

قوالب الصفحات والحالات المشتركة (المواصفة §6). كلها تحت `apps/web/app/components/shared/` ولكل منها قصة بفحص إمكانية الوصول عند `error`.

الشرح والقواعد في [DESIGN.md «القوالب والحالات»](../../DESIGN.md). القائمة الملزمة في `CONTRACT_TEMPLATES` (`tools/ui_policy.py`).

| المكوّن | القصة | مكونات الأساس المستخدمة فعليًا |
| --- | --- | --- |
| `apps/web/app/components/shared/LoadingSkeleton.vue` | `apps/web/stories/shared/LoadingSkeleton.stories.ts` | `USkeleton`؛ صفوف، سجل، بطاقات |
| `apps/web/app/components/shared/ErrorState.vue` | `apps/web/stories/shared/ErrorState.stories.ts` | `UAlert`، `UButton` (إعادة المحاولة بعد الترطيب) |
| `apps/web/app/components/shared/InvoiceLines.vue` | `apps/web/stories/shared/InvoiceLines.stories.ts` | جدول أو قائمة لبنود الفاتورة مع إشعار وإجماليات اختيارية؛ `UBadge` لنوع البند؛ المبالغ ينسّقها المستدعي (`subscriptionInvoiceView`، `vendorInvoiceLineViews`) |
| `apps/web/app/components/shared/ForbiddenState.vue` | `apps/web/stories/shared/ForbiddenState.stories.ts` | `UIcon`؛ 403 بلا إعادة محاولة |
| `apps/web/app/components/shared/NotFoundState.vue` | `apps/web/stories/shared/NotFoundState.stories.ts` | `UIcon`، `UButton` رابط رجوع اختياري؛ 404 |
| `apps/web/app/components/shared/StandalonePage.vue` | `apps/web/stories/shared/StandalonePage.stories.ts` | `UCard`؛ `card` هي `<main>` الصفحة وتأخذ `title` أو شريحة `#header` (تستبدل العنوان ويرسم صاحبها `<h1>`)، و`print` وثيقة `.nasq-print` تُطبع أسود على أبيض بلا إطار التطبيق (`assets/css/components.css`) |
| `apps/web/app/components/shared/ChartPanel.vue` | `apps/web/stories/shared/ChartPanel.stories.ts` | `UCard` (`as="section"`)، `USkeleton`؛ المخطط في الخانة الافتراضية، وإجراء في الترويسة |
| `apps/web/app/components/shared/DashboardPage.vue` | `apps/web/stories/shared/DashboardPage.stories.ts` | `SharedPageContainer`، `SharedPageHeader`؛ صف `SharedMetricTile` ثم شبكة `SharedChartPanel` باستعلام حاوية |
| `apps/web/app/components/shared/RecordPage.vue` | `apps/web/stories/shared/RecordPage.stories.ts` | `SharedPageContainer` (`detail`)، `SharedPageHeader`، `SharedLoadingSkeleton` (`record`)، `SharedPageState`، `USkeleton`؛ شريحة `#back` لرجوع مخصص، و`<aside>` الخصائص في نهاية السطر |
| `apps/web/app/components/shared/PropertiesPanel.vue` | `apps/web/stories/shared/PropertiesPanel.stories.ts` | `<section>` بعنوان و`<dl>` |
| `apps/web/app/components/shared/PropertyRow.vue` | `apps/web/stories/shared/PropertyRow.stories.ts` | `dt`/`dd`؛ القيمة الفارغة «—» مخفية عن قارئ الشاشة مع `states.noValue` |
| `apps/web/app/components/shared/RecordSection.vue` | `apps/web/stories/shared/RecordSection.stories.ts` | `<section aria-labelledby>` بعنوان `h2` وإجراءات |
| `apps/web/app/components/shared/TimelineFrame.vue` | `apps/web/stories/shared/TimelineFrame.stories.ts` | `SharedPageContainer`، `SharedPageHeader`، `UButton`، `UIcon`؛ السابق/اليوم/التالي ومقياس اختياري، والسهمان ينعكسان بـ `rtl:-scale-x-100` |
| `apps/web/app/components/shared/ConversationLayout.vue` | `apps/web/stories/shared/ConversationLayout.stories.ts` | `SharedPageContainer`، `useMediaQuery`؛ القائمة في الشريط السياقي من 768px، ولوحة معلومات في `aside` |
| `apps/web/app/components/shared/DataTable.vue` | `apps/web/stories/shared/DataTable.stories.ts` | `UTable` (تحديد الصفوف عبر `row-selection`)، `UCheckbox`، `UButton`، `NuxtLink`، `SharedPageState`، `SharedPagination`؛ صفوف `data-shortcut-row` مع `useRowNavigation` — جدول واحد في الصفحة |
| `apps/web/app/components/shared/ListPage.vue` | `apps/web/stories/shared/ListPage.stories.ts` | `SharedPageContainer`، `SharedPageHeader`، `UButton` (زر الإنشاء `data-shortcut-create`)، `SharedViewSwitch` المرتبط بـ `?view=`؛ `backTo`/`backLabel` لرجوع القائمة |
| `apps/web/app/components/shared/ViewSwitch.vue` | `apps/web/stories/shared/ViewSwitch.stories.ts` | `UButton` بأيقونة و`aria-pressed`، `UTooltip`؛ لا يعمل قبل الترطيب |
| `apps/web/app/components/shared/StatusBadge.vue` | `apps/web/stories/shared/StatusBadge.stories.ts` | `UBadge` بلون `STATUS_COLOR`؛ الخرائط تبقى في ملفات التطبيقات (`projectStatusBadge`، `taskStateBadge`، `deadlineTone`، `accessStateBadge`، `hrAccessBadge`، `subscriptionStateBadge`، `lifecycleBadge`، `orderPaymentBadge`/`orderFulfillmentBadge`، `invoiceStatusBadge`، `customerDisplayBadge`، `operationStatusBadge`، `paymentAttemptBadge`) |
| `apps/web/app/components/shared/RouteTabs.vue` | `apps/web/stories/shared/RouteTabs.stories.ts` | `UButton` روابط، `UIcon`؛ `routeTabsStripClass`/`routeTabClass`، و`aria-current="page"` للقسم الحالي |
| `apps/web/app/components/shared/SettingsPage.vue` | `apps/web/stories/shared/SettingsPage.stories.ts` | `SharedPageContainer` وأنماط `.nasq-settings-*` العامة (نُقل من `settings/SettingsLayout.vue`) |

## المشاريع والمهام

| السطح | المكونات الفعلية | المسؤولية الحالية |
| --- | --- | --- |
| قوائم المشاريع وملخصها | `apps/web/app/components/project/ProjectTable.vue`, `apps/web/app/components/project/ProjectCards.vue`, `apps/web/app/components/project/ProjectStatusSelect.vue`, `apps/web/app/components/project/ProjectOverview.vue`, `apps/web/app/components/project/ProjectOverviewTasks.vue`, `apps/web/app/components/project/ProjectProgress.vue` | يُبنى على `SharedListPage`/`SharedDataTable`/`SharedRecordPage` (الصفحات التجريبية) |
| نماذج المشروع وإعداداته | `apps/web/app/components/project/ProjectCopyForm.vue`, `apps/web/app/components/project/ProjectCreateForm.vue`, `apps/web/app/components/project/ProjectGeneralForm.vue`, `apps/web/app/components/project/ProjectSettingsForm.vue`, `apps/web/app/components/project/ProjectUpdateForm.vue`, `apps/web/app/components/project/StageListEditor.vue`, `apps/web/app/components/settings/ProjectSettingsForm.vue` | الإنشاء والنسخ والتحرير والمراحل والإعدادات |
| ملف المشروع والحوكمة | `apps/web/app/components/project/ProjectCharterDisplay.vue`, `apps/web/app/components/project/ProjectCharterFields.vue`, `apps/web/app/components/project/ProjectCharterRows.vue`, `apps/web/app/components/project/ProjectCharterForm.vue` (قصة: `apps/web/stories/project/ProjectCharterForm.stories.ts`؛ معالج الميثاق على خطوات يحددها التصنيف مع حفظ المسودة), `apps/web/app/components/project/governance/StakeholderForm.vue`, `apps/web/app/components/project/governance/RegisterForm.vue`, `apps/web/app/components/project/FollowerList.vue`, `apps/web/app/components/project/ProjectFieldHelp.vue` (قصة: `apps/web/stories/project/ProjectFieldHelp.stories.ts`) | الملف، أصحاب المصلحة، السجل، المتابعون والمساعدة |
| مهامي | `apps/web/app/components/my-tasks/MyTaskForm.vue` (قصة: `apps/web/stories/my-tasks/MyTaskForm.stories.ts`؛ نموذج إنشاء المهمة الشخصية: UInput وUTextarea وUSelect مع `SharedDateField` و`SharedPersonPicker`، يطلق جسم الطلب نفسه ولا ينفذ الطلب) | إنشاء مهمة شخصية في `/my-tasks/new` (التعديل في صفحة التفاصيل له نموذجه الخاص الذي يرسل الحقول المتغيرة فقط) |
| الجدول الزمني والمعالم | `apps/web/app/components/project/schedule/ScheduleGantt.vue`, `apps/web/app/components/project/schedule/ScheduleTaskForm.vue`, `apps/web/app/components/project/MilestoneTable.vue`, `apps/web/app/components/project/MilestoneForm.vue` | الجدولة والمعالم |
| المالية | `apps/web/app/components/project/finance/FinanceBudgetPicker.vue`, `apps/web/app/components/project/finance/FinanceEntryForm.vue`, `apps/web/app/components/project/finance/FinanceEntryTable.vue`, `apps/web/app/components/project/finance/FinanceSummaryCards.vue` | الميزانية والقيود والملخص |
| لوحة المشروع | `apps/web/app/components/project/dashboard/DashboardChartPanel.vue` (قصة: `apps/web/stories/project/dashboard/DashboardChartPanel.stories.ts`), `apps/web/app/components/project/dashboard/ProjectDashboardCharts.vue`, `apps/web/app/components/project/dashboard/ProjectDashboardMetrics.vue`, `apps/web/app/components/project/dashboard/ProjectDashboardRecentProjects.vue` | يُبنى على `SharedDashboardPage`/`SharedChartPanel` |
| إجراءات المشروع | `apps/web/app/components/project/ProjectArchiveAction.vue`, `apps/web/app/components/project/ProjectMenu.vue` (قصة: `apps/web/stories/project/ProjectMenu.stories.ts`), `apps/web/app/components/project/ProjectUpdateList.vue` | إجراءات وأحداث وتحديثات المشروع |
| قوائم المهام ولوحتها | `apps/web/app/components/task/TaskTable.vue`, `apps/web/app/components/task/TaskBoard.vue`, `apps/web/app/components/task/TaskCard.vue` (قصة: `apps/web/stories/task/TaskCard.stories.ts`), `apps/web/app/components/task/TaskToolbar.vue`, `apps/web/app/components/task/Timeline.vue` | القائمة واللوحة والخط الزمني وأدوات العرض |
| تفاصيل المهمة | `apps/web/app/components/task/TaskDetailPage.vue`, `apps/web/app/components/task/TaskDetailPanel.vue`, `apps/web/app/components/task/TaskDetails.vue`, `apps/web/app/components/task/TaskProperties.vue`, `apps/web/app/components/task/TaskDescription.vue`, `apps/web/app/components/task/TaskActivity.vue`, `apps/web/app/components/task/TaskDeliverables.vue`, `apps/web/app/components/task/TaskAttachments.vue`, `apps/web/app/components/task/SubtaskList.vue` | التفاصيل والوصف والنشاط والمرفقات والتسليمات |
| نماذج وتحكم المهمة | `apps/web/app/components/task/TaskCreateForm.vue`, `apps/web/app/components/task/StateMenu.vue` (قصة: `apps/web/stories/task/StateMenu.stories.ts`), `apps/web/app/components/task/PrioritySelect.vue` (قصة: `apps/web/stories/task/PrioritySelect.stories.ts`), `apps/web/app/components/task/AssigneePicker.vue`, `apps/web/app/components/task/MilestoneSelect.vue`, `apps/web/app/components/task/DependencyPicker.vue`, `apps/web/app/components/task/TaskCompletionApproval.vue`, `apps/web/app/components/task/CommentComposer.vue` | الحقول والحالة والمكلّف والانتقالات والتعليقات |
| بدن بطاقة المشروع | `apps/web/app/components/project/ProjectCardBody.vue` | رقم واسم وحالة وتقدم ومدير وتاريخ وقائمة الإجراءات؛ داخل البطاقة وصف الجوال في جدول المشاريع |
| تفاصيل المهمة الشخصية (`/my-tasks/{id}`) | `apps/web/app/components/my-tasks/MyTaskSubtasks.vue`, `apps/web/app/components/my-tasks/MyTaskComments.vue`, `apps/web/app/components/my-tasks/MyTaskAttachments.vue`, `apps/web/app/components/my-tasks/ConvertToProject.vue` | المهام الفرعية والتعليقات النصية والمرفقات والتحويل إلى مشروع بتأكيد مضمّن؛ بنيت على `SharedInlineConfirm` و`SharedFileField` و`SharedPageState` وUSelectMenu |
| نماذج وتحكم المهمة | `apps/web/app/components/task/TaskCreateForm.vue`, `apps/web/app/components/shared/StatusBadge.vue` (قصة: `apps/web/stories/shared/StatusBadge.stories.ts`), `apps/web/app/components/task/StateMenu.vue` (قصة: `apps/web/stories/task/StateMenu.stories.ts`), `apps/web/app/components/task/PrioritySelect.vue` (قصة: `apps/web/stories/task/PrioritySelect.stories.ts`), `apps/web/app/components/task/AssigneePicker.vue`, `apps/web/app/components/shared/TagPicker.vue` (قصة: `apps/web/stories/shared/TagPicker.stories.ts`), `apps/web/app/components/task/MilestoneSelect.vue`, `apps/web/app/components/shared/StatusBadge.vue` (قصة: `apps/web/stories/shared/StatusBadge.stories.ts`), `apps/web/app/components/task/DependencyPicker.vue`, `apps/web/app/components/task/TaskCompletionApproval.vue`, `apps/web/app/components/task/CommentComposer.vue`, `apps/web/app/components/shared/DescriptionEditor.vue` (قصة: `apps/web/stories/shared/DescriptionEditor.stories.ts`) | الحقول والحالة والمكلّف والانتقالات والتعليقات |

## الاجتماعات والمحادثات والإشعارات

| السطح | المكونات الفعلية | المسؤولية الحالية |
| --- | --- | --- |
| الاجتماعات | `apps/web/app/components/meetings/MeetingEventList.vue`, `apps/web/app/components/meetings/MeetingMinutesDocument.vue`, `apps/web/app/components/meetings/MeetingMinutesForm.vue`, `apps/web/app/components/meetings/MeetingPeopleFields.vue` (قصة: `apps/web/stories/meetings/MeetingPeopleFields.stories.ts`), `apps/web/app/components/meetings/MeetingProjectFilter.vue` (قصة: `apps/web/stories/meetings/MeetingProjectFilter.stories.ts`), `apps/web/app/components/meetings/MeetingTimeline.vue`, `apps/web/app/components/meetings/MeetingVersionList.vue` | الحدث، الأشخاص، المشروع، المحضر، الخط الزمني والنسخ |
| المحادثات | `apps/web/app/components/chat/ChatAttachment.vue` (قصة: `apps/web/stories/chat/ChatAttachment.stories.ts`), `apps/web/app/components/chat/ChatInfoPanel.vue` (جسم معلومات المحادثة، يُعرض في لوحة المعلومات بتخطيط المحادثة), `apps/web/app/components/chat/ChatWorkspace.vue`, `apps/web/app/components/chat/ChatSidebarPanel.vue` (لوحة المحادثات في القائمة السياقية عبر `sidebarPanel`), `apps/web/app/components/chat/ConversationList.vue`, `apps/web/app/components/chat/MessageComposer.vue`, `apps/web/app/components/chat/MessageHistory.vue` | مساحة المحادثة والرسائل والمرفقات |
| الإشعارات | `apps/web/app/components/notifications/NotificationCenter.vue` | مركز الإشعارات |

## المؤسسة والوصول والحساب

| السطح | المكونات الفعلية | المسؤولية الحالية |
| --- | --- | --- |
| دليل المؤسسة | `apps/web/app/components/hr/DirectoryTable.vue`, `apps/web/app/components/hr/EmployeeCard.vue`, `apps/web/app/components/hr/EmployeeProperties.vue`, `apps/web/app/components/hr/EmployeeGeneralForm.vue` | الموظفون والحالة ونموذج البيانات العامة؛ خصائص سجل الموظف في الشريط الجانبي |
| الهيكل والمستندات | `apps/web/app/components/hr/DepartmentTree.vue`, `apps/web/app/components/hr/DepartmentOrgChart.vue`, `apps/web/app/components/hr/DepartmentTable.vue`, `apps/web/app/components/hr/DepartmentForm.vue`, `apps/web/app/components/hr/DocumentList.vue`, `apps/web/app/components/hr/DocumentReader.vue`, `apps/web/app/components/hr/DocumentEditor.vue`, `apps/web/app/components/hr/DocumentCreateForm.vue` | الأقسام والمستندات والإنشاء والتحرير |
| إدارة الوصول | `apps/web/app/components/access/audit/AuditTable.vue`, `apps/web/app/components/access/roles/RolePermissionForm.vue`, `apps/web/app/components/access/roles/RoleTable.vue`, `apps/web/app/components/access/users/UserAccessForm.vue`, `apps/web/app/components/access/users/UserSecurityForm.vue`, `apps/web/app/components/access/users/UserTable.vue` | المستخدمون والأدوار والصلاحيات والتدقيق |
| الإعدادات والحساب | `apps/web/app/components/shared/SettingsPage.vue` (قصة: `apps/web/stories/shared/SettingsPage.stories.ts`), `apps/web/app/components/shell/AppearanceMenu.vue` (قائمة المظهر في الهيدر: وضع العرض وحجم الخط لكل مستخدم), `apps/web/app/components/settings/BrandingForm.vue`, `apps/web/app/components/settings/BrandingPreview.vue`, `apps/web/app/components/settings/ProjectCharterReferenceForm.vue`, `apps/web/app/components/account/PasswordForm.vue` | المظهر والهوية وإعدادات المشروع وكلمة المرور |
| إدارة الوصول | `apps/web/app/components/shared/StatusBadge.vue` (قصة: `apps/web/stories/shared/StatusBadge.stories.ts`), `apps/web/app/components/access/audit/AuditTable.vue`, `apps/web/app/components/access/roles/RolePermissionForm.vue`, `apps/web/app/components/access/roles/RoleTable.vue`, `apps/web/app/components/access/users/UserAccessForm.vue`, `apps/web/app/components/access/users/UserSecurityForm.vue`, `apps/web/app/components/access/users/UserTable.vue` | المستخدمون والأدوار والصلاحيات والتدقيق |
| الإعدادات والحساب | `apps/web/app/components/shared/SettingsPage.vue` (قصة: `apps/web/stories/shared/SettingsPage.stories.ts`), `apps/web/app/components/shell/AppearanceMenu.vue` (قائمة المظهر في الهيدر: وضع العرض وحجم الخط لكل مستخدم), `apps/web/app/components/settings/BrandingForm.vue`, `apps/web/app/components/settings/BrandingPreview.vue`, `apps/web/app/components/settings/ProjectCharterReferenceForm.vue`, `apps/web/app/components/account/PasswordForm.vue` | المظهر والهوية وإعدادات المشروع وكلمة المرور |
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
| `apps/web/app/components/vendor/LifecyclePanel.vue` | `apps/web/stories/vendor/LifecyclePanel.stories.ts` | `SharedFormSection`, `SharedInlineConfirm`, `SharedUnsavedChanges`, `UAlert`, `UButton`, `UFormField`, `UTextarea` |
| `apps/web/app/components/vendor/PlanForm.vue` | `apps/web/stories/vendor/PlanForm.stories.ts` | `SharedFormSection`, `SharedUnsavedChanges`, `UAlert`, `UButton`, `UCheckbox`, `UFormField`, `UInput`, `USelect`, `UTextarea` |
| `apps/web/app/components/vendor/PriceBreakdown.vue` | `apps/web/stories/vendor/PriceBreakdown.stories.ts` | `UAlert`, `UButton` |
| `apps/web/app/components/vendor/PriceListEditor.vue` | `apps/web/stories/vendor/PriceListEditor.stories.ts` | `UButton`, `UFormField`, `UInput`, `USelect` |
| `apps/web/app/components/vendor/SubscriptionSummary.vue` | `apps/web/stories/vendor/SubscriptionSummary.stories.ts` | `UAlert`, `UBadge` |
| `apps/web/app/components/vendor/UsageMeters.vue` | `apps/web/stories/vendor/UsageMeters.stories.ts` | `UBadge`, `UProgress` |
| `apps/web/app/components/subscription/AutoRenewControl.vue` | `apps/web/stories/subscription/AutoRenewControl.stories.ts` | `UBadge`, `UButton`, `UCheckbox` |
| `apps/web/app/components/subscription/BranchSummary.vue` | `apps/web/stories/subscription/BranchSummary.stories.ts` | `UBadge` |
| `apps/web/app/components/subscription/UsagePanel.vue` | `apps/web/stories/subscription/UsagePanel.stories.ts` | `UBadge` |

## مكونات العمليات

المكونات التالية محلية لتطبيق العمليات، وتعيد استخدام لبنات Storybook المشتركة. الصلاحيات والقرارات تأتي من عقود الخادم.

| المكوّن | الوظيفة | القصة | مكونات الأساس |
| --- | --- | --- | --- |
| `apps/web/app/components/operations/RequestList.vue` | طلباتي، بانتظار موافقتي، متابعة التنفيذ مع فلاتر الرابط | `apps/web/stories/operations/RequestList.stories.ts` | `SharedFilterBar`, `SharedFilterField`, `SharedPageState`, `SharedRecordNumber`, `SharedPagination`, `UButton` |
| `apps/web/app/components/operations/ProcessList.vue` | الإجراءات المنشورة والمسودات بحسب الصلاحية | `apps/web/stories/operations/ProcessList.stories.ts` | `SharedPageHeader`, `SharedPageState`, `SharedRecordNumber`, `SharedPagination`, `UButton` |
| `apps/web/app/components/operations/RequestForm.vue` | إنشاء الطلب وتعديل مسودته واختيار السجل المرتبط | `apps/web/stories/operations/RequestForm.stories.ts` | `SharedFormSection`, `SharedUnsavedChanges`, `UFormField`, `UInput`, `USelect`, `UTextarea` |
| `apps/web/app/components/operations/ProcessForm.vue` | ترتيب المراحل والمراجعين ونتيجة الإجراء | `apps/web/stories/operations/ProcessForm.stories.ts` | `SharedFormSection`, `SharedPersonPicker`, `SharedUnsavedChanges`, `UFormField`, `UButton` |

حالات العمليات تستخدم `shared/StatusBadge.vue` وخريطة الدرجات في `composables/operations/state.ts`، مع إبقاء عناوين الحالة وصلاحيات الخادم.

| RACI matrix | `apps/web/app/components/project/governance/RaciMatrix.vue` (Story: `apps/web/stories/project/RaciMatrix.stories.ts`) | `SharedDataTable`, `SharedRowActions`, `USelect` |

Meetings use SharedListPage/DataTable/RecordPage/TimelineFrame/StandalonePage. ChatWorkspace uses SharedConversationLayout and ChatInfoPanel.
