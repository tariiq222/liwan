# تقرير تثبيت المرحلة 2 (Platform/Entitlements) — تشغيلي

- **التاريخ:** 2026-09-21
- **خط الأساس:** `main` = `927543f5c5c5f225cb6d89bc9545515becb822a1` (= `origin/main`، شجرة العمل نظيفة عدا `.agent-teams/` غير المتعقب)
- **مصدر أودو:** `/Users/tariq/code/odoo` @ `34eed49d88f0f4357e1f54fe82cb0ad280939572` (= `deploy/odoo/ODOO_COMMIT`)، `.venv/bin/python` 3.12.13
- **قاعدة البيانات:** PostgreSQL 16.14 محلي على `127.0.0.1:5432` بمستخدم `tariq` (متغيرات `PGHOST/PGPORT/PGUSER`، بلا كلمة مرور على سطر الأوامر)
- **مرجع الكتل:** `.github/workflows/ci.yml` (static, odoo, upgrade, image, restore-drill, e2e-mock)
- **الحكم الإجمالي:** **main عند `927543f5` ليس أخضر.** كتلة `odoo` حمراء باختبار واحد مُخطئ، وكتلة `e2e-mock` حمراء بمواصفة واحدة فاشلة؛ وما عدا ذلك (static, upgrade, image, restore-drill، والدخول الحقيقي) مرّ.

> هذا تقرير تثبيت تشغيلي محلي. لا يحمل أي دليل نشر إنتاجي أو DNS، ولم تُشغَّل أي بوابة GitHub Actions سحابية. كل النتائج أدناه من تشغيل محلي على قواعد `scratch` معزولة، ولم تُمَس قاعدة `odoo19` ولا أي قاعدة لزميل.

---

## 1. مصفوفة النتائج

| المهمة | الكتلة / الهدف | الحكم | الدليل المختصر |
|---|---|---|---|
| t1 | `static` (ruff, deploy unittest, migration_guard, npm/test/lint) | PASS | كل الأوامر exit 0 |
| t1 | `odoo` على قاعدة scratch | **FAIL** | `0 failed, 1 error(s) of 628 tests` |
| t2 | `upgrade` (-u من `8cf28748` إلى `927543f5`) | PASS | install 0 ERROR، upgrade 0 ERROR، guard 0، smoke 0 |
| t3 | دخول حقيقي بدون Mocks (استحقاقات/حصص/دورة حياة/عقد `/me`) | PASS | 9/9 سيناريوهات، 0 ERROR في لوج أودو |
| t4 | `image` (بناء + تثبيت داخل الصورة + فحص التحصين) | PASS | `IMAGE_BLOCK_OK`، uid=10001، git غائب |
| t4 | `restore-drill` (نسخ/استرجاع + الحالة السالبة) | PASS | إيجابي `restore_verified:true`، سلبي `false` كما هو متوقع |
| t4 | `e2e-mock` (7 مواصفات) | **FAIL** | `6 passed / 1 failed` (حتمي في تشغيلين) |
| t7 | إصلاح T1-F1 (worktree **غير مدمج**) | PASS داخل الـworktree | 628/628 خضراء هناك |
| t8 | مراجعة أمنية مستقلة لإصلاح T1-F1 | pass | صفر تغيير runtime |

**تمييز حاسم:** `main` عند `927543f5` ما زال يحمل فشل t1. الإصلاح موجود فقط في worktree معزول `.worktrees/t7-tenant-profile-fixture` (فرع `codex/t7-tenant-profile-fixture`) ولم يُدمج ولم يُcommit ضمن هذا العمل.

---

## 2. t1 — كتلة `static` وكتلة `odoo` على main

### 2.1 كتلة `static` — نجحت بالكامل

الأوامر كما في `ci.yml` (من جذر `/Users/tariq/code/nasq`):

```sh
ruff check odoo-addons                                   # exit 0 — "All checks passed!"
python3 -B -m unittest discover -s deploy -p 'test_*.py' -v   # exit 0 — "Ran 45 tests … OK"
python3 -B tools/migration_guard.py --base origin/main   # exit 0 — بلا مخرجات
npm ci --ignore-scripts                                  # exit 0
npm -w apps/web run postinstall                          # exit 0 — "Types generated in .nuxt"
npm test                                                 # exit 0
npm -w apps/web run lint                                 # exit 0 — vue-tsc --build --noEmit
```

