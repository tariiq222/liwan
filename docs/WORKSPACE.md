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

نسخة الاسترداد: `/Users/tariq/Archives/nasq/2026-10-04/nasq-cleanup-20260920-211532` (نُقلت كاملة من مسارها السابق في `code` يوم 2026-10-04)؛ تحتوي Git bundle كاملًا وأرشيف النسخ الخمس، بما فيها الملفات المتجاهلة، وجرد SHA-256 وإرشادات الاستعادة. تحقق المحتوى والروابط شمل 51,850 عنصرًا. لا تُحذف ضمن تنظيف لاحق ولا تُرفع إلى GitHub؛ قد تحتوي مواد محلية حساسة.

## أدلة التسليم والاسترداد

- [طبقة منصة Phase 2](verification/2026-09-21-phase-2-platform.md): استحقاقات المستأجر، دورة الحياة، الحصص، عقد `/me`، وحراسة الواجهة. التحقق الموجّه موثّق؛ مجموعة Odoo الكاملة وCI الست لم تُشغَّل في ذلك التقرير.
- [تثبيت رموز الحالة المفكوخة](verification/2026-09-21-status-code-pinning.md): إغلاق بند المتابعة الثالث من مراجعة Phase 1 بتثبيت 15 موقعًا على حالات دقيقة، وتشغيلان كاملان نظيفان.
- [مراجعة دمج Phase 1](verification/2026-09-20-phase-1-review.md): الثغرة التشغيلية التي أُصلحت في مسار الترقية الأحادي، وإغلاق المعلّقات الثلاثة.
- [تنظيف الفروع ونسخ العمل وتحديث الحالة](verification/2026-09-20-workspace-cleanup.md).
- [دمج الواجهة والتنظيف والتحقق الجديد](verification/2026-09-12-main-integration-cleanup.md).
- [تطبيق الواجهة الجديدة](reports/ui-redesign-2026-09-12.md)، [اللون الرئيسي فقط](reports/ui-primary-color-review-2026-09-12.md)، [تنظيف المراجع](verification/2026-09-12-ui-documentation-cleanup.md): تقارير تسليم بتاريخها، وليست سياسات إضافية أو الحالة الحية.
- [خطة موثوقية Phase 0](superpowers/plans/2026-09-19-phase-0-reliability.md) و[مواصفة نماذج التوزيع](superpowers/specs/2026-09-19-nasq-distribution-models-design.md): تنفيذ الموثوقية مدمج في `main` عبر PR #3 عند `1b0394c9`. توجد وظائف CI الست وأدوات البناء والترقية والاسترجاع في المصدر. نتائج GitHub Actions لم تُتحقق في مراجعة 2026-09-20؛ لا يُستنتج من الدمج وحده اكتمال بوابات المرحلة أو نشر إنتاجي. طبقة `nasq-cli` ليست ضمن هذا التسليم.
- [خطة عزل Phase 1](superpowers/plans/2026-09-20-phase-1-isolation.md): `nasq_platform` و`root_company_id` وعزل الشركة، مدمجة في `main` عبر `5fbeca27` و`fe10a669` و`de312f16`. CI أخضر بالوظائف الست على الدفعتين، ومجموعة Odoo `610` اختبارًا نظيفة في ثلاثة تشغيلات متتالية.
- نسخة حفظ العمل قبل هذا الدمج: `/Users/tariq/Archives/nasq/2026-10-04/nasq-merge-20260912-artifacts`؛ نُقلت كاملة من `code` يوم 2026-10-04، وتحتوي Git bundle وملفات المصدر وجرد الفروق وسجلات الاختبارات. لا تُحذف ضمن تنظيف نسخ المهام.
- `/Users/tariq/code/nasq-security-evidence-20260909` يحتوي بيئة يستخدمها Odoo المحلي؛ لا تحذفه على أنه مجلد أدلة زائد.
- [أرشيف الواجهة](archive/ui/README.md) و[خريطة العمل السابقة كاملة](archive/ui/workspace-before-2026-09-12.md) يحفظان التاريخ. تقارير قديمة قد تشير إلى فروع ومنافذ وملفات أزيلت؛ تحقق قبل استعادتها أو حذف غيرها.

