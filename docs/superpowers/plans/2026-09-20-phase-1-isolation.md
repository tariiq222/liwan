# Phase 1 — Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** عزل الشركة داخل قاعدة العميل الواحدة، وإعلان نطاق كل موديل webvue، وإدخال الهيكل الأدنى لـ`webvue_platform` بـ`root_company_id`، دون باقات أو استحقاقات أو تزويد.

**Architecture:** ست مهام متسلسلة في العمل المشترك، مع استقلال نسبي لـL1 بعد وجود المنصة. `webvue_platform` يضيف جدولًا واحدًا ولا يفتح API أعمال. العزل يُفرض في الخادم (record rules + اختبارات تسريب). الواجهة لا تُعاد تصميمها.

**Tech Stack:** Odoo 19 CE · `webvue_*` addons · `packages/contracts` بلا حقول استحقاق · GitHub Actions القائمة · unittest داخل addons.

**Spec:** `docs/superpowers/specs/2026-09-19-webvue-distribution-models-design.md` (§3، §4، §5.1، §6، §10 Phase 1، §12 Phase 1). L1–L4 من `docs/superpowers/specs/2026-09-15-webvue-vertical-saas-transformation.md` §14.3 كما صحّحتها مواصفة 09-19 (branding = `root_company_id` لا host).

**Baseline (2026-09-20):** `main` = `1b0394c93edab5d70bbee7074ac314e2fcda0a8a`. Phase 0 مدمج. لا تبدأ هذه الخطة من برومبت Phase 0.

## Global Constraints

- **لا Phase 2:** لا `features` ولا `tier` ولا `status/valid_until` ولا `@requires_feature` ولا تغيير `/api/v1/me` ولا `apps/web/app/modules/registry.ts`.
- **لا Phase 3/4:** لا كتالوج، لا `webvue-cli`، لا `webvue_quality`، لا industry pack.
- لا منتج مشترك القاعدة. Tenant = Database. Company = Branch.
- كل ملف Python يبدأ بـ `# Part of Odoo. See LICENSE file for full copyright and licensing details.`
- `'license': 'LGPL-3'`، `version` وفق `docs/migrations.md`، author `Tariq Alwalidi`.
- لا OCA ولا Enterprise. لا `sudo()` جديد إلا ما هو موثّق في المهمة (قراءة الـprofile العامة في branding بعد تحديد السجل لا بالبحث عن أول شركة).
- لا اختبارات على `odoo19`. scratch + `--addons-path` صريح + منفذ ≠ 8069.
- مستودع `/Users/tariq/code/odoo` للقراءة فقط.
- `ruff check odoo-addons` نظيف. type-check: `npm -w apps/web run lint` من الجذر إن مُسّت العقود/الويب؛ وإلا لا تشغّله عبثًا.
- worktree: المسار `.worktrees/phase-1-isolation` والفرع `codex/phase-1-isolation` من أحدث `main`، بـ`node_modules` و`.nuxt` مستقلين إن لزم الويب.
- في `main` تعديلات غير مودَعة على `docs/WORKSPACE.md` و`docs/verification/2026-09-20-workspace-cleanup.md` **لا تُلمس**. ليست جزءًا من هذه المرحلة.
- لا push ولا دمج في `main` دون إذن. لا تغليف Customer-Hosted.
- تراجع الترقية = استرجاع DB + filestore، لا downgrade migration.
- سلسلة الاعتماد الوحيدة: `webvue_core → webvue_platform → webvue_api → الركائز`.
- جملة CLAUDE.md الحالية `there is no shared tenant layer` تُستبدل في Task 6 بالنص المعتمد لا بأي صياغة multi-tenant على قاعدة واحدة.

## حقائق مُتحقَّق منها (2026-09-20)

