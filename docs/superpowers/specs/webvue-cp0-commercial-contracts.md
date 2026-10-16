# CP0 — عقود ويب فيو التجارية وفصل النسخة المستقلة

> **حدّ تاريخي:** بنود هذه المسودة التجارية السابقة لا تلغي قرار المنتج الأحدث: SaaS ذاتي الخدمة بخدمات مشتركة وقاعدة وملفات مستقلة، والحكومة غير SaaS؛ fork حكومي مستقبلي مشروط لا ممنوع مطلقًا. راجع [عقد الاتجاه الحالي](webvue-shared-saas-and-sovereign-deployment.md) قبل اعتماد أي بند.

**الحالة:** مواصفة مقترحة للمراجعة؛ بدأ إعداد CP0 بطلب «ابدأ»، ولم تُعتمد قرارات D01–D04 تفصيليًا بعد.
**النوع:** وثيقة عقود وقرارات معمارية، وليست تنفيذًا أو إذن تشغيل أو ترحيل عميل.
**خط الأساس:** `main` عند `d194f93f65c377a4f2e23e3ca067514bb692805b`؛ تحقق حي من نظافة canonical عند البدء.
**فرع الوثيقة:** `codex/cp0-commercial-contracts` في worktree محدود مستقل؛ الخطة الأصلية باقية دون تعديل في `codex/saas-control-plan`.
**الخطة الأم:** `docs/superpowers/plans/webvue-commercial-control-plane-plan.md`، موجودة حاليًا في `.worktrees/saas-control-plan/` ولم تُدمج.
**المخرجات هنا:** ADR-01 إلى ADR-04، قاموس بيانات، عقود API/CLI، مصفوفة تفويض وشاشات، ترحيل، وقائمة عمل CP1/CP2.

## 1. شروط القراءة والاعتماد

- **من قرار المستخدم:** لوحة بائع مستقلة؛ إدارة عميل SaaS لاشتراكه وفواتيره؛ تحييد الحكومي غير SaaS عن الدفع والاعتماد التشغيلي المركزي. خط منتج واحد **افتراضيًا**، لا منع مطلق لـfork حكومي مستقبلي؛ الاختلاف المثبت وADR والموافقة المستقلة شروط لذلك وفق العقد الأحدث.
- **قائم في المصدر:** سلوك حقول وأوامر تمت قراءتها، لا يُفترض تغييرها بمجرد كتابة هذه الوثيقة.
- **مقترح:** أسماء الحقول والمسارات وآليات الربط أدناه؛ لا تتحول إلى عقد إنتاجي قبل اعتماد القرار المختص.
- **مؤجل:** الأسعار، بوابة الدفع، الضريبة، مهلة التعثر، مدد الاحتفاظ وRPO/RTO، وتتبع D05–D16 في الخطة الأم.
- إنهاء كتابة CP0 لا يعني اجتياز بوابة اعتماد CP0. CP1 يبدأ بعد اعتماد D01 وعقد الترحيل؛ CP3/CP6 ينتظران D02–D04 بحسب نطاقهما.
- لا اختبارات على `odoo19` ولا ترحيل أو دفع أو تشغيل أو commit/merge/push/deploy بهذه المهمة.

## 2. أدلة المصدر والفروق التي تؤثر على العقد

كل المسارات في علامات source نسبية إلى canonical `/Users/tariq/code/nasq`؛ لا يفترض وجود المصدر كله داخل worktree الوثيقة المحدود.

| الدليل المقروء | الملاحظة المؤثرة |
|---|---|
| `tenant_profile.py` | `status` المخزن active/suspended؛ `valid_until` Date؛ لا commercial_mode/source؛ سياسة المشغّل داخل context |
| `entitlement_service.py` | expired مشتقة بتوقيت UTC؛ التعليق يمنع دخول/جلسة العميل؛ دعم القراءة التاريخية؛ revision محلية غير بروتوكول شبكة |
| `res_users.py` و`ir_http.py` | lifecycle على تسجيل الدخول والمصادقة؛ لا يصلح تجاوزهما كحل سريع للسداد |
| `serializers/user.py` و`common/me.ts` | `platform.schema_version=1` وZod strict لهذا الجزء؛ إضافة حقل داخله قد تكسر عميلًا قديمًا |
| `post-tenant_policy.py` | الهجرة السابقة تهيئ legacy مرة واحدة؛ لا يجوز تعديلها بعد إصدارها لإضافة التصنيف الجديد |
| `__manifest__.py` للمنصة | الإصدار الحالي `19.0.1.1.0`؛ رفع مخطط جديد وفق سياسة migrations لا إعادة خفضه |
| `same-site.ts` | حماية JSON وSec-Fetch-Site لنقاط auth الحالية؛ ليست آلية SSO أو حماية تجارية كاملة تلقائيًا |
| `deploy/Caddyfile` | `/api/v1/*` إلى Odoo والباقي إلى Nuxt؛ `/api/commercial/v1/*` يصل إلى Nuxt حاليًا إن أضيف handler لاحقًا |
| الخطة الأم | ثمانية مراحل CP و22 معيار قبول؛ التفصيل هنا يخصص قرارات التأسيس دون توسيع النطاق |

<!-- source: .worktrees/saas-control-plan/docs/superpowers/plans/webvue-commercial-control-plane-plan.md -->
<!-- source: AGENTS.md -->
<!-- source: CLAUDE.md -->
<!-- source: DESIGN.md -->
<!-- source: docs/parallel-work.md -->
<!-- source: docs/migrations.md -->
<!-- source: odoo-addons/webvue_platform/models/tenant_profile.py -->
<!-- source: odoo-addons/webvue_platform/models/entitlement_service.py -->
<!-- source: odoo-addons/webvue_platform/models/res_users.py -->
<!-- source: odoo-addons/webvue_platform/models/ir_http.py -->
<!-- source: odoo-addons/webvue_platform/migrations/19.0.1.1.0/post-tenant_policy.py -->
<!-- source: odoo-addons/webvue_platform/__manifest__.py -->
<!-- source: odoo-addons/webvue_api/serializers/user.py -->
<!-- source: packages/contracts/src/common/me.ts -->
<!-- source: apps/web/server/utils/same-site.ts -->
<!-- source: deploy/Caddyfile -->

## 3. ADR-01 / D01 — النمط التجاري ومصدر السياسة

**الحالة:** مقترح، يحتاج اعتماد أسماء الحقول ومصفوفة المصدر وخطة الترحيل.
**السؤال:** كيف نحمي النسخة المستقلة دون نشر شروط باقات داخل منطق PMO/HR؟

| البديل | النتيجة | الترجيح |
|---|---|---|
| استنتاج النمط من hosting أو اسم الجهة | نسخة مخصصة مستضافة لدينا تُصنّف SaaS خطأً | مرفوض |
| باقة مجانية/مدى صلاحية بعيد للحكومي | يبقى اقتران بفاتورة وheartbeat وانتهاء تجاري | مرفوض |
| نمط تجاري صريح ومصدر سياسة مضبوط في المنصة | حماية خادمية، عزل التكامل، ركائز تسأل عن feature فقط | موصى به |

