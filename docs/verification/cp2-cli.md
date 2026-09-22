> Historical checkpoint. The current operational entry and evidence are documented in [2026-09-23-vendor-workspace.md](2026-09-23-vendor-workspace.md). Legacy adapter mutations now fail closed.

# CP2-T3 — محرك nasq-cli: العقد فقط

## النطاق والحالة

الشريحة الثالثة من CP2 على `main`. تنفّذ **سطح الأوامر**: المحلل، التحقق المحلي من
المدخلات، خريطة أكواد الخروج، ومخرج JSON واحد. لا تنفّذ أي عملية.

- لا Odoo، لا قاعدة بيانات، لا شبكة، لا `subprocess`، ولا كتابة خارج stdout.
- لا `tenant create`، لا `suspend/resume`، لا `export`، ولا لقطة golden.
- طبقة التنفيذ (adapters لتغليف `provision.sh` والاستعادة) تبقى **CP2-T4**.
- لا commit/merge/push/deploy. لم تُمس `odoo19` ولا أي قاعدة بيانات.

المصادر: `2026-09-19-nasq-distribution-models-design.md` §7.5، و`nasq-cp0-commercial-contracts.md` §11.

## الملفات

| الملف | الدور |
|---|---|
| `tools/nasq_cli/cli.py` | المحلل + التحقق + عقود المخرجات وأكواد الخروج |
| `tools/nasq_cli/__init__.py` | واجهة الحزمة |
| `tools/nasq_cli/__main__.py` | `PYTHONPATH=tools python3 -B -m nasq_cli ...` |
| `tools/test_nasq_cli.py` | 23 اختبارًا لعقد السطح |
| `docs/verification/cp2-cli.md` | هذا التقرير |

## سطح الأوامر كما في CP0 §11

```text
nasq-cli tenant inspect   --target <id> --json
nasq-cli tenant preflight --target <id> --policy-file <local> --json
nasq-cli tenant entitle   --target <id> --policy-file <local> --expected-revision <n> --request-id <id> --json
nasq-cli health           --target <id> --json
nasq-cli backup           --target <id> --request-id <id> --json
nasq-cli upgrade          --target <id> --release <local> --request-id <id> --json
nasq-cli restore          --target <id> --backup-id <id> --approval-id <id> --request-id <id> --json
```

الأعلام مطابقة للعقد حرفيًا: `inspect` و`health` قراءة فقط بلا `request-id`،
و`preflight` يتحقق من مدخل محلي بلا `request-id`، والأوامر المتغيّرة تحمل `request-id`.

## أكواد الخروج المعتمدة

| الكود | المعنى |
|---|---|
| 0 | نجاح العملية المعلنة فقط |
| 2 | `invalid_input` |
| 3 | `forbidden` (محجوز، معيّن ومختبَر) |
| 4 | `conflict` (محجوز، معيّن ومختبَر) |
| 5 | `operation_failed` |
| 6 | `needs_intervention` (محجوز، معيّن ومختبَر) |

`EXIT_CODES` هو المصدر الواحد؛ والاختبار يثبّت قيمه الست.

## القرارات المتخذة

1. **`preflight` لا يدّعي جاهزية تنفيذ.** يتحقق من المدخل المحلي ويعيد
   `status: validated_input` مع `execution_ready: false` وملاحظة أن مراجعة اللقطة
   والتعارضات تحتاج الـadapter. مراجعة snapshot الحيّة ليست في هذه الشريحة، ولا يجوز
   لـpreflight أن يعلن نجاح تنفيذ.
2. **العملية غير الموصولة تُعلن ولا تتظاهر.** بلا adapter يعيد الأمر
   `status: not_wired` و`error.code: operation_not_wired` بخروج 5 و`changed: false`.
   البديل — إرجاع 0 مع "parsed" — كان سيوهم بأن العملية جرت.