| الحقيقة | الأثر |
|---|---|
| `GET /api/v1/branding` ما زال `sudo().search([], order='id', limit=1)` في `webvue_api/controllers/branding.py:13` | L2 لم يُصلح. الإصلاح الوحيد المسموح: `root_company_id` |
| `webvue_chat/__manifest__.py` يصرّح أن القنوات بلا نطاق شركة. `discuss.channel` في Odoo 19 بلا `company_id` مخزَّن | L1 يحتاج inherit + حقل + rule + ترحيل |
| `webvue_pmo/security/webvue_pmo_rules.xml` يسمح `company_id in [current, False]` للمشاريع والمهام | L4. CLAUDE.md ينتظر تفويضًا صريحًا؛ هذه الخطة هي التفويض |
| `WebVuePmoCase` ينشئ المشروع المشترك بـ`company_id: False` (`webvue_pmo/tests/common.py:19`) | تشديد القاعدة **سيفشل مئات اختبارات PMO** إن لم يُغيَّر الـfixture أولًا |
| اختبارات أخرى تفترض مشاريع بلا شركة: `test_deadline_digest.py`، `test_project_schedule.py`، `test_project_reports.py`، `test_project_charter.py`، `test_project_finance.py`، `test_project_governance.py` (`self.companyless_project = self.project`) | تُحوَّل من «سلوك متوافق» إلى «مرفوض أو غير مرئي» بعد تغيير الـfixture |
| `_webvue_check_visible_current` يسمح بالمشروع بلا شركة (`project.company_id and ...`) | يُضيَّق مع L4 |
| `_webvue_sync_capability_groups` يتّحد عبر شركات المستخدم (`res_users.py:165-193`) | L3: لا تُكسر المزامنة؛ يُوثَّق + اختبار تغطية rules |
| `webvue.access.permission` بلا `company_id`؛ `webvue.access.role` له `company_id` (مدمج False، مخصص مطلوب) وrule `False أو الحالية` | permission = `tenant`؛ **الدور كله** `company` — النطاق لكل نموذج لا لكل صف |
| لا يوجد `webvue_platform` ولا `_webvue_scope` | يُضاف في هذه المرحلة |
| CI و`provision.sh` و`WEBVUE_ADDONS` و`upgrade_smoke` يثبّتون `webvue_core,webvue_api,webvue_pmo,webvue_hr,webvue_chat` | بعد Task 2 يجب إدراج `webvue_platform` **قبل** `webvue_api` |
| حارس الترحيل يقارن `webvue_*/__manifest__.py` مع `origin/main` | وحدة جديدة بلا تاريخ لا تحتاج مجلد migrations؛ رفع إصدار وحدة قائمة مع مخطط أو تضييق rule **يحتاج** `migrations/<version>/` |
| المالية والقوالب لها `company_id` مخزَّن. `webvue.project.stakeholder` / `raci` / `register` تعزل عبر `project_id` بلا عمود شركة | في Task 4: related مخزَّن مثل المالية، لا في Task 1 |

## File Structure

| الملف | المسؤولية |
|---|---|
| `odoo-addons/webvue_core/models/webvue_model.py` | إعلان `_webvue_scope` على موديلات webvue الجديدة |
| `odoo-addons/webvue_core/tests/test_webvue_scope.py` | يفشل إن غاب الإعلان أو إن `company` بلا `company_id` |
| `odoo-addons/webvue_platform/` | `webvue.tenant.profile` singleton + `root_company_id` |
| `odoo-addons/webvue_platform/hooks.py` (`post_init_hook`) | أول تثبيت على قاعدة قائمة **ليس** `to upgrade` للوحدة الجديدة؛ لا تعتمد `migrations/0.0.0` |
| `odoo-addons/webvue_api/__manifest__.py` | `depends: ['webvue_platform', 'auth_totp']` |
| `odoo-addons/webvue_api/controllers/branding.py` | يقرأ `root_company_id` فقط |
| `odoo-addons/webvue_chat/models/discuss_channel.py` | `company_id` مخزَّن |
| `odoo-addons/webvue_chat/security/chat_rules.xml` | rule الشركة الحالية |
| `odoo-addons/webvue_pmo/security/webvue_pmo_rules.xml` | `company_id = company_id` بعد backfill |
| `odoo-addons/webvue_pmo/migrations/<version>/pre-backfill_company.py` | صفوف `company_id IS NULL` ← `root_company_id` |
| `odoo-addons/webvue_pmo/tests/common.py` | المشروع الافتراضي على `env.company` |
| `.github/workflows/ci.yml` · `deploy/provision.sh` · `deploy/check_isolated.py` · `CLAUDE.md` | تثبيت المنصة وصياغة العزل |