نتائج `npm test` بالتفصيل: سياسة الواجهة 95 اختبار `OK`، `@nasq/contracts` 27 ملفًا / 166 اختبارًا passed، `apps/web` 122 ملفًا / 830 اختبارًا passed. و`ruff` بالنسخة المثبتة في CI (`ruff==0.16.3`).

### 2.2 كتلة `odoo` — حمراء (اختبار واحد)

الأمر المُشغَّل (كتلة `odoo` في `ci.yml` بمسارات محلية + `/Users/tariq/code/nasq/odoo-addons`)، على قاعدة scratch جديدة اسمه `nasq_p2_full_scratch` أُثبت غيابها قبل التشغيل:

```sh
cd /Users/tariq/code/odoo
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python odoo-bin \
  --db_host=127.0.0.1 --db_port=5432 --db_user="$PGUSER" \
  --addons-path=/Users/tariq/code/odoo/odoo/addons,/Users/tariq/code/odoo/addons,/Users/tariq/code/nasq/odoo-addons \
  --data-dir="$SCRATCH/data" --logfile="$SCRATCH/logs/odoo.log" \
  -d nasq_p2_full_scratch --db-filter='^nasq_p2_full_scratch$' \
  -i nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat \
  --test-tags /nasq_core,/nasq_platform,/nasq_api,/nasq_pmo,/nasq_hr,/nasq_chat \
  --http-port=8169 --workers=0 --max-cron-threads=0 --stop-after-init --log-level=test
```

النتيجة (`odoo-bin` exit **1**) والسطر الحاسم:

```text
2026-09-21 20:26:42,568 34408 ERROR nasq_p2_full_scratch odoo.tests.result:
  0 failed, 1 error(s) of 628 tests when loading database 'nasq_p2_full_scratch'
```

وفحص `ci.yml` نفسه على نفس اللوج يعطي exit **1**:

```sh
grep -Eq 'odoo.tests.result: 0 failed, 0 error\(s\) of [1-9][0-9]* tests when loading database' odoo-test.log
# → exit 1
```

الاختبار المُخطئ والاستثناء الحقيقي:

```text
ERROR: TestTenantProfile.test_ensure_raises_when_multiple_roots_and_no_profile
  (odoo-addons/nasq_platform/tests/test_tenant_profile.py:21)
odoo.exceptions.UserError: nasq_platform: tenant profile is missing or not a singleton.
```

مسار الاستدعاء الكامل (مثبت بالقراءة + بأثر المكدس):

1. `res.company.create({'name': 'Second root company'})` (سطر 21 في الاختبار) — وحينها كان صف `nasq.tenant.profile` قد حُذف في السطر 19.
2. Odoo يعطي كل شركة جديدة **شعارًا افتراضيًا حقيقيًا**: `logo = fields.Binary(related='partner_id.image_1920', default=_get_logo, readonly=False)` في `odoo/addons/base/models/res_company.py:62`، و`_get_logo` (السطور 41-43) تقرأ `base/static/img/res_company_logo.png` (11,445 بايت).
3. `BaseModel.create` يفلش قيمة الافتراضي عبر `determine_inverse` (`odoo/orm/models.py:4739`) → `_inverse_related` (`odoo/orm/fields.py:733`) → `res.partner.write({'image_1920': <png>})` → `fields_binary.write` (`odoo/orm/fields_binary.py:220`) ينشئ مرفقًا: `res_model='res.partner'`, `res_field='image_1920'`.
4. خطاف nasq `nasq_platform/models/ir_attachment.py:30` يطالب بـ `extra = 11445` بايت → `_nasq_claim_storage` → `_nasq_assert_lifecycle(write=True)` → `_nasq_effective_state` → `_nasq_profile` → `UserError`، أي **داخل** `res.company.create` وقبل الوصول إلى السطر 22/23 حيث يتوقع الاختبار `ValidationError`.

**حتمي لا عارض ترتيب اختبارات:** إعادة تشغيل معزولة بنفس كتلة الأمر على قاعدة scratch جديدة `nasq_p2_tenantprofile_scratch` مع `--test-tags /nasq_platform:TestTenantProfile` أعطت:

```text
odoo.tests.result: 0 failed, 1 error(s) of 2 tests when loading database 'nasq_p2_tenantprofile_scratch'
```

