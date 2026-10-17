# فهرس مكونات واجهة ويب فيو

السلطة البصرية هي [DESIGN.md](../../DESIGN.md). هذا الفهرس جرد لملكية الكود
الحالي في `packages/ui/app` (طبقة Nuxt المشتركة بين التطبيقات) و`packages/commercial-ui/app` (عرض الفوترة المشترك) و`apps/web/app` (المكونات المرتبطة بتطبيق) ومساراته؛ لا يضيف سياسة ثانية، ولا مصدرًا بصريًا أو
بيانات تجريبية. المرجع البصري `/Users/tariq/Downloads/nasq-ui` للمقارنة فقط.

Storybook هو فهرس المكونات الملزم: كل وكيل يأخذ اللبنة من `apps/web/stories/<المجلد>/<المكوّن>.stories.ts` ولا ينسخها محليًا؛ المكوّن المشترك الجديد يُشحن مع قصته ويُضاف إلى القائمة الملزمة `STORYBOOK_COMPONENTS` في `tools/ui_policy.py`.

## الأساس المشترك

| المسؤولية | المكونات الفعلية | الأساس المستخدم |
| --- | --- | --- |
| الحاوية والعنوان والأقسام | `packages/ui/app/components/shared/layout/PageContainer.vue` (قصة: `apps/web/stories/shared/PageContainer.stories.ts`), `packages/ui/app/components/shared/layout/PageHeader.vue` (قصة: `apps/web/stories/shared/PageHeader.stories.ts`), `packages/ui/app/components/shared/layout/FormSection.vue` (قصة: `apps/web/stories/shared/FormSection.stories.ts`), `packages/ui/app/components/shared/layout/CreatePanel.vue` (قصة: `apps/web/stories/shared/CreatePanel.stories.ts`) | حاويات الصفحة، العنوان، أقسام النماذج، ولوحة الإنشاء (`USlideover`) |
| البحث والفلاتر والحالة | `packages/ui/app/components/shared/data/FilterBar.vue` (قصة: `apps/web/stories/shared/FilterBar.stories.ts`), `packages/ui/app/components/shared/data/FilterField.vue` (قصة: `apps/web/stories/shared/FilterField.stories.ts`), `packages/ui/app/components/shared/data/FilterChoice.vue` (قصة: `apps/web/stories/shared/FilterChoice.stories.ts`), `packages/ui/app/components/shared/data/FilterChip.vue` (قصة: `apps/web/stories/shared/FilterChip.stories.ts`), `packages/ui/app/components/shared/feedback/PageState.vue` (قصة: `apps/web/stories/shared/PageState.stories.ts`) (واجهة رقيقة فوق LoadingSkeleton وErrorState وForbiddenState وNotFoundState وEmptyState؛ وصف فراغ و`#emptyAction`، و`keepContent` لفشل تحديث بيانات موجودة مع إخفاء البيانات عند 403/404), `packages/ui/app/components/shared/feedback/EmptyState.vue` (قصة: `apps/web/stories/shared/EmptyState.stories.ts`) | بحث، فلاتر (حقل بعنوان، اختيار مباشر، شريحة قابلة للإزالة)، تحميل، خطأ، فراغ وصلاحية |
| الحقول وحماية المسودة | `packages/ui/app/components/shared/form/DateField.vue` (قصة: `apps/web/stories/shared/DateField.stories.ts`), `packages/ui/app/components/shared/form/FileField.vue` (قصة: `apps/web/stories/shared/FileField.stories.ts`), `packages/ui/app/components/shared/form/UnsavedChanges.vue` (قصة: `apps/web/stories/shared/UnsavedChanges.stories.ts`), `apps/web/app/components/shared/form/DescriptionEditor.vue` (قصة: `apps/web/stories/shared/DescriptionEditor.stories.ts`), `apps/web/app/components/shared/form/TagPicker.vue` (قصة: `apps/web/stories/shared/TagPicker.stories.ts`) | `DateField`: UPopover/UCalendar/UButton؛ `FileField`: UButton وحقل ملف مخفي؛ حارس المسودة |
| الإجراءات والتأكيد | `packages/ui/app/components/shared/data/RowActions.vue` (قصة: `apps/web/stories/shared/RowActions.stories.ts`), `packages/ui/app/components/shared/form/InlineConfirm.vue` (قصة: `apps/web/stories/shared/InlineConfirm.stories.ts`) | `RowActions`: UButton رابط لإجراء واحد أو UDropdownMenu «…» والهدّام آخرًا؛ `InlineConfirm`: UAlert subtle بالإلغاء أولًا ثم الإجراء |
| القوائم والمحتوى | `packages/ui/app/components/shared/data/Pagination.vue` (قصة: `apps/web/stories/shared/Pagination.stories.ts`), `packages/ui/app/components/shared/form/RichText.vue` (قصة: `apps/web/stories/shared/RichText.stories.ts`), `packages/ui/app/components/shared/data/MetricTile.vue` (قصة: `apps/web/stories/shared/MetricTile.stories.ts`), `apps/web/app/components/shared/form/PersonPicker.vue` (قصة: `apps/web/stories/shared/PersonPicker.stories.ts`) | `Pagination`: UPagination مع «صفحة x من y»؛ `RichText`: HTML منقّى بتنسيق واحد؛ `MetricTile`: UCard لمؤشر واحد؛ `PersonPicker`: USelectMenu فوق `/api/v1/people` |
| هوية السجل والرسوم | `packages/ui/app/components/shared/data/RecordNumber.vue` (قصة: `apps/web/stories/shared/RecordNumber.stories.ts`), `apps/web/app/components/shared/data/DashboardChart.client.vue` (قصة: `apps/web/stories/shared/DashboardChart.stories.ts`) | رقم السجل ومحولات الرسوم |
| محولات الرسوم | `apps/web/app/components/charts/ChartContainer.vue` (قصة: `apps/web/stories/charts/ChartContainer.stories.ts`), `apps/web/app/components/charts/ChartLegendContent.vue`, `apps/web/app/components/charts/ChartStyle.vue`, `apps/web/app/components/charts/ChartTooltipContent.vue` | Unovis وتوكنات الرسم المشتقة من الهوية |
| الشعار المعتمد | `packages/ui/app/components/shared/layout/BrandWordmark.vue` (قصة: `apps/web/stories/shared/BrandWordmark.stories.ts`) | علامة W SVG بلون العميل مع اسم `ويب فيو`؛ الوضع المعكوس (أبيض) للشريط الداكن |

