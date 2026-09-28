# ملكيات الملفات قبل تشغيل التابعين — نسخة التنفيذ المشتركة

النسخة: `/Users/tariq/code/nasq-shared-isolation` — فرع `codex/shared-isolation`
على `d780862e` (لا commit/merge). الكاتب الوحيد لكل نقطة تكامل: `baseline`.

## 1. ملكية t2 — routing

- يملك: `apps/web/server/**` (بما فيه `utils/tenantHostResolver.ts` واختباراته)،
  وتكوين ingress جديد خاص تحت `deploy/shared/**` فقط.
- لا يملك: `apps/web/nuxt.config.ts`، `deploy/Caddyfile`، أي نقطة تكامل مشتركة
  أخرى — يطلبها من `baseline` في t5.
- الأساس المتاح له: `tenantHostResolver.ts` + `tenantHostResolver.test.ts`
  منقولان ويعملان (ضمن 896 اختبار ويب ناجح).

## 2. ملكية t3 — provisioning

- يملك ملفات جديدة حصريًا تحت `packages/commercial-contracts/src/shared/**`
  و`apps/control-plane/src/shared/**` واختباراتهما.
- لا يملك/لا يعدّل مباشرة: `packages/commercial-contracts/src/index.ts`،
  `apps/control-plane/src/http.ts`، `apps/control-plane/src/worker.ts`،
  `apps/control-plane/src/schema*.sql`، `tools/nasq_cli/managed_runtime.py`.
- ربط المستهلكين الحقيقيين = `baseline` في t5.

## 3. ملكية t4 — sovereign (non_saas)

- يملك: `odoo-addons/nasq_platform/commercial_config.py`،
  `odoo-addons/nasq_platform/models/entitlement_service.py`،
  `odoo-addons/nasq_platform/tests/**`، وأي اختبار pure جديد
  `tools/test_non_saas_*.py`.
- لا يملك: ملفات platform أخرى أو وثائق مشتركة — يطلبها من `baseline`.
- لا اختبار على `odoo19`؛ أي Odoo اختبار يحتاج scratch محددًا واعتماد موارد.

## 4. نقاط التكامل المشتركة — ملك baseline وحده

`apps/web/nuxt.config.ts`، `deploy/Caddyfile`،
`packages/commercial-contracts/src/index.ts`، `apps/control-plane/src/http.ts`،
`apps/control-plane/src/worker.ts`، `apps/control-plane/src/schema*.sql`،
وأي addon boundary جديد. تُعالج في t5 كمصالحة ملفات لا `git merge`.

## 5. ملكية t6/t7

- t6 (verification): حزمة اختبارات مستقلة جديدة فقط تحت
  `tools/shared_isolation_acceptance/**` + تقارير أدلتها. لا تصلح implementation.
- t7 (security): read-only؛ لا تعدّل كودًا ولا تدمج.

## 6. تداخلات مثبتة يجب إدارتها

1. **schema.sql / http.ts / worker.ts**: t3 ممنوع من لمسها؛ كل التغييرات عليها
   تمر عبر t5 مع إيقاف كتابة t2/t3/t4 قبلها.
2. **tenantHostResolver.ts**: منقول كأساس؛ أي تعديل عليه ملك t2 وليس `baseline`.
3. **managed_runtime.py وأدوات managed_**: منقولة كدليل مرجعي فقط؛ غير مخصصة
   لأي من t2–t7 إلا بعد طلب ملكية صريح.
4. **index.ts في commercial-contracts**: t3 يضيف ملفات shared، و`baseline` يضيف
   الـbarrel export الواحد في t5.