التحقق المحلي لا يثبت النشر. الـ remote هو `origin` (`https://github.com/tariiq222/nasq.git`) ويتتبعه `main`؛ قارن `main` مع `origin/main` بعد `git fetch` قبل أي دمج. لا commit أو دمج أو push أو نشر أو حذف عمل دون تفويض الإجراء؛ الدمج يحفظ القرارات السابقة وفق [AGENTS.md](../AGENTS.md).

## CI — Woodpecker (2026-09-29)

CI is Woodpecker, defined in [`.woodpecker.yml`](../.woodpecker.yml); GitHub
Actions was removed from the project. The main pipeline runs seven steps on the
local instance (`prepare`, `static`, `control-plane`, `odoo`, `upgrade`,
`restore-drill`, `e2e-mock`) and is portable to any Woodpecker deployment with
a Docker backend. The Docker image gate lives in
[`deploy/woodpecker/image.yml`](../deploy/woodpecker/image.yml) and is
activated by pointing the repository pipeline path at it: it needs an agent
whose engine can start a privileged dind service, which the local
rootless-dind engine cannot do (nested rootlesskit fails with
`newuidmap: Operation not permitted`). Keep it out of `.woodpecker/` because a
pipeline file whose `when` matches nothing makes the server reject the whole
webhook.
`.github/` keeps only non-Actions files (Copilot instructions and hooks). A
temporary Cloudflare tunnel fronts the instance because GitHub rejects
`localhost` webhook URLs; if the tunnel or its address changes,
`WOODPECKER_HOST` must be updated and the server restarted. The migration
policy is [`migrations.md`](migrations.md). The control-plane live-PG suites
run serially by design: its `test` script sets `--no-file-parallelism` and a
60s hook timeout because the suites share one scratch control database and
TRUNCATE the same tables.

## Vendor workspace local integration — 2026-09-23

The CP2 operator, independent control service, and company-only `/vendor` pages
are integrated locally from baseline `abc2400e`. Vendor flags remain disabled
by default. See [integration evidence](verification/2026-09-23-vendor-local-integration.md)
for checks and remaining delivery boundaries. This does not establish a remote
push, production deployment, recovery-ready backup, billing, CRM, or a completed
government/customer delivery package.

## Shared-SaaS lane integration — 2026-09-29

Current implementation status and remaining release gates are maintained in
[the consolidated hosting status](project-closure/saas-hosting-direction-status.md).
The following is the integration record, not a new test run.

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

### Shared restore queue — 2026-09-30

The shared-tenant restore path is wired end-to-end in `apps/control-plane`:
signed HTTP enqueue, approval-gated exactly-once consumption, worker/recovery/
dispatcher execution only through the fenced adapter, and one control
transaction with explicit lock ordering. Evidence record and remaining
boundaries: [shared restore queue](verification/shared-restore-queue.md). The
live control-plane suites now run serially by design. Readiness stays
`not ready`; this is local only: no push, no deployment, no real
Odoo/filestore restore, and the tenant storage is synthetic marker schemas.

### Shared live acceptance — 2026-09-30

Local Caddy/TLS/image/browser acceptance for two tenants passed 9/9 on the
committed configuration. Evidence: [shared live acceptance](verification/shared-live-acceptance.md).
This is local only: no push, no deployment, no public TLS, no DNS, 2 tenants
not 10, no MFA/websocket/filestore restore. F2b (initial policy grant missing
from provisioning) and F5 (nasq_odoo zone exhaustible by ordinary traffic)
remain open (superseded below: fixed in source and verified live in r3).
Readiness stays `not ready`.

### F2b/F5 fixes and regenerated gate evidence — 2026-09-30

F2b and F5 are fixed in source on `codex/integration-f2b-f5-gate`, based on local
`main` `329ef573`: shared provisioning now requires and verifies the initial
tenant policy (server-derived catalog policy, `initial_policy` activation gate,
revision >= 1, carried through backup/restore), and the edge no longer counts the
`get_session_info` page-load probe against the shared auth rate limit (it moves
into `nasq_odoo` by exact path, with image bytes in a new `nasq_odoo_image`
zone). Seven pre-existing local scratch control databases had been dropped by
pattern with no backup, so the evidence they backed was regenerated at current
HEAD on fresh scratch databases: [regenerated gate evidence](verification/2026-09-30-regenerated-gate-evidence.md).
Current status: [shared live acceptance](verification/shared-live-acceptance.md)
and [hosting direction status](project-closure/saas-hosting-direction-status.md).
Local only: no push and no deployment. `main` (`4eab6fd7`) includes
`codex/integration-f2b-f5-gate` and the r3 live acceptance rerun is recorded
(F2b and F5 verified live in r3).