| تذييل إجراءات النماذج | `packages/ui/app/components/shared/form/FormActions.vue` (قصة: `apps/web/stories/shared/FormActions.stories.ts`) | HTML form association وVue Teleport إلى تذييل `SharedCreatePanel`؛ نفس الأزرار الأصلية، بلا وصفة ألوان جديدة |

## الغلاف والتنقل

| المسؤولية | المكونات الفعلية | الأساس المستخدم |
| --- | --- | --- |
| الغلاف | `packages/ui/app/components/shell/ShellFrame.vue` (قصة: `apps/web/stories/shell/ShellFrame.stories.ts`), `apps/web/app/components/shell/AppSidebar.vue` (قصة: `apps/web/stories/shell/AppSidebar.stories.ts`), `apps/web/app/components/shell/ShellHeader.vue` (قصة: `apps/web/stories/shell/ShellHeader.stories.ts`), `packages/ui/app/components/shell/ShellBreadcrumb.vue` (قصة: `apps/web/stories/shell/ShellBreadcrumb.stories.ts`), `apps/web/app/components/shell/MobileNavigation.vue` (قصة: `apps/web/stories/shell/MobileNavigation.stories.ts`), `apps/web/app/components/shell/AppearanceMenu.vue` (قصة: `apps/web/stories/shell/AppearanceMenu.stories.ts`), `apps/web/app/components/shell/AppAccountMenu.vue` (قصة: `apps/web/stories/shell/AppAccountMenu.stories.ts`), `apps/web/app/components/shell/GlobalSearch.vue` (قصة: `apps/web/stories/shell/GlobalSearch.stories.ts`) | إطار ثلاثي الطبقات؛ هيدر 48px بمسار الصفحة ولوحة الأوامر ⌘K (UCommandPalette) والحساب؛ UBreadcrumb/UBadge |
| التنقل | `packages/ui/app/components/shell/ModuleRail.vue` (قصة: `apps/web/stories/shell/ModuleRail.stories.ts`), `apps/web/app/components/shell/ContextSidebar.vue` (قصة: `apps/web/stories/shell/ContextSidebar.stories.ts`), `apps/web/app/components/shell/SidebarCreateAction.vue` (قصة: `apps/web/stories/shell/SidebarCreateAction.stories.ts`), `apps/web/app/components/shell/MobileNavigation.vue` | شريط 64px ثابت، قائمة 232px بأقسام وعدّادات و`[`، درج جوال واحد؛ USlideover/UButton/UTooltip |
| لوحة الأوامر والاختصارات | `apps/web/app/components/shell/GlobalSearch.vue` (قصة: `apps/web/stories/shell/GlobalSearch.stories.ts`), `packages/ui/app/composables/shortcuts/keymap.ts`, `apps/web/app/composables/useShellShortcuts.ts`, `apps/web/app/composables/usePalette.ts`, `packages/ui/app/composables/useRowNavigation.ts` (قصة: `apps/web/stories/shell/RowNavigation.stories.ts`) | UCommandPalette داخل UModal؛ طبقة اختصارات واحدة؛ UKbd/UTooltip |
| مساحة المشروع | `apps/web/app/components/pmo/projects/workspace/ProjectWorkspaceTabs.vue` (قصة: `apps/web/stories/project/ProjectWorkspaceTabs.stories.ts`) | تبويبات المشروع والحوكمة عبر `level="sections"` أو `level="governance"`، ومكوّن `packages/ui/app/components/shared/layout/RouteTabs.vue` |

## القوالب والحالات — Tasmim الخطة 4

قوالب الصفحات والحالات المشتركة (المواصفة §6). تسكن في `packages/ui/app/components/shared/` ما لم يُذكر مسار `apps/web` (المكونات التي تعتمد على بيانات التطبيق)، ولكل منها قصة بفحص إمكانية الوصول عند `error`.

الشرح والقواعد في [DESIGN.md «القوالب والحالات»](../../DESIGN.md). القائمة الملزمة في `CONTRACT_TEMPLATES` (`tools/ui_policy.py`).