**انحراف موثّق في ت1:** `--logfile` يستبدل مُعالج `stderr` (`odoo/netsvc.py:261`)، فيحتوي ملف `tee` مخرجات غير-المُسجِّل فقط؛ لذلك أُلحقت نسخة `logs/odoo.log` لنفس التشغيل بين علامتي `BEGIN/END` صريحتين كي يحمل هدف فحص `ci.yml` النص الكامل.

**التنظيف (t1):** `dropdb --if-exists nasq_p2_full_scratch` و`dropdb --if-exists nasq_p2_tenantprofile_scratch` ثم `rm -rf` لمجلدي `mktemp` → 0 بقايا، و`odoo19` لم تُمَس.

---

## 3. t2 — الترقية `-u` من الأساس `8cf28748` إلى main

المسار: تثبيت الوحدات الست من worktree مؤقت للأساس `8cf28748`، ثم `-u` بكود `main` نفسه، ثم `upgrade_log_guard` ثم `upgrade_smoke`.

- **التثبيت من الأساس:** exit 0، سجل `logs/odoo-install.log` = 694 سطرًا و**0 ERROR/CRITICAL**؛ وpsql يثبت الست وحدات installed: `nasq_core`/`nasq_platform`/`nasq_api` = `19.0.1.0.0`، `nasq_pmo`/`nasq_chat` = `19.0.1.1.0`، `nasq_hr` = `19.0.1.0.0`.
- **الترقية `-u`** على نفس القاعدة بمسار `/Users/tariq/code/nasq/odoo-addons`: exit 0، `upgrade.log` = 78 سطرًا، `sha256 7e8399bb613fbdce333640c4f0e8b380920d231a377073b59338690ab34b1044`، **0 ERROR/CRITICAL**.
- **دليل أن الترقية حمّلت كود main فعلًا:** تنفيذ ترحيل حقيقي داخل اللوج:

```text
module nasq_platform: Running upgrade [19.0.1.1.0>] post-tenant_policy
```

وارتفاع `latest_version` إلى `19.0.1.1.0` (نسخة main) بينما الأساس يحمل `19.0.1.0.0`، ومجلد `migrations/19.0.1.1.0/post-tenant_policy.py` موجود في main وغائب عن worktree الأساس. بعد الترقية: **6 installed** و0 في to upgrade / to install / to remove.
- **`python3 -B tools/upgrade_log_guard.py upgrade.log`:** exit 0، ولا سطر مرفوض. التحذيران الوحيدان بنيويان عند الإقلاع وليسا مشاكل schema: `option --without-demo: since 19.0, invalid boolean value: 'all', assume True` و`missing --http-interface/http_interface, using 0.0.0.0 by default…`.
- **`deploy/odoo/upgrade_smoke.py`** عبر `odoo-bin shell --no-http`: طبع `UPGRADE_SMOKE_OK installed=6`، exit 0، `grep -q` exit 0، `smoke.log sha256 4f515adfb898f98d1bc5edf7af5d67e24e3c59321a647ebf2f1fd12f63c4c4db`.
- **انحراف موثّق:** الترقية شُغّلت بلا `--logfile` (كما في كتلة `upgrade` في `ci.yml`) لتفادي تفريغ ملف `tee` الموضح في 2.2.
- **التنظيف:** `dropdb --if-exists nasq_p2_upgrade_scratch`، وإزالة worktree الأساس المؤقت، وحذف جذر `mktemp`. بعد التنظيف `main` = `927543f5` بلا تغيير.

**ملاحظة كتلة `upgrade` في CI — تحليل لا نتيجة CI سحابية مُثبتة.** `ci.yml:87` يختار الأساس بـ `git tag --list 'release/*' --sort=-v:refname | head -n1`. تحققت قراءةً من المستودع المحلي:

```console
$ git tag --list 'release/*' --sort=-v:refname | head -n1
release/19.0.1.0.0                      # f9b961b59cad8e8e57364d7712a0f685d066063b
$ git ls-tree -d --name-only release/19.0.1.0.0 odoo-addons/
odoo-addons/cyan_meeting_minutes   odoo-addons/nasq_api      odoo-addons/nasq_chat
odoo-addons/nasq_core              odoo-addons/nasq_hr       odoo-addons/nasq_pmo
odoo-addons/web_theme_shadcn        # ← لا يوجد nasq_platform
$ git ls-tree -d --name-only 8cf28748 odoo-addons/
… odoo-addons/nasq_platform …       # ضبط موجب
```

