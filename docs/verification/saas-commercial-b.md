# التحقق التجاري SaaS — الجزء B (B1–B5, C1)

التاريخ: 2026-10-03

> **تنبيه صدق:** كل النتائج أدناه اختبارات شغّلها subagent ونقلها المنسّق، **وليست من CI**
> (test run by subagent, not by CI). اختبارات المحوّلات بـ mocked fetch دليل وحدة فقط.

## ملخص الحالة

| البند | الحالة | نوع الدليل |
|---|---|---|
| Contracts B (orders/subscriptions/billing/branches/usage/principal) | PASS | unit 60/60 وقت التشغيل |
| B2 Moyasar adapter + Simulator | PASS (وحدة) / Moyasar sandbox BLOCKED | unit بـ mocked fetch |
| Mail SMTP + invitation tokens | PASS محليًا / SMTP خارجي BLOCKED | 11 unit + 1 integration (Mailpit محلي) |
| Schemas 013–016 | مسجّلة في `db.ts` | اختبارات الأدناه |
| Invoices/outbox | PASS | 4/4 |
| Branches/usage | PASS | 5/5 مع تزامن عميلين حقيقيين |
| C1 legacy migration | PASS | 6/6 |
| Python `subscription_effect.py` | PASS (fake runners) / لم يُنفَّذ على Odoo حقيقي | 28 جديد + 43 إجمالي |
| B5 customer BFF + pages | PASS (وحدة/نوع) | web 1031 pass؛ lint clean |
| B1 routes/wiring النهائي، payments/renewals، B3 reconfigure worker، restore reconcile gate، إصلاح integration build | **PENDING** | قيد التنفيذ |

## Contracts B — PASS

orders / subscriptions / billing / branches / usage / principal: 60/60 وقت التشغيل. دليل unit، test run by subagent, not by CI.

## B2 — المحوّلات

- Moyasar adapter: Invoices API مع hosted redirect، تحقق webhook بـ `secret_token` + استعلام authoritative إلزامي، وحارس live-key.
- `SimulatorAdapter`.
- unit 15/15 (mocked fetch — دليل وحدة فقط، لا يثبت سلوك Moyasar الحقيقي). PASS.
- **Moyasar sandbox: BLOCKED** — لم تُقدَّم مفاتيح اختبار.

## البريد

- SMTP adapter + invitation tokens (تخزين hash فقط): 11 unit + 1 integration على Mailpit محلي (round trip لموضوع عربي) — PASS.
- **التسليم عبر SMTP خارجي: BLOCKED** — لم تُقدَّم إعدادات SMTP.

## قاعدة البيانات

- `schema_013`: customers, terms, subscriptions, revisions, orders, invoices, payments, renewals, outbox.
- `schema_014`: ربط legacy (C1).
- `schema_015`: branches, usage, fulfillment effects, `branch_quote_requests`.
- `schema_016`: مسجّلة في `db.ts` (انظر الجزء A).

## الاختبارات حسب المجال

- Invoices/outbox: 4/4 — PASS.
- Branches/usage: 5/5، بينها تزامن عميلين حقيقيين على آخر فرع مجاني (ينجح واحد فقط) — PASS.
- C1 migration: 6/6 — dry-run لا يكتب شيئًا، إعادة التشغيل مطابقة، interrupt/resume، سلطة legacy job — PASS.
- Python `subscription_effect.py` (reconfigure/observe): 28 اختبارًا جديدًا و43 إجمالًا بـ fake runners — PASS. **سكربتات جهة Odoo لم تُنفَّذ بعد على Odoo حقيقي.**
- الدليل لكلها: test run by subagent, not by CI.

## B5 — واجهة العميل

- BFF + صفحات: `/subscription`, `change`, `status`, `branches`, `branches/new`, `invoices`, `invoices/[id]`؛ وصفحات المورّد: customers, invoices, overview.
- web tests: 1031 pass؛ lint clean — PASS (وحدة/نوع). مراجعة المتصفح/E2E غير مُشغَّلة.

## قيد التنفيذ (PENDING)

- اختبارات B1 النهائية للمسارات/الربط (ويشمل بند المراجعة 7: change quotes/customer terms على الخادم).
- اختبارات payments/renewals.
- B3 reconfigure worker.
- بوابة restore reconcile (قاعدة TARGET المستعادة تُرصد وتُصلَح قبل إعادة الفتح).
- إصلاح integration build.

## حادثة

PG scratch المشترك قُتل بـ OOM تحت حمل Docker (background writer signal 9، 2026-10-03 01:19 UTC)؛ استُعيد بلا تغييرات.

## القرارات المعتمدة

- العملة SAR؛ VAT 15% حصرية.
- سعر الفرع لكل دورة.
- التناسب: Asia/Riyadh، يوم التفعيل يُحتسب ويوم التجديد لا، half-up لكل سطر.
- اتفاقات مثبّتة (pinned).
- الإضافة المدفوعة تُحتسب تناسبيًا بعد الدفع.
- الخفض/الإلغاء عند التجديد بلا استرداد تلقائي.
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

### ما أُضيف بعد المراجعة

- تسجيل عميل جديد مدفوع عبر مسار التوفير القائم تحت فاعل خدمة (service actor) للخادم فقط (schema_017).
- دعوات المسؤول: استخدام واحد، تخزين hash فقط، outbox بعد أول تفعيل، وأثر set-password في Odoo (schema_018، `invitation-odoo.ts`، `admin_password_effect.py`).
- مجدوِل العامل في `shared-worker-main.ts`: fulfillment، الدعوات، مصالحة الدفع، استرداد المقاطَع، التجديدات، dunning، مراجعة الاسترداد.
- أصل BFF للعميل لكل مستأجر (per-tenant customer BFF origin).
- الاستعادة تنتظر مصالحة التجاري قبل verified (تسليم job-worker).
- إصلاحات المراجعة: الحزم المضمّنة مجانية، التحقق التجميعي من الخطة، SAR/exponent، قدرة التسعير، CAS، ترتيب الإلغاء، الاسترداد ← رصيد معلّق (بلا استرداد تلقائي)، refunded بعد applied ← تدخّل، فحوص merchant/mode في `confirmEvent`.
- Moyasar sandbox: إنشاء فاتورة حقيقية والاستعلام عنها PASS (يلزم اسم الحساب)؛ webhooks محجوبة (BLOCKED).