ترتيب التنفيذ: **Task 1 → 2 → 3 → 4 → 5 → 6**. لا تبدأ Task 4 قبل Task 2 (الـbackfill يحتاج `root_company_id`). Task 3 و5 بعد Task 2 لأن CI يجب أن يثبّت المنصة.

| البند | المهام |
|---|---|
| `_webvue_scope` | Task 1 |
| `webvue_platform` + L2 | Task 2 |
| L1 chat | Task 3 |
| L4 projects/tasks | Task 4 |
| L3 rule coverage | Task 5 |
| CI / docs | Task 6 |

---

### Task 1: إعلان `_webvue_scope`

**Files:**
- Create: `odoo-addons/webvue_core/models/webvue_model.py`, `odoo-addons/webvue_core/tests/test_webvue_scope.py`
- Modify: `odoo-addons/webvue_core/models/__init__.py`، `odoo-addons/webvue_core/tests/__init__.py` (استيراد الاختبار إلزامي)، وكل `_name = 'webvue.*'` ذي جدول ليعلن النطاق. لا رفع إصدار: لا مخطط في هذه المهمة.

**Interfaces:**
- `_webvue_scope` ∈ `{'company', 'tenant', 'global'}`
- الاختبار يمر فقط على `_name.startswith('webvue.')` و`_auto is True` (جدول حقيقي) **زائد** الخدمات المعلنة صراحة أدناه. لا mixins.
- `company` ⇒ `'company_id' in model._fields` في هذه المهمة. النماذج الثلاثة بلا عمود (`stakeholder` / `raci` / `register`) **لا تُعلن `company` هنا**؛ تُعالَج في Task 4 بعد related مخزَّن.
- موروثات Odoo خارج الإعلان.

**نطاقات معتمدة لهذه المهمة:**

| النموذج | النطاق |
|---|---|
| `webvue.access.permission` | `tenant` |
| `webvue.access.role` | `company` (الحقل موجود؛ الـrule القائمة `False أو الحالية` تُبقي المدمج مرئيًا) |
| `webvue.access.assignment` | `company` |
| `webvue.access.audit` | `company` |
| `webvue.hr.document` | `company` |
| `webvue.meeting.series` | `company` |
| `webvue.meeting.minutes.version` | `company` |
| `webvue.meeting.event` | `company` |
| `webvue.project.finance.entry` | `company` |
| `webvue.project.type` | `company` |
| `webvue.project.owning.unit` | `company` |
| `webvue.project.template` | `company` |
| `webvue.pmo.settings` | `global` (AbstractModel) |
| `webvue.access.service` · `webvue.chat.service` | `global` |
| `webvue.governance.visibility` · `webvue.project.charter.catalog.mixin` | لا إعلان (mixin) |
| `webvue.project.stakeholder` · `raci` · `register` | مؤجَّل إلى Task 4 |

- [ ] **Step 1:** اختبار فاشل على الجداول الحقيقية + الخدمات الثلاث.

- [ ] **Step 2:** شغّله على scratch. Expected: FAIL لأن الإعلان غائب.

- [ ] **Step 3:** أضف الإعلان class-level على كل نموذج. لا تُورَّث BaseModel لكل Odoo.

- [ ] **Step 4:** الاختبار أخضر. لا يُفرض على `cyan.*`.

**Acceptance:** نموذج webvue جدولي بلا إعلان يفشل (أضفه مؤقتًا ثم احذفه). `company` بلا `company_id` في `_fields` يفشل. `stakeholder` لا يُكسر في هذه المهمة.

**Rollback:** احذف الملفات والإعلانات.

---

### Task 2: `webvue_platform` + ترحيل الجذر + L2 branding

