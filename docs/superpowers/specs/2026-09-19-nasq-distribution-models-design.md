# NASQ — نماذج التوزيع الثلاثة وطبقة المنصة: مواصفة التصميم

**التاريخ:** 2026-09-19
**الحالة:** مواصفة تاريخية لمرحلتها. قرار المنتج الأحدث يجعل SaaS المشترك والتسجيل الذاتي الهدف الأساسي بدل التأجيل في §10؛ انظر [عقد الاتجاه والقبول](nasq-shared-saas-and-sovereign-deployment.md). لا يدل تحديث التوجيه على تنفيذ shared أو اعتماد نشره.
**تمدّد:** `2026-09-15-nasq-vertical-saas-transformation.md` (التحليل والأدلة على مستوى الملف والسطر هناك؛ لا تُكرَّر هنا).
**تحلّ محل:** بند "No multi-tenant SaaS" في `2026-09-03-nasq-platform-design.md` بالقدر المحدد أدناه فقط.

> في نطاقهما التاريخي فقط، كانت هذه الوثيقة تسود مواصفة 09-15 في مواضع §11؛ [العقد الأحدث](nasq-shared-saas-and-sovereign-deployment.md) يسود الآن في نموذج الاستضافة والتسجيل والدفع والحكومة.

---

## 1. المبدأ الحاكم

```text
One codebase · One release line · One platform · Multiple deployment models
```

كان افتراض هذه المواصفة **خط منتج واحد دون فروع منفصلة** لـ`Nasq SaaS` / `Nasq Enterprise` / `Nasq Government`، وبنفس الكود والمهاجرات والصور. القرار الأحدث يُبقي ذلك **افتراضًا مبدئيًا لا منعًا دائمًا لـfork حكومي**؛ أي fork لاحق يحتاج اختلافًا مثبتًا وADR وموافقة المستخدم. معيار هذه المرحلة التاريخية أربع قدرات:

```text
Create · Upgrade · Isolate · Entitle
```

## 2. نماذج النشر

الفرق بين النماذج **من يشغّل البنية التحتية**، لا قاعدة البيانات. كلها قاعدة مستقلة ونفس الكود.

| النموذج | التسمية | مكان التشغيل | من يدير | التحديث | الاتصال بالبائع |
|---|---|---|---|---|---|
| SaaS | Managed Tenants | بنيتنا (مشتركة لاحقاً) | نحن | مركزي عبر `nasq-cli` | طبيعي |
| Dedicated | Managed Dedicated | بيئة معزولة مخصصة للعميل — **ليست بالضرورة عنده** | نحن | مركزي عبر `nasq-cli` | طبيعي |
| Government | Customer-Hosted / On-Premise | خوادم الجهة، قد تكون بلا إنترنت | الجهة | Release bundle وفق إجراءاتها | قد يكون ممنوعاً |

- "حكومي" و"شركات" تسميات بيع. المحور التقني الوحيد: **Managed** مقابل **Customer-Hosted**.
- لا `if mode ==` في الكود. الفروق إعدادات أو features.
- كان SaaS وDedicated متطابقين تقنيًا في نشر تلك المرحلة؛ القرار الحالي أن SaaS المشترك هو **الهدف الأساسي** مع DB/filestore لكل عميل، وله الآن تنفيذ مشترك مدمج وأدلة قبول محلية محدودة؛ حالة الإطلاق في [سجل الاستضافة الموحد](../../project-closure/saas-hosting-direction-status.md). Dedicated وCustomer-Hosted مساران منفصلان في الاستضافة والإدارة، و`saas/non_saas` محور تجاري مستقل. §10 سجل تأجيل تاريخي لا يحدد الأولوية الحالية.

### 2.1 ما يفرضه Customer-Hosted على المنتج من الآن