بما أن خطوة «Install the previous release» تمرر `-i "$MODULES"` و`MODULES` تتضمن `nasq_platform` على مسار `_baseline/odoo-addons`، فإن كتلة `upgrade` في CI تحتاج وسمًا جديدًا من نوع `release/*` يحوي `nasq_platform` وإلا فشلت عند التثبيت. **حدّ الدليل:** لم أشغّل كتلة CI السحابية، والدليل هنا من `git ls-tree` ونص `ci.yml` فقط.

---

## 4. t3 — دخول حقيقي بدون Mocks

البيئة: Odoo حقيقي على `nasq_p2_smoke_scratch` (`--without-demo=all --http-port=8171 --workers=0 --max-cron-threads=0`, addons path صريح) + Nuxt build إنتاجي (`node .output/server/index.mjs`) على `127.0.0.1:4097` بـ `NUXT_ODOO_URL=http://127.0.0.1:8171`، `NUXT_ODOO_DB=nasq_p2_smoke_scratch`، `NUXT_PUBLIC_WS_URL=ws://127.0.0.1:8171/websocket`. المستخدمون أُنشئوا عبر `odoo-bin shell`، والبوّابة عبر `_nasq_initialize_legacy_policy`. **لا Mock ولا stub ولا توكن bearer** — جلسة كوكي حقيقية عبر بروكسي Nuxt.

### 4.1 المقتطفات الحاسمة (منقولة داخل التقرير لأن `/tmp` غير دائم)

**(أ) الدخول و`/me` (السيناريو A):**

```text
--- A1 login customer / employee / support
login_status=200 body={"ok":true}      (×3)
--- A2 GET /api/v1/me through the Nuxt proxy with the client cookie jar
GET /api/v1/me -> HTTP 200
  modules       = ['nasq_chat', 'nasq_hr', 'nasq_pmo']
  entitlements  = {"chat.enabled": true, "hr.enabled": true, "meetings.enabled": true,
                   "pmo.enabled": true, "projects.max_projects": null,
                   "storage.limit_mb": null, "users.limit": null}
  platform      = {"policy_revision": 23, "read_only": false,
                   "readable_features": ["chat.enabled","hr.enabled","meetings.enabled","pmo.enabled"],
                   "schema_version": 1, "state": "active", "valid_until": null,
                   "writable_features": ["chat.enabled","hr.enabled","meetings.enabled","pmo.enabled"]}
--- A3 verify command: curl -fs -o /dev/null -w %{http_code}
ME_HTTP=200    curl_exit=0
```

**(ب) سحب ميزة ⇒ 403 `feature_not_included` مع بقاء القراءة التاريخية (السيناريو B):**

```text
--- B3 write on a business route (POST /api/v1/projects)
http=403 body={"code": "feature_not_included", "message": "this feature is not included",
               "details": {"reason": "feature", "feature": "pmo.enabled"}}
--- B4 write on an existing business record (PATCH /api/v1/projects/1)
http=403 body={"code": "feature_not_included", …}
--- B5 historical read (GET list + GET record)   → http=200
```

**(ج) الحصة: الإنشاء الزائد يُرفض بلا أثر داخل المعاملة (السيناريو C، `projects.max_projects=2`):**

```text
--- C3 create #1 (inside the limit)      → http=201 ; counts service_projects=1→2
--- C5 create #2 (over the limit)
http=403 body={"code": "create_forbidden", "message": "feature_not_included: this limit has been reached"}
--- C6/C8 count after the rejected create (must equal C4)   → service_projects=2 (بلا أثر)
--- C7 second rejected create with an independent curl       → HTTP=403
```

**(د) المستأجر المعلّق: قطع جلسة العميل وبقاء الدعم (السيناريو D):**

```text
--- D1 fresh client session while active → login 200, /me 200
--- D2 status = suspended
--- D3 the pre-existing client session must be cut
http=403 body={"code": "tenant_suspended", "message": "this tenant is suspended"}
--- D4 the same jar again (session must be gone)
http=403 body={"name": "odoo.http.SessionExpiredException", "message": "Session expired", …}
--- D5 customer login while suspended
login_status=401 body={"error": true, …, "data": {"code": "invalid_credentials"}}
--- D6 support login while suspended   → login_status=200 body={"ok":true}
--- D7 support /me while suspended     → http=200
--- D8 support read on a business route → http=200
--- D9 support write on a business route → http=403 {"code": "tenant_read_only", …}
```

