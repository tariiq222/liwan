# خط أساس SaaS التجاري — المرحلة 0

التاريخ: 2026-10-02 (إعداد المرحلة 0)

## المراجع
- `main` المرجعي: `5dc1daef79ff4628f92d4b23a8dec2d27e3af1eb` (نظيف، 6 التزامات أمام origin؛ بلا fetch/push).
- الـworktree الجديد: `/Users/tariq/.codex/worktrees/saas-commercial/nasq`، الفرع `codex/saas-commercial` (من main، تغييرات غير ملتزمة).
- الـworktree القديم (للقراءة فقط، لم يُمس): `/Users/tariq/.codex/worktrees/saas-lifecycle-integration/nasq`، الفرع `codex/ui-live-review` @ `5dc1daef`، متسخ: 84 ملفًا معدّلًا + 36 غير متتبع.

## ما نُقل (مجموعتا a وb)
**تغييرات متتبعة (diff مُطبّق):**
- `apps/control-plane/src/{db,http}.ts`, `shared/{job-store,job-worker,odoo-adapter,onboarding,shared-order}.ts`، وثمانية اختبارات (`service` و`shared-*`: تعديل TRUNCATE/استيراد للحزم).
- `packages/commercial-contracts/src/{index.ts,shared/provisioning.ts}`.
- `apps/web`: `useApi.ts` (+test، ترجمة أخطاء حصة الحزمة), `useSharedTenantOnboarding.ts`, صفحات vendor (`catalog.vue`, `operations/*`, `overview.vue`, `tenants/new.vue`) واختبار shared-onboarding، `server/utils/vendor-control.ts` (+اختباران: PATCH/DELETE وuseI18n), `i18n/locales/{ar,en}/{vendor,common}.json` (common: مفاتيح `errors.packageQuota` فقط).
- `docs/design-system/components.md` و`catalog.json` (هنك `VendorPackageForm` فقط)، `tools/ui_policy.py` (PackageForm في Storybook + استثناء vendor/catalog.vue).
- `tools/nasq_cli/managed_policy.py` (`parse_package_create_policy`) و`tools/shared_saas_lifecycle/{odoo_effect,test_odoo_effect}.py` — مطلوبة للحزم (authority v2 ومسؤول الحزمة)، كل هنكاتها تخص (a).

**ملفات غير متتبعة (نسخ):** `apps/control-plane/src/{packages,package-http,operation-feed}.ts`, `schema_011.sql`, اختبارات `packages*.test.ts` و`operation-feed.test.ts`؛ `packages/commercial-contracts/src/packages.ts` + اختباران؛ `apps/web/app/components/vendor/`, `pages/vendor/catalog/`, `pages/vendor/__tests__/operation-feed.test.ts`, `utils/vendorPackages.ts` (+test), `stories/vendor/`; `tools/test_package_policy.py`؛ وثائق: خطة/تصميم إدارة الحزم، `2026-10-02-saas-commercial-{product spec, master, a-catalog, b-subscriptions, c-acceptance}`، `docs/verification/2026-10-02-package-management.md`، و`prototypes/saas-commercial/`.

## ما استُبعد عمدًا (مجموعة c، لا تخص الحزم)
- أجزاء HR/PMO/الاجتماعات/مراجعة UI: مكوّنات `hr/DocumentCreateForm`, `project/*Form`, `task/TaskCreateForm`, صفحات `hr/*`, `meetings/*`, `projects/*`, `search.vue`, `archived-tasks.vue`, `project-templates/*`، واختبارات صفحات متعلقة، قصص stories غير vendor، ومفاتيح ترجمة `hr/meetings/projects/tasks`.
- `docs/design-system/catalog.json`: هنكات إزاحة أرقام الأسطر (7 من 8) لأنها تتبع الصفحات المستبعدة.
- غير متتبعة: `hrReturnTo.ts`, `recordListOrigin.ts`, اختبارات return-chain/requiredFeedback/financeFormFeedback/uiReviewNavigationForms، `docs/.../2026-10-01-ui-review.md`, `docs/verification/2026-10-02-ui-live-review.md`.

