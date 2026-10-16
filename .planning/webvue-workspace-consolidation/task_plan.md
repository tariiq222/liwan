# خطة ترتيب مساحة عمل ويب فيو — متابعة كتابة الخطة

**الحالة:** كتابة المسودة ومراجعتها مكتملتان؛ المراجعة الأولى `needs_revision` ثم الإصلاح النهائي وإعادة المراجعة `PASS` وثائق فقط. عرض المستخدم واعتماده pending؛ كل التنفيذ المستقبلي pending.

## الهدف وحدود الكتابة
- إنتاج خطة عربية عملية لحفظ العمل ومصالحته دون تنفيذ، في `plans/webvue-workspace-consolidation.md`.
- الكاتب الحالي حصري على الخطة وهذه الملفات الثلاثة فقط. لا مصدر/مراجع/أوامر/tests/runtime/network أو ملفات إضافية؛ لا delegation أو goal جديد.
- لم تُنفذ مراحل الخطة. static/unit/build المعتاد داخل نطاق تنفيذ مأذون لاحقًا لا يحتاج موافقة تحديث منفصلة؛ Odoo/live DB/services/data/Git/provider تبقى ببواباتها.

## سير كتابة الوثائق
| الخطوة | الحالة | الدليل |
|---|---|---|
| قراءة الجرد والتعليمات وصياغة المسودة | completed | مسودة وخلاصات الجرد الموروثة |
| المراجعة المستقلة الأولى | completed — needs_revision | تقرير مراجعة سُلّم للمنسق |
| الإصلاح الأول | completed — partial | ضبط أولي للنطاق/القبول؛ بقيت نقاط كشفها فحص المنسق |
| إصلاح الدقة النهائي | completed | الأدوار، DAG، shared ownership، manifests، baseline، permissions، verification، accounting |
| إعادة المراجعة المستقلة | completed — PASS | المراجع `6ed8787c`، وفق تقرير المنسق: 7 معايير مستوفاة، 0 findings مانعة؛ قراءة الوثائق الأربع فقط، لا operational certification |
| عرض الخطة وقرار المستخدم | pending | لا اعتماد أو تنفيذ تلقائي |

## مراحل التنفيذ المستقبلية — كلها pending
- P0 اعتماد النطاق؛ P1 جرد حي وخمود؛ P2 حفظ واسترجاع.
- P3 freeze path/hunk manifests: 395 union +PMO/main E2E/WIP/ignored data.
- P4 E2E، P5 PMO، P6 UI-only، P7 shared reconciliation: تفتح بعد P3 فقط بلا overlap.
- P8 existing commercial/feed/package slices بعد عقود P7؛ P9 per-package verifier/checks فور الجاهزية.
- P10 accounting بعد كل قرار accepted/preserved-pending/user-approved-deferred؛ Git/runtime/cleanup تفويض منفصل، لا C3 أو اشتراط كل features green.

## قرارات ثابتة
- المنسق الأعلى read-only؛ shared writer واحد strong، verifier strong مختلف النموذج.
- `.gitignore`, `recordBackTargets.test.ts`, useApi/common/generated catalog والـ21 خارج workers المتقاطعين؛ recordBackTargets بعد تقريري P5/P6، لا يحجب بدء P7.
- prerequisites باسم committed accepted SHA أو frozen candidate؛ tip drift يعيد candidate/checks؛ dirty-main overlaps تحفظ ولا stash/reset ضمني.
- snapshot خاصة خارج repo باختيار/اعتماد المستخدم؛ runtime consistency مستقلة، وعدم الخمود يحجب cleanup دون forced kill.

## أخطاء التخطيط الموروثة
- glob مبكر على `plans/` غير الموجود أعاد no-such-directory/exit 2؛ عولج مسار الوثائق فقط.
- قراءة `progress.md` قبل إنشائه أعادت not found. لا أخطاء أو أوامر تنفيذ في الإصلاح النهائي.
