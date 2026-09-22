# CP2-T1/T2 — عقد كتالوج المنصة وفحصه الدلالي

## النطاق والحالة

شريحة أولى من CP2 (الكتالوج والـCLI) على `main` عند `283f969d`. تضيف **العقد والفحص فقط**:
مخططا JSON، كتالوج المنصة كما يشحن اليوم، وأداة ترفض الكتالوج المعطوب.

- لا `nasq-cli`، لا لقطات golden، لا تزويد، لا Control Plane، لا فوترة، لا لوحة بائع.
- لا أسعار ولا عملة ولا خصم ولا باقات تجارية: أسماء المستويات وأسعارها وحدودها الرقمية
  قرارات D16/D09/D11 غير المعتمدة، وهي غائبة عمدًا.
- بيانات الكتالوج في `deploy/catalog/` (§7.2) والفحص في `tools/catalog_check.py` (§7.3)؛
  وخطوة CI مستقلة للكتالوج مضافة إلى وظيفة `static`.
- لا تعديل على أي وحدة Odoo أو عقد API أو واجهة.
- لا commit/merge/push/deploy. لم تُمس `odoo19` ولا أي قاعدة بيانات.

سبب وجود الشريحة: `deploy/catalog/**` و`tools/nasq_cli/**` مخرجان مخططان لا محرك قائم؛
وبدون فحص يربط الكتالوج بسجل الميزات الفعلي يصبح الكتالوج قائمة ثابتة تنفصل عن الكود.

## الملفات

| الملف | الدور |
|---|---|
| `deploy/catalog/schema/solution.schema.json` | عقد الحل: `base_modules` + `tiers` + `addons`، وبلا أي حقل تجاري |
| `deploy/catalog/schema/industry.schema.json` | عقد حزمة القطاع: بيانات فقط (مصطلحات، مراحل، أنواع مشاريع) |
| `deploy/catalog/solutions/platform.json` | حل `platform`: أربعة مستويات تركيب مطابقة لوحدات نسق الحالية |
| `deploy/catalog/industries/none.json` | حزمة محايدة فارغة، حتى يُعلَن القطاع صراحةً بدل إغفاله |
| `tools/catalog_check.py` | الفحص: تحقق مخطط + تحقق دلالي، بلا شبكة وبلا Odoo |
| `tools/test_catalog_check.py` | 45 اختبارًا: كل قاعدة سلبية تُبنى في جذر مستودع مصغّر |
| `.github/workflows/ci.yml` | خطوة `python3 -B tools/catalog_check.py` داخل وظيفة `static` |
| `docs/verification/cp2-catalog.md` | هذا التقرير |

## القرارات المتخذة

1. **لا مكتبة مخططات جديدة.** `jsonschema` ليست في الاعتماديات، وإضافتها قرار مستقل.
   لذلك يعمل `catalog_check.py` كمفسّر صغير لـJSON Schema (2020-12، مجموعة فرعية جزئية)،
   مع رفض أي كلمة مفتاحية لا ينفذها (`SchemaError`). بهذا يبقى ملف المخطط هو العقد
   القابل للقراءة آليًا، ولا يستطيع المخطط أن يدّعي قاعدة غير مفروضة.
2. **الحدود الرقمية غائبة عن الكتالوج.** المستوى يعلن أن ميزة الحد مشمولة، والقيمة يضعها
   المشغّل الموثوق. هذا يطابق السلوك المشحون فعلًا: `require_within_limit` يمرّ عند
   `limit is None`، و`_nasq_legacy_features_for` يبدأ الحدود بـ`None`. فلم تُخترع أرقام.
3. **أسماء المستويات وصف تركيب، لا باقات بيع.** `core`/`projects`/`people`/`messaging`
   تصف وحدات تُثبَّت معًا، وليست أسماء منتجات أو شرائح سعرية.
4. **الفحص يقرأ سجل الميزات من المصدر.** يوزع `odoo-addons/*/models/**.py` بـ`ast`
   ويجمع `_nasq_feature_definitions` و`_nasq_module_definitions` كقيم حرفية؛ فلا استيراد
   Odoo ولا بيئة تشغيل، ويفشل بوضوح إن غاب تعريف ميزة أو تكرر مفتاحه.