### 3.1 مصفوفة الحقول المقترحة

| الحقل | النوع والقيم | القيد/المالك |
|---|---|---|
| `commercial_mode` | `saas | non_saas` | مطلوب بعد ترحيل معتمد، بلا default صامت للقواعد القديمة |
| `entitlement_source` | `control_plane | local_policy` | saas ↔ control_plane، non_saas ↔ local_policy في الإصدار الأول |
| `hosting_model` | **تاريخيًا:** `managed | customer_hosted`؛ **الهدف الحالي:** `shared_managed | dedicated_managed | customer_hosted` | على D01 والمخزون/الترحيل اعتماد أو مواءمة القيم الثلاث قبل التطبيق؛ في deployment inventory/config الموثوق وليس قرار السماح بالميزة |
| `installation_id` | UUID غير مشتق من db_name | هوية محلية مستقرة؛ لا تتطلب تسجيلًا مركزيًا لغير SaaS |
| `policy_revision` | integer محلي متزايد | موجود؛ يظل مراجعة snapshot المحلي الكامل |
| `commercial_policy_revision` | integer متزايد مستقل | مقترح لـSaaS فقط؛ آخر إصدار تجاري طُبق، يبدأ 0 |
| `commercial_binding_id` | معرف ربط opaque أو null | SaaS بعد تسجيل موثوق؛ null في non_saas، غير قابل لتعديل العميل |
| `support_access_enabled` | boolean | موجود؛ لا تغيّره رسائل الفوترة ولا reset تلقائي بالترقية |
| `valid_until` | Date أو null | موجود؛ في non_saas يجب معالجة القيمة القديمة صراحة قبل اعتماد null |

الحقول الجديدة ليست حقول فاتورة أو اشتراك داخل قاعدة العميل؛ هي هوية/مصدر سياسة فقط.
لا نضيف تلقائيًا أسماء القدرة أو الأسعار أو billing_account إلى `/me` العام لكل موظف.
`solution/tier` أوصاف للعرض؛ لا يدخلان في التفويض أو اشتراط انتهاء الأعمال.

### 3.2 القيود

1. فحص قاعدة بيانات للزوج mode/source، وقيود Python لإجراءات الانتقال؛ لا تغيير للنمط من write عام.
2. non_saas يرفض binding تجاريًا وتحديث commercial revision ورسائل policy التجارية، حتى مع هوية خدمة SaaS صحيحة.
3. non_saas يعمل بسياسة محلية وميزات وحدود، وليس bypass للاستحقاقات أو ACL.
4. لا انتهاء دعم أو عدم دفع يغير `status/valid_until` في non_saas.
5. الجهة تستطيع تعليقًا إداريًا محليًا؛ تحييد SaaS لا يعني إلغاء الحماية الأمنية أو منع الصيانة.
6. التشعب حسب النمط محصور في المنصة/تركيب الموصلات وحدود API؛ منطق الأعمال يبقى module ∧ feature ∧ capability ∧ record visibility.
7. تصنيف SaaS مطلوب حتى لو كانت خدمة الفوترة غير مفعلة بعد؛ عدم وجود binding يمنع العمل التجاري ولا يخترع حسابًا.
8. تمديد/تقصير مدة SaaS يحتاج فعلًا تجاريًا مدققًا؛ الدعم لا يبدلها بتحديث عادي.

### 3.3 آثار وموانع

تحتاج migration ونسخة عقد واجهة متوافقة واختبارات offline. يجب ألا تتغير lifecycle للداتا القديمة تلقائيًا.
رفض إدخال تصنيف مبهم يقع في preflight قبل نشر النسخة، وليس بعد تشغيل إصدار لا يستطيع قراءة بياناته.
**مانع CP1:** اعتماد D01 واختيار تمثيل مدخل التصنيف في التزويد والهجرة؛ لا تخمين حكومي من المجال أو اسم المؤسسة.

## 4. ADR-02 / D02 — تشغيل النسخة المستقلة اختياريًا

**الحالة:** مقترح؛ لا تفويض ضمني بدخول جهة أو إرسال بياناتها.

| البديل | الأثر |
|---|---|
| ربط كل نسخة بمنصة البائع | يخالف استقلال non_saas، مرفوض |
| منع أي تشغيل مركزي لغير SaaS | آمن لكنه يمنع خدمة managed مخصصة حتى لو تعاقد العميل عليها |
| تسجيل تشغيلي اختياري مستقل عن الفوترة | موصى به: local-only افتراضيًا، مع تفويض الجهة لكل ربط |

- لا يتطلب الإقلاع DNS للبائع أو رمز اشتراك أو Control Plane.
- ربط تشغيل non_saas، إن اعتُمد، يستخدم `operations_binding` منفصلًا عن `commercial_binding`؛ مصدر الاستحقاق يظل local_policy.
- وكيل التشغيل يمكنه health/backup/upgrade بحسب grant محدود؛ لا `billing.*` ولا كتابة commercial_mode أو مدة صلاحية.
- الجهة تملك الإلغاء ومفاتيح الاتصال وسجل العمليات. إلغاء الربط لا يمنع الأعمال المحلية.
- تُشارك بيانات صحة/إصدار فقط افتراضيًا؛ تصدير logs أو نسخة احتياطية يحتاج تفويضًا مستقلًا ومكان تخزين معتمدًا.
- تنزيل ملف سياسة محلي أو تطبيقه وظيفة مسؤول الجهة؛ لا تفرض هذه المواصفة خادم ترخيص أو توقيعًا يحتاج إنترنت.
- دعم هوية/توقيع ملفات محلية يمكن إضافته بعقد offline؛ لا يختلط بسلطة الفوترة.
**مانع:** قبل تنفيذ ربط non_saas التشغيلي يعتمد D02 ونطاق grant والإبطال. CP1 لا يحتاج هذا الربط أصلًا.

## 5. ADR-03 / D03 — أماكن الخدمات وعقود الفصل

**الحالة:** توصية تقنية للمراجعة؛ لا حزم أو dependencies منشأة بهذه الوثيقة.

| البديل | التقييم |
|---|---|
| محاسبة ولوحة بائع داخل Odoo لكل عميل | خلط بيانات وسلطة تجارية، مرفوض |
| مستودع وفروع منتج منفصلة | يكلف توافقًا وترحيلًا ويشجع fork، غير موصى به |
| خدمات مستقلة تشغيليًا في monorepo | موصى به؛ نفس المنتج ولا مشاركة DB أو cookies |

المسارات المقترحة، لا الموجودة:

- `apps/control-plane/`: Nuxt/Nitro لخدمة API ولوحة البائع وبوابة الحساب التجاري؛ DB مستقلة.
- `packages/commercial-contracts/`: عقود Zod للتجارة لا تعتمد على PMO/HR؛ عميل non_saas لا يستورد SDK مزود الدفع.
- `tools/webvue_cli/`: محرك العمليات Python يعمل محليًا بلا طلبات إنترنت إلزامية.
- عامل العمليات entry point مستقل في نفس حزمة الخدمة أو حزمة مستقلة تعتمد قبل CP3، وليس promise داخل HTTP يفقد عند restart.
- `deploy/catalog/`: تعريف الحلول والمستويات والوحدات والميزات؛ لا أسرار أو بيانات عميل.
- `apps/web/server/api/commercial/v1/**`: BFF العميل المقترح؛ لا تغييرات على proxy `/api/v1` الحالي لاستضافة الفوترة.

اختيار Nuxt/Nitro هنا توصية لإعادة استخدام خبرة الفريق، لا إلزام تقني وافق عليه المستخدم.
قبل CP3 يعتمد محرك DB/مهاجراته والطابور ومكتبة الهوية وأوامر build/test وملكية lifecycle للعامل؛ لا يفترض وجود ORM أو Redis.
المبدأ الموصى به ضمن D03، بانتظار الاعتماد التفصيلي: HTTP API وworker وDB التجاريون منفصلون عن Odoo العميل، مهما اختلف الإطار المختار.

### 5.1 حدود الشبكة

```text
متصفح البائع -> جلسة بائع مستقلة -> Control Plane -> DB تجارية
متصفح عميل SaaS -> Nuxt same-origin BFF -> خدمة التجارة
عامل مركزي -> قناة تشغيل خاصة موثقة -> CLI/مطبق سياسة داخل deployment معين
متصفح non_saas -> Nuxt/Odoo المحليان فقط، لا حاجة لأي خط أعلاه
```

- `/api/v1/**` الحالي يبقى Odoo؛ لا redirect عام ولا proxy مفتوح إلى Control Plane.
- مفاتيح machine-to-machine ليست session cookie العميل ولا browser bearer token.
- target deployment يأتي من inventory موثوق ومطابقة installation ID، لا URL/DB/path في طلب المتصفح.
- قوائم allowlist للوجهات وTLS والتحقق من الشهادات وتدوير الهوية متطلبات، لا تعطيل TLS للتسهيل.
- endpoint webhook مركزي منفصل عن BFF، ويفحص مزود الدفع لا جلسة Odoo.
- قواعد CORS لا تُفتح لكل الجهات؛ الأصل الطبيعي للمتصفح same-origin، وSSO إن استُخدم يمر بتدفق redirect مضبوط.

## 6. ADR-04 / D04 — هوية الفوترة والاسترداد أثناء التعليق

**الحالة:** مقترح أمني مانع إطلاق؛ يحتاج اعتماد تدفق الهوية ومكتبتها وتفاصيل الإبطال قبل CP6.

| البديل | النتيجة |
|---|---|
| استثناء كل مسارات الفوترة من تعليق Odoo | لا يحل Odoo المتوقف، وقد يفتح جلسات أعمال، مرفوض |
| السداد عبر الدعم فقط | يناقض إدارة العميل الذاتية المطلوبة كحل دائم |
| هوية تجارية مستقلة + BFF داخل ويب فيو + بوابة استرداد | موصى به؛ تستمر الفوترة دون قاعدة الأعمال |

### 6.1 سلطات الهوية

- `CommercialPrincipal` هوية مركزية للتجارة؛ لا تعادل `res.users.id` العالمي (هذه المعرفات تتكرر بين القواعد).
- `BillingMembership` تربط principal بحساب تجاري وتفويض وإصدار `membership_revision` وحالة revoked.
- `TenantUserLink` اختياري ويربط `(installation_id, local_user_id)` بالprincipal بعد إثبات الجانبين؛ لا ربط تلقائي لمجرد تشابه البريد.
- مالك الحساب التجاري مركزي ولا يُلغى تلقائيًا إذا توقف Odoo أو عُطّل حسابه الوظيفي؛ نقل/إلغاء الملكية عبر تدفق مستقل موثّق.
- مفوض موظف من لوحة ويب فيو يحتاج حساب موظف نشطًا + جلسة تجارية صالحة + عضوية مركزية. بوابة الاسترداد لا تُمنح له افتراضيًا.
- من يحتاج الاسترداد يمنح `billing.recovery.access` صراحة، ويُوضح أنه grant تجاري مستقل لا يبطل تلقائيًا بمجرد تعطيل موظف محلي؛ إبطاله مركزي وفوري.
- لا نعتمد على تزامن مستقبلي من Odoo لإبطال grant حساس أثناء انقطاعه؛ هذه قاعدة يجب عرضها لصاحب الحساب قبل التفويض.

### 6.2 الدخول والربط المقترح

1. البائع ينشئ دعوة لمؤسسة SaaS وحساب محدد؛ الرابط أحادي الاستخدام محدود العمر وليس إثبات ملكية نهائيًا وحده.
2. المستلم يثبت هويته التجارية مع MFA ويقبل الحساب/شروطه؛ الدعوة تقفل على الحساب والفاعل المتوقع وتُستهلك ذريًا.
3. داخل ويب فيو يفتح المخول قسم الفوترة، وBFF يتحقق من هوية موظف محلية خادميًا قبل بدء الربط، لا من payload `/me` أرسله المتصفح.
4. إذا لم توجد جلسة تجارية، تستخدم آلية قياسية Authorization Code + PKCE بعميل سري خادمي، state وnonce وredirect URI مطابق حرفيًا.
5. الرموز قصيرة العمر مخزنة خادميًا في BFF، والمتصفح يحصل cookie opaque `Secure/HttpOnly` خاصًا بنطاقه. لا access/refresh token في localStorage أو URL.
6. redeem code خادمي فقط وبمرة واحدة؛ التحقق من issuer/audience/expiry/state/nonce ومطابقة الحساب والربط يتم قبل إنشاء الجلسة.
7. المتصفح لا يرسل Odoo cookie إلى أصل Control Plane؛ البائع والبوابة التجارية وويب فيو لا يتشاركون Domain cookie واسعة.
8. كل طلب تجارة يعيد التحقق من membership الحالية ومطابقة حساب الخدمة؛ claim قديم في token وحده لا يكفي لقبول عملية مالية.
9. إنهاء الجلسة في ويب فيو ينهي جلسة BFF المحلية؛ revoke مركزي يمنع الطلب التالي مهما بقي cookie محلي.

هذه متطلبات بروتوكول، لا طلب بناء خادم OAuth/OIDC منزلي؛ يعتمد CP3 مكتبة/مزود هوية مدققًا يحققها وتثبت اختبارات عقده.
إذا تعذر هذا التدفق، يعود القرار للمراجعة؛ لا يستبدل برابط magic غير مضبوط أو مشاركة كلمات مرور Odoo.

### 6.3 التعليق والتوقف