### أرشيف العمل غير المدمج — 2026-10-01

اندمجت كل الفروع في `main` وأُزيلت worktrees وفروع `codex/*`. العمل الفريد غير
المتحقق حُفظ في وسوم موسومة (annotated) تحت `archive/` ولم يُدمج في `main`.
الحالة لكل عنصر: غير متحقق، بانتظار المراجعة. الأحجام مقابل `main`.

| الوسم | sha | الغرض | الحجم | الحالة |
|---|---|---|---|---|
| `archive/saas-closure-wip` | `dc1643da` | مسودات إغلاق SaaS متجاوزة (10 commits) | 314 ملفًا، +227082/−4901 | غير متحقق، بانتظار المراجعة |
| `archive/managed-saas-acceptance-wip` | `41bf98a4` | سجلات قبول SaaS المُدار وإغلاق المشروع (4 commits) | 190 ملفًا، +28098/−14112 | غير متحقق، بانتظار المراجعة |
| `archive/integrate-offline` | `8747cfbc` | أدوات النشر دون اتصال: bootstrap/import/lifecycle | 18 ملفًا، +19740/−50 | غير متحقق، بانتظار المراجعة |
| `archive/integrate-pmo` | `3a99c1dc` | تحديثات PMO للمهام والمشاريع والقوالب (تتضمن تعديلات غير مُلتزمة سابقًا) | 9 ملفات، +190/−70 | غير متحقق، بانتظار المراجعة |
| `archive/architecture-evidence-wip` | `1168c5db` | أدلة المعمارية v2/v3 وv1 من checkout الرئيسي (`docs/architecture`) | 352 ملفًا، +168890/−22364 | غير متحقق، بانتظار المراجعة |
| `archive/stash-cp2-originals` | `558e9f8a` | stash: أصول CP2 قبل الدمج (2026-09-23) | 372 ملفًا، +403/−44287 | غير متحقق، بانتظار المراجعة |

(`archive/pre-reorganization-20260905` وسم سابق لا علاقة له بهذا الأرشيف.)


## تجميع المصدر المحلي — 2026-10-04

اكتمل تجميع المصدر محليًا في النسخة المرجعية `/Users/tariq/code/nasq` على
`main` بالالتزام `a3fb8925acb9643d35955e9c979094b210c42a94`، وشمل 398 مسارًا.
حُفظت التغييرات المحلية العشرون غير المرتبطة بالتجميع. الخرائط المؤرخة أعلاه
سجلات تاريخية؛ المرجع الحالي هو هذا القسم وأدلة الإغلاق المحلية.

أُزيلت نسخ `nasq-pmo-docker-acceptance` و`saas-commercial`
و`saas-lifecycle-integration` و`saas-real-lifecycle` ومجلداتها الحاضنة بعد
التحقق من الحفظ وعدم استخدامها؛ وكانت نسخة HR للمستأجر الأول قد أُزيلت سابقًا.
بقي المرشح المؤقت `/tmp/nasq-consolidation-20261004/remaining` لنقل تحديث هذه
الوثيقة إلى `main` ثم إزالته بواسطة منسق الدمج. سيُسجّل التزام الوثيقة النهائي
والتحقق من بقاء نسخة `main` وحدها في
`/Users/tariq/Archives/nasq/2026-10-04/nasq-preservation-20261003-220705/remaining-20261004-141720/FINAL-STATUS.md`؛
لا يُعدّ إنجاز هاتين الخطوتين مثبتًا هنا مسبقًا.

أُوقفت 21 حاوية قبول محلي وعُطّل إعادة تشغيلها التلقائي، مع إبقائها للاسترداد.
حُفظت 13 وحدة تخزين مسماة، بما فيها قواعد البيانات وملفات المستأجرين؛ هذا حفظ
للبيانات القائمة وليس شهادة صلاحية نسخة احتياطية لقواعد البيانات. لا توجد
إحالات bind إلى النسخ القديمة في الحاويات العاملة. الحاويات الموقوفة تحتفظ
بإعدادات الربط القديمة، ولذلك يلزم استرداد مسارات المصدر قبل استخدامها مجددًا.

