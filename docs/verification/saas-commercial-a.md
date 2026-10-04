# التحقق التجاري SaaS — الجزء A (A1–A4)

التاريخ: 2026-10-03

> **تنبيه صدق:** كل النتائج أدناه اختبارات شغّلها subagent ونقلها المنسّق، **وليست من CI**
> (test run by subagent, not by CI). لا تثبت نشرًا ولا اعتماد إصدار. دليل الوحدة/التكامل المحلي
> يغطي الطبقة المفحوصة فقط.

## ملخص الحالة

| البند | الحالة | نوع الدليل |
|---|---|---|
| A1 contracts + entitlement compiler | PASS | unit tests + build، شغّلها subagent لا CI |
| A2/A3/A4 server | PASS (مع قيد) | control-plane suite، شغّلها subagent لا CI |
| مراجعة مستقلة (نموذج مختلف) | needs_revision؛ إصلاحات 1–6 PASS، البند 7 PENDING | مراجعة + اختبارات |
| Vendor UI (bundles/plans) | PASS للوحدة/النوع/Storybook؛ المتصفح PENDING | web unit + vue-tsc + storybook build |
| Odoo `nasq_platform` 19.0.1.3.0 | PASS | Odoo install/upgrade على scratch DB معزولة |
| E2E المتصفح (E01, E02, E15) | PENDING | لم تُشغَّل بعد |

## A1 — العقود ومترجم الاستحقاقات (PASS)

- الملفات: `packages/commercial-contracts/src/commercial/{schemas,catalog,entitlements,calendar,pricing,quotes}.ts`.
- اختبارات contracts: 36/36 ثم 62/62 بعد إصلاحات المراجعة (`npm -w packages/commercial-contracts run test`، exit 0). Build exit 0.
- متجه التناسب: 500 SAR × 15/31 = 241.94 (24194 halalas) — مُختبَر.
- HQ + 3 فروع إضافية، واحد مجاني ← 2 مدفوعان = 100000 + VAT 15000 — مُختبَر.
- الدليل: unit tests، test run by subagent, not by CI.

## A2/A3/A4 — الخادم (PASS مع قيد)

- الملفات: `apps/control-plane/src/schema_012.sql`؛ `src/commercial/{catalog-releases,lifecycle,bundles,plans,policies,quotes,http}.ts`.
- المسارات: `/v1/commercial/{catalog/releases,bundles,plans,policies,quotes}`.
- الحزمة الكاملة لـ control-plane: 487 passed + 1 skipped (تكامل Mailpit يحتاج env)، exit 0 وقت التشغيل.
- الدليل: اختبارات تكامل/وحدة، test run by subagent, not by CI.

## المراجعة المستقلة (نموذج مختلف) — needs_revision، 7 ملاحظات

| # | الملاحظة | الحالة |
|---|---|---|
| 1 | احتساب رسوم لحزم included | PASS (مُصلَح + اختبار) |
| 2 | غياب التحقق الكلي للخطة (aggregate plan validation) | PASS (مُصلَح + اختبار) |
| 3 | العملة غير مقيّدة بـ SAR/exponent 2 | PASS (مُصلَح + اختبار) |
| 4 | إنشاء حزمة مُسعَّرة بلا `vendor.pricing.manage` | PASS (مُصلَح + اختبار) |
| 5 | غياب CAS على `edit_revision` في SQL | PASS (`schema_016.sql` CREATE OR REPLACE `protect_commercial_revision`؛ `UPDATE … WHERE edit_revision=$expected`؛ كاتبان متزامنان قديمان ← 200 واحد و409 واحد) |
| 6 | تعديل محتوى مُتحقَّق منه أبقى digest | PASS (مُصلَح + اختبار) |
| 7 | الخادم يسعّر quotes من نوع `new` فقط (change quotes/customer terms) | **PENDING** — سُلّم إلى B1، بانتظار التحقق النهائي |

أرقام ما بعد الإصلاح: contracts 62/62؛ plans+quotes 12/12. الدليل: test run by subagent, not by CI.

## واجهة المورّد: bundles/plans

- الصفحات: `/vendor/bundles` (+`new`, `[id]`, `[id]/edit`)، `/vendor/plans` (بالمثل).
- المكوّنات مع stories: `BundleForm`, `PlanForm`, `PriceBreakdown`, `EntitlementSummary`, `LifecycleBadge`, `PriceListEditor`, `CapacityLimitsEditor`, `LifecyclePanel`.
- web tests: 1008 ثم 1031 pass؛ `vue-tsc` نظيف؛ `ui_policy` PASS؛ `storybook build` exit 0 — PASS (unit/static، شغّلها subagent لا CI).
- مراجعة المتصفح/E2E: **PENDING (C2)**.

## Odoo — `nasq_platform` 19.0.1.3.0 (PASS)