- عند التعليق/توقف Odoo، بوابة التجارة المستقلة تتيح لمالك أو recovery grantee الدخول ببياناته التجارية وMFA.
- بوابة الاسترداد تعرض الفواتير والمدفوعات ومساعدة استعادة الحساب فقط؛ لا PMO/HR أو دخول دعم.
- اسم المستأجر أو معرف فاتورة أو رابط من صفحة تعليق لا يُستخدم كجلسة أو تفويض.
- التعليق التجاري والأمني سببان مستقلان؛ الدفع قد يغلق السبب التجاري فقط ولا يعيد جلسة Odoo القديمة.
- تسوية ناجحة مع سياسة غير مطبقة تظهر pending activation؛ العميل لا يعاد خصمه لإعادة المحاولة.
- استرداد MFA/نقل الملكية يحتاج إجراء هوية بشريًا مضبوطًا وتدقيقًا وإشعارًا؛ تفاصيل المهلة والموافقات تبقى D12.

## 7. مصفوفة القدرات وعقد رفض الوصول

القدرات التجارية مستقلة عن enum capabilities الحالي في Odoo. لا تُضاف تلقائيًا إلى دور system_admin ولا إلى كل مدير مؤسسة.

| القدرة المقترحة | مالك الحساب | مفوّض | الموظف العادي | موظف البائع |
|---|---|---|---|---|
| `billing.read` | نعم | منح صريح | لا | وظيفة مالية ونطاق مستأجر |
| `billing.pay` | نعم | منح صريح | لا | اعتماد عملية وفق سياسة البائع |
| `billing.profile.manage` | نعم | منح صريح | لا | منح مالي، لا هوية res.company |
| `billing.payment_methods.manage` | نعم | منح صريح مستقل | لا | لا قراءة بطاقة أو CVV |
| `subscription.manage` | نعم | منح صريح | لا | قدرة تجارية منفصلة عن التشغيل |
| `billing.delegates.manage` | نعم | لا افتراضيًا | لا | لا تصعيد دعم عادي |
| `billing.owner.transfer` | نعم مع إعادة تحقق | لا | لا | استرداد خاص موثّق، لا write عام |
| `billing.recovery.access` | نعم بعد تهيئة الهوية | grant مستقل | لا | ليس impersonation للعميل |
| `operations.restore` | طلب دعم فقط | لا | لا | مشغّل + موافقة حساسة |

التحقق التجاري = mode SaaS ∧ binding صحيح ∧ جلسة تجارية ∧ membership فعالة ∧ القدرة ∧ ملكية المورد.
داخل BFF الطبيعي يضاف شرط هوية الموظف النشطة. في بوابة الاسترداد يستبدل بشرط recovery grant، لا باستثناء Odoo عام.

| HTTP / code مقترح | الاستخدام |
|---|---|
| 401 `authentication_required` | لا جلسة صالحة |
| 403 `forbidden` | فاعل معروف بلا قدرة |
| 404 `not_found` | مورد غير موجود أو خارج نطاق المؤسسة، دون كشف وجوده |
| 404 `commercial_unavailable` | surface غير منشط في non_saas؛ لا طلب شبكة وراء الرفض |
| 409 `revision_conflict` | expected revision لا يطابق الحالة الحالية |
| 409 `idempotency_conflict` | مفتاح أعيد مع محتوى مختلف |
| 422 `invalid` | حقل/قيمة/انتقال غير صالح |
| 503 `commercial_service_unavailable` | انقطاع تجاري مؤقت؛ لا يتغير تشغيل المؤسسة بسببه |

هذا العقد لمسارات التجارة الجديدة؛ رموز `/api/v1` الحالية محفوظة ولا تستبدل من أجل توحيد شكلي.

## 8. توافق `/me` وحالة النشر

لا نضيف حقولًا داخل `platform` v1 الصارم. التوصية إضافة كتلة عليا optional باسم `commercial` بعقد مستقل:

```json
{
  "commercial": {
    "schema_version": 1,
    "mode": "non_saas",
    "self_service_available": false
  }
}
```

- المثال جزء إضافي من `/me` وليس استجابة `/me` كاملة.
- `self_service_available` يعني جاهزية السطح محليًا فقط، وليس صلاحية قراءة الفاتورة للفاعل.
- عدم وجود الكتلة عند خادم قديم يفسر على أنه لا سطح تجاري، دون تبديل lifecycle أو features.
- frontend جديد ↔ backend قديم، وfrontend قديم ↔ backend جديد يحتاجان اختبار عقد؛ لا نفترض أن كل المستهلكين يتجاهلون الحقول الزائدة.
- الصلاحيات التجارية تأتي من `/api/commercial/v1/context` بعد المصادقة، ولا تُستنتج من `commercial.mode` أو role في `/me`.
- CP1 يمكنه تعريف الكتلة والتمييز لكن `self_service_available=false` للجميع حتى جاهزية CP3/CP6 وربط موثوق.
- مراقبة انقطاع Control Plane لا تدخل `dump_me` ولا تجعل كل login يستدعي الشبكة.

## 9. عقد سياسة الاستحقاق وملكية الحقول

### 9.1 حدود الملكية

- السياسة التجارية تمتلك features/limits/cutoff SaaS المعتمدة فقط.
- المشغّل المحلي يملك root_company_id وsupport_access_enabled والتعليق الإداري/الأمني والتصنيف؛ ليست حقول webhook.
- `retained_read_features` يُشتق محليًا وفق القواعد الحالية، لا يمسحه payload تجاري لتخفيـة التاريخ.
- `terminology` لا تُرسل ضمن بروتوكول الدفع الأول؛ تغييرها مهمة إعداد منفصلة.
- سياسة non_saas تأتي من مسؤول محلي موثوق؛ شهادة آلة SaaS لا تمنحه authority عليها.
- أسماء حقول request أدناه عقد داخلي مستقبلي، وليست write ORM عامًا.

### 9.2 مثال طلب داخلي بعد الاعتماد

`POST /internal/v1/installations/{installation_id}/commercial-policy` في قناة التشغيل الخاصة، لا route متصفح عام.
`Idempotency-Key: policy-installation-demo-12` مع TLS وهوية آلة مقيّدة ونطاق operation. القيم أمثلة غير فعلية.

```json
{
  "schema_version": 1,
  "installation_id": "11111111-1111-4111-8111-111111111111",
  "binding_id": "binding_demo",
  "operation_id": "op_demo_12",
  "expected_revision": 11,
  "revision": 12,
  "effective_at": "2026-10-01T00:00:00Z",
  "valid_until": "2026-10-31",
  "features": {
    "users.limit": 30,
    "storage.limit_mb": 2048,
    "pmo.enabled": true,
    "meetings.enabled": true,
    "projects.max_projects": 100
  },
  "reason_code": "subscription_renewed"
}
```