**Files:**
- Create: شجرة `odoo-addons/webvue_platform/` كاملة
- Modify: `odoo-addons/webvue_api/__manifest__.py` (`depends` فقط؛ إن لم يتغير المخطط لا ترفع الإصدار)
- Modify: `odoo-addons/webvue_api/controllers/branding.py`
- Modify: `odoo-addons/webvue_api/tests/test_branding.py` و`odoo-addons/webvue_api/tests/__init__.py` إن أُضيف ملف اختبار
- Modify: قائمة التثبيت **في هذه المهمة** وإلا `-i webvue_api` ينكسر:

```
webvue_core,webvue_platform,webvue_api,webvue_pmo,webvue_hr,webvue_chat
```

مواقع إلزامية (ليست اختيارية): `.github/workflows/ci.yml` (`-i` و`MODULES` و`--test-tags` لتشمل `/webvue_platform`)، `deploy/provision.sh`، `deploy/check_isolated.py` (`WEBVUE_ADDONS`)، `deploy/OPERATIONS.md` المثالان عند السطرين 83 و200، `deploy/verification-checks.json`، أمر scratch في `CLAUDE.md`. لا تُحدّث فقرة tenant في CLAUDE.md هنا (Task 6).
- Modify: `deploy/odoo/upgrade_smoke.py` — لا تكتفِ بـ`webvue_%`؛ ارفض إن غاب `webvue_platform` بالاسم.
- Modify: `deploy/test_operations.py` إن نسخت أمثلة الوحدات الأربع.

**Interfaces:**

```python
class WebVueTenantProfile(models.Model):
    _name = 'webvue.tenant.profile'
    _description = 'WebVue tenant profile'
    _webvue_scope = 'tenant'

    root_company_id = fields.Many2one('res.company', required=True, ondelete='restrict')
```

- صف واحد: عمود `singleton_key = fields.Char(default='tenant', required=True)` مع `models.Constraint('UNIQUE(singleton_key)', ...)` ومنع `create` ثاني في `create()`. xmlid ثابت `webvue_platform.tenant_profile`.
- لا حقول `solution` / `tier` / `features`.
- ACL: لا كتابة من المستخدم. branding العام: `sudo().env.ref('webvue_platform.tenant_profile')` ثم `root_company_id`. إن غاب السجل أو تعدد ⇒ خطأ. لا `search([], order='id')` على `res.company`.
- `GET /api/v1/branding` يقرأ تلك الشركة فقط.

**أول تثبيت على قاعدة قائمة:** Odoo يضع الوحدة الجديدة في `to install` لا `to upgrade`، لذلك **`migrations/` لن يعمل**. ضع المنطق في `post_init_hook` (و`post_load` ممنوع):

```text
roots = companies WHERE parent_id IS NULL
0 صف profile:
  len(roots) == 1 → أنشئ الـprofile بذلك الجذر (xmlid إن أمكن)
  len(roots) != 1 → raise بأسماء/معرفات الجذور؛ اطلب التحديد صراحة
صف واحد موجود → لا تخمّن ولا تستبدل
لا order='id'
```

XML `data` يجوز أن يزرع `base.main_company` على قاعدة فارغة/جذر واحد؛ الـhook هو من يفشل عند تعدد الجذور. لا ملف `migrations/0.0.0`.

حارس الترحيل: وحدة جديدة (`old is None`) لا تحتاج مجلدًا.

- [ ] **Step 1:** اختبار L2 أحمر على الكود الحالي: أبقِ `base.main_company` (id=1) فخًا. أنشئ شركة ثانية (id أكبر). بعد الإصلاح سيكون `root_company_id` = الشركة الثانية. اليوم `order='id' limit=1` يعيد الشركة الأولى — هذا هو الفشل المطلوب. **لا تحاول إنشاء id أصغر عبر `create`.**

- [ ] **Step 2:** اختبار hook: شركة جذر واحدة ينشئ profile. شركتان `parent_id IS NULL` يرفع. لا تختبر باستدعاء `migrate()` يتيم. أضف حالة scratch حقيقية `-i webvue_platform` (أو `-u webvue_api` بعد depends) بجذرين وتتوقع الفشل.

