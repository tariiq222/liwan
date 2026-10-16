# تقدم شريحة القبول المحلية

## خط أساس وفجوات مثبتة

- `PYTHONPATH=tools python3 -B -m unittest test_managed_runtime test_webvue_cli_operator test_webvue_cli_scratch_guards`: نجح 121 اختبارًا في 0.560 ثانية قبل أي تغيير إنتاجي (bash-6، exit 0).
- أضيفت `tools/test_managed_create_acceptance.py`؛ الأمر `PYTHONPATH=tools python3 -B -m unittest test_managed_create_acceptance` شغّل 5 اختبارات وفشلت الخمسة للأسباب المستهدفة (RED، exit 1): ملف سياسة غير صالح/قناة مختلفة/بصمة كتالوج مختلفة لا ترفض قبل الأثر، قائمة تثبيت ثابتة لا تطابق people، ونتيجة بلا إثبات تعاد ok بدل عدم اليقين.
- الاستكشاف المستقل أكد أن مولد `deploy/managed-local/generate.py` قالب ثنائي ساكن لا يطابق عقد المحوّل، وأن صورة المشروع تحتاج ملف odoo.conf وWEBVUE_COMMERCIAL_CONFIG أثناء التثبيت. لن نغير عقد المولد السابق بلا حاجة؛ سنوفر تركيب قبول أحادي محكوم.
- لا توجد صور WebVue محلية عند البداية. Docker 29.8.0 / Compose 5.5.1 متاحان على aarch64، مساحة الجهاز المتاحة 331GiB. يجري بناء صور قبول منفصلة من Dockerfiles الموجودة؛ لم تُشغل حاويات جديدة بعد. لا نلمس الحاويات الموجودة بما فيها webvue-saas-control-local.
- Python `coverage` غير مثبت (فحص version exit 1)، بينما ruff وuv موجودان. هذا قيد أداة وليس فشل التطبيق؛ لا نتيجة تغطية بعد.

## ملكية الملفات

- المنسق: managed_runtime.py، اختبارات قبول التكامل، أدوات/تركيب القبول، وثائق الشريحة، التحقق النهائي.
- وكيل policy: managed_policy.py، test_managed_policy.py، managed-policy-tdd.md فقط.
- وكيل probe: managed_probe.py، test_managed_probe.py، managed-probe-tdd.md فقط.
- وكيل verify: managed_verify.py، test_managed_verify.py، managed-verify-tdd.md فقط.
- استكشاف مستقل مكتمل للقراءة فقط؛ المراجعة النهائية لم تبدأ.

## التمييز الواجب حفظه

المسار المدار الحالي يمنع التشغيل الحقيقي بدل الادعاء بالجاهزية. الاختبارات الحالية تستخدم doubles وسياسات placeholder؛ لا تعني أنها أثبتت تركيبًا فعليًا. أي تعديل fixtures لاحق سيُوثق لتزويدها بسياسات صحيحة وإيصالات مستقلة، لا حذف ضمانات الرفض والتكرار والحجر. انتهاء أمر التثبيت ليس دليل صحة أو تطبيق سياسة.

readiness_state: local-create-accepted; regression-and-scoped-review-passed

بدأ دمج إصلاح runtime: التحقق الصارم من السياسة قبل الأثر، تثبيت الوحدات المختارة، تطبيق أولي وقراءة مستقلة، واشتراط HTTP مع القراءة قبل readiness. فحوص المكونات الجديدة والتكامل: 98 اختبارًا ناجحًا (exit0)؛ مجموعة الانحدار القديمة تحتاج تحديث fixtures placeholder لتحتفظ بنفس ضماناتها مع العقد الجديد، ويعمل عليها مالك منفصل. لا تُجرَ تجربة قبول حقيقية بعد. لا commits أو دمج أو نشر أو تنظيف.

## بناء صور التجربة

- صورة web بُنيت محليًا باسم webvue-acceptance-web:d780862e.
- بناء proxy الإنتاجي فشل (bash-8، exit1): مرجع github.com/mholt/caddy-ratelimit@v0.2.0 غير موجود. لم يُعدّل اعتماد الإنتاج.
- جُلب Caddy الرسمي 2.11.4 بنجاح (bash-9، exit0)، digest sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52 لتوجيه قبول محلي فقط دون rate_limit. هذا لا يثبت جاهزية صورة proxy الإنتاجية.
- بناء Odoo اكتمل في bash-7، exit0؛ صورة webvue-acceptance-odoo:d780862e بهوية محلية sha256:4b38c91f957233dc90fd631cebebf0e0039a32791e2e9d07db449896975bfa75.

## تحديث التكامل والتجربة الفعلية