المثال لبيئة تعلن PMO فقط إضافة إلى منصة الأساس؛ في بيئة بها HR/Chat يلزم payload كامل لمفاتيحها من registry. لا نسخ للمثال كسياسة كل عميل.
`expected_revision/revision` هنا يخصان commercial_policy_revision لا quota_revision ولا policy_revision المحلي.
مصدر الرسالة يُشتق من credential وbinding، لا من ادعاء `source=trusted` داخل JSON.

```json
{
  "operation_id": "op_demo_12",
  "status": "applied",
  "commercial_policy_revision": 12,
  "policy_revision": 27,
  "effective_state": "active",
  "applied_at": "2026-10-01T00:00:02Z",
  "correlation_id": "corr_demo_12"
}
```

`effective_state` في الرد يحسب بعد جمع قيود التشغيل، ولا يَعِد بأن الدفع ألغى سبب تعليق آخر.

### 9.3 الترتيب وإعادة المحاولة

1. تحقق credential والمستأجر/installation/binding/channel قبل تفاصيل payload؛ لا كشف profile لمستأجر آخر.
2. ارفض non_saas في الخادم قبل تطبيق أي cutoff أو feature.
3. تحقق schema كاملة وتوافق الوحدات والمفاتيح وrevision وUTC؛ لا أسرار أو أوامر تثبيت في السياسة.
4. الرسالة المستقبلية تعود `scheduled` وتبقى في scheduler مركزي؛ لا تُطبّق مبكرًا في قاعدة العميل.
5. عند النفاذ، تحت قفل transaction، أعد فحص mode/binding/revision ثم احفظ policy + receipt ذريًا.
6. يجب `revision = expected_revision + 1`. التكرار المطابق لمفتاح سابق يعيد receipt سابقًا؛ نفس المفتاح/محتوى مختلف = 409.
7. يحدث تعارض إصدار قديم = 409؛ المصالحة تجلب metadata الحالي بإذن ولا ترفع revision عميانيًا لتطمس تعديلًا مشروعًا.
8. تخزين idempotency scoped للbinding والعملية، مع hash canonical للطلب ونتيجة. مدة الاحتفاظ قرار CP3؛ لا حذف receipt قبل انتهاء نافذة retries المعتمدة.
9. policy_revision المحلي يزيد مع تغيير السياسة الفعلي؛ commercial revision يزيد مع تحديث تجاري مقبول، حتى لو تغير مشغّل إداري بالتوازي.
10. لا side effect خارجي غير ذري وسط transaction؛ النشر/الإشعار بعد commit عبر outbox.

### 9.4 التعليق والصلاحية

CP1 يحافظ على status الحالي؛ لا يضيف أسباب تعليق متعددة على عجل. قبل CP5 يجب توفير سجل أسباب منفصل:
`commercial_hold`, `administrative_hold`, `security_hold` مع فاعل/سبب/نفاذ/رفع.
الحالة الفعالة suspended إذا بقي hold مانع؛ سداد فاتورة يرفع commercial_hold المرتبط فقط.
فشل المزامنة لا ينشئ hold. نفاذ Date الحالي ينتهي بعد نهاية اليوم UTC المحدد، لا في بداية التاريخ.
ترحيل status=suspended قائم يتطلب سببًا موثقًا؛ لا يُفترض أنه تجاري.

## 10. عقود التجارة والشاشات

العقود التالية مقترحة عبر BFF في أصل ويب فيو. لا تنشأ routes أو capabilities في هذه المهمة.

| الشاشة | endpoint مقترح | القدرة | النتيجة |
|---|---|---|---|
| ملخص الاشتراك | `GET /api/commercial/v1/context` و`/subscription` | جلسة + membership، وbilling.read للتفاصيل | mode/قدرات مسموحة/اشتراك ومزامنة دون أسرار |
| الباقات | `GET /api/commercial/v1/catalog` | subscription.manage أو عرض مصرح | نسخ متاحة لهذا الحساب فقط |
| معاينة تغيير | `POST /api/commercial/v1/change-quotes` | subscription.manage | quote ثابت محدود العمر والمستأجر |
| تأكيد تغيير | `POST /api/commercial/v1/subscription-changes` | subscription.manage + إعادة تحقق حسب الأثر | 202 operation، لا applied متفائل |
| الاستخدام | `GET /api/commercial/v1/usage` | billing.read | حدود وعدادات وmeasured_at، لا بيانات موظفين |
| الفواتير | `GET /api/commercial/v1/invoices` و`/invoices/{id}` | billing.read | items/total للقائمة وrecord مفصل |
| تنزيل فاتورة | `POST /api/commercial/v1/invoices/{id}/download` | billing.read | تسليم آمن محدود النطاق والعمر |
| دفع | `POST /api/commercial/v1/invoices/{id}/payment-sessions` | billing.pay | hosted checkout مع عنوان مزود allowlisted |
| ملف الفوترة | `GET/PATCH /api/commercial/v1/billing-profile` | read/manage | full server shape بعد تعديل، لا تحديث res.company |
| وسيلة الدفع | `POST /api/commercial/v1/payment-method-sessions` | billing.payment_methods.manage | جلسة مزود، بلا PAN/CVV |
| الإلغاء/التجديد | `POST /api/commercial/v1/subscription-actions` | subscription.manage | أثر مؤرخ ومعتمد أو 422 |
| المفوضون | `GET/POST/DELETE /api/commercial/v1/delegates/{id?}` | billing.delegates.manage | grant محدود، revoke مدقق لا soft-hide فقط |
| نقل الملكية | `POST /api/commercial/v1/ownership-transfers` | billing.owner.transfer | طلب pending يقبله المالك الجديد بعد MFA |
| تتبع عملية | `GET /api/commercial/v1/operations/{id}` | صاحب الطلب أو قدرة مقابلة | حالة مورد المؤسسة فقط، بلا shell logs خام |

كل طلب تغيير يدعم Idempotency-Key عند وجود أثر غير قابل للتكرار، ويفحص CSRF وOrigin وجلسة الفاعل؛ استعمال POST للقراءة الحساسة هنا لا يعفيه من الحماية.
BFF يربط الحساب خادميًا، ولا يقبل `billing_account_id` لتغيير مؤسسة المستخدم. سياق البائع متعدد المؤسسات يملك عقدًا منفصلًا مع تفويض لكل هدف.
قائمة sort/filter/page محدودة allowlist وpagination؛ أسماء errors/شكل envelope توثق في Zod واختبارات قبل التنفيذ.

### 10.1 مثال تأكيد عرض تغيير

```json
{
  "quote_id": "quote_demo",
  "expected_subscription_revision": 4,
  "confirmation": "accept_quoted_change"
}
```

الخادم يعيد تحميل quote؛ السعر والعملة والضريبة وcatalog_version وtarget tier والمستأجر والوقت لا تؤخذ من المتصفح.
quote منتهٍ أو revision تغيرت = 409/422 وفق العقد المفصل، ويعرض فرقًا جديدًا للموافقة؛ لا قبول صامت لسعر مختلف.
Idempotency-Key لا ينتقل بين حسابات أو فاعلين؛ الخادم يفحص التفويض حتى عند إعادة receipt.