**(هـ) الاشتراك المنتهي: الدخول والقراءة يعملان والكتابة تُرفض (السيناريو E):**

```text
--- E2 customer login still works → login_status=200
--- E3 /me after expiry → HTTP 200
  platform = {"read_only": true, "state": "expired", "valid_until": "2026-09-20", "writable_features": []}
--- E4 read on a business route → http=200
--- E5/E6 write (POST جديد وPATCH لسجل قائم) → http=403 {"code": "tenant_read_only", …}
```

**(و) إخفاء الوحدة المسحوبة: عدّ `href="/hr"` قبل/بعد على SSR حقيقي (السيناريو F):**

```text
--- F2 SSR /projects BEFORE (nav rail)   → page_status=200  hr_nav_links=1  chat_nav_links=1  projects_nav_links=2
--- F3 withdraw hr.enabled and drop it from retained_read_features
--- F4 /me AFTER
  entitlements = {… "hr.enabled": false …}
  platform.readable_features = ["chat.enabled","meetings.enabled","pmo.enabled"]   # سقط hr.enabled
--- F5 SSR /projects AFTER (nav rail)    → page_status=200  hr_nav_links=0  chat_nav_links=1
--- F6 HR business route read after withdrawal
http=403 body={"code":"feature_not_included","details":{"reason":"feature","feature":"hr.enabled"}}
```

**(ز) إثبات نصّ `modules` حرفيًا بسحب على مستوى الوحدة (السيناريو I — إلغاء تثبيت `nasq_hr`):**

```text
--- I2 GET /api/v1/me
  modules      = ['nasq_chat', 'nasq_pmo']       # سقط nasq_hr
  hr key in modules = absent
  readable     = ['chat.enabled', 'meetings.enabled', 'pmo.enabled']
  entitlements = {… "hr.enabled": true …}        # السياسة المخزّنة بقيت true بينما الفعّال أسقطه
--- I3 SSR /projects (nav rail)  → hr_nav_links=0
```

**(ح) لوج أودو أثناء الجولة:**

```text
ERROR/CRITICAL lines = 0      Traceback lines = 0
Access Denied warnings = 1    (مقصود: دخول عميل معلّق بعد نجاح فحص الاعتماد)
Login failed lines = 0
```

### 4.2 ملاحظات على صياغة المعيار (الانحرافات الموثقة)

1. **`modules` ≠ الاستحقاقات.** `modules` في `/me` تسرد **وحدات Odoo المثبَّتة** (`nasq_chat/nasq_hr/nasq_pmo`) ولا تتغير بسحب استحقاق. آلية الإخفاء الفعلية في الواجهة هي: `entitlements[key] = false` + **غياب المفتاح من `platform.readable_features`** — وهو ما طابقته عبارة تقرير المرحلة 2 «الواجهة تخفي الوحدة المسحوبة إذا وُجدت قائمة الميزات». وأُثبت النص الحرفي لـ`modules` بسحب على مستوى الوحدة (السيناريو I أعلاه). **صياغة قبول t3 كانت أضيق من الواقع ويجب قراءتها بالآلية الصحيحة.**
2. **رمز رفض الحصة هو `create_forbidden`، لا `feature_not_included`.** الاستجابة الفعلية: `{"code": "create_forbidden", "message": "feature_not_included: this limit has been reached"}` (أصيل ORM `AccessError` يُغلَّف في `create_project`) — والحالة 403 محققة. رمز `feature_not_included` يظهر كما هو متعاقد في بوابة **الميزة** على المسار (البند ب).
3. **دخول العميل المعلّق يعيد 401 `invalid_credentials`** من `/api/auth/login` بينما السبب الحقيقي `AccessDenied` من بوّابة المنصة **بعد** نجاح الاعتماد (السجل: `Login successful for smoke_client` ثم `Access Denied`). نقطة الدخول توحّد كل الفشل برمز واحد. **ملاحظة شفافية محتملة للدعم، وليست عيبًا مثبتًا.**
4. **`GET /api/v1/me` بلا جلسة** يعيد **403** بجسم `SessionExpiredException` (مع debug traceback من أودو) وليس 401 — وهو مسار التحميل الأول للصفحة. سُجّل كملاحظة، ولم يطلبه معيار t3 (المطلوب كان 200 بجلسة صحيحة).
5. **فرق مخزّن/فعّال:** بعد سحب `hr.enabled` من `retained` يبقى في السيناريو I `entitlements['hr.enabled'] = true` (السياسة المخزّنة) بينما `readable_features` تُسقطه (الفعالية) — الفرق يستحق توثيقًا في أي عمل لاحق على الواجهة.
6. **فرق عدّ في تحقق العقد:** سجل الجولة المحفوظ يعرض `Tests 13 passed (13)` لمجموعة `/me` مقابل عقد `packages/contracts/src/common/me.ts`، بينما تقرير t3 يذكر `14/14 passed`؛ مجلد الأدلة يحوي اليوم 13 ملف `me_*.json` + اختبار وجود = 14 حالة عند إعادة التشغيل. فرق أعداد موثّق لا تناقض دلالي: كل الحالات المسجّلة مرّت.
7. **ملاحظة قياس (ليست عيبًا):** `_nasq_count_users()` استُنتجت قيمتها 2 في قاعدة t3 بينما كانت القاعدة تحوي 3 مستخدمين داخليين نشطين غير `share`. العدّاد يستثني `base.user_root` ومستخدمي `nasq_core.group_vendor_support` تصميميًا (`nasq_platform/models/entitlement_service.py::_nasq_excluded_user_ids`)، لذا لا تُقرأ القيمة كعيب. العدّ الدقيق غير قابل لإعادة التحقق الآن لأن قاعدة scratch أُسقطت، ولم يكن حد المستخدمين هو المعتمد في إثبات الحصة (استُخدم `projects.max_projects`).