مواد الاسترداد محفوظة تحت `/Users/tariq/Archives/nasq/2026-10-04/nasq-preservation-20261003-220705` بعد نقل الأرشيف يوم 2026-10-04.
طابق الجرد الحديث 216,179 عنصرًا من النسخ الأربع مع الأرشيفات الأساسية المتحقق
من استعادتها وفهارس Git وبيانات الجرد الحديثة. وتحقّق Git bundle جديد حجمه نحو
55 MB يشمل التزام `main` المحلي؛ لا يشمل هذا الادعاء التغييرات غير الملتزمة
أو اتساق قواعد البيانات. أُبقيت مراجع فروع المصدر ومواد الاسترداد، ولم تُحذف
ضمن تنظيف نسخ العمل. الوسوم `archive/*` القديمة وحدها لا تثبت حفظ آخر الملفات
غير الملتزمة أو المتجاهلة.

تسجّل أدلة القبول نجاح اختبارات الجذر: 533 Python، و178 و1,131 Vitest؛
والتجاري: 65 و703 مع اختبارين متجاوزين. نجح تثبيت Odoo الجديد في 673 اختبارًا
والترقية في 44، مع قراءة مستقلة للسياسات القديمة و`null` والقيم الرقمية
والترقية الثانية. نجحت فحوص الأنواع والبناء وruff والمراجعة المستقلة V3.
هذه نتائج قبول محلي للمصدر. أدلة الدمج والحفظ والتنظيف وإيقاف التشغيل والقبول
هي ملفات `LOCAL-MERGE-RESULT.json` و`FRESH-PRESERVATION-RESULT.json`
و`FOUR-WORKTREE-CLEANUP-RESULT.json` و`RUNTIME-RETIREMENT-RESULT.json`
و`ACCEPTANCE-EVIDENCE.json` داخل مجلد `remaining-20261004-141720` المذكور أعلاه.

تبقى بوابات إطلاق المنتج: ingestion موثوق لقياس الاستخدام، ومسارات مصادقة
وواجهة لإلغاء الطلب وإعادة الاختيار وتسوية حالاته العالقة. حارس الطلب المالي
لا يسمح بإزاحة طلب فاشل قد ينجح دفعه لاحقًا، ولا يُكمل مسار التسوية. الفشل
التاريخي E04 والحالات E05–E14 وE16 المحظورة وE15 الجزئية تظل أدلة تاريخية.
قبول المزود الحقيقي والمستأجر والبريد والمتصفح والسعة والاسترداد وRPO/RTO
يحتاج أدلته المستقلة. لم يحدث push أو نشر أو تغيير إنتاج ضمن هذا التجميع.

## جرد الأرشيفات وترتيبها — 2026-10-04

التحقق الحي أثبت وجود worktree واحدة: `/Users/tariq/code/nasq` على `main`
عند `7208cf961ecbeb60e988e840fe2ca7cd4c3a3b9d`، وفيها إصلاحات لوحة البائع/SaaS.
هذه نقطة تحقق مؤرخة؛ افحص Git قبل العمل. إصلاح الإلغاء وإعادة الاختيار يغطي
الشراء المؤهل غير المدفوع قبل بدء التنفيذ؛ تسوية حالات الدفع العالقة والقبول
مع المزود الحقيقي وقياس الاستخدام والسعة والتعافي ما زالت تحتاج أدلتها.

نُقلت ثمانية مجلدات حفظ وأدلة كاملة، بأسمائها الأصلية، إلى
`/Users/tariq/Archives/nasq/2026-10-04` بصلاحية خاصة. التفاصيل الحالية في
`README.md` وخريطة المسارات في `RELOCATION-MAP.json` هناك. بقيت التقارير
والسكربتات التاريخية دون إعادة كتابة؛ ترجم مساراتها المطلقة القديمة بالخريطة
ولا تشغّل سكربتات التنظيف القديمة. بقي مجلد `nasq-security-evidence-20260909`
في مكانه لأنه يحتوي بيئة Odoo ومواد استرداد قواعد وملفات خاصة.