```json
{
  "operation_id": "op_change_demo",
  "status": "awaiting_payment",
  "subscription_revision": 4,
  "correlation_id": "corr_change_demo"
}
```

لا تزداد subscription revision لمجرد إنشاء عملية إلا إذا نص عقد مخزن الاشتراك على تعديل فعلي؛ المثال يتركها 4.
حالات متابعة التجارة: awaiting_payment → payment_confirmed → applying_policy → applied، مع failed/needs_intervention؛ لا تختلط بحالة عامل التشغيل أو tenant.status.

### 10.2 خريطة البائع

- العملاء: directory/detail → inventory API مفوّض؛ إنشاء من wizard مرتبط بمسار ثم operation ID.
- الاستحقاقات: عرض desired/applied/history → policy service، لا write عام على profile.
- الكتالوج: draft/validate/publish → نسخ ثابتة وفحص schema/semantic.
- الاشتراكات والفواتير: عقود مركزية لا تمر عبر قاعدة العميل.
- التشغيل: operations/details/retry → worker allowlist؛ restore/delete approvals منفصلة.
- الدعم: grant/expiry/revoke/audit → session broker إن اعتمد، لا impersonation من اسم بريد.
- سجلات التدقيق: فلاتر وصلاحية قراءة مستقلة وتصدير منقّح.

صفحات العميل تتبع DESIGN.md وStorybook وi18n وRTL؛ إنشاء /new فقط داخل SharedCreatePanel، والتفاصيل والتعديل صفحات، والتأكيد inline.
تصميم لوحة البائع المستقلة يُعتمد دون تغيير شكل العميل؛ لا واجهة mock في تشغيل الإنتاج.

## 11. عقد CLI وعمليات التشغيل

الأسماء التالية مسودة أوامر `webvue-cli` غير موجودة بعد؛ لا تشغّلها على بيئة حقيقية. CP2 يكتب parser وعقودًا واختبارات أولًا.

```text
webvue-cli tenant inspect --target <inventory-id> --json
webvue-cli tenant preflight --target <inventory-id> --policy-file <local-file> --json
webvue-cli tenant entitle --target <inventory-id> --policy-file <local-file> --expected-revision <n> --request-id <id> --json
webvue-cli health --target <inventory-id> --json
webvue-cli backup --target <inventory-id> --request-id <id> --json
webvue-cli upgrade --target <inventory-id> --release <local-bundle> --request-id <id> --json
webvue-cli restore --target <inventory-id> --backup-id <id> --approval-id <id> --request-id <id> --json
```

- `--target` يحل من inventory محلي موثوق؛ لا URL/DB افتراضي، ولا أسرار في flags، ولا auto-target إلى odoo19.
- كل payload ملف schema معروف ومحدود الحجم، path محلي واضح؛ لا تحميل URL حر أو shell interpolation.
- `preflight` بلا تغيير ولا شبكة إلزامية ولا إنشاء قاعدة؛ يرى snapshot والتعارضات ولا يعلن success للتنفيذ.
- `entitle` المحلي non_saas يمر بقناة operator موثوقة وسياسة محلية، لا commercial binding؛ expected revision حينها policy_revision المحلي ويحدد schema نوع القناة صراحة.
- لا يخلط CLI commercial revision وlocal revision في ملف واحد مبهم؛ parser يرفض نوع السياسة غير الموافق للنمط.
- عملية إضافة وحدة منفصلة عن تعيين feature: backup وinstall وhealth ثم policy، وليس install تلقائيًا من اسم feature.
- stdout JSON واحد للنتيجة، stderr logs منقحة؛ لا كلمات مرور أو access tokens. exit 0 نجاح العملية المعلنة فقط.
- exit codes مقترحة: 2 invalid input، 3 authorization، 4 conflict، 5 failed operation، 6 needs intervention. تعتمد في CP2 وتختبر.
- لا timeout يساوي نجاحًا. receipt يحفظ operation/request ID، target fingerprint غير سري، المرحلة والإصدار ونتيجة health ومراجع النسخة.

```json
{
  "schema_version": 1,
  "operation_id": "op_upgrade_demo",
  "request_id": "request_demo",
  "target": "installation_demo",
  "operation": "upgrade",
  "status": "needs_intervention",
  "stage": "restore_verification",
  "changed": true,
  "error": {
    "code": "restore_health_failed",
    "message": "Manual intervention required"
  },
  "correlation_id": "corr_upgrade_demo"
}
```

receipt لا يحول backup UNVERIFIED إلى recovery-ready؛ إثبات اتساق الالتقاط واختبار الاستعادة منفصلان.
worker يقفل الهدف مع fencing token وlease، ويخزن transitions ذريًا؛ عامل انتهى lease لا يطبق update حتى لو بقي process حيًا.
السلوك قبل retry: inspect الحالة/receipt أولًا؛ لا تكرار restore أو create عمياني. نقطة الإلغاء الآمنة يحددها كل operation.

## 12. نموذج البيانات المركزي الأدنى

| الكيان | مفتاح/قيود أساسية | لا يحتوي |
|---|---|---|
| Installation | UUID، نطاقات موثقة، نمط واستضافة، ربط واحد فعال من كل نوع | أسرار DB ظاهرة أو ملفات أعمال |
| BillingAccount | معرف opaque ومالك principal فعال؛ ربط installation معتمد | فروع res.company كمؤسسات مستقلة |
| Membership | account+principal فريد، capabilities، revision، revoked_at | أدوار PMO/HR ضمنية |
| Subscription | account/installation، price/catalog version، revision، period | feature policy تُحرر من المتصفح |
| Invoice | account، رقم فريد ضمن الجهة المصدرة، بنود/عملة/ضريبة ثابتة عند الإصدار | PAN/CVV |
| PaymentAttempt | provider+external reference فريد، invoice، مبلغ/عملة/حالة | كود استرجاع كدليل تحصيل |
| ProviderInbox | provider+event_id فريد، digest، processing state | قبول حدث دون توقيع/حساب/مبلغ |
| PolicyOutbox | installation+commercial revision فريد، payload، retries | target host حر |
| Operation | target/type/request identity، مراحل وlease/fencing ونتيجة | shell command من العميل |
| AuditEvent | actor/subject/action/reason/correlation/time | رموز session أو بيانات حساسة خام |

العلاقات وأسماء الأعمدة تحتاج migration للخدمة الجديدة مستقلًا عن Odoo؛ SQL constraints ليست افتراض ORM معين.
المبالغ integers بأصغر وحدة وعملة صريحة؛ rounding والحساب النسبي والضريبة تُحسم D06/D07/D11 قبل CP5.
حذف حساب/مستخدم لا يحذف فواتير تاريخية تلقائيًا؛ legal hold/retention يحتاجان D10.