## قرارات الأعمال المعتمدة (المستخدم، 2026-10-02)
1. سعر الفرع الإضافي دوري لكل دورة فوترة؛ بلا رسم تأسيس.
2. النِّسبية: Asia/Riyadh؛ يوم التفعيل يُحسب ويوم التجديد لا؛ حساب نسبي دقيق داخليًا؛ تقريب half-up مرة لكل بند (500 × 15/31 = 241.94).
3. تغيير السعر العام: اتفاقات العملاء القائمة مثبتة حتى تغيير معتمد لذلك العميل.
4. إضافة حزمة مدفوعة تُفعّل بعد الدفع وتُحاسب للأيام المتبقية؛ التخفيض/الإلغاء عند التجديد مع حفظ البيانات؛ لا استرداد تلقائي.
5. التجربة والسماح: لا قيم ثابتة؛ `trial_days`/`grace_days` صريحان لكل باقة من لوحة SaaS؛ التعليق الآلي وفق سياسة الباقة فقط.
6. التجديد تلقائي بموافقة صريحة وtoken من المزود (بلا تخزين بطاقة)، وإلا طلب دفع.
7. مزود الدفع Moyasar (مفاتيح الاختبار عبر البيئة — غير متوفرة بعد).
8. قناة دعوة المسؤول: SMTP/بريد (إعدادات عبر البيئة — غير مزوّدة بعد).
9. العملة SAR؛ ضريبة 15% حصرية كبند مستقل؛ فاتورة ZATCA الرسمية خارج النطاق.
10. WIP القديم يُنقل (غير ملتزم) إلى `codex/saas-commercial` دون مساس بالقديم.
مفتوح: أهداف السعة وSLA.

## المصطلحات
تطبيق/App · حزمة/Bundle · باقة/Plan · اشتراك الشركة/Company subscription · عرض السعر/Quote · مساحة الشركة/Workspace · طلب تغيير/Change order.

## جرد التشغيل (يُحفظ ولا يُوقف)
- مشروع compose `nasq-saas-life-1790879392` من الـworktree القديم: proxy (Caddy) على 127.0.0.1:80/443، control-db على 127.0.0.1:55447، وخدمات control-api/worker/odoo/db/vendor-*.
- `nasq-ui-preview` (3180)، `nasq-saas-control-local`، `nasq-saas-outage-fixture`.
- لم تُشغَّل أي اختبارات على `odoo19`؛ لا PostgreSQL scratch على 5432.

## نتائج الفحوص (في الـworktree الجديد)
| الأمر | النتيجة | exit |
|---|---|---|
| `npm ci --ignore-scripts` | نجح | 0 |
| `npm -w packages/commercial-contracts run test` | 3 ملفات / 10 اختبارات نجحت | 0 |
| `npm -w packages/commercial-contracts run build` | نجح | 0 |
| `npm -w apps/control-plane run build` | نجح | 0 |
| `npm -w apps/web run test` (بعد `nuxt prepare`) | 142 ملفًا / 949 اختبارًا نجحت | 0 |
| `cd apps/web && npx vue-tsc --build --noEmit` | نظيف | 0 |
| `python3 -m unittest discover -s tools/shared_saas_lifecycle -p 'test_*.py'` | 15 اختبارًا OK | 0 |
| `python3 tools/test_package_policy.py` | نجح | 0 |
| `git diff --check` | نظيف | 0 |
| `python3 tools/secret_guard.py` | نجح | 0 |
| اختبارات control-plane الحية (PostgreSQL) | **معلّقة**: لا قاعدة scratch على 5432 | — |

ملاحظة: أول تشغيل لـweb test وvue-tsc فشل لغياب `.nuxt` (تهيئة لم تُجرَ بعد `npm ci --ignore-scripts`)، وليس عيب نقل؛ حُلّ بـ`npx nuxt prepare`.

## تاريخي مقابل ما يُعاد قبوله
- **تاريخي (لا يُعدّ قبولًا حاليًا):** `docs/verification/2026-10-02-package-management.md` وتقارير الـworktree القديم؛ أي ادعاء حي سابق عن الحزم/العمليات/القاعدة.
- **يُعاد قبوله:** اختبارات control-plane الحية (packages-live وبقية shared-*) على PostgreSQL scratch، تدفق الحزم في الواجهة مقابل التشغيل الحي، تسعير الاشتراك/الاشتراكات/Moyasar/الدعوة (لم تُنفّذ بعد)، وكل القبول البصري.