5. **حد الاعتماديات معلن:** الاعتماديات خارج `odoo-addons/` هي وحدات Odoo الأساسية،
   ولا تُحلّ هنا لأن نسخة Odoo مستنسخة منفصلة؛ لكن الاعتمادية **المملوكة لنسق** (موجودة في
   `odoo-addons`، أو معلنة في سجل الوحدات، أو بادئتها `nasq_`) يجب أن تُحل، وإلا فهي خطأ
   لا وحدة Odoo. ويرفض الفحص وجود دورة بين وحدات نسق.
6. **ميزات الـaddon تُفحص بنفس صرامة ميزات المستوى.** دالة `_check_features` مشتركة، فلا
   يستطيع addon تمرير ميزة غير معلنة أو بنوع مقلوب أو يملكها مكوّن لا يثبّته.
7. **`installed` لكل مستوى على حدة.** المستوى يثبّت `base_modules` + وحداته + وحدات
   الـaddons التي يشير إليها فقط؛ فلا يستعير وحدة مالك ميزة من addon شقيق لا يستدعيه.

## قواعد الفحص المنفذة

**المخطط:** النوع، `const`، `enum`، `pattern`، `minLength`، `minimum`، `required`،
خصائص غير مسموحة، `items`، `minItems`، `uniqueItems`، و`$ref` محلي إلى `$defs`.

**الدلالي:**

| القاعدة | تُثبت في الاختبار |
|---|---|
| كل وحدة في الكتالوج لها `__manifest__.py` | `test_unknown_module_is_rejected` |
| `id` يطابق اسم الملف | `test_module_file_name_must_match_its_id` |
| معرّفات المستويات فريدة | `test_duplicate_tier_id_is_rejected` |
| لا وحدة في `base_modules` والاختيارية معًا | `test_base_and_optional_overlap_is_rejected` |
| كل ميزة معلنة في السجل، وبنوعها (boolean/limit) | `test_unknown_feature_is_rejected`، `test_schema_rejects_unknown_type_and_wrong_prefix` |
| كل مفتاح حد معروف للنظام | `test_limit_ceiling_for_an_undeclared_feature_is_rejected` |
| المستوى يثبّت الوحدة المالكة لميزته | `test_feature_of_an_uninstalled_owner_is_rejected` |
| `limits` لا تضع سقفًا لميزة غير معلنة في المستوى | `test_limit_ceiling_for_an_undeclared_feature_is_rejected` |
| إشارة المستوى إلى addon معروف | `test_tier_addon_reference_must_be_declared` |
| إشارة الحل إلى حزمة قطاع موجودة | `test_unknown_industry_is_rejected` |
| لا دورة اعتماديات بين وحدات نسق | `test_dependency_cycle_is_rejected` |
| لا اعتمادية مملوكة لنسق بلا manifest | `test_missing_nasq_dependency_is_rejected`، `test_registry_declared_dependency_without_a_manifest_is_rejected` |
| لا وحدة اختبارية في الكتالوج | `test_test_only_module_cannot_be_sold`، `test_test_only_marker_is_verified` |
| لا حقل تجاري في الكتالوج | `test_schema_rejects_a_price_field`، `test_committed_catalog_declares_no_commercial_field` |
| الحد ليس null ولا سالبًا | `test_schema_rejects_a_null_limit_and_a_negative_limit` |
| قيمة `type` في المخطط منفذة لا مجرد معلنة | `test_schema_type_value_must_be_implemented`، `test_unimplemented_type_in_a_nested_node_is_refused` |
| ميزات الـaddon معلنة وبالنوع الصحيح ومالكها مثبَّت | `test_addon_feature_must_be_declared_in_the_registry`، `test_addon_feature_prefix_must_match_the_registry_type`، `test_addon_feature_owner_must_be_installed_by_the_addon` |
| لا تداخل `base_modules` مع وحدات addon، ولا وحدة في addonين | `test_base_module_declared_as_an_addon_module_is_rejected`، `test_module_declared_by_two_addons_is_rejected` |
| المستوى لا يستعير وحدات addon لا يشير إليه | `test_tier_cannot_borrow_an_unreferenced_addons_modules`، `test_tier_may_use_the_modules_of_the_addon_it_references` |
| الفحص لا يستورد شبكة/Odoo/subprocess | `test_checker_never_imports_network_odoo_or_subprocess` |

## ملاحظات المراجعة المستقلة وإغلاقها

راجعت المراجعة المستقلة (مسار `z-ai/glm-5.3-flash`، مستقل عن المنفذ) النسخة الأولى وأعادت
`fail` بخمس ملاحظات. أُصلحت كلها داخل نفس النطاق، ولكل واحدة اختبار سلبي يثبت الإغلاق:

| # | الملاحظة | الإصلاح | الاختبار |
|---|---|---|---|
| F1 | ميزات الـaddon لم تكن تُفحص دلاليًا إطلاقًا | دالة `_check_features` مشتركة بين المستوى والـaddon | `test_addon_feature_must_be_declared_in_the_registry`، `test_addon_feature_prefix_must_match_the_registry_type` |
| F2 | تداخل `base_modules` مع وحدات addon، وتكرار وحدة بين addonين، لم يُرفضا | فحص تداخل القاعدة + سجل مالك لكل وحدة addon | `test_base_module_declared_as_an_addon_module_is_rejected`، `test_module_declared_by_two_addons_is_rejected` |
| F3 | الاعتماد المكسور على وحدة نسق غير موجودة كان يُسكت عنه | `_nasq_owned` يميّز وحدة نسق من وحدة Odoo الأساسية | `test_missing_nasq_dependency_is_rejected`، `test_registry_declared_dependency_without_a_manifest_is_rejected` |
| F4 | فحص مالك الميزة استخدم مجموعة مثبَّتة على مستوى الحل كله | `installed` لكل مستوى = القاعدة + وحداته + وحدات الـaddons التي يشير إليها | `test_tier_cannot_borrow_an_unreferenced_addons_modules` |
| F5 | قيمة `type` غير المنفذة كانت تُنتج `KeyError` بدل `SchemaError` | التحقق من قيمة `type` داخل `_assert_supported` بشكل تعاودي | `test_schema_type_value_must_be_implemented`، `test_unimplemented_type_in_a_nested_node_is_refused` |

## دليل التحقق

```text
python3 -B tools/catalog_check.py                      # CATALOG_OK solutions=1، exit 0
python3 -B -m unittest discover -s tools -p 'test_catalog_check.py' -v    # 45 اختبارًا OK
python3 -B -m unittest discover -s tools -p 'test_*.py' -v                # اكتشاف tools الذي يشغّله npm test
python3 -B -m unittest discover -s deploy -p 'test_*.py' -v               # مجموعة deploy كاملة
ruff check --no-cache tools/catalog_check.py tools/test_catalog_check.py  # All checks passed
```

النتائج الفعلية مسجّلة في رد التسليم مع أكواد الخروج. الاختبارات لا تلمس الشبكة ولا Odoo،
ولا تحتاج قاعدة بيانات أو Docker، ولا تكتب خارج مجلد مؤقت يُنظَّف.

## الانحرافات عن الوثيقة الأم

1. **اسم ملف الحل:** المواصفة تذكر `solutions/health.json` كمثال. هنا `solutions/platform.json`
   (خط الأساس الحالي)؛ حل الصحة مرحلة لاحقة (§8، Phase 4) ولم يُخترع الآن: إنشاؤه يعني
   ابتداع مصطلحات ومراحل ومستويات باقات لم يقررها أحد.
2. **`industry: none`:** أُضيفت حزمة محايدة فارغة لأنه لا توجد حزمة قطاع بعد، ولأن الفحص
   يشترط أن يكون `industry` موجودًا إن ذُكر.
3. **`$schema` رابط خارجي:** معرّف تحريري فقط. لا شيء في المستودع يجلبه، واختبار الاستيراد
   يثبت غياب أي مسار شبكة؛ قاعدة «لا اعتماد خارجي وقت التشغيل» (§2.1) غير متأثرة.

المسار متناسب مع المواصفة: بيانات الكتالوج `deploy/catalog/` (§7.2)، والفحص
`tools/catalog_check.py` (§7.3)، وخطوة CI `python3 -B tools/catalog_check.py` داخل
وظيفة `static`.

## المتبقي

1. CP2-T3 وما بعده: `tools/nasq_cli/**` (parser/inspect/preflight)، ثم adapters، ثم
   receipts/locks، ثم لقطة golden — جميعها مؤجلة.
2. قرارات D16/D09/D11 (الأسماء والأسعار والحدود) وهي مانع أي كتالوج تجاري معروض.
3. `nasq_quality` وحل الصحة (Phase 4) لم يبدأ.

## حدود الدليل

- هذا فحص مستودع ثابت وتشغيل اختبارات وحدة محلية. لا يثبت تزويدًا ولا ترقية ولا نشرًا
  ولا جاهزية إنتاج، ولا يشغّل CI السحابي.
- لا تحقق من أن كتالوجًا منشورًا يطابق قاعدة عميل؛ اللقطة والتزويد خارج النطاق.
