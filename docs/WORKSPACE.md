# خريطة مساحة عمل ليوان

مرجع الواجهة الوحيد هو [DESIGN.md](../DESIGN.md)، ومنه [فهرس المكونات](design-system/components.md) و[مرجع Nuxt UI](design-system/nuxt-ui-reference.md). هذا الملف يحدد مكان العمل والأوامر الحية فقط؛ لا يحتفظ بسجلات تسليم مؤرخة (تاريخها في Git). الحالة الحية تُفحص ولا تُقرأ من وثيقة.

## نسخة العمل

نسخة تطوير المنتج المحلية هي `/Users/tariq/code/webvue` على `main`، ومستودع GitHub اسمه `liwan` (الـ remote هو `origin`، `https://github.com/tariiq222/liwan.git`، ويتتبعه `main`). نسخ المهام المؤقتة (بأي اسم فرع عادي، مثل `<area>-<slug>`) تُنشأ من أحدث `main` بمساحات dependencies وتوليد ومنافذ وقواعد اختبار مستقلة، ولا تُحذف نسخة تستخدمها عملية حية.

- صفحات ومكونات التطبيق: `apps/web/app`؛ التطبيق لا يعتمد على معاينة مستقلة.
- مصدر Odoo وإعداداته في `/Users/tariq/code/odoo` للقراءة فقط.
- التطوير المحلي المعتاد: Nuxt `3000` وOdoo `8069`. ملف apps/web/.env الخاص بالنسخة الرئيسية يحدد قاعدة `liwan_dev` صراحةً؛ لا تختبر على `liwan_dev` أو `odoo19`.
- إصدار Node المعتمد في `.nvmrc` هو `24.15.0`. لكل worktree تثبيت dependencies وملفات Nuxt مولّدة مستقلة. الأمر `npm run dev` يقرأ ملف `.env.worktree` المحلي تلقائيًا ليستخدم قاعدة النسخة ومنافذ Nuxt/Odoo وWebSocket الخاصة بها. المنافذ `3100` و`3103` محجوزة لإدارة البائع؛ المخصّص يستبعدهما للنسخ الجديدة ولا يغيّر حجوزات النسخ الموجودة.

قبل العمل، تحقق من الحالة الحية:

```sh
git status --short --branch
git worktree list
git branch --show-current
git tag -l 'archive/*'
```

قواعد العزل وملكية الملفات والخدمات في [parallel-work.md](parallel-work.md)، والمعمارية والعقود في [AGENTS.md](../AGENTS.md).

## الأرشفة والاسترداد

العمل غير المدمج الذي لم يُحسم يُحفظ في وسم موسوم `archive/<name>` قبل إزالة فرعه (تنظيف الفروع بـ `python3 -B tools/wt.py gc` بإذن المالك فقط). قائمة الوسوم الحية هي ناتج الأمر أعلاه، لا جدول في وثيقة. نسخ الاسترداد الكاملة خارج المستودع (حزم Git ومواد التخزين) تحت `/Users/tariq/Archives/liwan/<تاريخ>/`؛ تحقق من وجود المجلد قبل الاعتماد عليه.

تقارير التقدم والتسليم المؤقتة وخطط التنفيذ المنجزة لا تتحول إلى تعليمات نشطة، ولا تُنقل تلقائيًا إلى أرشيف داخل المصدر؛ عند اعتماد إزالتها يبقى تاريخها في Git. قبل أي حذف، تحقق من ملكية الوثيقة والإحالات واعتماد الأدوات عليها، واحفظ القرارات والأدلة المطلوبة في المرجع المالك. لا تطبق التنظيف على عقد معتمد أو دليل قبول ما زال مرجعيًا للأدوات لمجرد أن عنوانه مؤرخ؛ تاريخ الدليل وحدود SHA والبيئة يبقيانه دليلًا لسياقه، لا شهادة جاهزية حالية. لا تغيير في شرط تفويض الحذف أو حفظ أعمال الآخرين. [أرشيف الواجهة](archive/ui/README.md) ليس وجهة تلقائية لوثائق جديدة.

## CI — GitHub Actions