1. لا اعتماد خارجي وقت التشغيل (خطوط، CDN، خدمات). يُفرض بفحص CI.
2. المراقبة الخارجية (Sentry) اختيارية عبر env ومعطّلة افتراضياً؛ البديل سجلات محلية.
3. `nasq-cli` يعمل بلا شبكة ويُشحن ضمن الحزمة. أوامر التشغيل للجهة، وأوامر البائع لنا (§7).
4. الاستحقاقات آلية واحدة بمدخلين: كتابة مباشرة (Managed) أو `entitle --file` (Customer-Hosted).
5. `upgrade` ذاتي الاكتمال: نسخة احتياطية ← `-u` ← فحص صحة ← تراجع عند الفشل. هو نفسه المستخدم يومياً في Managed، فيُختبر عندنا قبل أن يصل إليهم.
6. حساب البائع قابل للتعطيل من جانب الجهة.

تغليف الحزمة نفسه مؤجَّل إلى أول طلب فعلي (§10).

## 3. نموذج المستأجر

```text
Tenant  = Database
Company = Branch   (res.company، بتسلسل parent_id عند الحاجة)
```

- الحدود (`users.limit`، `projects.max_projects`، `storage.limit_mb`) على **المستأجر كله**، لا على الفرع.
- القفل عند فحص الحد: `SELECT … FOR UPDATE` على سجل `nasq.tenant.profile`. العدّ على القاعدة كلها باستثناء حساب الدعم.
- عزل الشركات داخل القاعدة ليس حداً أمنياً بين عملاء لا يثقون ببعضهم؛ لذلك لا يتشارك عميلان قاعدة أبداً.

## 4. سلسلة الاعتماد

```text
nasq_core
   ↓
nasq_platform
   ↓
nasq_api
   ↓
business modules (pmo · hr · chat · quality · …)
   ↓
industry packs (بيانات فقط)
```

```python
nasq_platform: depends = ['nasq_core']
nasq_api:      depends = ['nasq_platform', 'auth_totp']
```

السبب: `/api/v1/branding` و`/api/v1/me` و`@requires_feature` تعيش في `nasq_api` وتقرأ الـprofile؛ أي اتجاه آخر دائري.

## 5. `nasq_platform`

### 5.1 Phase 1 — الهيكل الأدنى

```text
nasq.tenant.profile   (singleton، _nasq_scope = 'tenant')
└── root_company_id
```

- `/api/v1/branding` يقرأ `root_company_id`. لا استنتاج من `parent_id = False` ولا `order='id', limit=1`.
- **ترحيل القواعد القائمة لا يخمّن:** root company وحيدة واضحة ← تُعبَّأ. أكثر من واحدة ← يفشل الترحيل برسالة تطلب تحديدها صراحة.

### 5.2 Phase 2 — الإضافات

| الحقل / الخدمة | الغرض |
|---|---|
| `solution`, `tier` | للعرض والدعم فقط؛ الكود لا يتفرّع عليهما |
| `status` (`active` / `suspended`), `valid_until` | suspended = دخول مرفوض عدا الدعم؛ منتهٍ = قراءة فقط |
| `features` (JSON مسطّح) | مصدر الحقيقة الوحيد للاستحقاق داخل القاعدة |
| `terminology` (JSON) | تجاوزات مفاتيح i18n |
| `nasq.entitlement.service` | `get(key, default)` · `require(key)` · `require_within_limit(key, count)` → 403 `feature_not_included` |
| `@requires_feature(key)` | بجانب `@api_handler` في `nasq_api/controllers/common.py` |
| Feature Registry | كل وحدة تعلن features وlimit keys التي تملكها |
| Module Registry | `CAPABILITIES` في `nasq_core` = مجموع ما تعلنه الوحدات (نفس الـ28؛ يُزال `assert == 28`) |

### 5.3 قاعدة القرار

```text
allowed(user, action, record) =
      module_installed(action.module)
  AND entitlement.allows(action.feature)
  AND has_capability(user, action.capability, company_of(record))
  AND record_rule_visible(user, record)
```

