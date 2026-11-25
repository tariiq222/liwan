# سجل تعميم لغة تصميم الاجتماعات على `apps/web`

سجل حالة حيّ لمتابعة التنفيذ، وليس سياسة تصميم. المرجع الملزم للشكل هو [DESIGN.md](../../DESIGN.md)، وقواعد العمل في [AGENTS.md](../../AGENTS.md) و[parallel-work.md](../parallel-work.md). تُحدَّث الحالات بعده فقط، ولا تُعدَّل حالة بند قبل دمج PR الخاص به.

آخر تحديث: 2026-11-25 · الفرع الأساس: `main` · المنسّق: `opencode-ui-core`

## دلالة الرموز

| الرمز | المعنى |
|---|---|
| `[ ]` | لم يبدأ |
| `[~]` | قيد التنفيذ في لين مفتوح |
| `[x]` | منفّذ ومتحقق في فرعه؛ لا يعني مدموجًا حتى يُسجَّل رقم الـPR في سجل الدمج |
| `[!]` | موقوف، ويُذكر السبب في سطر البند |
| `[-]` | خارج النطاق بقرار مسجّل |

## خط الأساس المقاس (2026-11-25)

| الفئة | العدد |
|---|---|
| ملفات الصفحات تحت `apps/web/app/pages` | 360 |
| صفحات قوائم تشغيلية (بلا `/new`) | 69 |
| صفحات سجلات تشغيلية | 55 |
| لوحات إنشاء (`/new`) | 53 |
| صفحات إعدادات | 85 |
| أسطح خاصة | 82 |
| صفحات عامة خارج النطاق | 15 |
| تطبيقات بشريط جانبي صريح (`sidebar.ts`) | 2 (meetings, pmo) |
| قوائم على النمط الكامل (KPI + FilterBar + DataTable) | 3 (meetings) |
| صفحات بلا عمود خصائص `#aside` من أصل 55 | 25 |

## قواعد ثابتة لكل اللينات

- تطبيق واحد = لين واحد في الجولة الواحدة: `i18n/locales/{ar,en}/<app>*.json` و`modules/<app>/manifest.ts` ملفان مفردان.
- صفحات `settings/apps/<app>/**` تتبع namespace التطبيق نفسه، فتُنفَّذ في لين التطبيق لا في لين إعدادات منفصل.
- `packages/ui/**` و`DESIGN.md` و`tools/ui_policy.py` مجمّدة بعد PR-0؛ أي حاجة جديدة تعود إلى PR مشترك صغير ثم rebase.
- ممنوع على كل اللينات لمس `common.json` و`settings.json` إلا اللين المنصّي.
- لا تغيير في العقود أو الصلاحيات أو روابط المباشر والرجوع والفلاتر.
- كل لين يملك `pages/<app>/**` و`components/<app>/**` و`modules/<app>/**` وملفات لغته.

## المرحلة 0: البنية المشتركة (مانعة)

اللين: `web-ui-record-hero` · الحالة: `[~]`

- [x] 0.1 `packages/ui/app/components/shared/layout/RecordHero.vue`: بطل السجل المشترك (هوية + بيانات أطراف ومواعيد + بطاقات مؤشر)، مستخرج من `apps/web/app/pages/meetings/[id].vue`.
- [x] 0.2 قصة `apps/web/stories/shared/RecordHero.stories.ts` مع `storyContext`.
- [x] 0.3 اختبار وحدة في `packages/ui/test/` يغطي التخطيط والحالات (فاتح، ملغى، بلا مؤشرات).
- [x] 0.4 فتحة `#kpis` في `SharedListPage` مع تشغيل `kpi-toggle` تلقائيًا عند وجودها، واختبار يمنع الازدواج.
- [x] 0.5 نقل `kpiLink` إلى `packages/ui/app/utils/kpiLink.ts` مع اختبار، وتحديث استيراد الاجتماعات.
- [x] 0.6 تسجيل المكوّن في `STORYBOOK_COMPONENTS` و`LAYER_COMPONENTS` داخل `tools/ui_policy.py`.
- [x] 0.7 قسم «لغة القوائم والسجلات الموحّدة» في `DESIGN.md` §5/§6، وسطر في `docs/design-system/components.md`.
- [x] 0.8 تحويل `meetings/[id].vue` إلى `RecordHero` بلا تغيير بصري، ونقل شريط مؤشرات القائمة إلى `#kpis`.
- [x] 0.9 الفحوص: `ui_policy` (PASS)، `arch_policy` (PASS)، `packages/ui` (92 ملفًا/734 اختبارًا)، `apps/web` (854/7748)، و`vue-tsc` (PASS بحد ذاكرة 8GB).

