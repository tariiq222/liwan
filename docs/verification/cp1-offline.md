# CP1-T6 — ترقية وتشغيل بلا شبكة بائع

## ما ثبت

من `/Users/tariq/code/nasq`، داخل `sandbox-exec` يرفض كل شبكة غير loopback:

```text
sandbox-exec -f "$PROFILE" env PYTHONDONTWRITEBYTECODE=1 \
  /Users/tariq/code/odoo/.venv/bin/python \
  .worktrees/cp1-commercial-mode/tools/check_cp1_scratch.py offline
```

النتيجة: exit 0.

1. فحص egress قبل التشغيل أعاد `URLError` على `example.com`.
2. تثبيت الوحدات الست من baseline `d194f93f` على scratch UUID.
3. ترقية `-u` إلى كود CP1 بتصنيف `non_saas` صريح ومسح cutoff مصرح. التصنيف الناتج `non_saas` وبلا `valid_until`، والحالة `active`.
4. بعد الترقية، قراءة مشروع محلي و`/me` نجحتا بلا `NASQ_COMMERCIAL_CONFIG` إضافي في عملية الأعمال، و`self_service_available=false`.

القواعد والملفات المؤقتة أُزيلت مع الـrunner. لم تُمس `odoo19`.

## ما لم يثبت

- لا جلسة متصفح ولا كتابة PMO بقدرة موظف. القراءة تمت عبر ORM لمشروع أُنشئ بـsudo ثم قُرئ بالمستخدم.
- لا CI السحابي، ولا صورة Docker، ولا تزويد Compose حي.
- لا حجب egress على نشر مستضاف. الحجب هنا sandbox محلي للعملية فقط.
- لا مراجعة مستقلة، ولا دمج.

CP1 ليست جاهزة للإطلاق. المتبقي قبل الدمج: مراجعة مستقلة، ثم تشغيل CI بعد تفويض الدمج.
