# تحليل مشروع ويب فيو (webvue) — الصورة الكاملة

تاريخ التحليل: 2026-10-07. تحليل قراءة فقط (لم يُعدَّل ملف ولم يُشغَّل اختبار أو Odoo). جُمع من ستة تقارير وكلاء مستقلين، كلٌّ على طبقة واحدة، مع تحقق مباشر من ملفات السياسات. هذا تقرير مؤرخ؛ تحقق من الحالة الحية قبل الاعتماد عليه.

## 1. ما هو المشروع

**ويب فيو** منصة عربية RTL-first موحّدة لتشغيل الشركات، بطموح يشبه أودو في الاتساع، لكن بهوية وتجربة خاصة. المحرك **Odoo 19 Community**، وواجهة العميل **Nuxt 4 + Nuxt UI 4**، والعقود بينهما Zod في `packages/contracts`. التطبيقات المنفّذة اليوم: **PMO** (مشاريع/مهام/ميثاق/قوالب/مالية/حوكمة)، **Meetings**، **HR** (دليل/أقسام/وثائق — بلا رواتب)، **Chat**، إضافة إلى الإعدادات والصلاحيات. التعريف المعتمد في `apps/web/PRODUCT.md` يميّز صراحة بين الرؤية (مبيعات/مالية/مخزون…) وما هو منفَّذ.

**نموذج التشغيل:** قاعدة بيانات وfilestore منفصلان لكل عميل؛ المستهدف SaaS ذاتي الخدمة على خدمات تطبيق مشتركة، مع بقاء dedicated وcustomer-hosted (non_saas) خيارات منفصلة. حالة الجاهزية المعلنة في `docs/project-closure/saas-hosting-direction-status.md`: **`not ready`**.

## 2. حجم المستودع وحالة Git الحية

| المقياس | القيمة |
|---|---|
| الفرع | `main` = `origin/main` (0↔0)، آخر commit `9336317e` |
| ملفات متتبعة | 2,078 (apps 983، odoo-addons 407، docs 319، tools 147، deploy 98، packages 96) |
| Worktrees | 4 (الرئيسية + 3 تحت `~/.codex/worktrees/` كلها عند `7208cf96`) |
| الوسوم | `release/19.0.1.0.0` واحد + 9 `archive/*` |
| متسخ (M) | `.gitignore`، `package.json`، `package-lock.json`، `docs/WORKSPACE.md` |
| غير متتبع | `.agents/`، `.planning/`، `plans/`، `e2e/`، `e2e.config.ts`، `docs/e2e.md` |

ملاحظة: `docs/WORKSPACE.md` يذكر worktree واحدة فقط؛ الواقع الحي 4 — الوثيقة نقطة تحقق مؤرخة لا الحالة الحالية.

## 3. طبقة Odoo (13 إضافة)

| الرتبة | الإضافة | الإصدار | يعتمد على | المسارات | sudo | اختبارات |
|---|---|---|---|---|---|---|
| 0 | `webvue_core` | 19.0.1.2.0 | base | — | 2 | 37 |
| 1 | `webvue_platform` | 19.0.1.3.0 | webvue_core | — | 19 | 48 |
| 2 | `webvue_api` | 19.0.1.0.0 | core, platform, **auth_totp** | 20 (`/admin/*`, `/me*`, `/branding`, `/auth/totp`) | 5 | 72 |
| 3 | `webvue_notify` | 19.0.1.0.0 | webvue_api, mail | 3 | 11 | 20 |
| 3 | `webvue_directory` | 19.0.1.0.0 | webvue_api | 1 (`/people`) | 0 | 7 |
| 4 | `webvue_pmo` | 19.0.1.4.0 | api, platform, directory, notify, project, mail, bus | **55** | **86** | **362** |
| 4 | `webvue_hr` | 19.0.1.1.0 | webvue_api, hr, mail | 9 | **0** | 80 |
| 4 | `webvue_meetings` | 19.0.1.0.0 | api, platform, notify, directory, cyan, calendar, mail | 20 | 25 | 99 |
| 4 | `webvue_chat` | 19.0.1.1.0 | api, platform, mail | 14 | 3 | 19 |
| 5 | `webvue_meetings_pmo` | 19.0.1.0.0 (auto_install) | meetings, pmo | 1 | 8 | 37 |
| معفى | `cyan_meeting_minutes` | 19.0.1.3.1 | base, mail, web, calendar | — | 3 | 55 |
| معفى | `web_theme_shadcn` / `webvue_registry_probe` | 19.0.1.0.0 | web / platform | — | 0 | 7 / 1 |