أُزيلت عشر نسخ مفتوحة في `restore-rehearsal` فقط، بعد مطابقتها حديثًا مع
الأرشيفات وفهارسها عبر 488,551 عنصرًا، بالمحتوى والصلاحيات والروابط. أُبقيت
الأرشيفات الأصلية وحزم Git وكل الأدلة. مساحة `du` المحسوبة للنسخ المكررة نحو
6.94 GiB؛ لا يُستنتج منها مقدار زيادة المساحة الحرة على APFS. طابقت 16,954
ملفًا محتفظًا به قبل النقل وبعده، مع جميع أنواع العناصر والصلاحيات والروابط؛
الأدلة في `CLEANUP-RESULT.json` و`REHEARSAL-VERIFICATION.json` داخل الأرشيف.

حُفظت ملفات المستخدم العشرون بالمحتوى والصلاحيات وحالة Git؛ تحديث هذه الخريطة
تغيير توثيقي منفصل غير ملتزم. لم تُحذف فروع أو قواعد أو وحدات تخزين، ولم تتغير
خدمات أو إنتاج، ولم يحدث commit أو push أو نشر ضمن ترتيب الأرشيفات.

## تمرين استعادة حقيقي — قياس RPO/RTO — 2026-10-09

أداة جديدة [`deploy/rpo_rto_drill.py`](../deploy/rpo_rto_drill.py) تقيس RPO/RTO
فعليًا (لا تقديريًا) على بيانات واقعية الحجم (40 مستخدمًا، 15 مشروعًا، 600 مهمة،
600 مرفق)، عبر تشغيلتين مستقلتين كاملتين بنتائج متسقة: نسخ <1 ثانية، استعادة
كاملة حتى قراءة مُتحقَّقة ~4 ثوانٍ، تطابق بيانات كامل في كلتا التشغيلتين. هذا
يسدّ الفجوة الموثقة في [بوابة الإطلاق الرابعة](project-closure/saas-hosting-direction-status.md)
(خطوة `restore-drill` الآلية في CI تختبر الآلية على قاعدة شبه فارغة فقط، بلا
قياس زمني). التفاصيل والحدود الصريحة (جهاز مطور واحد، بلا حمل متزامن، ليس
PITR، لا موقع ثانٍ) في [تقرير التمرين](verification/2026-10-09-rpo-rto-drill.md).
لم يُشغَّل على بنية الاستضافة الفعلية المختارة؛ ذلك القياس يُعاد عند اعتماد
قرار الاستضافة. لا commit أو push ضمن هذا التمرين.

## عزل 10 مستأجرين حقيقي — Odoo فعلي بدل upstream اصطناعي — 2026-10-09

أداة جديدة [`tools/shared_isolation_acceptance/real-odoo-isolation-matrix.mjs`](../tools/shared_isolation_acceptance/real-odoo-isolation-matrix.mjs)
تسدّ الفجوة الصريحة في [مصفوفة العزل الاصطناعية](verification/shared-isolation-matrix.md)
("Real Odoo ACLs are not proven"): عملية Odoo حقيقية واحدة تخدم 10 قواعد
بيانات حقيقية ومستقلة عبر `dbfilter = ^%h$` (آلية الإنتاج الموثقة)، خلف
الـguard الحقيقي (`deploy/shared/guard.mjs`). بتفويض المستخدم، SSR/Nuxt خارج
نطاق هذا التمرين تحديدًا (مغطى اصطناعيًا سابقًا)؛ التركيز على guard+Odoo
الحقيقيين. تشغيلتان مستقلتان كاملتان، ✔ pass 1/1 في كلتيهما: 10/10 تسجيلات
دخول، 90/90 عبورًا اتجاهيًا للجلسة مرفوضًا (Odoo نفسه يرفض بـ
`SessionExpiredException`، طبقة دفاع ثانية مستقلة عن الـguard)، 180/180 عبور
معرّف كائن بلا تسريب (كل طلب يعيد سجل المستأجر الصحيح فقط)، وWebSocket حقيقي
يرفض الجلسات الأجنبية. تنظيف كامل تلقائي بعد كل تشغيلة (لا قواعد أو اتصالات
متبقية). التفاصيل والحدود الصريحة (لا SSR حقيقي، لا MFA، لا TLS/Caddy، حجم
بيانات صغير لكل مستأجر) في [تقرير التمرين](verification/2026-10-09-real-odoo-isolation-matrix.md).
لا commit أو push ضمن هذا التمرين.