- [ ] **Step 3:** نفّذ الوحدة + الربط + branding + قوائم التثبيت.

- [ ] **Step 4:** `test_webvue_addons_cover_every_shipped_pillar` يجب أن يتوقع `webvue_platform`.

**Acceptance:**
- تثبيت جديد بجذر واحد: branding = هوية `root_company_id` حتى لو وُجدت شركة أخرى بـid أصغر.
- تثبيت/ترقية بجذرين تفشل برسالة صريحة (hook لا XML).
- `upgrade_smoke` يفشل إن غاب `webvue_platform`.
- `python3 -B tools/migration_guard.py --base origin/main` يخرج 0.

**Rollback:** `git revert`. لا downgrade.

---

### Task 3: L1 — عزل `discuss.channel`

**Files:**
- Create: `odoo-addons/webvue_chat/models/discuss_channel.py`, `odoo-addons/webvue_chat/security/chat_rules.xml`
- Modify: `odoo-addons/webvue_chat/__manifest__.py` → `19.0.1.1.0` + `data` للـrule + `migrations/19.0.1.1.0/post-channel_company.py`
- Modify: `odoo-addons/webvue_chat/models/__init__.py`، `chat_service.py`، `tests/__init__.py` إن لزم، `tests/test_chat_security.py`
- **لا** تضف `ir.model.access.csv` لـ`discuss.channel` ما لم تثبت أن ACL في `mail` ناقص.

**Interfaces:**
- `discuss.channel.company_id` Many2one مخزَّن، index، `ondelete='restrict'`، `default=lambda self: self.env.company`. **ليس** `required=True` حتى يملأ `post-` الصفوف القديمة. قيد NOT NULL بعد التعبئة فقط إن لزم SQL منفصل في نفس `post-`.
- **rule عام بلا `groups`:** `[('company_id', '=', company_id)]`. في Odoo 19 القواعد العامة تُAND مع قاعدة العضوية في mail. قاعدة مجموعة على `group_user` تُOR مع العضوية وتُبقي تسريب L1 مفتوحًا.
- `create()` / default يضع الشركة الحالية لكل مسار mail (`_create_channel`، `_create_group`، `_get_or_create_chat`) لا عبر `chat_service` فقط.
- Override `_get_or_create_chat`: البحث الخام الحالي بلا شركة سيعيد محادثة الشركة A داخل B. أضف `company_id = env.company` إلى البحث والإنشاء.
- ترحيل: **`post-channel_company.py`** (العمود لا يوجد في `pre-`). `NULL` ← `root_company_id`. إن غاب الـprofile أو الجذر ⇒ `raise`.

- [ ] **Step 1 — اختبار L1 الأحمر:** المستخدم **عضو صريح** في قناة أُنشئت في الشركة A، ثم `with_company(B)` / `env.company = B`، قراءة API = 403 أو 404. اختبار غير العضو 403 موجود أصلًا ولا يثبت L1.

- [ ] **Step 2:** FAIL على القاعدة الحالية (عضوية mail تكفي).

- [ ] **Step 3:** الحقل + rule عام + post-backfill + default/`_get_or_create_chat`.

- [ ] **Step 4:** لا تكسر اختبارات العضوية الحالية في الشركة نفسها.

**Acceptance:** اختبار العضو المنتقل أحمر ثم أخضر. `manifest` لم يعد يقول إن القنوات بلا شركة. حارس الترحيل 0 لأن `migrations/19.0.1.1.0/` فيه `post-*.py`.

**Rollback:** `git revert` + استرجاع إن وُسِمت.

---

### Task 4: L4 — تضييق المشاريع والمهام

**هذه المهمة تغيّر عقدًا معلّقًا في CLAUDE.md.** بعد دمجها: المشاريع بلا شركة غير مرئية، والإنشاء الجديد يفرض الشركة الحالية (موجود جزئيًا).