**الالتزام بالمعمارية:** R1–R4 محققة في المصدر: لا استيراد بين تطبيقات، الجسر الوحيد `webvue_meetings_pmo`، والأساس لا يعرف أي تطبيق. كل `test_*.py` مستورد في `tests/__init__.py`. الإصدارات مطابقة لما توثّقه `AGENTS.md`. مجموع `def test_` في Odoo ≈ **844**.

**ملاحظات طبقة Odoo:**
- `webvue_pmo` هو مركز الثقل: 55 مسارًا، أكبر ملفين `project_project.py` (934 سطرًا) و`project_task.py` (924)، و86 `sudo()` تحتاج مطابقة مع الحالات الموثقة (R7).
- `webvue_chat` بلا `ir.model.access.csv` (قواعد سجل فقط فوق `discuss.channel`) — يستحق تحققًا.
- `webvue_meetings` بلا `migrations/`؛ HR/meetings/chat بلا `i18n/` (PMO وcyan فقط يشحنان `ar.po`).
- `webvue_api` يعتمد على `auth_totp`، وهو غير مذكور في قائمة الاعتماديات بـ `AGENTS.md`.
- ملفات `__pycache__/*.pyc` موجودة داخل الإضافات (ضوضاء).

## 4. واجهة العميل `apps/web`

| البند | القيمة |
|---|---|
| التقنية | Nuxt ^4.5.2، @nuxt/ui 4.11.1، @nuxtjs/i18n 10 (`ar` افتراضي، `no_prefix`)، vue-query 5، Tailwind 4، Zod 4، tiptap، unovis |
| الصفحات | **141** صفحة: projects 47، vendor 20، hr 17، meetings 15، settings 14، subscription 7، project-templates 6، chat 4، tasks 3+، auth 3، أخرى |
| المكونات | project 38، task 25، shared 22، vendor 14، hr 12، access 7، meetings 7، shell 6، chat 5… |
| Composables | 61 + مجلد `nav/` |
| i18n | 14 namespace لكل لغة، **ar/en متطابقتان** |
| الاختبارات | 142 ملف vitest، **56** Playwright spec، **69** قصة Storybook |
| وضع الاستئجار | `WEBVUE_TENANCY_MODE=dedicated\|shared` يغيّر routeRules والبروكسي |

**الالتزام بـ DESIGN.md:** `SharedCreatePanel` تستخدمه **26/26** صفحة `/new`؛ `useHydrated` مستخدم 208 مرة؛ **لكن 7 أصناف Tailwind فيزيائية** (`left-`/`right-`) باقية في `.vue` وتخالف سياسة الخصائص المنطقية. أكبر ملف `pages/meetings/[id].vue` (627 سطرًا). TODO/FIXME = 0. R5 محقق: لا استيراد من control-plane (مطابقات نصية فقط في تعليقات).

**الخادم (`apps/web/server`):** بروكسي SSR إلى `/api/v1`، تسجيل الدخول/الخروج/TOTP مع CSRF، بروكسيات موقّعة لـ vendor/commercial، قبول الدعوات، وطبقة tenant-boundary للوضع المشترك (11 ملف اختبار).

## 5. العقود `packages/contracts`

6 نطاقات (`common`, `access`, `pmo`, `hr`, `chat`, `meetings`) بـ ~40 ملف مخطط و28 ملف اختبار. العقود المشتركة الأساسية: `ApiErrorSchema` في `src/common/error.ts` بشكل `{code, message, field?, details?}`، غلاف القوائم `{items, total}` (strict)، `PersonRefSchema` في `src/pmo/personal-stage.ts`، وحالات المهمة الست في `src/pmo/state.ts`.

## 6. مستوى التحكم `apps/control-plane`