- فحص `unittest discover -s tools -p 'test_managed*.py'`: 241 اختبارًا ناجحًا، قبل إضافة اختباري رفض قراءة الاعتماد وإعادة الطلب دون فحص Docker context؛ مجموعة قبول المنسق الحالية 13/13 ناجحة.
- انحدار scratch: 56 اختبارًا ناجحًا. عامل control-plane: 36 اختبارًا ناجحًا وtsc --noEmit ناجح؛ لا دليل E2E للعامل مع قاعدة control-plane حقيقية بعد.
- تم توصيل سياسة الكتالوج، فحص الموارد، حفظ بصمات ملفات التشغيل ومقارنتها قبل الأوامر، انتظار TCP PostgreSQL، تطبيق السياسة وقراءتها مستقلة، تهيئة كلمة مرور المسؤول وقراءتها مستقلة، صحة مرتبطة بالحاويات والصور والمنافذ، وحفظ الإثبات في الإيصال. Docker مثبت على Unix socket محلي لكل عملية بعد replay؛ الخرج متدفق ومحدود، والأسرار ملفات خاصة محدودة.
- المراجعة المستقلة كشفت ثغرات حد الخرج/pg_isready/socket context/الأسرار/الصحة؛ نفذت ضوابط واختبارات لها. لا يعني ذلك اعتمادًا إنتاجيًا.
- التجربة الأولى bash-11 خرجت 4 قبل أي أثر: status conflict، stage preflight، changed=false، code probe_malformed. لم تُنشأ حاويات/قاعدة من هذه المحاولة. ملف الحالة الخاص خارج المستودع محفوظ ولم ينظف.
- التشخيص: Docker يعرض Labels مفصولة بفواصل بينما بعض قيم labels نفسها تحتوي فواصل؛ افتراض parser غير صحيح. إخراج volume ls الكامل يزيد عن64KiB في الجهاز كثير الموارد. إصلاح محصور لدى وكيل **Luna high** لإسقاط الاسم وcompose-project label فقط بصيغة JSON، دون إضعاف رفض الخرج المبتور.
- إصلاح إسقاط Docker rows اكتمل لدى Luna:29 اختبارًا ناجحًا، وتوافق read-only فعلي مع37 حاوية/198volume/16network دون تعديلها.
- المحاولة الثانية bash-12 اجتازت preflight وثبّتت people فعلًا، لكنها حُجرت عند initial_policy. قراءة مستقلة read-only أثبتت `features=False` وrevision0 في Odoo الجديد، لا `{}` كما افترضت doubles. الوحدات الفعلية: webvue_api,webvue_core,webvue_hr,webvue_platform فقط. عُدّل عقد البداية لقبول False حصريًا قبل أول تطبيق عند revision0، مع استمرار رفض False كإثبات بعد التطبيق؛ RED ثم25 اختبارverify ناجحًا.
- موارد المحاولة الثانية محفوظة: project `webvue-accept-243b7e2a`، DB `webvue_scratch_243b7e2a`، حالتها quarantined؛ لم تُستأنف ولم تنظف ولم تُشغّل خدمات العميل منها. بدأ bash-13 لهدف جديد بعد الإصلاح.
- الفحص الأوسع control-plane كشف3 fixtures حدود قديمة (92pass/3fail/1skip)؛ Luna يعالج fixtures بسياسة صحيحة وفشل Docker اصطناعي دون أي وصول Docker حقيقي من الاختبارات. لا تُعرض المجموعة الكاملة كناجحة حتى إعادة التحقق.
- bash-13 ثبّت السياسة وقرأها وحقق كلمة مرور المسؤول، ثم حُجر عند health بسبب ID مختصر من Compose ps. أضيف RED ثم --no-trunc بدل قبول الهوية المختصرة؛16 اختبارhealth ناجحًا وفحص الهدف read-only ناجح لاحقًا، دون تغيير إيصال الحجر.
- **bash-14 exit0**: إنشاء فعلي ناجح للهدف tgt_local_54b24f06، policy_verified/deployment_ready=true، revision1 وميزاتpeople والوحدات الأربع الصحيحة. نجحت اختبارات replay دون أي runner/probe/resolver، status متحقق، ورفض بايتات مختلفة وطلب إنشاء ثان. التفاصيل في managed-saas-acceptance.md وmanaged-saas-receipt.json.
- البوابة النهائية:246 Python managed +56 scratch ناجحة، Ruff النطاق ناجح، control-plane95 اختبارًا ناجحًا وملفservice واحد متخطى، tsc وgit diff --check ناجحان. اكتمل إصلاح fixtures دون وصول Docker حقيقي من الاختبارات، وإصلاح predicate رفض local Docker context قبل الأثر للحفاظ على registered.
- مراجعة Luna النهائية للنسخة الصحيحة: scoped pass دون ملاحظات جوهرية جديدة؛ قيود standalone health/inspect وcontrol-plane E2E وTOCTOU والإنتاج موثقة. تسليم الشريحة المحلية مكتمل دون دمج.
- لا commit/merge/push/deploy ولا تنظيف. قبول الإنشاء المحلي مثبت؛ لا ادعاء جاهزية إنتاج أو control-plane E2E.