| المكوّن | القصة | مكونات الأساس المستخدمة فعليًا |
| --- | --- | --- |
| `packages/ui/app/components/shared/feedback/LoadingSkeleton.vue` | `apps/web/stories/shared/LoadingSkeleton.stories.ts` | `USkeleton`؛ صفوف، سجل، بطاقات |
| `packages/ui/app/components/shared/feedback/ErrorState.vue` | `apps/web/stories/shared/ErrorState.stories.ts` | `UAlert`، `UButton` (إعادة المحاولة بعد الترطيب) |
| `packages/commercial-ui/app/components/shared/data/InvoiceLines.vue` | `apps/web/stories/shared/InvoiceLines.stories.ts` | جدول أو قائمة لبنود الفاتورة مع إشعار وإجماليات اختيارية؛ `UBadge` لنوع البند؛ المبالغ ينسّقها المستدعي (`subscriptionInvoiceView`) |
| `packages/ui/app/components/shared/feedback/ForbiddenState.vue` | `apps/web/stories/shared/ForbiddenState.stories.ts` | `UIcon`؛ 403 بلا إعادة محاولة |
| `packages/ui/app/components/shared/feedback/NotFoundState.vue` | `apps/web/stories/shared/NotFoundState.stories.ts` | `UIcon`، `UButton` رابط رجوع اختياري؛ 404 |
| `packages/ui/app/components/shared/layout/StandalonePage.vue` | `apps/web/stories/shared/StandalonePage.stories.ts` | `UCard`؛ `card` هي `<main>` الصفحة وتأخذ `title` أو شريحة `#header` (تستبدل العنوان ويرسم صاحبها `<h1>`)، و`print` وثيقة `.webvue-print` تُطبع أسود على أبيض بلا إطار التطبيق (`packages/ui/app/assets/css/components.css`) |
| `packages/ui/app/components/shared/data/ChartPanel.vue` | `apps/web/stories/shared/ChartPanel.stories.ts` | `UCard` (`as="section"`)، `USkeleton`؛ المخطط في الخانة الافتراضية، وإجراء في الترويسة |
| `packages/ui/app/components/shared/layout/DashboardPage.vue` | `apps/web/stories/shared/DashboardPage.stories.ts` | `SharedPageContainer`، `SharedPageHeader`؛ صف `SharedMetricTile` ثم شبكة `SharedChartPanel` باستعلام حاوية |
| `packages/ui/app/components/shared/layout/RecordPage.vue` | `apps/web/stories/shared/RecordPage.stories.ts` | `SharedPageContainer` (`detail`)، `SharedPageHeader`، `SharedLoadingSkeleton` (`record`)، `SharedPageState`، `USkeleton`؛ شريحة `#back` لرجوع مخصص، و`#summary` للبيانات التشغيلية قبل التبويبات والمحتوى، و`#aside` للتفاصيل المساندة |
| `packages/ui/app/components/shared/layout/PropertiesPanel.vue` | `apps/web/stories/shared/PropertiesPanel.stories.ts` | `<section>` بعنوان و`<dl>` |
| `packages/ui/app/components/shared/layout/PropertyRow.vue` | `apps/web/stories/shared/PropertyRow.stories.ts` | `dt`/`dd`؛ القيمة الفارغة «—» مخفية عن قارئ الشاشة مع `states.noValue` |
| `packages/ui/app/components/shared/layout/RecordSection.vue` | `apps/web/stories/shared/RecordSection.stories.ts` | `<section aria-labelledby>` بعنوان `h2` وإجراءات؛ `panel` يرسمه بطاقة بصف عنوان (`webvue-record-panel`) |
| `apps/web/app/components/shared/data/AttachmentList.vue` | `apps/web/stories/shared/AttachmentList.stories.ts` | `SharedPageState`، `SharedInlineConfirm`، `SharedFileField`، `UButton`؛ روابط المرفقات وحذف بتأكيد مضمّن وحقل رفع واحد، والمعالجان `uploadFile` و`deleteFile` يمرّرهما التطبيق (`pmo/tasks/TaskAttachments.vue` و`personal-tasks/MyTaskAttachments.vue`) |
| `apps/web/app/components/shared/data/CommentThread.vue` | `apps/web/stories/shared/CommentThread.stories.ts` | `SharedPageState`؛ تعليقات نصية من الأقدم مع فتحة `composer`، ولا تغني عن `pmo/tasks/Timeline.vue` الذي يعرض HTML وتغييرات الحقول |
| `apps/web/app/components/shared/form/CommentComposer.vue` | `apps/web/stories/shared/CommentComposer.stories.ts` | `UTextarea`، `UFormField`، `UButton`؛ حقل تعليق وزر نشر بلا مسودة ولا طلب، وفتحة `below` لقائمة الإشارات في `pmo/tasks/CommentComposer.vue` |
| `apps/web/app/components/shared/data/Checklist.vue` | `apps/web/stories/shared/Checklist.stories.ts` | `NuxtLink`، `UInput`، `UButton`، `UBadge`؛ بنود مرتبطة (المهام الفرعية) مع تبديل إنجاز اختياري ونموذج إضافة، والمعالجان `add` و`toggle` يمرّرهما التطبيق؛ `v-model:draft` اختياري لملكية المسودة وحارس المغادرة في التطبيق (`pmo/tasks/SubtaskList.vue` و`personal-tasks/MyTaskSubtasks.vue`) |
| `packages/ui/app/components/shared/layout/TimelineFrame.vue` | `apps/web/stories/shared/TimelineFrame.stories.ts` | `SharedPageContainer`، `SharedPageHeader`، `UButton`، `UIcon`؛ السابق/اليوم/التالي ومقياس اختياري، والسهمان ينعكسان بـ `rtl:-scale-x-100` |
| `packages/ui/app/components/shared/layout/ConversationLayout.vue` | `apps/web/stories/shared/ConversationLayout.stories.ts` | `SharedPageContainer`، `useMediaQuery`؛ القائمة في الشريط السياقي من 768px، ولوحة معلومات في `aside` |
| `packages/ui/app/components/shared/data/DataTable.vue` | `apps/web/stories/shared/DataTable.stories.ts` | `UTable` (تحديد الصفوف عبر `row-selection`)، `UCheckbox`، `UButton`، `NuxtLink`، `SharedPageState`، `SharedPagination`؛ صفوف `data-shortcut-row` مع `useRowNavigation` — جدول واحد في الصفحة |
| `packages/ui/app/components/shared/layout/ListPage.vue` | `apps/web/stories/shared/ListPage.stories.ts` | `SharedPageContainer`، `SharedPageHeader`، `UButton` (زر الإنشاء `data-shortcut-create`)، `SharedViewSwitch` المرتبط بـ `?view=`؛ `backTo`/`backLabel` لرجوع القائمة |
| `packages/ui/app/components/shared/data/ViewSwitch.vue` | `apps/web/stories/shared/ViewSwitch.stories.ts` | `UButton` بأيقونة و`aria-pressed`، `UTooltip`؛ لا يعمل قبل الترطيب |
| `packages/ui/app/components/shared/data/StatusBadge.vue` | `apps/web/stories/shared/StatusBadge.stories.ts` | `UBadge` بلون `STATUS_COLOR` (محايد/معلومة/تحذير/نجاح/خطأ/أساسي للمدير فقط) والنوع الافتراضي `subtle` (`outline` للأزرار لا للشارات) ونص ≥ 12px؛ الدلالة في DESIGN.md §2 «الشارات والحالات»؛ الخرائط تبقى في ملفات التطبيقات (`projectStatusBadge`، `taskStateBadge`، `deadlineTone`، `accessStateBadge`، `hrAccessBadge`، `subscriptionStateBadge`، `lifecycleBadge`، `orderPaymentBadge`/`orderFulfillmentBadge`، `invoiceStatusBadge`، `customerDisplayBadge`، `operationStatusBadge`، `paymentAttemptBadge`) |
| `packages/ui/app/components/shared/layout/RouteTabs.vue` | `apps/web/stories/shared/RouteTabs.stories.ts` | `UButton` روابط، `UIcon`؛ `routeTabsStripClass`/`routeTabClass`، و`aria-current="page"` للقسم الحالي |
| `packages/ui/app/components/shared/layout/SettingsPage.vue` | `apps/web/stories/shared/SettingsPage.stories.ts` | `SharedPageContainer` وأنماط `.webvue-settings-*` العامة (نُقل من `settings/SettingsLayout.vue`) |

## المشاريع والمهام

