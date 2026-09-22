# CP1-T5 — السطح التجاري مغلق

## النطاق

استكمال D01 في `codex/cp1-commercial-mode` من baseline `d194f93f`.
الشرائح السابقة محفوظة. هذه الشريحة تمنع تفعيل سطح الفوترة، بلا صفحة وبدون اتصال خارجي.
لا commit ولا merge ولا push ولا deploy.

## السلوك

- `/api/commercial/v1/<path>` يرفض بـ404 `commercial_unavailable` للمستخدم المصادق، سواء كان التصنيف `saas` أو `non_saas`.
- المجهول يبقى 403، بلا كشف رمز السطح.
- الجسم لا يُعاد ولا يُخزَّن. json2 يفك JSON قبل المتحكم؛ الرفض لا يقرأ الحقول.
- `self_service_available` يبقى `false`. لا صفحة `/settings/billing` ولا عنصر تنقل.
- Caddy لا يوجّه `/api/commercial` إلى Odoo. الرفض الحي عند الحافة يحتاج مسار Nuxt لاحقًا؛ هذه الشريحة لا تدّعي أن الوكيل نفسه يرفض.

## التحقق

من `/Users/tariq/code/nasq`:

```text
ruff check --no-cache .worktrees/cp1-commercial-mode/odoo-addons/nasq_api/controllers/commercial.py .worktrees/cp1-commercial-mode/odoo-addons/nasq_api/tests/test_commercial_surface.py
npx vitest run app/composables/nav/__tests__/shellModules.test.ts app/modules/__tests__/registry.test.ts
PYTHONDONTWRITEBYTECODE=1 /Users/tariq/code/odoo/.venv/bin/python .worktrees/cp1-commercial-mode/tools/check_cp1_scratch.py me
```

النتيجة: ruff نظيف، vitest 18/18، وOdoo scratch 21/21 تشمل `TestCommercialSurface`.
لم تُشغَّل مجموعة الركائز الكاملة ولا CI الست ولا إثبات egress محجوب.

## المتبقي

CP1-T6: أدلة ترقية وoffline أوسع قبل اعتبار CP1 مكتملة. الفوترة وصفحات الاشتراك ما زالت خارج النطاق.