## الجولات

### R1: التطبيقات الصغيرة (4 لينات متوازية)

#### meetings (`web-meetings-finish`)
- [ ] `meetings/calendar.vue`: رأس وفلاتر موحّدة، ومبدّل العرض من الشريط بدل تكرار الشاشة.
- [ ] `meetings/follow-up`: شريط مؤشرات التوصيات (إجمالي، نشط، متأخر، منجز).
- [ ] `meetings/series`: شريط مؤشرات + فلاتر صفّين.
- [ ] `meetings/series/[id].vue`: بطل + `#aside` بخصائص السلسلة.
- [ ] لقطات 390/1440 عربي/إنجليزي فاتح/داكن.

#### helpdesk + appointments (`web-helpdesk-appointments`)
- [ ] `helpdesk/index`: شريط مؤشرات (مفتوح، بانتظاري، متأخر) + فلاتر + جدول موحّد.
- [ ] `helpdesk/[id]`: بطل + `#aside` + إجراءات التبويبات في رؤوس البطاقات.
- [ ] `helpdesk/reports`: رأس وإجراءات موحّدة.
- [ ] شريط جانبي لـ helpdesk بعدّادات.
- [ ] `appointments/index`: شريط مؤشرات + فلاتر + جدول.
- [ ] `appointments/[id]`: بطل + `#aside` + إجراءات.
- [ ] `settings/apps/appointments`: بطاقات موحّدة.

#### operations (`web-operations-design`)
- [ ] `operations/index`, `pending`, `monitoring`: شريط مؤشرات + فلاتر صفّين + جدول.
- [ ] `operations/self/index`: قائمة موحّدة.
- [ ] `operations/[id]` و`self/[id]`: بطل + `#aside`.
- [ ] شريط جانبي للعمليات بعدّادات.

#### commercial: crm + customers + sales + products (`web-commercial-design`)
- [ ] `crm/opportunities/index`: شريط مؤشرات + فلاتر + جدول.
- [ ] `crm/audit` و`crm/imports`: قائمة موحّدة.
- [ ] `crm/index`: رأس وإجراءات.
- [ ] `settings/apps/crm`: مجموعات وبطاقات.
- [ ] `customers/index` و`customers/[id]`: قائمة + بطل و`#aside`.
- [ ] `sales/index`, `sales/reports`, `sales/[id]`: قائمة + سجل.
- [ ] `products/index` و`products/[id]`: قائمة + سجل.
- [ ] شريط جانبي لـ crm وsales بعدّادات.

### R2: التطبيقات الكبيرة (4 لينات متوازية)

#### hr-core (`web-hr-core`)
- [ ] `hr/index` و`hr/employees/index`: شريط مؤشرات (نشط، على رأس العمل، بلا مدير، قيد التأهيل) + فلاتر + جدول.
- [ ] `hr/employees/[employeeId]`: بطل + `#aside` + إجراءات التبويبات.
- [ ] `hr/departments` و`[departmentId]`: قائمة + سجل.
- [ ] `hr/leave` و`leave/[leaveId]` و`leave/allocations`: قائمة + سجل + مؤشرات.
- [ ] `hr/self/*`: توحيد الرأس والإجراءات.
- [ ] `settings/apps/hr`: مجموعات وبطاقات.
- [ ] شريط جانبي لـ hr بعدّادات الموظفين والإجازات + «المفتوحة مؤخرًا» للموظفين.
- [ ] `hr.json` مفاتيح جديدة فقط.

#### finance (`web-finance-design`)
- [ ] `finance/sales/invoices` و`[id]` و`credit-notes`: قائمة + سجل.
- [ ] `finance/purchases/bills` و`refunds`: قائمة + سجل.
- [ ] `finance/accounting/entries` و`accounts`: قائمة + سجل.
- [ ] `finance/bank/statements` و`[id]/lines/[lineId]`: قائمة + سجل.
- [ ] `finance/budgets` و`assets` و`partners`: قائمة + سجل.
- [ ] `finance/reports` و`finance/index`: رأس وإجراءات.
- [ ] `settings/apps/finance/**`: بطاقات ومجموعات.
- [ ] شريط جانبي للمالية بعدّادات (فواتير غير مدفوعة، فواتير موردين مستحقة).