| السطح | المكونات الفعلية | المسؤولية الحالية |
| --- | --- | --- |
| قوائم المشاريع وملخصها | `apps/web/app/components/pmo/projects/ProjectTable.vue`, `apps/web/app/components/pmo/projects/ProjectCards.vue`, `apps/web/app/components/pmo/projects/ProjectStatusSelect.vue`, `apps/web/app/components/pmo/projects/ProjectOverview.vue`, `apps/web/app/components/pmo/projects/ProjectOverviewTasks.vue`, `apps/web/app/components/pmo/projects/ProjectProgress.vue` | يُبنى على `SharedListPage`/`SharedDataTable`/`SharedRecordPage` (الصفحات التجريبية) |
| نماذج المشروع وإعداداته | `apps/web/app/components/pmo/projects/ProjectCopyForm.vue`, `apps/web/app/components/pmo/projects/ProjectCreateForm.vue`, `apps/web/app/components/pmo/projects/ProjectGeneralForm.vue`, `apps/web/app/components/pmo/projects/ProjectSettingsForm.vue`, `apps/web/app/components/pmo/projects/ProjectUpdateForm.vue`, `apps/web/app/components/pmo/projects/StageListEditor.vue`, `apps/web/app/components/settings/ProjectSettingsForm.vue` | الإنشاء والتحرير والمراحل والإعدادات |
| ملف المشروع والحوكمة | `apps/web/app/components/pmo/projects/ProjectCharterDisplay.vue`, `apps/web/app/components/pmo/projects/ProjectCharterFields.vue`, `apps/web/app/components/pmo/projects/ProjectCharterRows.vue`, `apps/web/app/components/pmo/projects/CharterApprovalPanel.vue` (قصة: `apps/web/stories/project/CharterApprovalPanel.stories.ts`), `apps/web/app/components/pmo/projects/ProjectPhaseStepper.vue` (قصة: `apps/web/stories/project/ProjectPhaseStepper.stories.ts`؛ خطوات مرحلة المشروع للعرض فقط), `apps/web/app/components/pmo/projects/ProjectPhaseGate.vue` (قصة: `apps/web/stories/project/ProjectPhaseGate.stories.ts`؛ شروط الانتقال إلى المرحلة التالية وأزرار الانتقال والرجوع بتأكيد مضمّن), `apps/web/app/components/pmo/projects/ProjectCharterForm.vue` (قصة: `apps/web/stories/project/ProjectCharterForm.stories.ts`؛ معالج الميثاق على خطوات يحددها التصنيف مع حفظ المسودة), `apps/web/app/components/pmo/projects/governance/StakeholderForm.vue`, `apps/web/app/components/pmo/projects/governance/RegisterForm.vue`, `apps/web/app/components/pmo/projects/FollowerList.vue`, `apps/web/app/components/pmo/projects/ProjectFieldHelp.vue` (قصة: `apps/web/stories/project/ProjectFieldHelp.stories.ts`) | الملف، أصحاب المصلحة، السجل، المتابعون والمساعدة |
| مهامي | `apps/web/app/components/personal-tasks/MyTaskForm.vue` (قصة: `apps/web/stories/my-tasks/MyTaskForm.stories.ts`؛ نموذج موحد لإنشاء وتعديل المهمة الشخصية: UInput وUTextarea وUSelect مع `SharedDateField` و`SharedPersonPicker`؛ task اختياري وأحداث create/update typed، ولا ينفذ الطلب) | إنشاء في `/my-tasks/new` وتعديل في `/my-tasks/{id}/edit`، baseline ثابت وPATCH للحقول المتغيرة فقط |