**Files:**
- Modify: `odoo-addons/webvue_pmo/security/webvue_pmo_rules.xml` → `[('company_id', '=', company_id)]` للمشروع والمهمة
- Modify: `odoo-addons/webvue_pmo/models/project_project.py` `_webvue_check_visible_current` يرفض `not project.company_id`
- Modify: `odoo-addons/webvue_pmo/__manifest__.py` → `19.0.1.1.0`
- Create: `odoo-addons/webvue_pmo/migrations/19.0.1.1.0/pre-backfill_project_company.py` (عمود `project_project.company_id` موجود مسبقًا — `pre-` صحيح هنا)
- Modify: `odoo-addons/webvue_pmo/models/project_governance.py` — `company_id` related مخزَّن على `stakeholder` / `raci` / `register` مثل المالية، ثم `_webvue_scope = 'company'`
- Modify: `odoo-addons/webvue_pmo/tests/common.py` — **أولًا** `company_id: self.env.company.id`
- Modify كل اختبار يفترض المشروع المشترك بلا شركة، بما فيها `test_project_governance.py`
- حدّث تعليقات المالية/التقارير التي تقول إن الـfixture بلا شركة

**ترحيل:**

```sql
-- بعد التأكد من وجود webvue_tenant_profile.root_company_id صف واحد
UPDATE project_project SET company_id = :root WHERE company_id IS NULL;
UPDATE project_task SET company_id = :root WHERE company_id IS NULL;
```

إن تعذر الجذر ⇒ `raise`. لا توزيع صفوف على شركات متعددة.

- [ ] **Step 1:** غيّر `WebVuePmoCase` إلى شركة حالية. شغّل عيّنة PMO scratch. إن فشل شيء غير متعلق بالشركة، أصلحه كرجوع لا كتوسيع نطاق.

- [ ] **Step 2:** اختبار تسريب: مشروع `company_id=False` (عبر SQL في الاختبار قبل التضييق، أو صف يُنشأ ثم يُصفَّر إن سمح ORM) لا يظهر لـ`api_emp`. بعد التضييق: `search` لا يعيده.

- [ ] **Step 3:** XML + Python + backfill.

- [ ] **Step 4:** اختبارات «company-less compatibility» تصبح اختبارات رفض/إخفاء، لا اختبارات نجاح.

**Acceptance:** مستخدم الشركة B لا يرى مشروع الشركة A ولا مشروعًا بلا شركة. الـfixture الأخضر على الشركة الحالية. حارس الترحيل 0.

**Rollback:** `git revert` + restore. القاعدة بعد الترحيل لا تُعاد إلى False بـmigration عكسي.

---

### Task 5: L3 — تغطية القواعد لا كسر اتحاد المجموعات

**Files:**
- Create: `odoo-addons/webvue_core/tests/test_record_rule_coverage.py`
- Modify: `odoo-addons/webvue_core/tests/__init__.py`
- Modify: `odoo-addons/webvue_core/models/res_users.py` — تعليق فوق `_webvue_sync_capability_groups` يشير إلى هذا الاختبار. لا تغيّر المنطق.
- `docs/superpowers/specs/2026-09-19-webvue-distribution-models-design.md` لا تُعدَّل. أضف فقرة قصيرة في `CLAUDE.md` تحت العقود: اتحاد `res.groups` عبر شركات المستخدم **مقصود في Odoo**؛ الحماية هي record rule + `_webvue_scope=company`.

**Interfaces:**
- لكل نموذج webvue جدولي `_webvue_scope == 'company'`: يوجد `ir.rule` على `model_id` ذلك النموذج يتضمّن `company_id`.
- لا يُطلب rule لـ`tenant`/`global`.
- لا يُعاد كتابة مزامنة المجموعات.

- [ ] **Step 1:** اختبار يفشل إن أُضيف نموذج company بلا rule (استخدم قائمة بيضاء مؤقتة فارغة ثم املأها من الواقع بعد الجرد).

- [ ] **Step 2:** الجرد من `security/*.xml` الحالية. أي فجوة حقيقية في نماذج webvue الجدولية تُغلق بـrule، لا باستثناء صامت، إلا mixin بلا جدول.