3. **`--target` معرّف مخزون محلي، لا هدف اتصال.** يُرفض URL أو مسار أو سلسلة اتصال أو
   `odoo19`، ولا يوجد هدف افتراضي؛ وغياب `--target` خطأ إدخال.
4. **لا صدى للقيم في الرسائل.** argparse كان يطبع الوسائط غير المعروفة حرفيًا، فيتسرب
   سرّ مكتوب بالخطأ إلى stdout. الآن تُعرض أسماء الأعلام فقط
   (`unrecognized arguments: --password`)، وقيم الهدف/المعرّفات لا تُصدَّر في أي رسالة.
   هذا سلوك مطلوب في CP0 §11 («لا كلمات مرور أو access tokens»).
5. **ملف السياسة محلي ومحدود.** مسار مطلق، ملف عادي موجود، وبحد `POLICY_MAX_BYTES`
   (16 KiB) مطابقًا لسقف مدخل التصنيف في `commercial_config.py`. لا تحميل URL ولا تمرير shell.
6. **JSON واحد على stdout وسجل منقّح على stderr.** كل نتيجة — نجاحًا أو فشلًا — وثيقة
   JSON واحدة؛ و`--help` وحده يخرج 0 بلا JSON.

## ما لم يُنفَّذ (حدود صريحة)

- **لا adapter ولا عملية حقيقية:** `run(args, adapter=...)` هو المنفذ الوحيد، ولا
  `adapters.py` في الحزمة، واختبار يثبت غيابه.
- **لا قراءة snapshot ولا كشف تعارضات:** `preflight` هنا تحقق مدخلات فقط.
- **لا تحقق من مخطط سياسة الميزات:** قواعد `features/limits` تحتاج مخطط السياسة
  المعتمد، ولم أخترعه. المتوفر الآن: المسار والحجم والنوع.
- **لا تكامل مع `commercial_config.py`:** استدعاء `load_classification` يحتاج
  `valid_until` الفعلي من القاعدة، وهو قراءة قاعدة تخص CP2-T4.
- **لا receipts ولا locks ولا fencing:** CP2-T5.

## دليل التحقق

```text
PYTHONPATH=tools python3 -B -m nasq_cli tenant preflight --target install_demo \
  --policy-file /tmp/nasq_cli_demo_policy.json --json      # validated_input، exit 0
python3 -B -m unittest discover -s tools -p 'test_nasq_cli.py' -v   # 23 اختبارًا OK
python3 -B -m unittest discover -s tools -p 'test_*.py' -v          # 170 اختبارًا OK
ruff check --no-cache tools/nasq_cli tools/test_nasq_cli.py        # All checks passed
python3 -B tools/catalog_check.py                                  # CATALOG_OK solutions=1
```

من الأمثلة المختبَرة: كل أشكال الأوامر السبعة تُحلَّل إلى أمرها الصحيح؛ علم غير معروف
وسرّ مكتوب خطأً يخرجان 2 بلا صدى للقيمة؛ `https://…` و`user@host/db` و`odoo19` مرفوضة
كهدف؛ مسار سياسة نسبي أو غائب أو أكبر من 16 KiB مرفوض و16 KiB بالضبط مقبول؛
`--expected-revision` يرفض `-1` و`x` و`1.5` ويقبل 0؛ و`restore` بلا `--backup-id`
أو`--approval-id` مرفوض.

## المتبقي

1. CP2-T4: adapters إلى التغليف القائم، وقراءة snapshot/valid_until، وتكامل
   `commercial_config`.
2. CP2-T5: receipts وlocks وfencing وretry.
3. CP2-T6: نص تشغيل scratch وتصميم لقطة golden.
4. `tenant create/suspend/resume/export` وصفحات البائع (CP3/CP4).

## حدود الدليل

- هذا عقد سطر أوامر مختبَر محليًا. لا يثبت أي عملية تزويد أو ترقية أو استعادة، ولا
  نشرًا، ولا نتائج CI سحابية، ولا صلاحيات بيئة حقيقية.