| الجدول الزمني والمعالم | `apps/web/app/components/pmo/projects/schedule/ScheduleGantt.vue`, `apps/web/app/components/pmo/projects/schedule/ScheduleTaskForm.vue`, `apps/web/app/components/pmo/projects/MilestoneTable.vue`, `apps/web/app/components/pmo/projects/MilestoneForm.vue` | الجدولة والمعالم |
| المالية | `apps/web/app/components/pmo/projects/finance/FinanceBudgetPicker.vue`, `apps/web/app/components/pmo/projects/finance/FinanceEntryForm.vue`, `apps/web/app/components/pmo/projects/finance/FinanceEntryTable.vue`, `apps/web/app/components/pmo/projects/finance/FinanceSummaryCards.vue` | الميزانية والقيود والملخص |
| لوحة المشروع | `apps/web/app/components/pmo/projects/dashboard/DashboardChartPanel.vue` (قصة: `apps/web/stories/project/dashboard/DashboardChartPanel.stories.ts`), `apps/web/app/components/pmo/projects/dashboard/ProjectDashboardCharts.vue`, `apps/web/app/components/pmo/projects/dashboard/ProjectDashboardMetrics.vue`, `apps/web/app/components/pmo/projects/dashboard/ProjectDashboardRecentProjects.vue`, `apps/web/app/components/pmo/projects/dashboard/PendingCharterReviews.vue` (قصة: `apps/web/stories/project/dashboard/PendingCharterReviews.stories.ts`) | يُبنى على `SharedDashboardPage`/`SharedChartPanel` |
| إجراءات المشروع | `apps/web/app/components/pmo/projects/ProjectArchiveAction.vue`, `apps/web/app/components/pmo/projects/ProjectMenu.vue` (قصة: `apps/web/stories/project/ProjectMenu.stories.ts`), `apps/web/app/components/pmo/projects/ProjectUpdateList.vue` | إجراءات وأحداث وتحديثات المشروع |
| قوائم المهام ولوحتها | `apps/web/app/components/pmo/tasks/TaskTable.vue`, `apps/web/app/components/pmo/tasks/TaskBoard.vue`, `apps/web/app/components/pmo/tasks/TaskCard.vue` (قصة: `apps/web/stories/task/TaskCard.stories.ts`), `apps/web/app/components/pmo/tasks/TaskToolbar.vue`, `apps/web/app/components/pmo/tasks/TaskArchivedList.vue`, `apps/web/app/components/pmo/tasks/Timeline.vue` | القائمة واللوحة والخط الزمني وأدوات العرض |
| تفاصيل المهمة | `apps/web/app/components/pmo/tasks/TaskDetailPage.vue`, `apps/web/app/components/pmo/tasks/TaskDetailPanel.vue`, `apps/web/app/components/pmo/tasks/TaskDetails.vue`, `apps/web/app/components/pmo/tasks/TaskProperties.vue`, `apps/web/app/components/pmo/tasks/TaskDescription.vue`, `apps/web/app/components/pmo/tasks/TaskActivity.vue`, `apps/web/app/components/pmo/tasks/TaskDeliverables.vue`, `apps/web/app/components/pmo/tasks/TaskAttachments.vue`, `apps/web/app/components/pmo/tasks/SubtaskList.vue` | التفاصيل والوصف والنشاط والمرفقات والتسليمات |
| نماذج وتحكم المهمة | `apps/web/app/components/pmo/tasks/TaskCreateForm.vue`, `apps/web/app/components/pmo/tasks/StateMenu.vue` (قصة: `apps/web/stories/task/StateMenu.stories.ts`), `apps/web/app/components/pmo/tasks/PrioritySelect.vue` (قصة: `apps/web/stories/task/PrioritySelect.stories.ts`), `apps/web/app/components/pmo/tasks/AssigneePicker.vue` (محوّل رفيع فوق `SharedPersonPicker` يبقى لأنه يحوّل النموذج إلى `{ ids, resolved }` ويحمل نص «غير مكلّف»)، `apps/web/app/components/pmo/tasks/MilestoneSelect.vue`, `apps/web/app/components/pmo/tasks/DependencyPicker.vue`, `apps/web/app/components/pmo/tasks/TaskCompletionApproval.vue`, `apps/web/app/components/pmo/tasks/CommentComposer.vue` (إشارات `@` و`/` فوق `SharedCommentComposer`) | الحقول والحالة والمكلّف والانتقالات والتعليقات |
| بدن بطاقة المشروع | `apps/web/app/components/pmo/projects/ProjectCardBody.vue` | رقم واسم وحالة وتقدم ومدير وتاريخ وقائمة الإجراءات؛ داخل البطاقة وصف الجوال في جدول المشاريع |
| تفاصيل المهمة الشخصية (`/my-tasks/{id}`) | `apps/web/app/components/personal-tasks/MyTaskSubtasks.vue`, `apps/web/app/components/personal-tasks/MyTaskComments.vue`, `apps/web/app/components/personal-tasks/MyTaskAttachments.vue`, `apps/web/app/components/personal-tasks/ConvertToProject.vue` | المهام الفرعية والتعليقات النصية والمرفقات والتحويل إلى مشروع بتأكيد مضمّن؛ توصيلات رفيعة فوق `SharedChecklist` و`SharedCommentThread` و`SharedCommentComposer` و`SharedAttachmentList` وUSelectMenu |
| نماذج وتحكم المهمة | `apps/web/app/components/pmo/tasks/TaskCreateForm.vue`, `packages/ui/app/components/shared/data/StatusBadge.vue` (قصة: `apps/web/stories/shared/StatusBadge.stories.ts`), `apps/web/app/components/pmo/tasks/StateMenu.vue` (قصة: `apps/web/stories/task/StateMenu.stories.ts`), `apps/web/app/components/pmo/tasks/PrioritySelect.vue` (قصة: `apps/web/stories/task/PrioritySelect.stories.ts`), `apps/web/app/components/pmo/tasks/AssigneePicker.vue`, `apps/web/app/components/shared/form/TagPicker.vue` (قصة: `apps/web/stories/shared/TagPicker.stories.ts`), `apps/web/app/components/pmo/tasks/MilestoneSelect.vue`, `packages/ui/app/components/shared/data/StatusBadge.vue` (قصة: `apps/web/stories/shared/StatusBadge.stories.ts`), `apps/web/app/components/pmo/tasks/DependencyPicker.vue`, `apps/web/app/components/pmo/tasks/TaskCompletionApproval.vue`, `apps/web/app/components/pmo/tasks/CommentComposer.vue`, `apps/web/app/components/shared/form/DescriptionEditor.vue` (قصة: `apps/web/stories/shared/DescriptionEditor.stories.ts`) | الحقول والحالة والمكلّف والانتقالات والتعليقات |

## الاجتماعات والمحادثات والإشعارات

| السطح | المكونات الفعلية | المسؤولية الحالية |
| --- | --- | --- |
| الاجتماعات | `apps/web/app/components/meetings/MeetingEventList.vue` (قصة: `apps/web/stories/meetings/MeetingEventList.stories.ts`), `apps/web/app/components/meetings/MeetingMinutesDocument.vue` (قصة: `apps/web/stories/meetings/MeetingMinutesDocument.stories.ts`), `apps/web/app/components/meetings/MeetingMinutesForm.vue` (قصة: `apps/web/stories/meetings/MeetingMinutesForm.stories.ts`), `apps/web/app/components/meetings/MeetingPeopleFields.vue` (قصة: `apps/web/stories/meetings/MeetingPeopleFields.stories.ts`), `apps/web/app/components/meetings/MeetingProjectFilter.vue` (قصة: `apps/web/stories/meetings/MeetingProjectFilter.stories.ts`), `apps/web/app/components/meetings/MeetingTimeline.vue` (قصة: `apps/web/stories/meetings/MeetingTimeline.stories.ts`), `apps/web/app/components/meetings/MeetingVersionList.vue` (قصة: `apps/web/stories/meetings/MeetingVersionList.stories.ts`), `apps/web/app/components/meetings/MeetingRecordTabs.vue` (قصة: `apps/web/stories/meetings/MeetingRecordTabs.stories.ts`), `apps/web/app/components/meetings/MeetingResolutionsTab.vue` (قصة: `apps/web/stories/meetings/MeetingResolutionsTab.stories.ts`), `apps/web/app/components/meetings/MeetingAttachmentsTab.vue` (قصة: `apps/web/stories/meetings/MeetingAttachmentsTab.stories.ts`) | الحدث، الأشخاص، المشروع، المحضر، الخط الزمني والنسخ، وشريط تبويبات سجل الاجتماع وتبويبا التوصيات والمرفقات |
| المحادثات | `apps/web/app/components/chat/ChatAttachment.vue` (قصة: `apps/web/stories/chat/ChatAttachment.stories.ts`), `apps/web/app/components/chat/ChatInfoPanel.vue` (جسم معلومات المحادثة، يُعرض في لوحة المعلومات بتخطيط المحادثة), `apps/web/app/components/chat/ChatWorkspace.vue`, `apps/web/app/components/chat/ChatSidebarPanel.vue` (لوحة المحادثات في القائمة السياقية عبر `sidebarPanel`), `apps/web/app/components/chat/ConversationList.vue`, `apps/web/app/components/chat/MessageComposer.vue`, `apps/web/app/components/chat/MessageHistory.vue` | مساحة المحادثة والرسائل والمرفقات |
| الإشعارات | `apps/web/app/components/notifications/NotificationCenter.vue` | مركز الإشعارات |