#### projects (`web-projects-design`)
- [ ] `projects/[id]/index`: بطل الملخص مع شريط تقدم وبطاقات مؤشر.
- [ ] `projects/[id]/tasks` و`milestones` و`baselines`: مؤشرات + فلاتر.
- [ ] `projects/[id]/register` و`changes` و`meetings`: مؤشرات + جداول.
- [ ] `stakeholders` و`register/[registerId]` و`changes/[changeId]` و`finance/[entryId]` و`baselines/[number]`: `#aside`.
- [ ] `settings/apps/projects/catalogs/**`: بطاقات.
- [ ] الحفاظ على إطار المشروع و`provideFrameOwnsActions`.

#### inbox (`web-inbox-design`)
- [ ] `inbox/index` و`orders/index`: رأس وفلاتر.
- [ ] `inbox/[id]/[[panel]]`: بطل المحادثة + `#aside`.
- [ ] `inbox/campaigns/**` و`audiences/**`: قائمة + سجل + لوحة إنشاء.
- [ ] `inbox/flows/**` و`reports/**`: قائمة + سجل.
- [ ] `settings/apps/inbox/**` (25 صفحة): بطاقات ومجموعات وإجراءات.
- [ ] شريط جانبي لـ inbox بعدّادات.

### R3: الرواتب والتوظيف والأصول والإعدادات المنصّية

#### hr-payroll (حسّاس: tester + مراجع حسّاس)
- [ ] `hr/payroll` و`[runId]` و`gosi` و`payslips/[payslipId]`: قائمة + سجل.
- [ ] `hr/self/pay` و`[payslipId]`: توحيد.
- [ ] `settings/apps/hr/audit`: بطاقات.

#### hr-recruitment
- [ ] `hr/recruitment` و`jobs`: مؤشرات (وظائف مفتوحة، مرشحون، مقابلات).
- [ ] `hr/onboarding/**` و`offboarding/**`: قائمة + سجل.
- [ ] `hr/warnings`: قائمة + سجل.

#### hr-assets
- [ ] `hr/assets` و`categories`: قائمة + سجل.
- [ ] `hr/shifts` و`schedules` و`roster`: مؤشرات ورديات.
- [ ] `hr/insurance` و`plans/[planId]`: قائمة + سجل.

#### platform + root (حسّاس في الصلاحيات)
- [ ] `settings/company`, `team` (users, roles, branches, access, security), `system`, `integrations`.
- [ ] `subscription/**`: رأس وإجراءات وبطاقات.
- [ ] `work`, `tasks`, `tasks/[id]`, `notifications`, `apps`, `search`, `account`, `my-tasks`, `notification-digests`.
- [ ] لا مساس بتصميم `chat` و`ai` الخاصين.

### R4: الإغلاق

- [ ] تمرير إصلاحات المراجعات المفتوحة.
- [ ] مسح e2e موحّد لكل تطبيق متأثر.
- [ ] تدقيق RTL/LTR وداكن و390/1440 لكل تطبيق.
- [ ] تحديث هذا السجل بالحالات النهائية والأدلة.
- [ ] إرجاع اللينات بـ`npm run wt -- done --orchestrator <id>` بعد الدمج.

## خارج النطاق (بقرار)

- [-] صفحات الدخول والعامة: `login`, `register`, `forgot-password`, `reset-password`, `invite`, `join`, `find-workspace`, `book`, `quote`, `pay`, `payment-done`, `setup`, `support`.
- [-] شاشات الطباعة: `meetings/[id]/print` و`subscription/invoices/print/[id]`.
- [-] `chat/**` و`ai/**`: لهما دستور عرض خاص في DESIGN.md §3.

## سجل القرارات

| # | القرار | الحالة | التاريخ |
|---|---|---|---|
| 1 | KPI لكل قائمة تشغيلية تُنتج أرقامًا بحالات أو فترات، واستثناء الإعدادات والقوائم المرجعية | افتراضي معتمد | 2026-11-25 |
| 2 | `AppSidebarMenu` لثمانية تطبيقات، و«المفتوحة مؤخرًا» في أربعة | افتراضي معتمد | 2026-11-25 |
| 3 | الترتيب: الاجتماعات ثم helpdesk/appointments ثم HR ثم المالية ثم الباقي | افتراضي معتمد | 2026-11-25 |
| 4 | الإعدادات 85 صفحة تُوزَّع على لينات التطبيقات، والمنصّية في لين مستقل | افتراضي معتمد | 2026-11-25 |
| 5 | الدمج تسلسلي بكلمة المالك بعد كل جولة | معتمد | 2026-11-25 |

## سجل الدمج

| PR | الفرع | النطاق | الحالة | التاريخ |
|---|---|---|---|---|
| — | `web-ui-record-hero` | المرحلة 0 | مكتمل في الفرع، بانتظار المراجعة المستقلة والـPR | — |
