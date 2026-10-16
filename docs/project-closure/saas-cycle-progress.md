# تقدم تنفيذ خطة دورة SaaS

## التفويض والنطاق

طلب المستخدم البدء بالخطة والتنفيذ باستخدام Sol وLuna. التنفيذ محصور في `codex/managed-saas-acceptance`، دون commit/merge/push/deploy، ودون لمس `odoo19` أو العملاء/موارد القبول القديمة. الخطة `saas-cycle-delivery-plan.md` تفصل الإنجاز المرحلي عن الحكم الأشمل `not ready`.

## SAAS-04 — انتقال الفشل الآمن (Sol)

| البوابة | الأمر | النتيجة |
|---|---|---|
| RED الأول | `env -u CONTROL_TEST_DATABASE_URL npm -w apps/control-plane test -- src/__tests__/worker-managed.test.ts` | فشل اختبار `port_shared` المقصود؛ 1 فشل/35 نجاحًا. العامل لم يعد العميل إلى registered. |
| GREEN الأول | الأمر نفسه + `npm -w apps/control-plane run build` |36/36 نجاحًا وفحص الأنواع نجح.|
| RED حد الفشل المغلق | الأمر نفسه بعد إضافة unknown/secret refusals | فشلان مقصودان/42 نجاحًا: كانا ينتهيان failed بينما يجب حفظ تدخل غير معلوم.|
| GREEN أولي | الأمر نفسه + build |44/44 نجاحًا وفحص الأنواع نجح.|
| RED/GREEN ربط هوية الرفض | الأمر نفسه بعد اختبار target/request/operation/schema mismatch، ثم بعد الحراسة | ظهر فشل مقصود لحالة schema_version، ثم 48/48 نجاحًا مع `tsc --noEmit`. الرفض الآمن يجب أن يطابق هدف/طلب/نوع/نسخة الإيصال قبل أن يعود registered. |

غيّر Sol `worker.ts` و`worker-managed.test.ts`: رفض preflight المدعوم والمؤكد `changed=false` يعود إلى حالة قابلة لإعادة الطلب، مع allowlist مغلقة لأكواد المحوّل. unknown/secret/غير مؤكد لا يُعامل كرفض آمن؛ ينتقل إلى intervention ولا يصبح نجاحًا. توجد حاجة لمراجعة أمنية/DB integration؛ محاكاة SQL وحدها لا تثبت انتقال قاعدة حقيقية.

## عمل متوازٍ

- Luna: اكتشاف/تسجيل managed v3؛ مالك `http.ts` واختباره الجديد. ظهر خطأ توجيه ملف جديد إلى canonical checkout؛ توقف الوكيل وأبلغ عنه قبل تعديل الإنتاج. نُقل **الملف الجديد وحده** إلى worktree المعين ثم تأكد المنسق أن canonical عاد إلى عناصره غير المتتبعة القديمة فقط. حققت تجربة أولى 7/7 وcontrol 116/116؛ المراجعة كشفت تراجعًا في تسجيل non_saas القديم وضعف تحقق بنية descriptor المتداخلة، فأُضيفت حالات RED جديدة ثم أُصلحت؛ خرج full suite أثناء RED:117 نجاحًا/فشل متوقع واحد، وليس نتيجة نهائية. البوابة النهائية للتسجيل 15/15 واختبار الخدمة/عامل كامل 130 PASS بعد مواءمة fixture descriptor الصارمة.
- Luna: `managed_runtime.py` و`managed_health.py` واختباراتهما للفحص والصحة المستقلة؛ لا Docker حقيقي ولا أسرار أو mutation أثناء اختبارات القراءة.
- Luna مراجعة خطة نقدية: أكدت ضرورة التحقق من descriptor والتباس v2/v3 fail closed، وعدم تسمية بيانات metadata صحة حقيقية؛ مراحل التسليم/الاستحقاقات/الاسترداد لاحقة وتحتاج قرارات وتشغيلًا معزولًا بتفويض.

## SAAS-08 — انتهاء تحديث العملية (Luna)