## مساعد WebVue AI

| السطح | المكونات الفعلية | المسؤولية الحالية |
| --- | --- | --- |
| صفحة `/ai` | `apps/web/app/components/ai/AiMessage.vue`, `apps/web/app/components/ai/AiRecordCards.vue`, `apps/web/app/components/ai/AiToolTrace.vue`, `apps/web/app/components/ai/AiConfirmCard.vue` (تأكيد مضمّن عبر `SharedInlineConfirm`), `apps/web/app/components/ai/AiDraftCard.vue`, `apps/web/app/components/ai/AiLimitNotice.vue`, `apps/web/app/components/ai/AiComposer.vue`, `apps/web/app/components/ai/AiRunList.vue` (لوحة الشريط الجانبي: محادثات المستخدم السابقة، مع تغيير الاسم في مكانه والأرشفة وعرض المؤرشفة؛ وتحت 768px تعرضها صفحة `/ai` بالخاصية `disclosure` قسمًا قابلًا للطي) (قصص: `apps/web/stories/ai/AiThread.stories.ts`, `apps/web/stories/ai/AiCards.stories.ts`, `apps/web/stories/ai/AiRunList.stories.ts`) | محادثة المساعد: الرسائل وبطاقات السجلات وأثر الأدوات وبطاقات التأكيد والمسودة وإشعار الحدود ومربع الكتابة وسجل المحادثات |

## المؤسسة والوصول والحساب

| السطح | المكونات الفعلية | المسؤولية الحالية |
| --- | --- | --- |
| دليل المؤسسة | `apps/web/app/components/hr/DirectoryTable.vue`, `apps/web/app/components/hr/EmployeeCard.vue`, `apps/web/app/components/hr/EmployeeProperties.vue`, `apps/web/app/components/hr/EmployeeGeneralForm.vue` | الموظفون والحالة ونموذج البيانات العامة؛ خصائص سجل الموظف في الشريط الجانبي |
| الهيكل والمستندات | `apps/web/app/components/hr/DepartmentTree.vue`, `apps/web/app/components/hr/DepartmentOrgChart.vue`, `apps/web/app/components/hr/DepartmentTable.vue`, `apps/web/app/components/hr/DepartmentForm.vue`, `apps/web/app/components/hr/DocumentList.vue`, `apps/web/app/components/hr/DocumentReader.vue`, `apps/web/app/components/hr/DocumentEditor.vue`, `apps/web/app/components/hr/DocumentCreateForm.vue` | الأقسام والمستندات والإنشاء والتحرير |
| إدارة الوصول | `apps/web/app/components/access/audit/AuditTable.vue`, `apps/web/app/components/access/roles/RolePermissionForm.vue`, `apps/web/app/components/access/roles/RoleTable.vue`, `apps/web/app/components/access/users/UserAccessForm.vue`, `apps/web/app/components/access/users/UserSecurityForm.vue`, `apps/web/app/components/access/users/UserTable.vue` | المستخدمون والأدوار والصلاحيات والتدقيق |
| الإعدادات والحساب | `packages/ui/app/components/shared/layout/SettingsPage.vue` (قصة: `apps/web/stories/shared/SettingsPage.stories.ts`), `apps/web/app/components/shell/AppearanceMenu.vue` (قائمة المظهر في الهيدر: وضع العرض وحجم الخط لكل مستخدم), `apps/web/app/components/settings/BrandingForm.vue`, `apps/web/app/components/settings/BrandingPreview.vue`, `apps/web/app/components/pmo/projects/settings/ProjectCharterReferenceForm.vue`, `apps/web/app/components/account/PasswordForm.vue` | المظهر والهوية وإعدادات المشروع وكلمة المرور |
| إدارة الوصول | `packages/ui/app/components/shared/data/StatusBadge.vue` (قصة: `apps/web/stories/shared/StatusBadge.stories.ts`), `apps/web/app/components/access/audit/AuditTable.vue`, `apps/web/app/components/access/roles/RolePermissionForm.vue`, `apps/web/app/components/access/roles/RoleTable.vue`, `apps/web/app/components/access/users/UserAccessForm.vue`, `apps/web/app/components/access/users/UserSecurityForm.vue`, `apps/web/app/components/access/users/UserTable.vue` | المستخدمون والأدوار والصلاحيات والتدقيق |
| الإعدادات والحساب | `packages/ui/app/components/shared/layout/SettingsPage.vue` (قصة: `apps/web/stories/shared/SettingsPage.stories.ts`), `apps/web/app/components/shell/AppearanceMenu.vue` (قائمة المظهر في الهيدر: وضع العرض وحجم الخط لكل مستخدم), `apps/web/app/components/settings/BrandingForm.vue`, `apps/web/app/components/settings/BrandingPreview.vue`, `apps/web/app/components/pmo/projects/settings/ProjectCharterReferenceForm.vue`, `apps/web/app/components/account/PasswordForm.vue` | المظهر والهوية وإعدادات المشروع وكلمة المرور |
| المهام الشخصية | `apps/web/app/components/personal-tasks/MyTaskRow.vue` | صف قائمة «مهامي»: العنوان والحالة والأولوية والموعد والمكلّفون، ويربط مهمة المشروع بمسارها من الخادم |

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
| `packages/commercial-ui/app/components/shared/commerce/PriceBreakdown.vue` | `apps/web/stories/shared/CommercePriceBreakdown.stories.ts` | `UAlert`, `UButton` |
| `apps/web/app/components/subscription/AutoRenewControl.vue` | `apps/web/stories/subscription/AutoRenewControl.stories.ts` | `UBadge`, `UButton`, `UCheckbox` |
| `apps/web/app/components/subscription/BranchSummary.vue` | `apps/web/stories/subscription/BranchSummary.stories.ts` | `UBadge` |
| `apps/web/app/components/subscription/UsagePanel.vue` | `apps/web/stories/subscription/UsagePanel.stories.ts` | `UBadge` |

