# CP1-T1/T2 — تصنيف النمط التجاري، الشريحة الأولى

## القرار والنطاق

اعتمد المستخدم D01 بعد عرض القواعد الخمس: SaaS/non_saas صريح، المصدر مركزي/محلي، لا تخمين لترحيل القديم، لا إيقاف لانتهاء دعم المستقل، وعقد /me متوافق لاحقًا.
هذه الشريحة تنفذ أساس الخادم والترحيل فقط على `codex/cp1-commercial-mode` من `d194f93f65c377a4f2e23e3ca067514bb692805b`؛ لا دمج أو commit أو نشر.

- الحقلان `commercial_mode` و`entitlement_source` مطلوبان وزوجهما محمي في SQL وORM، بدون default SaaS.
- التصنيف غير قابل للتغيير عبر `write` حتى بسياق المشغّل؛ تحويل النمط يحتاج إجراء منفصل لاحقًا.
- غير SaaS لا يقبل `valid_until` اشتراكًا؛ يبقى التعليق الإداري والدعم والميزات والحدود كما هي.
- `_nasq_require_policy_source` حد داخلي خاص يحتاج superuser environment ويطابق المصدر؛ ليس credential شبكيًا ولا endpoint ولا بروتوكول تحديث تجاري مكتملًا.
- كتابة السياسة والتحقق الداخلي للمشغّل يتطلبان superuser environment بالإضافة إلى سياق المشغّل؛ مفتاح context مزوّر وحده لا يمنح سلطة. أضيف اختبار regression لحقول السياسة.
- لا توجد قناة دفع أو webhook الآن. كل قناة مستقبلية يجب أن تستخدم فحص المصدر وتفويض الهوية الخاص بها؛ لا ادعاء حماية موصل لم يُنفذ.
- لا تغيير على /me أو واجهة العميل أو ميثاق PMO/HR؛ الحقول UUID/binding/commercial revision مؤجلة، لا تُعتبر مكتملة.

## مدخل المشغّل للتثبيت والترقية

متغير `NASQ_COMMERCIAL_CONFIG` يحدد **مسارًا مطلقًا محليًا** لملف JSON موثوق. لا أسرار فيه ولا إدخال متصفح؛ احفظه خارج Git بصلاحيات المشغّل.
ملف واحد لقاعدة واحدة، ويُرفض اسم قاعدة مختلف. ليس هوية متعددة العناقيد؛ قبل الترقية يثبت المشغّل host/port والهدف مستقلًا، ولا يشغل ملفًا لقاعدة بنفس الاسم على خادم آخر عميانيًا.

```json
{
  "schema_version": 1,
  "database": "customer_database_name",
  "commercial_mode": "non_saas",
  "entitlement_source": "local_policy",
  "expected_valid_until": null,
  "valid_until_action": "preserve"
}
```

SaaS يستخدم `saas/control_plane` و`preserve` فقط. عند وجود cutoff قديم يجب أن تطابق `expected_valid_until` قيمته ISO مثل `2026-01-01`.
في non_saas ذي cutoff قديم لا يكفي تغيير mode؛ يجب اعتماد إزالة القيمة ثم كتابة `valid_until_action=clear` مع التاريخ المتوقع المطابق حرفيًا. لا تستأنف الهجرة تعليقًا قائمًا ولا تعيد تفعيل الدعم.
حجم الملف 16 KiB كحد أقصى، حقول دقيقة لا إضافات، لا مفاتيح مكررة أو schema boolean بدل integer، ولا استنتاج mode من الاستضافة.

### التثبيت الجديد

إنشاء profile يقرأ المدخل المحلي ويثبت التصنيف. غياب الملف/الزوج الصحيح يفشل التثبيت بدل إنتاج عميل مصنف تخمينًا.
الملف مطلوب للتثبيت الأول وليس لكل طلب أعمال أو تسجيل دخول؛ المصدر محلي ولا شبكة.
**قيد توافق مقصود:** `deploy/provision.sh` وCompose وCI الحاليون لا يمررون الملف بعد؛ لا تستخدم هذه الشريحة كإصدار جاهز للتزويد. CP1-T4 يجب أن يمرر mapping إلى عملية/حاوية Odoo صراحة؛ وجود env في shell المضيف وحده لا يكفي للحاوية.

### ترقية قديم إلى 19.0.1.2.0

pre-migration تفحص singleton وتاريخ الصلاحية ومدخل التصنيف قبل إضافة الأعمدة أو تعديل البيانات في transaction الترقية. الفشل يرجع التغييرات؛ لا تُعدل migration 19.0.1.1.0 القديمة.
يشغّل المشغّل فحص mapping قبل نافذة نشر الكود، مع نسخة احتياطية متسقة وخطة استرجاع؛ فحص pre-migration داخل -u وحده ليس orchestrator يمنع كل تغيير خدمات قبل النشر.
يمكن استدعاء دالة `load_classification(database, valid_until)` من أداة محلية موثوقة بعد قراءة الحالة؛ wrapper CLI للمشغّل ما زال مؤجلًا.