- **الاستحقاق يحجب فقط؛ لا يمنح صلاحية.**
- لا `if plan ==` ولا `if industry ==` في أي مكان. الكود يسأل عن feature فقط.
- التخفيض يمنع الإنشاء الجديد ولا يحذف ولا يخفي بيانات قائمة.
- الواجهة تخفي للراحة؛ الفرض في الخادم.

### 5.4 `/api/v1/me`

يضيف `modules`، `entitlements`، `terminology`. العقد في `packages/contracts/src/common`.
الواجهة: سجل واحد `apps/web/app/modules/registry.ts` يحل محل `shellModules.ts` و`activeRoute.ts` ووجهات `accessPolicy.ts` ومصادر `GlobalSearch.vue`. الظهور = module ∧ feature ∧ `hasCapability`. المصطلحات تُدمج عبر `mergeLocaleMessage`؛ المفاتيح ثابتة والقيم تتبدّل.

## 6. نطاق الموديلات

كل موديل nasq **جديد** يعلن:

```python
_nasq_scope = 'company' | 'tenant' | 'global'
```

اختبار آلي يفشل إن غاب الإعلان. `company` وحده يشترط `company_id` + قاعدة سجلات.
الموديلات الموروثة من Odoo خارج هذا الإعلان وتُعالَج فردياً (L1 `discuss.channel`، L4 `project.project`).

## 7. الكتالوج والتزويد

### 7.1 نموذج الباقات

```text
Solution (health · …)
 ├─ base_modules      ← مثبتة دائماً
 ├─ industry pack     ← بيانات الحل
 ├─ tiers             ← modules + features + limits لكل مستوى
 └─ addons            ← تُثبَّت عند الشراء
```

- الاستحقاق يتحكم بالخصائص **داخل** الوحدة المثبّتة. وحدة لا يملكها العميل إطلاقاً لا تُثبَّت.
- **التخفيض يسحب الاستحقاق ولا يزيل التثبيت أبداً** (uninstall يحذف البيانات). لذلك كل route في وحدة غير أساسية يحمل `@requires_feature`، وباختبار تغطية.
- تخصيص العميل بثلاث درجات بلا كود: addons اختيارية · تهيئة ذاتية (مراحل، Properties، مصطلحات، أدوار) · وثيقة استحقاقات مفصّلة لعميل واحد. الـoverlay درجة رابعة استثنائية (§9).

### 7.2 الملفات

```text
deploy/catalog/
  schema/solution.schema.json
  schema/industry.schema.json
  solutions/health.json
  industries/health.json
```

### 7.3 فحص الكتالوج في CI — بندان مستقلان

1. **Schema validation:** شكل tier، أنواع limits، وجود `base_modules`، صيغة أسماء features.
2. **Semantic validation** (`tools/catalog_check.py`):
   - كل module في الكتالوج موجودة في `odoo-addons/` ولها `__manifest__.py`.
   - كل dependency موجودة ولا رسم مكسور.
   - كل feature في tier/addon معلنة في Feature Registry.
   - كل limit key معروفة للنظام.
   - tier IDs فريدة.
   - لا module في `base_modules` وفي الاختيارية معاً.
   - tier لا يشير إلى addon غير معروف.
   - solution لا يشير إلى industry pack غير موجود.

### 7.4 Golden snapshot

واحد لكل Solution، **مربوط بالإصدار وغير قابل للتعديل**: `health/v1.4.0`، `health/v1.5.0`.
المحتوى: base modules + بيانات الحل الأساسية + حالة الإصدار. يبنيه CI (`pg_dump` + filestore).
المستويات ليست snapshots؛ الـCLI يثبّت وحداتها ويطبّق الاستحقاقات.

```text
golden dump → pg_restore → sanitize (database.secret · uuid · كلمات المرور · mail · tokens · cron state)
            → seed branding → install tier modules/addons → write profile → health check
```