**Acceptance:** فشل متعمّد (نموذج وهمي في الاختبار) يُكتشف. المزامنة عبر الشركات تبقى كما هي مع تعليق في `res_users.py` يشير إلى الاختبار.

**Rollback:** احذف الاختبار والفقرة.

---

### Task 6: التوثيق وإغلاق المرحلة

**Files:**
- Modify: `CLAUDE.md` — استبدل جملة الطبقة المشتركة بالنص المعتمد حرفيًا:

```
WebVue has a tenant abstraction through webvue_platform,
but tenant isolation remains database-per-tenant.
There is no shared-database tenant layer.
```

- أزل أو حدّث فقرة «Legacy company-less collaboration compatibility is awaiting explicit authorization» لأنها نُفّذت في Task 4.
- في قسم التخطيط في `CLAUDE.md`، جملة أن كل addon نسخته `19.0.1.0.0` لم تعد صحيحة بعد Task 3/4؛ أشر إلى `docs/migrations.md`.
- أضف `webvue_platform` إلى تخطيط المستودع في `CLAUDE.md` (`webvue_core → webvue_platform → webvue_api`).
- Modify: `docs/WORKSPACE.md` **فقط داخل worktree**؛ لا تدمج فوق تعديلات المالك غير المودَعة على checkout `main` الحالي.
- لا تكتب خطة Phase 2 هنا.

- [ ] **Step 1:** `npm test` إن مُسّت العقود (لا يُفترض). `ruff check odoo-addons`.
- [ ] **Step 2:** scratch:

```
-i webvue_core,webvue_platform,webvue_api,webvue_pmo,webvue_hr,webvue_chat
--test-tags /webvue_core,/webvue_api,/webvue_pmo,/webvue_hr,/webvue_chat,/webvue_platform
```

- [ ] **Step 3:** دورة `-u` من `release/19.0.1.0.0` إلى HEAD على scratch (أو من وسم أحدث إن وُجد). Expected: `UPGRADE_SMOKE_OK` وعدد وحدات webvue يشمل المنصة.

**Acceptance — تعريف «Phase 1 أخضر»:**
1. اختبارات التسريب L1 وL2 وL4 حمراء سابقًا ثم خضراء على scratch.
2. ترحيل `root_company_id`: جذر واحد يمر؛ متعدد يفشل.
3. كل نموذج webvue جدولي يعلن `_webvue_scope`؛ `company` له rule.
4. CI يثبّت `webvue_platform` قبل `webvue_api`.
5. لا حقول استحقاق ولا كتالوج ولا تغيير `/me`.
6. CLAUDE.md بالنص المعتمد.

**يحتاج إذن المالك:** push · PR · وسم إصدار جديد إن رُفعت الإصدارات · حماية `main`.

---

## طريقة التنفيذ

1. `git fetch origin && git worktree add .worktrees/phase-1-isolation -b codex/phase-1-isolation origin/main`
2. لا تنسخ تعديلات `docs/WORKSPACE.md` غير المودَعة.
3. TDD لكل مهمة. commit واحد في نهايتها. لا `git add -A`.
4. قبل المهمة التالية: `ruff check odoo-addons` وعيّنة الاختبارات المتأثرة على scratch ثم `dropdb`.
5. نقاط توقف: أي `sudo()` إضافي؛ أي تخمين لجذر متعدد؛ أي الإبقاء على `WebVuePmoCase` بلا شركة بعد Task 4؛ أي بدء Feature Registry؛ أي `ir.rule` مجموعة على القناة بدل قاعدة عامة؛ أي `migrations/0.0.0` للمنصة؛ أي Task 4 قبل أن يكتب `post_init_hook` الجذر فعلًا.

## خارج هذه الخطة عمدًا

billing · self-signup · shared workers · `@requires_feature` · terminology · Health · overlays · تغليف الحكومة · حذف فروع GitHub السلبية · branch protection.

## التقرير النهائي المطلوب من المنفّذ

جدول المهمة · الـcommit · الملفات. أوامر scratch ونتائجها الفعلية. انحرافات عن هذه الخطة. ما ينتظر CI بعد الدفع. لا ادّعاء إنتاج.