- خدمة الفروع: `nasq.tenant.branch`، `branches.extra_limit`، حقول محمية `commercial_revision_id/digest/applied_at`، حارس إنشاء child لـ `res.company`.
- تثبيت: 667 اختبارًا، 0 failed، 0 errors (scratch DB `nasq_commercial_odoo_install` على PG معزول 127.0.0.1:55491).
- ترقية من main `19.0.1.2.0` ← `19.0.1.3.0`: 38 اختبارًا، 0 failures. `ruff` نظيف.
- ملاحظة: `tools/upgrade_log_guard.py` يرصد 4 أسطر ERROR من اختبارات سلبية مقصودة عند التشغيل مع `--test-tags`؛ خطوة CI للترقية تعمل بلا tags.
- الدليل: اختبارات Odoo على قاعدة scratch، test run by subagent, not by CI.

## مفتوح

- E2E المتصفح (E01, E02, E15): PENDING — لم تُشغَّل.
- البند 7 من المراجعة: PENDING.

## القرارات المعتمدة

- العملة SAR؛ ضريبة VAT 15% حصرية (exclusive).
- سعر الفرع لكل دورة (per cycle).
- التناسب (proration): بتوقيت Asia/Riyadh، يُحتسب يوم التفعيل ولا يُحتسب يوم التجديد، تقريب half-up لكل سطر.
- الاتفاقات مثبّتة (pinned agreements).
- الإضافة المدفوعة تُحتسب تناسبيًا بعد الدفع.
- الخفض/الإلغاء عند التجديد دون استرداد تلقائي.
- trial/grace لكل خطة من الإدارة.
- تجديد تلقائي بموافقة + Moyasar token.
- دعوات عبر SMTP.

## بوابات مفتوحة

- مفاتيح Moyasar sandbox.
- إعدادات SMTP.
- بيئة staging.
- أهداف السعة/SLA.
- ZATCA خارج النطاق.

## تحقق نهائي 2026-10-07

تشغيل مستقل متسلسل على PG scratch (127.0.0.1:55491) فقط، بلا commit ولا لمس Docker. قواعد: `nasq_control_scratch_final2` ثم `final3` (جديدتان) للحزمة الكاملة؛ `nasq_control_scratch_payfinal` لملفَي payment-events وrenewals (حارساهما يشترطان هذا الاسم)؛ ملفات branches / restorec / reconfigure تُنشئ أو تشتق قاعدتها الخاصة وتعمل ضمن الحزمة الكاملة.

| # | الأمر | النتيجة | exit |
|---|---|---|---|
| 1 | contracts test | 178/178 (28 ملفًا) | 0 |
| 2 | contracts build (`tsc --noEmit`) | نجح | 0 |
| 3 | control-plane build | نجح | 0 |
| 4 | control-plane الكامل (final2، الجولة 1) | 571 نجاح / 13 فشل / 2 تخطٍّ | 1 |
| 5 | إعادة بعد ~3 دقائق (final2) | 584 نجاح / 1 فشل / 2 تخطٍّ | 1 |
| 6 | إعادة على قاعدة جديدة final3 | 584 نجاح / 1 فشل / 2 تخطٍّ (الفاشل: `shared-restore-waiting`) | 1 |
| 7 | `shared-restore-waiting` منفردًا على final3 (مرتان) | 3/3 | 0 |
| 8 | payment-events + renewals (payfinal) | الجولة 1: 20/21 (فشل renewals:66) → بعد الإعادة 21/21 | 0 |
| 9 | web test | 1040/1040 (150 ملفًا) | 0 |
| 10 | web lint (`vue-tsc --build --noEmit`) | نجح | 0 |
| 11 | `tools/ui_policy.py` | PASS | 0 |
| 12 | `node tools/ui_catalog.mjs --check` | «catalog.json is stale» (متكرر بعد إعادة المحاولة) | 1 |
| 13 | unittest `tools/shared_saas_lifecycle` (51) + `tools` (test_ui_policy) | OK | 0 |
| 14 | `ruff check odoo-addons` | All checks passed | 0 |
| 15 | `git diff --check` | نظيف | 0 |
| 16 | `tools/secret_guard.py` | نظيف | 0 |

### تصنيف الإخفاقات

| الإخفاق | التصنيف | الملاحظة |
|---|---|---|
| commercial-downgrade (11) وcommercial-enrollment (2) في الجولة 1 | منتج قيد الإنجاز (انجراف عقد: `catalog_release_id` غير معروف في `authority.entitlement`، وحواجز الخفض تحلّ بدل أن ترفض) | زالت بعد هبوط تعديلات الوكلاء الأخرى؛ نجحت 20/20 عند الإعادة |
| commercial-renewals:66 (paid/succeeded بدل awaiting_payment/pending) | اختبار/تزامن تعديلات | لم يتكرر عند الإعادة (21/21) |
| `shared-restore-waiting` (1) داخل الحزمة الكاملة | اختبار (عزل/ترتيب: يمر منفردًا 3/3 على قاعدة جديدة، ويفشل ثابتًا ضمن الحزمة: ترتيب job id المُطالَب به) | ليس بيئة؛ يحتاج تنظيف حالة بين الملفات |
| `ui_catalog --check` stale | منتج (ملف مولَّد غير مُجدَّد بعد إضافة قصص `stories/subscription` و`stories/vendor`) | العلاج `node tools/ui_catalog.mjs`؛ لم يُنفَّذ لأن النطاق توثيقي فقط |
| بيئة | لا إخفاق بيئي | Python 3.9 مع unittest `discover -s` يلزمه `-p` (أمر التشغيل لا مشكلة منتج) |