خدمة headless مستقلة (Node 22 / PostgreSQL منفصلة) لحوكمة البائع: tenants، catalog، orders/payments/subscription، audit، backup/restore. 18 ترحيل SQL (`schema.sql` → `schema_018`)، 67 ملف اختبار (4 live تحتاج `CONTROL_TEST_DATABASE_URL`، تعمل تسلسليًا عمدًا). سطح HTTP: `/healthz`، `/api/commercial/payment-callback`، وعائلة `/v1/` (audit, catalog, context, customer, invitations/accept, operations, overview, registry/*, shared/tenants, targets, tenants). المنتج يعمل بدونها فعليًا (R5): لا استيراد منها في `odoo-addons` أو `apps/web/app`.

## 7. النشر والأدوات وCI

- **deploy/**: نموذجان مقولبان — `docker-compose.yml` (dedicated لكل عميل) و`docker-compose.shared.yml` (SaaS مشترك مع guard)؛ Caddy 2.11.4 + ratelimit؛ `provision.sh`، `backup.py`/`restore_verify.py`؛ `ODOO_COMMIT=34eed49d` يطابق HEAD الحالي لـ `/Users/tariq/code/odoo`. `deploy/.env` متجاهَل (غير متتبع).
- **tools/**: `arch_policy.py` (R1–R10)، `git_policy.py`، `ui_policy.py`، `secret_guard.py`، `migration_guard.py`، `no_external_refs.py`، `api_surface.py`…
- **الدين المعماري المسجّل** في `tools/arch_baseline.json`: **168 مخالفة** — R7 (sudo) **83**، R9 (نقاط تمديد غير عامة) **68**، R5 8، R2 4، R3 4، R8 1، وR1/R4/R6/R10 = 0. الخط الأساسي لا يُسمح له إلا بالتناقص.
- **CI (Woodpecker)**: `static` → `control-plane` → `odoo` → `upgrade` → `restore-drill` → `image` → `e2e-mock`؛ بوابة الصورة الاختيارية في `deploy/woodpecker/image.yml`. `npm test` يجمع اختبارات tools + الحراس + العقود + web.

## 8. التقييم العام

**نقاط القوة**
- معمارية طبقية مفروضة بالأدوات لا بالنية فقط (ranks في `tools/arch_layers.json`، خط أساسي متناقص، فحص `--base` في CI).
- تغطية اختبار واسعة عبر الطبقات (~844 Odoo، 142 vitest، 56 e2e، 67 control-plane، 28 contracts) وتناظر i18n كامل.
- فصل واضح بين الرؤية والمنفَّذ في الوثائق، وسجل أدلة/تحقق كثيف (`docs/verification` 71 ملفًا).
- التزام عالٍ بسياسة الواجهة (CreatePanel 26/26، hydration 208).

**أبرز المخاطر والديون**
1. **R7/R9 (151 مخالفة)**: الاعتماد الواسع على `sudo()` وتمديدات غير عامة، معظمها في PMO — أكبر دين أمني/صيانة.
2. **تركّز التعقيد في `webvue_pmo`** (ملفات ~930 سطرًا، 55 مسارًا) مقابل بقية التطبيقات الخفيفة.
3. **فجوات تغليف صغيرة**: `webvue_chat` بلا ACL CSV، `webvue_meetings` بلا migrations، HR/meetings/chat بلا `i18n`، 7 أصناف Tailwind فيزيائية.
4. **الجاهزية التجارية**: الاستضافة المشتركة `not ready` — بوابات مفتوحة: تمرين Odoo حقيقي بـ ACL/MFA، TLS عام، مزود دفع فعلي، استعادة Odoo+filestore مع RPO/RTO، قبول non_saas مستقل.
5. **تضخم توثيقي/تاريخي**: 319 ملف docs وثلاث worktrees قديمة ومجلدات غير متتبعة (`.planning/`, `plans/`, `.agents/`) — خطر الخلط بين نقاط التحقق المؤرخة والحالة الحية.
6. `postgres:16` في compose الرئيسي بلا digest (بخلاف control-plane)؛ وتبعية `auth_totp` غير موثقة؛ `PGPASSWORD=odoo` نصًا في CI (scratch فقط).

**حدود هذا التحليل:** مصدري فقط؛ لم تُشغَّل اختبارات أو Odoo، فأرقام الاختبارات هي عدّ تعريفات لا نتائج تشغيل.

**خطوات مقترحة:** (أ) تدقيق مصدري على `webvue_pmo` لمطابقة الـ 86 `sudo()` مع الحالات الموثقة؛ (ب) حزمة صغيرة لإصلاح الأصناف الفيزيائية السبعة وتوثيق `auth_totp`؛ (ج) تحديث `docs/WORKSPACE.md` بحالة worktrees الحية.
