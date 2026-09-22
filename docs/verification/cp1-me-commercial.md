# CP1-T3 — بيانات النمط في /me دون تفعيل الفوترة

## النطاق والحالة

استكمال D01 المعتمد في نفس worktree `codex/cp1-commercial-mode` من baseline `d194f93f65c377a4f2e23e3ca067514bb692805b`.
التغييرات السابقة للحقول والترحيل محفوظة دون تعديل في هذه الشريحة؛ main والخطة وCP0 لم تتغير.
لا commit/merge/push/deploy ولا تحديث لقاعدة تطوير حية. ليس هذا اكتمال CP1 أو موافقة نشر.

## العقد

يضيف `dump_me` كتلة عليا اختيارية، خارج `platform` الصارمة v1:

```json
{
  "commercial": {
    "schema_version": 1,
    "mode": "non_saas",
    "self_service_available": false
  }
}
```

- المثال جزء من الاستجابة لا /me كاملة.
- mode من profile المحلي، لا اسم الجهة أو مكان الاستضافة أو شبكة خارجية.
- self_service_available يظل false في saas وnon_saas؛ لا فوترة أو جلسة تجارية أو grants ضمنية.
- لا نشر entitlement_source أو binding أو مفاتيح أو تفاصيل مالية ضمن metadata.
- platform.schema_version=1 وحقوله دون تغيير.
- إذا فشلت قراءة profile بـUserError، يبقى fallback السابق للمنصة وتُحذف commercial؛ لا نفترض SaaS أو non_saas. لم نغير سياسة fallback القديمة في هذه الشريحة.
- missing commercial مع خادم قديم مقبول، ولا ينتج default mode أو self-service.
- Zod يقبل الحقول الثلاثة فقط؛ version/mode غير صالح، null، حقل حساس إضافي أو availability=true مرفوض حتى يتغير عقد الفوترة في مرحلة معتمدة لاحقًا.
- الكتلة تصف النشر ولا تمنح صلاحية. قواعد ACL/lifecycle الحالية باقية، وGET /me المجهول مرفوض.

## الملفات

- `odoo-addons/nasq_api/serializers/user.py`: إضافة آمنة بالـwhitelist أثناء قراءة المنصة المحلية.
- `odoo-addons/nasq_api/tests/test_me.py`: حفظ assertion حقول الاستجابة القديمة مع الإضافة، وإضافة TestMeCommercial المبني على NasqApiCase.
- `packages/contracts/src/common/me.ts`: MeCommercialSchema/type وoptional top-level field؛ لا تغيير strict platform.
- `packages/contracts/src/common/__tests__/commercial.test.ts`: old payload/new client، new payload/pre-change client shape، modes، رفض القيم والحقول غير المسموحة.
- `tools/check_cp1_scratch.py`: mode جديد me يشغّل HTTP metadata/password tests؛ توسيع allowlist لهذه الملفات فقط مع بقاء الاختبارات السابقة.

## دليل التحقق

الأوامر من canonical `/Users/tariq/code/nasq`:

```text
git -C .worktrees/cp1-commercial-mode diff --check
ruff check --no-cache .worktrees/cp1-commercial-mode/odoo-addons/nasq_api/serializers/user.py .worktrees/cp1-commercial-mode/odoo-addons/nasq_api/tests/test_me.py .worktrees/cp1-commercial-mode/tools/check_cp1_scratch.py
npm --prefix .worktrees/cp1-commercial-mode/packages/contracts run test
npm --prefix .worktrees/cp1-commercial-mode/packages/contracts run build
PYTHONDONTWRITEBYTECODE=1 /Users/tariq/code/odoo/.venv/bin/python .worktrees/cp1-commercial-mode/tools/check_cp1_scratch.py me
PYTHONDONTWRITEBYTECODE=1 /Users/tariq/code/odoo/.venv/bin/python .worktrees/cp1-commercial-mode/tools/check_cp1_scratch.py regression
```

التشغيل الموجّه قبل بوابات التسليم: Ruff نظيف، contracts 178/178 في 28 ملفًا، TypeScript tsc --noEmit ناجح، Odoo me/password 16/16 ناجح.
يُعاد تشغيل الأوامر كلها في Verify على المحتوى النهائي ثم المراجعة المستقلة، بما فيها platform regression (27 اختبارًا في الشريحة السابقة).
اعتماديات worktree مستقلة وثبتت بـnpm ci --ignore-scripts --offline؛ لم يتغير lockfile ولم تُستخدم symlink لاعتماديات نسخة أخرى. تحذيرات deprecated للحزم القائمة ليست إصلاح dependency ضمن هذا النطاق.

فحص التوافق مع العميل السابق يستخدم نسخة مجمّدة مستقلة لشكل me.ts من baseline d194f93f، لا اشتقاقًا من MeSchema الجديدة، ويؤكد إسقاط الحقل فقط مع بقاء platform كما هي؛ لا يثبت تشغيل binary قديم في متصفح أو نشر مختلط فعلي.
اختبارات SaaS/non_saas عبر HTTP تحفظ القدرات والميزات. تغيير النمط عبر SQL في اختبار fixture فقط داخل scratch لا يفتح تحويلًا في المنتج.
كل تشغيل Odoo بقاعدة UUID جديدة وconfig/data/logs مؤقتة خارج upstream، addons محددة ومنافذ مستقلة وتنظيف الموارد المنشأة فقط. ممنوع اختبار odoo19.
أضيف أيضًا اختبار HTTP لفشل قراءة profile تحديدًا أثناء serialization بعد نجاح مصادقة وحراسة lifecycle الحقيقيتين؛ لا يدّعي أن غياب profile الكامل يسمح بالدخول. العدد النهائي لاختبارات me/password أصبح 17 بدل 16.
لا تشغيل واجهة أو اختبار بصري/egress أو وظائف CI الست أو مجموعة الركائز الكاملة في هذه الشريحة.

## المتبقي

1. CP1-T4: تمرير ملف التصنيف بشكل صريح إلى provision وCompose وCI (التثبيت الجديد يرفض غيابه حاليًا).
2. فحوص التشغيل المستقل offline والفحوص الأوسع والترقية الكاملة قبل اكتمال CP1.
3. UUID/binding/commercial revisions وهوية الفوترة والخدمة المركزية تبقى مراحل مستقلة، دون توسيع هذا endpoint لمنحها.
4. لا واجهة دفع أو صفحات Placeholder أو طلبات Control Plane أو تحديث نشر حي.

التقرير السابق `docs/verification/cp1-commercial-mode.md` سجل الشريحة الأولى؛ عبارة /me مؤجلة فيه تاريخية وقد أُنجزت هنا. التزويد وCI ما زالا مانع جاهزية إصدار CP1 للدمج والنشر.