## مكونات لوحة إدارة المورّد — apps/vendor-admin

تطبيق مستقل يمتد من `packages/ui` ولا يستورد من `apps/web`. لا مكان له في Storybook (القصص في `apps/web` وحدها)، فيُثبت سلوكه باختبارات الوحدة في `apps/vendor-admin/app/components/__tests__`.

| المكوّن | الوظيفة | مكونات الأساس المستخدمة فعليًا |
| --- | --- | --- |
| `apps/vendor-admin/app/components/AdminHeader.vue` | هيدر 48px: قائمة الجوال ومسار الصفحة (ShellBreadcrumb) وشارة الكونسول وقائمة الحساب | `AdminMobileNav`, `ShellBreadcrumb`, `UAvatar`, `UBadge`, `UButton`, `UDropdownMenu`, `UIcon` |
| `apps/vendor-admin/app/components/AdminMobileNav.vue` | أقسام الشريط نفسها في درج تحت 768px | `UButton`, `UIcon`, `USlideover` |
| `apps/vendor-admin/app/components/PasskeyButton.vue` | زر الدخول الرئيسي بمفتاح المرور؛ يعمل بعد الترطيب | `UButton` |
| `apps/vendor-admin/app/components/RecoveryCodes.vue` | رموز الاسترداد تُعرض مرة واحدة بعد التسجيل مع إقرار الحفظ | `UAlert`, `UButton`, `UCheckbox` |
| `apps/vendor-admin/app/components/StepUpPanel.vue` | لوحة تأكيد مرتفع الأمان مضمّنة أعلى النافذة، لا حوار | `UButton`, `UIcon` |
| `apps/vendor-admin/app/components/TotpSetup.vue` | إعداد تطبيق المصادقة: رمز QR والمفتاح ورابط otpauth | `UButton` |
| `apps/vendor-admin/app/components/analytics/KpiTile.vue` | مؤشر تحليلي واحد: القيمة والتغير عن الفترة السابقة، أو سبب عدم توفره | `SharedMetricTile`, `UIcon` |
| `apps/vendor-admin/app/components/analytics/PeriodBar.vue` | اختيار فترة التحليلات: الشهر أو الربع أو السنة أو مدى مخصص | `UButton`, `UFormField`, `UInput` |
| `apps/vendor-admin/app/components/analytics/RankedList.vue` | قائمة قصيرة بصفوف وقيم وشريط نسبة اختياري ورابط | `UProgress` |
| `apps/vendor-admin/app/components/analytics/TrendChart.vue` | منحنى الإيراد الشهري المتكرر لآخر 12 شهرًا بـ SVG، يتبع الوضع الداكن واتجاه RTL | |
| `apps/vendor-admin/app/components/team/AccountAction.vue` | لوحة إجراء على حساب فريق (سبب وأدوار وتأكيد داخلي) | `SharedInlineConfirm`, `UAlert`, `UButton`, `UFormField`, `UInput` |
| `apps/vendor-admin/app/components/team/AccountForm.vue` | نموذج دعوة حساب فريق مع حماية المسودة | `SharedFormSection`, `SharedUnsavedChanges`, `UAlert`, `UButton`, `UFormField`, `UInput` |
| `apps/vendor-admin/app/components/team/InvitationLink.vue` | رابط الدعوة مع تاريخ انتهائه وزر النسخ | `UButton`, `UFormField`, `UInput` |
| `apps/vendor-admin/app/components/team/RolePicker.vue` | اختيار أدوار الفريق | `UCheckbox` |
| `apps/vendor-admin/app/components/vendor/AttentionList.vue` | قائمة «يحتاج تصرّفك» في صفحة اليوم: اسم العميل والإجراء ورابط المكان الدقيق | `NuxtLink`, `UIcon` |
| `apps/vendor-admin/app/components/vendor/AuditSubject.vue` | موضوع حدث التدقيق: نوع السجل واسمه المحلول من الخادم مع رابط إلى صفحته عند وجودها | `NuxtLink` |
| `apps/vendor-admin/app/components/vendor/BundleForm.vue` | نموذج الحزمة التجارية | `CapacityLimitsEditor`, `PriceListEditor`, `SharedFormSection`, `SharedUnsavedChanges`, `UAlert`, `UButton`, `UCheckbox`, `UFormField`, `UIcon`, `UInput`, `USelect`, `UTextarea` |
| `apps/vendor-admin/app/components/vendor/CapacityLimitsEditor.vue` | محرر حدود السعة | `UFormField`, `VendorLimitControl` |
| `apps/vendor-admin/app/components/vendor/CatalogFacts.vue` | شريط حقائق سجل الكتالوج تحت العنوان: الحالة ثم السعر والمحتوى والعملاء | |
| `apps/vendor-admin/app/components/vendor/CatalogTabs.vue` | تبويبات قسم الكتالوج (الباقات والحزم والحزم القديمة) عبر `SharedRouteTabs` | `SharedRouteTabs` |
| `apps/vendor-admin/app/components/vendor/CustomerGlance.vue` | ملخص العميل في لمحة: الباقة والتجديد وآخر فاتورة والمساحة وما يحتاج متابعة مع رابط لتبويبه | `SharedMetricTile`, `SharedStatusBadge`, `UButton`, `UIcon` |
| `apps/vendor-admin/app/components/vendor/CustomerTermsForm.vue` | نموذج شروط العميل | `SharedFormSection`, `SharedUnsavedChanges`, `UAlert`, `UButton`, `UFormField`, `UInput`, `USelect`, `UTextarea` |
| `apps/vendor-admin/app/components/vendor/EntitlementSummary.vue` | ملخص الاستحقاقات: التطبيقات والميزات المختارة والحدود | `UBadge` |
| `apps/vendor-admin/app/components/vendor/FormSubsection.vue` | عنوان فرعي ووصف وخط فاصل لكتلة داخل بطاقة قسم النموذج | |
| `apps/vendor-admin/app/components/vendor/LifecyclePanel.vue` | إجراءات دورة حياة الاشتراك بتأكيد داخلي | `SharedFormSection`, `SharedInlineConfirm`, `SharedUnsavedChanges`, `UAlert`, `UButton`, `UFormField`, `UTextarea` |
| `apps/vendor-admin/app/components/vendor/LimitControl.vue` | قائمة نوع الحد وحقل العدد جنبًا إلى جنب | `UInput`, `USelect` |
| `apps/vendor-admin/app/components/vendor/PlanForm.vue` | نموذج الباقة: أربع بطاقات ثم المراجعة، والإجراءات في تذييل اللوحة | `SharedEmptyState`, `SharedFormActions`, `SharedFormSection`, `SharedUnsavedChanges`, `UAlert`, `UButton`, `UCheckbox`, `UFormField`, `UInput`, `USelect`, `UTextarea`, `VendorCapacityLimitsEditor`, `VendorFormSubsection`, `VendorLimitControl`, `VendorPriceListEditor` |
| `apps/vendor-admin/app/components/vendor/PolicyComparison.vue` | مقارنة إعدادات المساحة المطلوبة بالمرصودة صفًا صفًا مع حالة كل صف | `SharedEmptyState`, `SharedStatusBadge` |
| `apps/vendor-admin/app/components/vendor/PriceListEditor.vue` | محرر قائمة الأسعار | `SharedEmptyState`, `UButton`, `UFormField`, `UInput`, `USelect` |
| `apps/vendor-admin/app/components/vendor/ProvisioningSteps.vue` | مراحل تجهيز مساحة العمل قائمة مرتبة: منجزة وحالية وقادمة | `UIcon` |
| `apps/vendor-admin/app/components/vendor/StatusStrip.vue` | شريط الحالة المضغوط في صفحة اليوم: أعداد تفتح القوائم التي تعدّها | `NuxtLink` |
| `apps/vendor-admin/app/components/vendor/SubscriptionSummary.vue` | ملخص اشتراك العميل والطلب المعلّق ومساحة لإجراءاته | `SharedPropertiesPanel`, `SharedPropertyRow`, `SharedStatusBadge`, `UAlert` |
| `apps/vendor-admin/app/components/vendor/SubscriptionTimeline.vue` | خط زمني لمراحل الاشتراك: المطبّق والتغيير المطلوب والطلب المعلّق | `SharedStatusBadge`, `UIcon` |
| `apps/vendor-admin/app/components/vendor/TenantOperationsPanel.vue` | تبويب عمليات مساحة العميل: إضافة عملية بتأكيد مضمّن وآخر العمليات ومنطقة حساسة لصلاحية العمليات | `SharedForbiddenState`, `SharedInlineConfirm`, `SharedPageState`, `SharedRecordSection`, `SharedStatusBadge`, `UAlert`, `UButton`, `UCheckbox`, `UFormField`, `UInput`, `USelect`, `UTextarea` |
| `apps/vendor-admin/app/components/vendor/TenantProperties.vue` | خصائص مساحة العميل: الحالة والنمط والاستضافة والكتالوج وآخر فحص | `SharedPageState`, `SharedPropertiesPanel`, `SharedPropertyRow`, `SharedStatusBadge`, `UButton` |
| `apps/vendor-admin/app/components/vendor/UsageMeters.vue` | مقاييس الاستهلاك مقابل الحدود | `SharedStatusBadge`, `UProgress` |
| `apps/vendor-admin/app/components/vendor/WorkspacePanel.vue` | تبويب مساحة العمل: مراحل التجهيز وفتح المساحة ومقارنة الإعدادات المطلوبة بالمرصودة | `SharedEmptyState`, `SharedPageState`, `SharedRecordSection`, `UAlert`, `UButton`, `VendorPolicyComparison`, `VendorProvisioningSteps` |

