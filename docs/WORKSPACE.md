# خريطة مساحة عمل نسق

مرجع الواجهة الوحيد هو [DESIGN.md](../DESIGN.md)، ومنه [فهرس المكونات](design-system/components.md) و[مرجع Nuxt UI](design-system/nuxt-ui-reference.md). هذا الملف يحدد مكان العمل والاسترداد، ولا يضيف سياسة تصميم.

## نسخة العمل

نسخة تطوير المنتج المحلية هي `/Users/tariq/code/nasq` على `main`. أحدث نقطة تحقق موثّقة لطبقة المنصة: [Phase 2](verification/2026-09-21-phase-2-platform.md) فوق تثبيت رموز الحالة `3c78e9d5` وPhase 1. هذا وصف لنقطة تحقق، لا بديل عن فحص الحالة الحية. تفاصيل دمج الواجهة السابق في [تقرير 2026-09-12](verification/2026-09-12-main-integration-cleanup.md).

- صفحات ومكونات التطبيق: `apps/web/app`؛ التطبيق لا يعتمد على معاينة مستقلة.
- المرجع البصري `/Users/tariq/Downloads/nasq-ui` للمقارنة، وليس تطبيقًا تشغيليًا أو مصدر بيانات.
- مصدر Odoo وإعداداته وحالة Git في `/Users/tariq/code/odoo` للقراءة فقط.
- التطوير المحلي المعتاد: Nuxt `3000` وOdoo `8069`. لا تختبر على `odoo19`.

قبل العمل، تحقق من الحالة الحية:

```sh
git status --short --branch
git worktree list
git branch --show-current
```

قواعد العزل وملكية الملفات والخدمات في [parallel-work.md](parallel-work.md)، والمعمارية والعقود في [CLAUDE.md](../CLAUDE.md). تُنشأ نسخ المهام المؤقتة من أحدث main بمساحات dependencies وتوليد ومنافذ وقواعد اختبار مستقلة. لا حذف لنسخة تستخدمها عملية حية.

سجل تنظيف 2026-09-12 تاريخي: أزيلت فيه 8 نسخ عمل و7 فروع، وكانت 3 نسخ تحت `.claude/worktrees` باقية آنذاك. في فحص 2026-09-20 كان هذا المجلد فارغًا؛ لا تعتمد وصف الجلسات القديمة كحالة حية. لا تُحذف نسخة تستخدمها عملية حية.

## حالة التنظيف — 2026-09-20

أزيلت خمس نسخ عمل منتهية وخمسة فروع محلية بعد أرشفتها والتحقق من عدم استخدامها. بقيت نسخة `/Users/tariq/code/nasq` ونسخة العمل الجارية `.worktrees/phase-1-isolation`؛ لم تتغير فروع GitHub أو الوسوم أو الخدمات أو قواعد البيانات. تفاصيل الجرد والحفظ وحدود التحقق في [تقرير التنظيف](verification/2026-09-20-workspace-cleanup.md).

نسخة الاسترداد: `/Users/tariq/code/nasq-cleanup-20260920-211532`؛ تحتوي Git bundle كاملًا وأرشيف النسخ الخمس، بما فيها الملفات المتجاهلة، وجرد SHA-256 وإرشادات الاستعادة. تحقق المحتوى والروابط شمل 51,850 عنصرًا. لا تُحذف ضمن تنظيف لاحق ولا تُرفع إلى GitHub؛ قد تحتوي مواد محلية حساسة.

## أدلة التسليم والاسترداد