إعادة التطبيق على تصنيف قائم تطابق mode/source ولا تغيّر policy. بعد clear ناجح حدّث expected cutoff إلى null لإعادة تحقق لاحقة؛ المدخل القديم الذي يزعم وجود تاريخ ممسوح يُرفض عمدًا كـstale assertion، لا يعيد المسح أو التحويل.
الهجرة تحفظ features/retained/status/support/root_company والمراجعات، عدا إزالة cutoff المصرح بها. حالة saas تحتفظ بتاريخها وسلوك الانتهاء الحالي UTC.

## التحقق

الأوامر المحلية من canonical، لا على قاعدة حية:

```text
ruff check --no-cache .worktrees/cp1-commercial-mode/odoo-addons/nasq_platform .worktrees/cp1-commercial-mode/tools/test_commercial_config.py .worktrees/cp1-commercial-mode/tools/check_cp1_scratch.py
python3 -B -m unittest discover -s .worktrees/cp1-commercial-mode/tools -p test_commercial_config.py -v
PYTHONDONTWRITEBYTECODE=1 /Users/tariq/code/odoo/.venv/bin/python .worktrees/cp1-commercial-mode/tools/check_cp1_scratch.py upgrade
PYTHONDONTWRITEBYTECODE=1 /Users/tariq/code/odoo/.venv/bin/python .worktrees/cp1-commercial-mode/tools/check_cp1_scratch.py regression
PYTHONDONTWRITEBYTECODE=1 /Users/tariq/code/odoo/.venv/bin/python .worktrees/cp1-commercial-mode/tools/check_cp1_scratch.py saas
PYTHONDONTWRITEBYTECODE=1 /Users/tariq/code/odoo/.venv/bin/python .worktrees/cp1-commercial-mode/tools/check_cp1_scratch.py fresh
git -C .worktrees/cp1-commercial-mode diff --check
```

الrunner محلي لهذه الآلة عمدًا: Python Odoo الحالي، PostgreSQL loopback:5432 والمستخدم tariq؛ لا يطبع كلمة مرور ويستخدم env عند الحاجة.
يرفض baseline مختلفًا أو dirty tracked قبل تشغيله، وينشئ قواعد بأسماء UUID تبدأ nasq_cp1_scratch_ وconfig/data/logs في temp مستقل.
لا يقرأ config حيًا أو يكتب داخل Odoo upstream، ويستخدم addons لهذه النسخة صراحة. يحذف قواعده وأدلته المؤقتة فقط عند الانتهاء؛ أي فشل cleanup يُبلغ بالموارد الباقية.

الفحوص تتضمن:
- 7 اختبارات parser مع subcases للملف/النوع/المفاتيح/الهدف/الزوج/التاريخ/clear.
- تثبيت baseline ثم رفض upgrade بلا mapping ورفض non_saas مع cutoff بلا تصريح clear.
- upgrade صريح إلى non_saas، حفظ policy/support/suspension، replay مطابق ورفض conversion عند replay مخالف.
- 27 اختبارًا موجّهًا لطبقة nasq_platform تشمل 9 اختبارات تجارية جديدة، مع دورة الحياة والاستحقاقات والحصص/singleton القديمة دون إضعافها.
- regression يثبت SaaS جديدًا بملف صريح لتشغيل اختبارات الانتهاء القديمة؛ اختبارات non_saas تحضر fixture SQL داخل savepoint فقط، وليس مسار تحويل منتج.
- ترقية SaaS تحافظ على التاريخ والتعليق؛ تثبيت جديد يرفض mapping غائبًا ثم ينجح كـnon_saas.

## حدود الدليل والمتبقي

نتائج التشغيل الأول نجحت: parser 7، platform 26، upgrade non_saas والتثبيت الجديد. تُعاد جميع أوامر Verify بعد آخر تعديل، وتوثق النتيجة النهائية في رد التسليم.
لم تُشغّل المجموعة الشاملة لكل الركائز ولا CI الست أو frontend أو إثبات egress محجوب. لا اختبارات على `odoo19`، ولا ادعاء جاهزية إنتاج.
المتبقي قبل دمج CP1 كإصدار قابل للتزويد: /me المتوافق، تمرير mapping في provision/CI، هوية UUID وربط الشبكة/revisions في شريحة مستقلة إذا لزم، اختبارات offline كاملة، واختبارات ترقية أوسع ومراجعة مستقلة.
لا default مخفي لتشغيل fixtures القديمة: يتم إمداد mapping صريح للقاعدة scratch. مستخدم المنتج لا يغير النمط أو المصدر ولا صلاحية العقد من واجهته.