## مكونات العمليات

المكونات التالية محلية لتطبيق العمليات، وتعيد استخدام لبنات Storybook المشتركة. الصلاحيات والقرارات تأتي من عقود الخادم.

| المكوّن | الوظيفة | القصة | مكونات الأساس |
| --- | --- | --- | --- |
| `apps/web/app/components/operations/RequestList.vue` | طلباتي، بانتظار موافقتي، متابعة التنفيذ مع فلاتر الرابط | `apps/web/stories/operations/RequestList.stories.ts` | `SharedFilterBar`, `SharedFilterField`, `SharedPageState`, `SharedRecordNumber`, `SharedPagination`, `UButton` |
| `apps/web/app/components/operations/ProcessList.vue` | الإجراءات المنشورة والمسودات بحسب الصلاحية | `apps/web/stories/operations/ProcessList.stories.ts` | `SharedPageHeader`, `SharedPageState`, `SharedRecordNumber`, `SharedPagination`, `UButton` |
| `apps/web/app/components/operations/RequestForm.vue` | إنشاء الطلب وتعديل مسودته واختيار السجل المرتبط | `apps/web/stories/operations/RequestForm.stories.ts` | `SharedFormSection`, `SharedUnsavedChanges`, `UFormField`, `UInput`, `USelect`, `UTextarea` |
| `apps/web/app/components/operations/ProcessForm.vue` | ترتيب المراحل والمراجعين ونتيجة الإجراء | `apps/web/stories/operations/ProcessForm.stories.ts` | `SharedFormSection`, `SharedPersonPicker`, `SharedUnsavedChanges`, `UFormField`, `UButton` |

حالات العمليات تستخدم `shared/data/StatusBadge.vue` وخريطة الدرجات في `composables/operations/state.ts`، مع إبقاء عناوين الحالة وصلاحيات الخادم.

| RACI matrix | `apps/web/app/components/pmo/projects/governance/RaciMatrix.vue` (Story: `apps/web/stories/project/RaciMatrix.stories.ts`) | `SharedDataTable`, `SharedRowActions`, `USelect` |

Meetings use SharedListPage/DataTable/RecordPage/TimelineFrame/StandalonePage. ChatWorkspace uses SharedConversationLayout and ChatInfoPanel.

| جدولة مهمة المشروع داخل سجلها | `apps/web/app/components/pmo/projects/schedule/ProjectTaskScheduleSection.vue` | SharedRecordSection وSharedPageState وScheduleTaskForm، مع UButton؛ نفس توكنات السجل والنموذج، قراءة الجدولة وإظهار محررها للمدير فقط، دون واجهة مستقلة |

| جدولة الصيانة | `apps/web/app/components/settings/MaintenanceSettings.vue` (قصة: `apps/web/stories/settings/MaintenanceSettings.stories.ts`) | `SharedSettingsPage` و`UFormField` و`UInput` و`USelect` و`SharedInlineConfirm`؛ تفضيل أسبوعي وحجز إصدار معلن مع المنطقة الزمنية والصلاحية وحماية المسودة |