---

## 5. t4 — كتل `image` و`restore-drill` و`e2e-mock`

### 5.1 `image` — PASS

- `docker build -f deploy/odoo/Dockerfile --build-arg ODOO_COMMIT="$(cat deploy/odoo/ODOO_COMMIT)" --build-arg NASQ_REVISION=927543f5c5c5 -t nasq-odoo:ci .` → exit 0، صورة `9653fb3741d6` بحجم 4.33GB بملصقي `sa.nasq.odoo-commit=34eed49d…` و`sa.nasq.revision=927543f5c5c5` (تحقق عبر `docker inspect`).
- تثبيت الوحدات الست داخل الصورة ضد `postgres:16` مؤقتة → `Modules loaded.` بعد 59 وحدة.
- فحص التحصين الحرفي من `ci.yml` مرّ، مع أدلة إضافية: `uid=10001`, `git=ABSENT`, `addons_writable=NO`.

### 5.2 `restore-drill` — PASS (بالحالة الإيجابية والسالبة)

- `deploy/backup.py` بمعاملي opt-in الموثقين أنتج `manifest` (consistency `UNVERIFIED` / `recovery_ready false` بالتصميم).
- `deploy/restore_verify.py` على `nasq_drill_restored_scratch` → exit 0:

```json
{"nasq_modules_installed": 6, "modules_stuck_mid_transition": 0,
 "attachment_files_referenced": 19, "missing_attachment_files": []}
  "restore_verified": true,
```

- أودو أقام على القاعدة المستعادة و`/web/health` أعاد 200: `{"status": "pass"}`.
- الحالة السالبة: بعد حذف الملف `05/055ffc5cce56e142234ffc466012dff7edc2c7e7` عمدًا →

```json
{"missing_attachment_files": ["05/055ffc5cce56e142234ffc466012dff7edc2c7e7"]}
  "restore_verified": false,
NEGATIVE_ASSERT_OK missing= 05/055ffc5cce56e142234ffc466012dff7edc2c7e7
MANIFEST_IDENTICAL
```

- القواعد الثلاث `nasq_drill_*` أُسقطت، ومجلد `mktemp` حُذف، والحاويات/الشبكات نظّفت.

### 5.3 `e2e-mock` — FAIL (حتمي، دون إصلاح)

البنية كلها صعدت (mock API على 4498، `nuxt build`، السيرفر على 4097 و`/login` يرد) لكن `npx playwright test` خرج بـ exit 1 في **تشغيلين متتاليين بنفس النتيجة**:

```text
  1 failed
    e2e/totp.spec.ts:7:1 › MFA-pending login shows and submits the TOTP step
  6 passed (9.3s)
PLAYWRIGHT_FAILED exit=1
```

تفاصيل الفشل:

```text
Error: expect(page).toHaveURL(expected) failed
Expected pattern: /\/tasks$/
Received string:  "http://localhost:4097/account"
Timeout: 5000ms
    at apps/web/e2e/totp.spec.ts:32:22
```

المواصفة تحاكي (`page.route`) كلًا من `/api/auth/login` (يرد `{ok:false, mfa:'totp'}`)، `/api/auth/totp` (يرد `{ok:true}`)، و`/api/v1/me`؛ وبعد إرسال خطوة TOTP تتوقع الانتقال إلى `/tasks` بينما التطبيق ينتقل إلى `/account` (وسياق الخطأ يظهر صفحة «الحساب» مع هيدر «حسابي: Admin»). **رُفع كما هو دون إصلاح كود ودون تعديل المواصفة**، وفق قيد المهمة. المواصفات الست الأخرى (بينها auth-csrf وchat-presentation) تمر.

---

## 6. t7 / t8 — إصلاح T1-F1 ومراجعته (worktree غير مدمج)

- **t7:** إصلاح ضيق بإعادة ترتيب fixture **داخل `odoo-addons/nasq_platform/tests/test_tenant_profile.py` فقط**: نقل إنشاء الشركة الثانية إلى ما قبل حذف `xmlid`/صف profile، مع إبقاء `DELETE` و`invalidate_model` و`assertRaises(ValidationError)` و`assertIn('cannot guess root company')` واستدعاء `_nasq_ensure_root_company()` كما هي، وإضافة إثباتات حالة (`roots >= 2`، `Profile.search_count([]) == 0`، وأثر الجذور المتعددة في رسالة الاستثناء). **صفر تغيير runtime:** `ir_attachment.py` و`entitlement_service.py` و`tenant_profile.py` متطابقة بايت مع main. أدلة داخل الـworktree: المجموعة الموجهة (TestTenantProfile+TestTenantQuotas+TestTenantLifecycle) `0 failed, 0 error(s) of 9 tests`، والمجموعة الكاملة `0 failed, 0 error(s) of 628 tests`، و`ruff` نظيف.
- **t8:** مراجعة أمنية مستقلة → **pass**، مع ملاحظتين غير معطِّلتين: (1) بعد إعادة الترتيب لم يبقَ اختبار يغطي عمدًا سلوك الخطاف عند غياب profile (السلوك باقٍ fail-closed طبيعيًا بلا بلع استثناءات)؛ (2) مجموع أسطر `odoo.tests.stats` لكل الوحدات (776) يخالف عدّاد العدّاء (628) — سمة عدّ متسقة مع خط الأساس في t1، والمعتمد هو سطر `odoo.tests.result`.
- **الحالة:** worktree `.worktrees/t7-tenant-profile-fixture` (فرع `codex/t7-tenant-profile-fixture`) من `main`، **غير مدمج وغير مُcommit**، و`main` بقي `927543f5` نظيفًا. `ci.yml` على `main` ما زال أحمر حتى يُدمج الإصلاح أو يُستبدل بقرار من مالك Git.

---

## 7. ملاحظات بنيوية عامة

1. **`--logfile` يُفرّغ `tee`:** عند ضبط `--logfile` يستبدل أودو مُعالج `stderr` (`odoo/netsvc.py:261`) فيصير التدفق الملتقط بـ`tee` بلا سطور المُسجِّل. أثّر ذلك في كتلتي `odoo` (t1) و`upgrade` (t2) محليًا؛ الحل الموثق: إما بلا `--logfile`، أو الحفاظ على الملف وإلحاقه صراحةً. كتلة `upgrade` في `ci.yml` لا تستخدم `--logfile` أصلًا.
2. **تكييفات بيئة محلية (بلا أي تعديل منتج):** macOS/arm64، node v24.21.0 بدل `.nvmrc=22`، python من venv أودو 3.12.13، أدوات PG16 من `/opt/homebrew/opt/postgresql@16/bin`، `--pg-user tariq` (ثقة محلية بدل دور `odoo`)، `odoo.conf` في `/tmp`، وplaywright chromium بلا `--with-deps`، وكتلة `e2e-mock` استخدمت المنفذ 4097 كما في `ci.yml` بلا انحراف.
3. **أثر جانبي غير متعقب:** بناء Nuxt الإنتاجي أنشأ `apps/web/.output` و`.nuxt` وهما متجاهَلان في `.gitignore`؛ لم يُمَس أي ملف منتج.
4. **ارتفاع `policy_revision`/`quota_revision`** عبر سيناريوهات t3 (12 → 33) ناتج عن كتابات المشغّل المتتالية في الجولة نفسها، وليس عيبًا.