## 13. خطة ترحيل D01 وتوافق القديم

### 13.1 مدخل تصنيف موثوق مقترح

ملف mapping محلي خارج Git يربط installation/DB الهدف الذي يثبته المشغّل بالmode/source والتعامل مع expiry/hold القديمين؛ ليس ملفًا يرفعه عميل عبر الواجهة.
CP1 يحدد طريقة تمريره إلى pre-migration في scratch أولًا، وتُعتمد قبل تشغيل upgrade حقيقي.

```json
{
  "schema_version": 1,
  "installation_id": "11111111-1111-4111-8111-111111111111",
  "commercial_mode": "non_saas",
  "entitlement_source": "local_policy",
  "hosting_model": "customer_hosted",
  "legacy_valid_until_action": "requires_operator_decision",
  "legacy_suspension_action": "preserve",
  "approved_by": "operator_reference"
}
```

هذا المثال **غير قابل للتطبيق** عمدًا حتى تُحسم requires_operator_decision؛ approved_by معلومة تدقيق لا اعتماد مصادقة يمكن تزويره.

### 13.2 خطوات ومنع التراجع الوظيفي

1. preflight للنسخة القديمة: singleton/root company، status/cutoff، features/retained، support flag، والإصدار.
2. لا كتابة للحقول التجارية في القديم ولا reset للسياسة إذا كانت initialized.
3. اعتماد mapping لكل قاعدة؛ غياب mapping/وجود cutoff غير محلول يوقف rollout قبل تحميل إصدار جديد.
4. backup مرجعي ونافذة مصرح بها قبل أي migration؛ هذه الوثيقة لا تأذن بتنفيذهما.
5. migration جديدة بإصدار أعلى من 19.0.1.1.0، لا تعديل ملف الهجرة السابقة؛ إنشاء جديد يلتزم مسار التزويد نفسه.
6. non_saas: cutoff تجاري قديم لا يمسح إلا بقرار موثق؛ status معلّق يبقى مع سببه، ولا يُستأنف تلقائيًا.
7. saas: يحافظ على cutoff/lifecycle الحاليين، commercial revision يبدأ 0 وربط خارجي غير مفترض؛ لا فاتورة أو دفع رجعي.
8. retained features والحدود وroot_company والقدرات ودعم معطل لا تتغير نتيجة التصنيف وحده.
9. يعاد التشغيل على نفس mapping بأمان؛ mismatch بعد تصنيف قائم = رفض، لا تحويل نمط ضمن migration عادية.
10. rollback يستعيد DB+filestore والإصدار المتوافق؛ لا downgrade migrations. المراقبة تصف rollback الفعلي لا نجاحًا وهميًا.

التحويل المستقبلي SaaS ↔ non_saas ليس جزء CP1؛ يحتاج عقد خروج وفصل أسرار/منح/فواتير مع إبقاء البيانات، وقرار مستخدم خاص.

## 14. تسليم CP1 وCP2 إلى التنفيذ بعد الاعتماد

### 14.1 CP1 — فصل النمط دون بناء فوترة

| المهمة | ملكية ملفات مرشحة، تثبت بالفحص عند البدء | المخرج/الدليل |
|---|---|---|
| CP1-T1 | `webvue_platform/models/tenant_profile.py` وentitlement_service، manifest، migration جديدة | الحقول/قيود المصدر وpreflight؛ لا تغيير ميزات أو دعم ضمني |
| CP1-T2 | `webvue_platform/tests/test_tenant_profile.py` وlifecycle واختبارات تصنيف جديدة وtests/__init__ | مصفوفة mode/source وتحديث تجاري مرفوض لغير SaaS وتكرار migration |
| CP1-T3 | `webvue_api/serializers/user.py`، `packages/contracts/src/common/me.ts` واختباراتهما | extension متوافق للـ/me واختبار client/server قديم/جديد |
| CP1-T4 | deploy seed/provision مواضع محددة بعد فحص، واختبارات wrappers | إدخال تصنيف صريح للتثبيت الجديد، لا default SaaS |
| CP1-T5 | اختبارات API/frontend عند الحاجة، registry المشترك بمالك واحد | غير SaaS لا تفعّل surface؛ لا صفحة فوترة placeholder أو شبكة إلزامية |
| CP1-T6 | أدلة verification منفصلة بمسارات تعتمد لاحقًا | تشغيل focused ثم scratch/upgrade/offline وتقرير مخاطر |

المسارات المختصرة أعلاه داخل `odoo-addons/` حيث تبدأ webvue_platform/webvue_api، لا مجلدات جديدة في جذر المستودع.
كاتب واحد للمنصة؛ لا تشغيل T1 وT2 على الملفات نفسها بالتوازي دون نقل ملكية. T3 يعتمد العقد، وT4 يعتمد T1.
**خارج CP1:** أسعار، UI دفع، موصل مزود، cron تحصيل، recovery identity، suspension reasons الجديدة، تشغيل مركزي.
**بوابة CP1:** القواعد الحالية محفوظة، non_saas مصنفة دون قناة تجارية، migrations غير غامضة، وغياب Control Plane لا يؤثر بالأعمال المحلية.

### 14.2 CP2 — عقد الكتالوج ومحرك تشغيل محلي

| المهمة | النطاق المقترح | المخرج/الدليل |
|---|---|---|
| CP2-T1 | `deploy/catalog/schema/**` وsolutions/industries، fixtures | schema وأنواع/إصدارات ومفاتيح، دون أسعار نهائية مختلقة |
| CP2-T2 | `tools/catalog_check.py` واختباراته | فحص semantic للregistry/modules/dependencies مع حالات فساد مقصودة |
| CP2-T3 | `tools/webvue_cli/**` | parser/inspect/preflight/JSON/errors/target validation؛ no network افتراضي |
| CP2-T4 | adapters تشغيل محددة إلى wrappers الحالية | tests تثبت عدم shell injection/استهداف DB افتراضية، ولا كذب بشأن recovery readiness |
| CP2-T5 | receipts/locks واختبارات retry | idempotency ومراحل وتدخل بشري عند فشل الاستعادة |
| CP2-T6 | نص تشغيل scratch/golden-design وأدلة في docs | create/entitle مع تصنيف CP1؛ bundle بلا بيانات عميل وأسرار |

يجوز CP2-T1/T2 على عقود معتمدة قبل اكتمال CP1؛ عمليات التزويد والتغيير الفعلية تنتظر CP1.
لا يُحذف `deploy/provision.sh` فورًا؛ مسار توافق وانتقال مثبت أولًا ثم إزالة منفصلة إن اعتمدت.
**خارج CP2:** Control Plane حي، بوابة دفع، تشغيل مشترك للعملاء، نشر حكومي فعلي، أو أتمتة delete production.

### 14.3 أوامر التحقق ومقاييس التسليم