CI is the `ci` workflow in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): thirteen stages,
selected per change by `tools/ci_scope.py`, each runnable through `deploy/ci`.
Keep a PR draft during local preparation; ready requests deterministic CI and
review of the actual diff. The required status-check policy is current-head
`ci-result` only. Review uses the selected available agent or a human; publication
and protected merging require the owner's explicit authorization. CI does not
repair code, merge PRs, create release tags or deploy. A release tag requires a
full green main run and separate owner authorization. Recheck live GitHub rules
before remote delivery; source policy is not a live protection snapshot.
The full procedure and live-protection caveats are in
[integration-rules.md](agents/integration-rules.md); check commands are in
[testing.md](testing.md#ci-workflow), migrations in [migrations.md](migrations.md).
The control-plane live-PG suites run serially by design: its `test` script sets
`--no-file-parallelism` and a 60s hook timeout because the suites share one scratch control database and TRUNCATE
the same tables.

## مراجع الاستضافة والتجارة

- الحالة الموحدة لنماذج الاستضافة وبوابات الإطلاق: [saas-hosting-direction-status.md](project-closure/saas-hosting-direction-status.md).
- العقد المعتمد: [hosting and acceptance contract](superpowers/specs/liwan-shared-saas-and-sovereign-deployment.md).
- سجلات القبول المرجعية التي تقرؤها الأدوات: [shared-live-acceptance](verification/shared-live-acceptance.md)، [shared-isolation-matrix](verification/shared-isolation-matrix.md)، [shared-first-tenant-acceptance](verification/shared-first-tenant-acceptance.md)، [shared-restore-acceptance](verification/shared-restore-acceptance.md)، وسجلات `cp1-*`.
- تشغيل SaaS التجاري: [saas-commercial-runbook.md](operations/saas-commercial-runbook.md).
- فصل لوحة تحكم البائع: [المواصفة](superpowers/specs/2026-10-15-liwan-vendor-admin-separation-design.md)؛ `apps/vendor-admin` هو العميل الوحيد لخدمة التحكم.
- التحديثات المستمرة: [التصميم](superpowers/specs/2026-10-16-liwan-continuous-updates-design.md) و[سجل القبول](verification/2026-10-16-continuous-updates.html).

## الرواتب السعودية: بوابات الإطلاق المفتوحة

قسم الرواتب في `liwan_hr` وجسر `liwan_hr_finance` منفّذان ومختبَران محليًا ([المواصفة](superpowers/specs/2026-10-20-hr-saudi-payroll-design.md)، [الخطة](superpowers/plans/2026-10-21-hr-saudi-payroll.md)). نجاح الاختبارات المحلية ليس اعتمادًا للإطلاق؛ تبقى هذه البوابات مفتوحة:

- نسب التأمينات الاجتماعية في `data/hr_gosi_rate_data.xml` (وسمها `VERIFY`) تُؤكَّد على gosi.gov.sa، ومنها نسب الخليجيين التي لا صفوف لها بعد.
- أعمدة ملف حماية الأجور في الملف الأساسي `profile_mudad_wps` تُطابَق مع قالب مُدد الحالي، ويُضاف ملف خاص لكل بنك عند طلب العميل.
- معادلات مكافأة نهاية الخدمة وطريقة المخصص الشهري والقيد المحاسبي تراجعها محاسبة قانونية سعودية.
- ملف حماية الأجور والملف البنكي يُقرآن من لقطة بيانات الدفع المحفوظة عند اعتماد المسيّر، لا من التعويضات الحية. مسيّر اعتُمد قبل `19.0.1.12.0` وبقيت لقطته بلا آيبان لا يُصحَّح من الواجهة؛ تصحيحه إجراء موثّق خارج المنتج ([قيود الترحيل](../odoo-addons/liwan_hr/migrations/19.0.1.12.0/README.md)).
- قراران مؤجلان بشرط من المالك وغير منفّذين: الإلغاء المسجّل لإجازات الموظف عند خروجه (يُفتح بعد اعتماد تصميم نقطة امتداد تحفظ تاريخ الإجازة وتعالج الموظف بلا حساب وعزل الشركة)، وسقف فترة التجربة وفق المادة ٥٣ (يُفتح بعد نص رسمي حالي من وزارة الموارد البشرية). حتى ذلك لا يفرض ليوان أيًّا منهما.
- حدود معروفة: لا حضور وانصراف بعد؛ هيكل الرواتب السعودي مملوك للشركة الرئيسية، فلا تستطيع شركة ثانية في القاعدة نفسها حساب أو إنشاء مسيّر قبل نسخ الهيكل لها؛ دور `payroll_manager` يجمع الإدارة والاعتماد والإعداد معًا، وفصل المهام يأتي من إعداد أدوار العميل، والممنوع فقط اعتماد مسيّر يحمل قسيمة المعتمِد نفسه؛ مُنتقي أسماء البنوك غير موجود في نموذج التعويضات.
