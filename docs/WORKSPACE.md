# خريطة مساحة عمل ويب فيو

مرجع الواجهة الوحيد هو [DESIGN.md](../DESIGN.md)، ومنه [فهرس المكونات](design-system/components.md) و[مرجع Nuxt UI](design-system/nuxt-ui-reference.md). هذا الملف يحدد مكان العمل والأوامر الحية فقط؛ لا يحتفظ بسجلات تسليم مؤرخة (تاريخها في Git). الحالة الحية تُفحص ولا تُقرأ من وثيقة.

## نسخة العمل

نسخة تطوير المنتج المحلية هي `/Users/tariq/code/webvue` على `main`، ومستودع GitHub اسمه `webvue` (الـ remote هو `origin`، `https://github.com/tariiq222/webvue.git`، ويتتبعه `main`). نسخ المهام المؤقتة `codex/<area>-<slug>` تُنشأ من أحدث `main` بمساحات dependencies وتوليد ومنافذ وقواعد اختبار مستقلة، ولا تُحذف نسخة تستخدمها عملية حية.

- صفحات ومكونات التطبيق: `apps/web/app`؛ التطبيق لا يعتمد على معاينة مستقلة.
- مصدر Odoo وإعداداته في `/Users/tariq/code/odoo` للقراءة فقط.
- التطوير المحلي المعتاد: Nuxt `3000` وOdoo `8069`. لا تختبر على `odoo19`.

قبل العمل، تحقق من الحالة الحية:

```sh
git status --short --branch
git worktree list
git branch --show-current
git tag -l 'archive/*'
```

قواعد العزل وملكية الملفات والخدمات في [parallel-work.md](parallel-work.md)، والمعمارية والعقود في [AGENTS.md](../AGENTS.md).

## الأرشفة والاسترداد

العمل غير المدمج الذي لم يُحسم يُحفظ في وسم موسوم `archive/<name>` قبل إزالة فرعه (تنظيف الفروع بـ `python3 -B tools/wt.py gc` بإذن المالك فقط). قائمة الوسوم الحية هي ناتج الأمر أعلاه، لا جدول في وثيقة. نسخ الاسترداد الكاملة خارج المستودع (حزم Git ومواد التخزين) تحت `/Users/tariq/Archives/webvue/<تاريخ>/`؛ تحقق من وجود المجلد قبل الاعتماد عليه.

تقارير التقدم والتسليم المؤقتة وخطط التنفيذ المنجزة لا تتحول إلى تعليمات نشطة، ولا تُنقل تلقائيًا إلى أرشيف داخل المصدر؛ عند اعتماد إزالتها يبقى تاريخها في Git. قبل أي حذف، تحقق من ملكية الوثيقة والإحالات واعتماد الأدوات عليها، واحفظ القرارات والأدلة المطلوبة في المرجع المالك. لا تطبق التنظيف على عقد معتمد أو دليل قبول ما زال مرجعيًا للأدوات لمجرد أن عنوانه مؤرخ؛ تاريخ الدليل وحدود SHA والبيئة يبقيانه دليلًا لسياقه، لا شهادة جاهزية حالية. لا تغيير في شرط تفويض الحذف أو حفظ أعمال الآخرين. [أرشيف الواجهة](archive/ui/README.md) ليس وجهة تلقائية لوثائق جديدة.

## CI — GitHub Actions

CI is the `ci` workflow in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): twelve stages,
selected per change by `tools/ci_scope.py`, each runnable through `deploy/ci`.
Delivery uses a draft PR, then ready requests review and bounded automatic delivery.
`pr-delivery` requires current CI/review/scope gates, repairs safe failures at most
three times, and merges normally. Sensitive scope needs exact-head owner approval. The required delivery gates are `ci-result`, `code-review` and `delivery-policy`, an up-to-date branch and resolved review threads, with no ruleset bypass actors. Recheck the live GitHub settings before delivery; this document is not a live protection snapshot. Successful full main CI produces the
next `release/19.0.X.Y.Z` tag without deploying production. The separate
`pr-review` workflow supplies `code-review`: Codex first, Claude on service
unavailability; activation prerequisites and bootstrap are in the integration policy.
The full procedure and live-protection caveats are in
[integration-rules.md](agents/integration-rules.md); check commands are in
[testing.md](testing.md#ci-workflow), migrations in [migrations.md](migrations.md).
The control-plane live-PG suites run serially by design: its `test` script sets
`--no-file-parallelism` and a 60s hook timeout because the suites share one scratch control database and TRUNCATE
the same tables.

## مراجع الاستضافة والتجارة

- الحالة الموحدة لنماذج الاستضافة وبوابات الإطلاق: [saas-hosting-direction-status.md](project-closure/saas-hosting-direction-status.md).
- العقد المعتمد: [hosting and acceptance contract](superpowers/specs/webvue-shared-saas-and-sovereign-deployment.md).
- سجلات القبول المرجعية التي تقرؤها الأدوات: [shared-live-acceptance](verification/shared-live-acceptance.md)، [shared-isolation-matrix](verification/shared-isolation-matrix.md)، [shared-first-tenant-acceptance](verification/shared-first-tenant-acceptance.md)، [shared-restore-acceptance](verification/shared-restore-acceptance.md)، وسجلات `cp1-*`.
- تشغيل SaaS التجاري: [saas-commercial-runbook.md](operations/saas-commercial-runbook.md).
- فصل لوحة تحكم البائع: [المواصفة](superpowers/specs/2026-10-15-webvue-vendor-admin-separation-design.md)؛ `apps/vendor-admin` هو العميل الوحيد لخدمة التحكم.
- التحديثات المستمرة: [التصميم](superpowers/specs/2026-10-16-webvue-continuous-updates-design.md) و[سجل القبول](verification/2026-10-16-continuous-updates.html).

## الرواتب السعودية: بوابات الإطلاق المفتوحة

قسم الرواتب في `webvue_hr` وجسر `webvue_hr_finance` منفّذان ومختبَران محليًا ([المواصفة](superpowers/specs/2026-10-20-hr-saudi-payroll-design.md)، [الخطة](superpowers/plans/2026-10-21-hr-saudi-payroll.md)). نجاح الاختبارات المحلية ليس اعتمادًا للإطلاق؛ تبقى هذه البوابات مفتوحة:

- نسب التأمينات الاجتماعية في `data/hr_gosi_rate_data.xml` (وسمها `VERIFY`) تُؤكَّد على gosi.gov.sa، ومنها نسب الخليجيين التي لا صفوف لها بعد.
- أعمدة ملف حماية الأجور في الملف الأساسي `profile_mudad_wps` تُطابَق مع قالب مُدد الحالي، ويُضاف ملف خاص لكل بنك عند طلب العميل.
- معادلات مكافأة نهاية الخدمة وطريقة المخصص الشهري والقيد المحاسبي تراجعها محاسبة قانونية سعودية.
- حدود معروفة: لا حضور وانصراف بعد؛ هيكل الرواتب السعودي مملوك للشركة الرئيسية، فلا تستطيع شركة ثانية في القاعدة نفسها حساب أو إنشاء مسيّر قبل نسخ الهيكل لها؛ دور `payroll_manager` يجمع الإدارة والاعتماد والإعداد معًا، وفصل المهام يأتي من إعداد أدوار العميل، والممنوع فقط اعتماد مسيّر يحمل قسيمة المعتمِد نفسه؛ مُنتقي أسماء البنوك غير موجود في نموذج التعويضات.