- الوثيقة الحالية: `git diff --check` وفحص بنيوي ومراجع المصدر وصحة JSON أمثلة؛ لا إثبات عمل endpoints.
- CP1 لاحقًا: `ruff check odoo-addons`، اختبارات Odoo المستهدفة على scratch جديد، migration من baseline، `npm -w packages/contracts run test`، وweb lint/tests إذا تغير العميل.
- CP2 لاحقًا: `python3 -B -m unittest discover -s tools -p 'test_*.py'` و`python3 -B -m unittest discover -s deploy -p 'test_*.py'`، مع أوامر اختبارات CLI الجديدة التي تُثبت في عقد المهمة.
- `npm test` و`npm -w apps/web run lint` للبوابات الأوسع ذات الصلة؛ لا npx -w، ولا تغيير اختبارات لتقبل regression.
- `DESIGN.md` وStorybook وui_policy عند أي صفحة/تنقل؛ لا حاجة لتغيير واجهة في CP0.
- offline proof في التنفيذ يشمل حجب egress فعليًا وملاحظة الطلبات والإقلاع والأعمال، لا غياب عنوان في ملف فقط.
- scratch/config/data/logs/ports مستقلة، upstream Odoo للقراءة فقط؛ ممنوع `odoo19` أو إعداد حي.
- لا تثبيت dependencies لهذه الوثيقة؛ في التنفيذ npm ci --ignore-scripts، ومساحات node_modules/.nuxt مستقلة غير مربوطة.
- shared files مثل barrels/config/navigation/provision/CI لها مالك واحد؛ لا merge/commit/deploy دون تفويض مستقل.

## 15. سيناريوهات العقد المانعة للتسليم

| ID | السيناريو | النتيجة المطلوبة |
|---|---|---|
| C01 | non_saas + credential تجاري صحيح | رفض قبل تغيير أي feature/cutoff/hold أو اتصال خارجي |
| C02 | mapping غائب أو cutoff قديم غير محلول | preflight يمنع rollout، لا تصنيف افتراضي أو تعطيل أعمال |
| C03 | backend قديم دون commercial | العميل الجديد لا يظهر الفوترة ولا يغير الوصول للأعمال |
| C04 | نفس البريد في قاعدتين | لا ربط identities أو كشف حساب تجاري دون إثبات ربط |
| C05 | سحب membership مع session/token قديم | الطلب التالي للتجارة مرفوض، حتى عند تكرار idempotency key |
| C06 | Odoo متوقف ومالك recovery مخوّل | دخول تجاري مستقل ودفع دون وصول أعمال |
| C07 | تعطيل موظف بلا سحب recovery grant مستقل | BFF الطبيعي مرفوض؛ recovery يعمل فقط إذا grant مستقل قائم ومعلن للمفوّض |
| C08 | code/redirect/state/nonce/audience خاطئ أو معاد | فشل الربط دون جلسة أو account substitution |
| C09 | quote لحساب مختلف/منتهٍ/سعر متغير | رفض وتقديم معاينة جديدة؛ لا تحصيل من قيم المتصفح |
| C10 | سياسة future أو revision قديم | جدولة أو conflict، لا تطبيق مبكر أو rollback للميزة |
| C11 | نفس request key بمحتوى آخر أو target آخر | conflict أو رفض scope، لا إعادة تنفيذ |
| C12 | دفع مع administrative/security hold | التجاري يغلق وحده؛ لا جلسة أعمال مستأنفة |
| C13 | worker يفقد lease قبل apply | fencing يمنع الكتابة القديمة، ولا success وهمي |
| C14 | backup UNVERIFIED أو استعادة مرفق ناقص | لا إعلان recovery-ready؛ فشل/تدخل بشري بدليل |
| C15 | non_saas بإعداد شبكة فارغ/بائع غير متاح | install/login/features المحلية تعمل بعد التصنيف الصحيح |
| C16 | فوترة profile update | لا تعديل company identity/logo أو منح HR/PMO |
| C17 | إعادة migration أو CLI preflight | لا تكرار أثر ولا reset لدعم معطل/retained/حدود |
| C18 | tenant_id/URL/DB/مسار ملف من browser | لا ثقة؛ server-side mapping وallowlist وscope rejects |

تربط C01–C18 بالسيناريوهات A01–A22 في الخطة الأم في عقود التنفيذ؛ نجاح فحص JSON هنا ليس نجاح أي من هذه السيناريوهات التشغيلية.

## 16. حزمة الاعتماد المطلوبة قبل الكود

| القرار | الموافقة المطلوبة تحديدًا | ما يمكن فعله قبله |
|---|---|---|
| D01 | commercial_mode/source والقيود، mapping صريح، Date غير SaaS بلا انتهاء دعم، /me extension خارج platform v1 | مراجعة الوثيقة فقط؛ CP1 ممنوع قبل اعتماد المخطط والترحيل |
| D02 | non_saas local-only افتراضيًا، وربط تشغيل اختياري منفصل إن احتاجته الجهة | CP1 المحلي وكتالوج مستقل بعد D01 |
| D03 | خدمات منفصلة في monorepo والمسارات المقترحة أو بديل محدد | عقود المنصة والـCLI؛ لا إنشاء stack خدمة مفترض |
| D04 | هوية تجارية مستقلة وBFF آمن، recovery grant مستقل، عدم الربط بالبريد، الإبطال والتحقق بكل طلب | CP1/CP2 لا يحتاجان بناء المصادقة التجارية |

D05–D16 تظل مفتوحة، ولا تحدد هذه الوثيقة مهلة سداد أو سعرًا أو بوابة أو احتفاظًا أو التزام امتثال نيابة عن المستخدم.
لا يحتاج بدء CP1 اعتماد السعر أو بوابة الدفع؛ يحتاج اعتماد D01 وتفصيل مدخل التصنيف أولًا.
اقتراح أول شريحة بعد الموافقة: CP1-T1/T2 فقط، بنطاق ملفات متحقق وفحوص scratch منفصلة؛ ثم العقد /me والتزويد.

## 17. حدود مهمة CP0 الحالية

- المخرج ملف مواصفة واحد؛ الخطة الأم محفوظة والمصدر التنفيذي دون تعديل.
- البدائل والتوصيات مكتوبة، لكن الحالة «مقترح» لا «مقبول». لا حقول أو خدمات أو routes أو grants جديدة منفذة.
- فحوص الوثيقة تثبت بناءها ومراجعها وصحة أمثلة JSON فقط، ولا تثبت أمن منتج أو إنتاج أو DNS أو امتثال.
- لا commit أو دمج أو push أو نشر أو تغيير خدمات أو قواعد؛ worktree الخطة والوثيقة محفوظان حتى يطلب المستخدم غير ذلك.
- مراجع AGENTS/CLAUDE/DESIGN والمهاجرات والعمل المتوازي هي القواعد الحاكمة؛ هذه الوثيقة لا تعيد تعريفها ولا تتجاوز قرارًا معتمدًا.