---

## 8. المخاطر المتبقية وأسئلة مفتوحة

1. **`main` أحمر (الأهم):** كتلة `odoo` في `ci.yml` تفشل على `927543f5` باختبار واحد؛ الإصلاح جاهز ومُراجَع (t7/t8) لكنه **غير مدمج**. القرار قرار مالك Git/orchestrator (لا commit/merge في هذا العمل).
2. **كتلة `upgrade` في CI مهددة:** آخر وسم `release/*` (`release/19.0.1.0.0`) لا يحوي `odoo-addons/nasq_platform`؛ يلزم وسم `release/*` جديد (تحليل من `git ls-tree` + نص `ci.yml`، لا نتيجة CI سحابية).
3. **`e2e-mock` أحمر:** `e2e/totp.spec.ts` حتمي الفشل بعد خطوة MFA؛ يحتاج قرارًا وظيفيًا: هل المسار المتوقع بعد نجاح TOTP هو `/tasks` أم `/account`؟ لا إصلاح داخل نطاق هذا التثبيت.
4. **تغطية الخطاف:** لم يبقَ اختبار يغطي عمدًا حالة «لا يوجد profile» بعد إعادة الترتيب (ملاحظة t8) — لا تضعيف أمني (fail-closed باقٍ)، لكنها فجوة تغطية إن أُريد حصانة دائمة.
5. **عدم قابلية إعادة التحقق لبعض القياسات:** قواعد scratch أُسقطت ضمن التنظيف المطلوب (بما فيها ادعاء `_nasq_count_users`). ما تبقّى هو المقتطفات المنقولة أعلاه وبصمات `sha256` لملفات لوج t2، مع إمكانية إعادة توليد كل شيء بنفس الأوامر الموثقة.
6. **ديمومة الأدلة:** الأدلة الخام في `/tmp` (منها `/tmp/nasq_p2_evidence` وملفات t1/t7) غير دائمة؛ نقلت المقتطفات الحاسمة داخل هذا التقرير لهذا السبب.

---

## 9. حدود الدليل (ما لا يثبته هذا التقرير)

- **لا دليل إنتاج ولا نشر ولا DNS بنية تحتية**؛ كل شيء قواعد `scratch` محلية وNuxt محلي.
- **لا تشغيل لأي بوابة GitHub Actions سحابية**؛ «نجاح/فشل كتلة CI» هنا يعني تشغيل أوامر الكتلة نفسها محليًا.
- **لا تكافؤ بيئي كامل:** macOS/arm64 وnode 24 وplaywright بلا `--with-deps` مقابل ubuntu-24.04 + python 3.12 + node من `.nvmrc` في CI.
- **لا إثبات لمسار الترقية الإنتاجي:** `-u` جرى على قاعدة scratch واحدة، وليس تمرين نشر موسوم.
- **لا تعديل منتج ولا commit/merge/push** في هذا العمل؛ وحالة المستودع الفعلية يجب أن تُتحقق مباشرة عند أي استخدام لاحق لهذا التقرير.

---

## 10. مراجع الأدلة الخام (وقت الكتابة)

| الأثر | المسار |
|---|---|
| لوج كتلة odoo الكامل على main (t1) | `/tmp/nasq_p2_t1_odoo-test.log` |
| لوج أودو الأصلي لنفس التشغيل (t1) | `/tmp/nasq_p2_t1_odoo-logfile.log` |
| إعادة إنتاج معزولة للاختبار المُخطئ (t1) | `/tmp/nasq_p2_t1_tp_odoo.log` |
| سجل سيناريوهات الدخول الحقيقي + المحاكاة (t3) | `/tmp/nasq_p2_evidence/scenarios.log` و13 ملف `me_*.json` و`odoo_final.log` |
| سياق خطأ مواصفة TOTP (t4) | `/tmp/nasq_p2_t4_totp_error-context.md` |
| لوجات t4 | `/tmp/nasq_p2_t4_{docker_build,image_block_run,restore_drill,e2e_mock_run,e2e_mock_run2}.log` |
| أدلة الإصلاح t7 | `/tmp/nasq_t7_focused.log`، `/tmp/nasq_t7_full_odoo-test.log` |