- [طبقة منصة Phase 2](verification/2026-09-21-phase-2-platform.md): استحقاقات المستأجر، دورة الحياة، الحصص، عقد `/me`، وحراسة الواجهة. التحقق الموجّه موثّق؛ مجموعة Odoo الكاملة وCI الست لم تُشغَّل في ذلك التقرير.
- [تثبيت رموز الحالة المفكوخة](verification/2026-09-21-status-code-pinning.md): إغلاق بند المتابعة الثالث من مراجعة Phase 1 بتثبيت 15 موقعًا على حالات دقيقة، وتشغيلان كاملان نظيفان.
- [مراجعة دمج Phase 1](verification/2026-09-20-phase-1-review.md): الثغرة التشغيلية التي أُصلحت في مسار الترقية الأحادي، وإغلاق المعلّقات الثلاثة.
- [تنظيف الفروع ونسخ العمل وتحديث الحالة](verification/2026-09-20-workspace-cleanup.md).
- [دمج الواجهة والتنظيف والتحقق الجديد](verification/2026-09-12-main-integration-cleanup.md).
- [تطبيق الواجهة الجديدة](reports/ui-redesign-2026-09-12.md)، [اللون الرئيسي فقط](reports/ui-primary-color-review-2026-09-12.md)، [تنظيف المراجع](verification/2026-09-12-ui-documentation-cleanup.md): تقارير تسليم بتاريخها، وليست سياسات إضافية أو الحالة الحية.
- [خطة موثوقية Phase 0](superpowers/plans/2026-09-19-phase-0-reliability.md) و[مواصفة نماذج التوزيع](superpowers/specs/2026-09-19-nasq-distribution-models-design.md): تنفيذ الموثوقية مدمج في `main` عبر PR #3 عند `1b0394c9`. توجد وظائف CI الست وأدوات البناء والترقية والاسترجاع في المصدر. نتائج GitHub Actions لم تُتحقق في مراجعة 2026-09-20؛ لا يُستنتج من الدمج وحده اكتمال بوابات المرحلة أو نشر إنتاجي. طبقة `nasq-cli` ليست ضمن هذا التسليم.
- [خطة عزل Phase 1](superpowers/plans/2026-09-20-phase-1-isolation.md): `nasq_platform` و`root_company_id` وعزل الشركة، مدمجة في `main` عبر `5fbeca27` و`fe10a669` و`de312f16`. CI أخضر بالوظائف الست على الدفعتين، ومجموعة Odoo `610` اختبارًا نظيفة في ثلاثة تشغيلات متتالية.
- نسخة حفظ العمل قبل هذا الدمج: `/Users/tariq/code/nasq-merge-20260912-artifacts`؛ تحتوي Git bundle وملفات المصدر وجرد الفروق وسجلات الاختبارات. لا تُحذف ضمن تنظيف نسخ المهام.
- `/Users/tariq/code/nasq-security-evidence-20260909` يحتوي بيئة يستخدمها Odoo المحلي؛ لا تحذفه على أنه مجلد أدلة زائد.
- [أرشيف الواجهة](archive/ui/README.md) و[خريطة العمل السابقة كاملة](archive/ui/workspace-before-2026-09-12.md) يحفظان التاريخ. تقارير قديمة قد تشير إلى فروع ومنافذ وملفات أزيلت؛ تحقق قبل استعادتها أو حذف غيرها.

التحقق المحلي لا يثبت النشر. الـ remote هو `origin` (`https://github.com/tariiq222/nasq.git`) ويتتبعه `main`؛ قارن `main` مع `origin/main` بعد `git fetch` قبل أي دمج. لا commit أو دمج أو push أو نشر أو حذف عمل دون تفويض الإجراء؛ الدمج يحفظ القرارات السابقة وفق [AGENTS.md](../AGENTS.md).

## Vendor workspace local integration — 2026-09-23

The CP2 operator, independent control service, and company-only `/vendor` pages
are integrated locally from baseline `abc2400e`. Vendor flags remain disabled
by default. See [integration evidence](verification/2026-09-23-vendor-local-integration.md)
for checks and remaining delivery boundaries. This does not establish a remote
push, production deployment, recovery-ready backup, billing, CRM, or a completed
government/customer delivery package.

## Shared-SaaS lane integration — 2026-09-29

The shared-tenant SaaS lane is integrated locally into `main` (`7ffee66e` +
gate fixes `3fd76c38`) from baseline `d780862e`: durable registry and queue
(schema 005–008), tenant routing boundary and guard overlay, physically fenced
adapter, provision readiness/activation gate, backup/restore authority,
sandbox order/payment lifecycle, and the acceptance suites (live-SQL gates,
ten-tenant isolation matrix, full journey). Gate evidence and explicit
boundaries: [packages 1–3](verification/shared-live-sql-gate.md),
[isolation matrix](verification/shared-isolation-matrix.md),
[fenced adapter](verification/shared-fenced-adapter.md),
[packages 4–7](verification/shared-packages-4-7.md). This is local acceptance
only: no push, no deployment, no real Odoo/ACL drill, no real payment provider,
and no release approval. The two tool fixes unblocked root gates that already
failed on the `d780862e` baseline (reproduced before the merge, not caused by
it).