Luna عدّل `apps/web/app/pages/vendor/operations/[id].vue` وملفي locale عربي/إنجليزي وأضاف اختبار `apps/web/app/pages/vendor/__tests__/operation-polling.test.ts`. عند24 دورة تظهر رسالة أن التحديث الآلي توقف؛ زر تحديث يدوي يعيد العداد ويستأنف دورة محدودة إذا العملية نشطة. RED موجّه: اختباران فشلا مقصودًا/واحد نجح؛ GREEN: 3/3 وفحص `vue-tsc` نجح. لم تُخف العمليات غير المدعومة لأن tenant response لا يحمل lane موثوقًا؛ إبقاؤها بند SAAS-05 صريحًا بدل التخمين من الاسم أو hosting_model.

## SAAS-03 — دليل العامل للصحة (Sol)

أضيفت حراسة في `worker.ts` قبل نجاح health المُدار: `health_verified=true`، `policy_verified=true`، fingerprint مطابق للdescriptor وprofile آمن. RED: 3 حالات كانت تُعد نجاحًا زائفًا (missing health/profile أو fingerprint خاطئ)، ثم GREEN للصحة. أضيفت حراسة inspect حتى لا تُقبل سياسة مرصودة دون `policy_verified=true` وfingerprint مطابق؛ RED: حالتان لملف جيد بلا دليل/ببصمة خاطئة، ثم GREEN: 54/54 اختبار عامل و`tsc --noEmit`. نجاح health الصحيح لا يفعّل tenant create؛ صحة الهدف الحي لم تُختبر.

## نتائج المرحلة بعد جمع أعمال Sol وLuna

- **SAAS-01:** `http.ts` و`managed-registration.test.ts`: عرض/تسجيل v3 ببصمة وبنية descriptor ورفض تضارب v2/v3 مع الحفاظ على scratch SaaS/non-SaaS؛ 19/19 اختبارات endpoint عبر SQL double. لا يسرد descriptor أو الأسرار. لاحقًا ربط Luna اختيار `tenant.catalog_version` والبصمة المنشورة مع `release_ref` عند تسجيل managed وعند enqueue `tenant.create` قبل INSERT؛ الاختيار نفسه ظل اختياريًا وقت التسجيل، وطلب الإنشاء بدونه مرفوض. اختبارات endpoint 19/19؛ المراجعة المستقلة أثبتت حدودها ولا يوجد تفويض لقاعدة حقيقية.
- **SAAS-02/03:** `managed_runtime.py` و`test_managed_runtime.py`: اشتراط projection provisioned وإيصال إنشاء دائم مطابق لاستعادة التركيب الأصلي بالضبط؛ snapshot مستقل للسياسة والوحدات عبر Odoo shell؛ صحة جديدة تشمل الحاويات/الصور وHTTP loopback ثم readback نفسه. لا استنتاج من تاريخ الإنشاء وحده ولا probe عند الحجر. 255 اختبار managed Python نجح وRuff نظيف. أضيفت إعادة فحص كاملة للموارد بعد تجهيز الأسرار وقبل `db.up`: اختبار RED يحاكي ظهور DB/project/volume/network/port بين الفحصين؛ الرفض المؤكد يعود `conflict/changed=false` بلا runner ولا حجر. إعادة الفحص تقلل النافذة ولا تعطي ضمانًا ذريًا ضد تغيّر Docker خارجي بين الفحص والأثر. لا تعني HTTP/login form جلسة عميل مصادق عليها أو MFA/websocket.
- **SAAS-04:** `worker.ts` و`worker-managed.test.ts`: 54/54 في الاختبار الموجه؛ البصمة وهوية إيصال الرفض قبل إعادة الحالة، وحراسة health موثّقة؛ النتائج لا تثبت تنفيذ SQL على PostgreSQL حقيقي.
- **SAAS-08:** واجهة العملية ورسالة التوقف المؤقت وتحديث يدوي؛ 3/3 اختبارات موجهة. **SAAS-05 ما زالت ظاهرة في واجهة tenant** مع رفض الخادم؛ لا نخفيها استنادًا إلى تخمين من `hosting_model` أو `tgt_`، ويلزم discriminator/capabilities مُصدر من الخادم.
- **بوابات عامة جديدة:** `npm -w apps/control-plane run build` PASS؛ `env -u CONTROL_TEST_DATABASE_URL npm -w apps/control-plane test` 134 PASS و`service.test.ts` SKIP لعدم تفويض DB؛ `PYTHONPATH=tools python3 -B -m unittest discover -s tools -p 'test_managed*.py'` 255 PASS؛ `ruff check --no-cache tools/webvue_cli/managed_*.py tools/test_managed*.py` PASS؛ `npm -w apps/web test` 873 PASS؛ `npm -w apps/web run lint` PASS؛ `python3 tools/ui_policy.py` PASS؛ `python3 tools/catalog_check.py` PASS؛ `git diff --check` PASS. اختبارات Nuxt العامة فيها تحذيرات Vue في fixtures غير مرتبطة بهذه الصفحة، ولم تتحول لفشل.