`CREATE DATABASE … TEMPLATE` مؤجَّل حتى تصبح السرعة مشكلة.

### 7.5 `nasq-cli` (`tools/nasq_cli/`، بلا اعتماد شبكي، يحل محل `deploy/provision.sh`)

| الفئة | الأوامر | من يشغّلها |
|---|---|---|
| تشغيل | `install` · `upgrade` · `backup` · `restore` · `health` | نحن، أو فريق الجهة في Customer-Hosted |
| بائع | `tenant create --solution --tier [--addons]` · `tenant entitle [--file]` · `tenant suspend\|resume` · `tenant export` | نحن |

`tenant entitle --addons` عملية صيانة قصيرة: نسخة احتياطية ← `-i` ← إعادة تشغيل العمال ← فحص صحة.

**تعريف rollback في `upgrade`:** استرجاع، لا downgrade migration.

```text
backup DB + filestore → upgrade (-u) → health check → failure → restore DB + filestore
```

لا تُكتب migrations عكسية ولا يُعتمد عليها؛ في Odoo الاسترجاع الكامل هو المسار الآمن الوحيد.

## 8. الحل الصحي v1

- 4 حقول على `project.task.type`: `nasq_key`، `nasq_enter_capability`، `nasq_is_gate`، `nasq_next_stage_keys`. الحالات الست على السلك ثابتة. **لا محرك workflow.**
- Properties على project وmeeting (موجودة على task). للبيانات الوصفية فقط؛ لا تدخل قواعد السجلات أبداً.
- `nasq_quality`: وحدة مشتركة **محايدة المفردات** — سجل مخاطر، تدقيقات، ملاحظات، CAPA. routes تحت `/api/v1/quality/*`.
- `nasq_industry_health`: **بيانات فقط** — مصطلحات، مراحل (مسودة ← مراجعة ← جودة ← اعتماد ← مغلق)، أنواع مشاريع، حقول CBAHI، أدوار مقترحة، لوحات، قوالب. اختبار يرفض أي منطق Python فيه.
- `solutions/health.json` بمستويات basic / advanced / cluster.
- `tracking=True` على الحقول الحساسة (ميزانية، حالة، مسؤول): تدقيق الأعمال لا يُبنى بأثر رجعي.

## 9. الـOverlays

استثناء مدفوع، لا طريق أساسي. عند أول عميل يدفع:
خطافات معلنة فقط + اختبار عقد لكل خطاف في النواة + CI متدرج (PR: النواة + overlays المتأثرة؛ المصفوفة الكاملة ليلاً وقبل الإصدار) + رسم صيانة سنوي + سجل ملكية. عميل ثانٍ يطلب نفس المنطق ← يُرقّى إلى المنتج كـfeature ويُحذف الـoverlay.

## 10. المراحل والمؤجَّل

| المرحلة | الهدف |
|---|---|
| **Phase 0 — Reliability** | CI · migrations + اختبار `-u` من لقطة سابقة · صورة Odoo مخبوزة (الوحدات + `deploy/security/odoo_secure.py`) · نسخ احتياطي مُختبَر الاسترجاع · إزالة `deploy/.env` من المستودع · فحص "لا مراجع خارجية" |
| **Phase 1 — Isolation** | L1–L4 · `_nasq_scope` · هيكل `nasq_platform` بـ`root_company_id` |
| **Phase 2 — Platform** | §5.2–5.4 + الحدود على مستوى المستأجر + اختبار تغطية `@requires_feature` |
| **Phase 3 — Provisioning** | الكتالوج + المخططات + الفحصان + `nasq-cli` + golden snapshots |
| **Phase 4 — Health Solution** | §8 |

