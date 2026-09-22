> Historical checkpoint. The current operational entry and evidence are documented in [2026-09-23-vendor-workspace.md](2026-09-23-vendor-workspace.md). Legacy adapter mutations now fail closed.

# CP2-T4 — محوّلات التشغيل خلف `cli.main(adapter=...)`

## النطاق والحالة

الشريحة الرابعة من CP2 على شجرة العمل، و`main` عند `abc2400e`. الحزمة غير
ملتزمة: `tools/nasq_cli/` و`tools/test_nasq_cli.py` و
`tools/test_nasq_cli_adapters.py` غير متتبعة. لا commit ولا merge ولا push
ولا deploy. لم تُمس قاعدة `odoo19` ولا أي قاعدة حية في هذا الدليل.

المدخل العاري `python -m nasq_cli` يبقى بلا منفّذ. `preflight` هناك
`validated_input` مع `execution_ready: false`، وبقية الأوامر تخرج 5
`operation_not_wired`. اختبار `test_default_entry_stays_unwired_in_cp2_t4`
يثبت أن وجود `adapters.py` لا يوصّل هذا المدخل. مدخل التنفيذ هو
`python -m nasq_cli.adapters`، ويحقن `deploy_adapter`.

ما يوصله المحوّل: `tenant.inspect` و`tenant.preflight` و`health` قراءة،
و`tenant.entitle` لطفرته الوحيدة على هدف `scratch`. `backup` و`restore`
و`upgrade` تبقى `operation_not_wired` بخروج 5، لأن CP0 §11 يمنع إعلان
النجاح بلا receipt، والإيصالات والأقفال والـfencing هي CP2-T5.

- لا تنفيذ لـ`provision.sh`، ولا `tenant create/suspend/resume/export`.
- لا لقطة golden، ولا receipts، ولا locks، ولا fencing، ولا عامل retry.
- لا محرّر استحقاق لمخطط الميزات. `entitle` لا يكتب `features` ولا `status`
  ولا `commercial_mode`.
- لا طفرة على قاعدة عميل. اسم `odoo19` مرفوض قبل أي استدعاء.

المصادر: `docs/superpowers/specs/nasq-cp0-commercial-contracts.md` §11،
و`odoo-addons/nasq_platform/commercial_config.py`، و
`odoo-addons/nasq_platform/models/tenant_profile.py`.

## الملفات

| الملف | الدور |
|---|---|
| `tools/nasq_cli/adapters.py` | المحوّل: مخزون محلي، قراءة `psql`، تصنيف، وكتابة ORM المحروسة |
| `tools/nasq_cli/cli.py` | السطح السابق؛ `preflight` يصل إلى المحوّل إن مُرّر |
| `tools/nasq_cli/__main__.py` | المدخل العاري: `cli.main()` بلا محوّل |
| `tools/test_nasq_cli_adapters.py` | 16 اختبارًا بمنفّذ محقون، بلا `psql` ولا `odoo-bin` ولا شبكة |
| `docs/verification/cp2-t4-adapters.md` | هذا التقرير |

## المخزون والرفض

لا هدف افتراضي ولا قاعدة ولا مضيف ولا منفذ داخل الوحدة. الهدف يُحل من
`NASQ_CLI_INVENTORY`: مسار مطلق، حد 16 KiB، ومفاتيح `version` و`targets`
فقط. غياب الملف أو هدف غير معروف خروج 2.

اسم القاعدة يجب أن يطابق `^[A-Za-z][A-Za-z0-9_]*$`، ويُرفض إن كان
`odoo19` أو `production` أو `prod` أو `postgres` أو `template0` أو
`template1` حرفيًا أو كوحدة بين حدود `_`. هدف `scratch` يجب أن يحتوي اسم
قاعدته على `scratch`. الرفض خروج 3 `target_forbidden` وقبل أي `psql` أو
shell. أسرار `PGPASSWORD` لا تُنسخ إلى JSON.

## entitle

الكتابة الوحيدة هي مسح `valid_until` حين يقول `load_classification`
`clear_valid_until`. قبلها:

- هدف `customer` خروج 3. التحويل بين `saas` و`non_saas` خروج 3، لأن
  `tenant_profile.write()` يجعل النمط غير قابل للتغيير.
- `expected_revision` المختلف عن `policy_revision` خروج 4.
- ملف سياسة ليس ملك المشغّل، أو قابل للكتابة من المجموعة أو العالم، خروج 2
  وقبل التصنيف.
- وحدات في `to upgrade` أو `to install` أو `to remove` خروج 6، ولا يُفتح
  shell. تحميل registry الفاشل في Odoo يستدعي `reset_modules_state` ويثبّت
  تلك الحالات؛ رفض الفتح هو الحد المتاح بلا تعديل Odoo.

إن لزم المسح، الأمر قائمة argv:

```text
odoo-bin shell --no-http --workers=0 --max-cron-threads=0 --http-port=8179 -c <conf> -d <database>
```

السكربت يذهب إلى stdin، بلا اسم قاعدة ولا جسم سياسة. يستورد
`OPERATOR_CONTEXT` من `entitlement_service`، يكتب عبر السياق الموثوق، ثم
`env.cr.commit()`. هذا الالتزام ضروري: `odoo/cli/shell.py` يعمل
`cr.rollback()` بعد stdin، فيضيع المسح بغيره. مراجعة التعارض تُعاد داخل
السكربت قبل الكتابة. فشل العملية أو غياب سطر `NASQ_ENTITLE_RESULT` خروج 5
و`changed` ليس true. ذيل stderr يُكتب إلى stderr فقط؛ رسالة JSON ثابتة حتى
لا ينتقل host أو user إلى stdout.

مطابقة السياسة أصلًا تخرج 0 و`changed: false` بلا shell.

## ما لا يثبته هذا الدليل

الاختبارات تحقن المنفّذ. لا يوجد هنا تشغيل `psql` أو `odoo-bin` على قاعدة
scratch حقيقية، وبالتالي لا إثبات حي لمسح `valid_until`. لا إثبات تزويد،
ولا ترقية، ولا استعادة، ولا نشر، ولا CI سحابي.

## دليل التحقق

شُغّل من جذر المستودع في هذه الجلسة، و`PYTHONDONTWRITEBYTECODE=1`:

```text
PYTHONPATH=tools python3 -B -m unittest discover -s tools -p 'test_nasq_cli.py'
  Ran 23 tests ... OK
PYTHONPATH=tools python3 -B -m unittest discover -s tools -p 'test_nasq_cli_adapters.py'
  Ran 16 tests ... OK
python3 -B -m unittest discover -s tools -p 'test_*.py'
  Ran 186 tests ... OK
ruff check --no-cache tools/nasq_cli tools/test_nasq_cli.py tools/test_nasq_cli_adapters.py
  All checks passed!
python3 -B tools/catalog_check.py
  CATALOG_OK solutions=1
```

## المتبقي

1. CP2-T5: receipts وlocks وfencing، وبعدها فقط توصيل `backup` و`restore`
   و`upgrade`، وفتح `entitle` لهدف customer.
2. تشغيل scratch حي يثبت مسح `valid_until` ثم قراءة الصف بعده. ليس في هذا
   الدليل.
3. CP2-T6: نص تشغيل scratch وتصميم لقطة golden.
