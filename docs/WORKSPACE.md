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

الوثائق المنتهية (تقارير التسليم والدمج والتحقق وخطط التنفيذ المنجزة) تُحذف من `docs/` ويبقى أثرها في تاريخ Git؛ لا تُنقل إلى مجلد أرشيف داخل المصدر. [أرشيف الواجهة](archive/ui/README.md) لم يبقَ فيه سجلات.

## CI — GitHub Actions

CI is the `ci` workflow in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): twelve stages, each a
`deploy/ci/<stage>.sh` script, selected per change by `tools/ci_scope.py`. Its aggregate job `ci-result` gates the
`automerge` job for pull requests; the normal route is a direct push of `main` followed by a manual full `ci` run
(owner decision 2026-10-17, valid until the first server deployment; branch protection is not available on the
current plan). Details are in [`testing.md`](testing.md#ci-workflow). The migration policy is
[`migrations.md`](migrations.md). The control-plane live-PG suites run serially by design: its `test` script sets
`--no-file-parallelism` and a 60s hook timeout because the suites share one scratch control database and TRUNCATE
the same tables.

## مراجع الاستضافة والتجارة

- الحالة الموحدة لنماذج الاستضافة وبوابات الإطلاق: [saas-hosting-direction-status.md](project-closure/saas-hosting-direction-status.md).
- العقد المعتمد: [hosting and acceptance contract](superpowers/specs/webvue-shared-saas-and-sovereign-deployment.md).
- سجلات القبول المرجعية التي تقرؤها الأدوات: [shared-live-acceptance](verification/shared-live-acceptance.md)، [shared-isolation-matrix](verification/shared-isolation-matrix.md)، [shared-first-tenant-acceptance](verification/shared-first-tenant-acceptance.md)، [shared-restore-acceptance](verification/shared-restore-acceptance.md)، وسجلات `cp1-*`.
- تشغيل SaaS التجاري: [saas-commercial-runbook.md](operations/saas-commercial-runbook.md).
- فصل لوحة تحكم البائع: [المواصفة](superpowers/specs/2026-10-15-webvue-vendor-admin-separation-design.md)؛ `apps/vendor-admin` هو العميل الوحيد لخدمة التحكم.
- التحديثات المستمرة: [التصميم](superpowers/specs/2026-10-16-webvue-continuous-updates-design.md) و[سجل القبول](verification/2026-10-16-continuous-updates.html).