| مؤجَّل | المحفِّز |
|---|---|
| تسجيل ذاتي + فوترة (كانتا مؤجلتين في هذه المرحلة) | **تاريخي:** أصبح التسجيل الذاتي والدفع ضمن هدف SaaS الأساسي بالعقد الجديد، وتوجد آليات طلب ودفع اصطناعي مدمجة؛ قبول التسجيل العام ومزود الدفع والرحلة الفعلية ما زال مفتوحًا وفق [سجل الاستضافة الموحد](../../project-closure/saas-hosting-direction-status.md) |
| تشغيل مشترك (كان اقتراحه `dbfilter` بالـHost واستنتاج القاعدة في Nuxt) | **تاريخي وغير كافٍ للعزل:** العقد الأحدث يشترط resolver موثوقًا وفشلًا مغلقًا عبر login/API/content/WS/jobs؛ لا تعتمد اقتراح §10 كتصميم تنفيذ |
| تغليف الحزمة (صور `docker save` · مصدر · SBOM · TLS داخلي)، ترخيص موقَّع، `auth_ldap` / نفاذ، سياسات كلمات المرور والجلسات، syslog | أول طلب Customer-Hosted — من آخر إصدار موسوم |
| تجمع صحي (`subtree` scope، `parent_path`) | أول تجمع |
| قطاع ثانٍ — معيار النجاح: صفر تعديل في النواة والواجهة المركزية | صفقة في القطاع |
| إطار الـoverlays | أول عميل يدفع |

## 11. الفروق عن مواصفة 09-15

| 09-15 | هذه الوثيقة |
|---|---|
| `nasq_platform` ضمنياً فوق `nasq_api` | `nasq_core → nasq_platform → nasq_api` |
| قاعدة شركة على كل موديل (L3) | إعلان `_nasq_scope`؛ `company` فقط يلزمه القاعدة |
| `/branding` "بالـhost أو الجذر" | `root_company_id` صريح؛ الترحيل لا يخمّن |
| الحدود بلا تحديد مستوى القفل | قفل على سجل الـprofile؛ عدّ على القاعدة كلها |
| Package مسطّحة | Solution ← Tier ← Addons |
| Shared SaaS = Phase 5 | مؤجَّل بمحفِّز |
| Customer-Hosted غير مغطّى | §2.1 |

## 12. التحقق

- **Phase 0:** CI أخضر على PR تجريبي؛ مهمة `-u` تمر من لقطة سابقة؛ استرجاع نسخة احتياطية إلى قاعدة scratch ونجاح `/login`.
- **Phase 1:** اختبار لكل تسريب (مستخدم الشركة B لا يرى قناة/مشروع/هوية A)؛ اختبار `_nasq_scope`؛ ترحيل `root_company_id` بحالتيه (وحيدة / متعددة تفشل).
- **Phase 2:** ميزة محجوبة ← 403 `feature_not_included`؛ حد متجاوز تحت تزامن؛ suspended؛ قراءة فقط؛ Playwright: عنصر القائمة يختفي والمصطلح يتبدّل.
- **Phase 3:** الفحصان يفشلان على كتالوج معطوب عمداً؛ `tenant create` من snapshot ← دخول ← `/me` يعكس الحل والمستوى؛ `entitle` يغيّر الحدود بلا إعادة نشر.
- **Phase 4:** تدفق الجودة كاملاً عبر الواجهة؛ بوابات المراحل تحترم الصلاحية؛ مستأجر basic يُرفض على `/api/v1/quality/audits`.
- كل اختبارات Odoo على قاعدة scratch بمسار addons صريح. لا اختبارات على `odoo19`.

## 13. خارج النطاق

**خارج نطاق تنفيذ هذه المواصفة التاريخية، لا خارج هدف المنتج الحالي:** billing · self-signup · shared Odoo workers. أصبحت الثلاثة ضمن اتجاه SaaS الجديد، وبواباتها في [العقد الأحدث](nasq-shared-saas-and-sovereign-deployment.md). بقيت العناصر الأخرى خارج هذه المرحلة: license server · LDAP/نفاذ · government installer · overlay framework · قطاع ثانٍ · workflow engine · AI · portal users.