## حدود الإثبات الحالية

اكتملت المراجعة المستقلة قراءة فقط. **Finding متوسط مؤجل لمسار المصالحة:** `worker.ts:307` يُسجّل قراءة status المُدار فاشلة رغم تحقق إيصال create في السطور السابقة؛ إيصال journal يحتفظ `operation='tenant.create'` بينما العملية الجديدة `type='status'`، ويثبت `worker-managed.test.ts:389-401` هذا الفشل صراحة. لا يسمح `operationRequestSchema` العام بطلب status، ولا يغير العيب نجاح create الموثق في هذه المرحلة؛ علاجه لاحقًا يتطلب مسار قراءة مستقل لا يفعّل tenant واختبارات إيصال صحيح/مخالف. **Finding منخفض:** صفحة `tenants/new.vue` تشترط الكتالوج قبل التسجيل، وإن كان HTTP يسمح بالتسجيل بلا اختيار؛ لا تُوصف هذه المرونة بأنها رحلة UI متاحة. كما أن عمليات managed غير المدعومة ما زالت ظاهرة في واجهة tenant، يلزم حقول قدرات يملكها الخادم قبل إخفائها بأمان.

### شريحة المتابعة — قراءة الإيصال وصدق أزرار العمليات

- صُحّحت قراءة `status` الداخلية في `worker.ts`: الإيصال `tenant.create` الموثق أصلًا ينجح كقراءة status **دون** تنشيط tenant أو تحديث policy/health؛ اختلاف digest/fingerprint/request/operation يذهب إلى `receipt_unverified`/intervention. RED: كان المسار الصحيح `failed`، GREEN: اختبار العامل 58/58. لم يُفتح `status` في API العام ولا تُعد هذه مصالحة حالة تشغيلية.
- أضاف الخادم `available_operations` إلى GET تفصيل tenant واستجابة grant، مشتقة من lane/حالة tenant/الكتالوج المنشور و`descriptor.allowed_operations` الفعلية؛ قبل enqueue يُرفض أي عمل غير مصرح به في descriptor. عميل Vue لا يستنتج من `tgt_` أو hosting_model؛ قائمة مفقودة/مشوهة تُخفي النموذج وتمنع enqueue. عند grant يعيد تحميل بيانات الخادم بدل الثقة بحالة قديمة.
- RED: غياب field، ثم تغير بصمة الكتالوج، ثم descriptor يتيح create فقط، ثم grant التزم لكن قراءة inventory فشلت؛ GREEN لكل الحالات ببدائل SQL. إذا تعذرت قراءة inventory **بعد** commit، يستجيب grant بحالته الملتزمة وقائمة فارغة مغلقة بدل إبلاغ المستخدم بفشل كتابة نجحت؛ الواجهة تحاول refresh بعد خطأ غير حاسم. المراجعة المستقلة كشفت مشكلتي subset وpost-commit وعولجتا؛ اختبار UI الموجه 5/5 يعتمد قراءة المصدر لا render/browser، ولا يُقدّم كإثبات تفاعل حقيقي.
- **بوابات نهائية بعد الإصلاحات:** control-plane 142 PASS و`service.test.ts` SKIP، `tsc --noEmit` PASS؛ web 878 PASS و`vue-tsc` PASS؛ managed Python 255 PASS وRuff PASS؛ UI policy وcatalog check و`git diff --check` PASS. هذه أعداد نجاح الاختبارات، وليست نسبة تغطية.

لم تُجر اختبارات PostgreSQL الحقيقية أو واجهة→عامل→Docker→عميل؛ لا تكرار لإنشاء الحاويات السابقة. إعادة الفحص قبل أول أثر ليست قفلًا ذريًا للعالم الخارجي. لا تُعد هذه المرحلة دليل اكتمال SaaS أو إغلاق فجوات handoff/entitle/reconciliation/backup/restore/upgrade. `readiness_state: not ready` للدورة الكاملة، رغم اكتمال شريحة الإصلاح المحلية.
