# مراجعة مستقلة لإصلاح F1

الحكم الحالي (t10، جولة 2): **pass**. F1-R1 مغلق. الحكم السابق في الأسفل تاريخي ولا يُعاد فتحه.

## جولة 2 — t10 على t9

- التاريخ: 2026-09-24.
- المراجع: `grok-review`. لم يُعدَّل مصدر. الفحص استدعاء قراءة فقط لـ`cli.main` ثم تشغيل اختبارات CLI والحدّ فقط.
- الشجرة: `/Users/tariq/code/nasq-team-saas-combined`.
- المهمة المراجعة: **t9** (repair round 2). النطاق: `tools/nasq_cli/cli.py` و`tools/test_nasq_cli.py`.

### الحكم

**pass.** الاستثناء في `cli.py:322` يُبقي رمزي المحوّل 2 و3، وغياب `error` لم يعد يرمي `KeyError`. تأكيد الحدّ ما زال 4 على نفس السيناريو. اختبارات CLI تغطي الحالات المطلوبة. تخطي `service.test.ts` في تشغيل control بلا env ليس قبول PostgreSQL.

### إغلاق F1-R1

| الحالة | رمز المحوّل | رمز `cli.main` | stderr |
|---|---|---|---|
| `status=error` / `invalid_input` | 2 | 2 | `nasq-cli: invalid_input` |
| `status=error` / `descriptor_not_private` | 3 | 3 | `nasq-cli: descriptor_not_private` |
| `status=error` / فشل عملية | 5 | 5 | `nasq-cli: adapter_failure` |
| `status=conflict` بلا `error` | 4 أو 0 | 4 | `nasq-cli: conflict` |
| `status=needs_intervention` بلا `error` | 6 أو 0 | 6 | `nasq-cli: needs_intervention` |
| parser (`health --json` بلا target) | — | 2 | `nasq-cli: invalid_input` |

لا `Traceback` ولا تسريب لـ`secret-detail` في أي صف. المصدر: الشرط `exit_code not in (EXIT_INVALID_INPUT, EXIT_AUTHORIZATION)` قبل إعادة التعيين، ثم `payload.get('error')` مع اسم الحالة إن غاب الرمز (`cli.py:322-331`).

الاختبارات في `test_nasq_cli.py:130-151` تمر عبر `cli.main`: 2 و3 يبقيان، و`conflict` بلا `error` يخرج 4 وstderr هو اسم الحالة فقط. تشغيل مستقل: `python3 -B -m unittest discover -s tools -p 'test_nasq_cli.py'` → 30 اختبارًا، OK. الحدّ: `adapter-boundary.test.ts:161` ما زال `toBe(4)`، وإعادة تشغيل الملف عبر subprocess الحقيقي نجحت 1/1 في 349ms.

### حدود لا تُدّعى

- لم أُعد `npm test` ولا ruff ولا مجموعة control كاملة في هذه الجولة. تسجيل t9 (309 tools، 178 contracts، 864 web، ruff نظيف، diff-check نظيف) هو دليل المنفّذ، لا إعادة تحقق مستقلة.
- `npm -w apps/control-plane run test` بلا `CONTROL_TEST_DATABASE_URL` يتخطى `service.test.ts`. ذلك ليس قبول تكامل. الدليل الحي يبقى t3/t4 على scratch أُسقطت.
- هذا ليس قبول SaaS ولا نشرًا ولا commit.

---

## جولة 1 — t8 على t7 (تاريخي، needs_revision، أُغلق في الجولة 2)

- التاريخ: 2026-09-24.
- المراجع: `grok-review`. لم يُعدَّل أي مصدر. الفحص الحي كان استدعاءً للقراءة فقط عبر `cli.main` داخل العملية، بلا كتابة ولا قاعدة ولا Docker.
- الشجرة: `/Users/tariq/code/nasq-team-saas-combined`، HEAD ما زال `abde67b6` بلا commit.
- المهمة المراجعة: **t7** (repair، attempt 2). الملفات: `tools/nasq_cli/cli.py`، `tools/test_nasq_cli.py`، `apps/control-plane/src/__tests__/adapter-boundary.test.ts`.

## الحكم

**needs_revision.** إصلاح غياب `error` صحيح لحالة `status` المتعارضة، وتأكيد الحدّ صار 4. لكن `cli.py` يعيد كتابة رمز المحوّل من حالة الإيصال، فيحوّل رفض الإدخال (2) ورفض التفويض (3) إلى 5 على مسار الـCLI الحقيقي. اختبارات الوحدة لا ترى ذلك لأنها تستدعي الـadapter seam لا `cli.main`. لا يُقبل الإصلاح على هذا الشكل، ولا يُحتسب skip قبول تكامل.

## ما أُغلق من F1

| البند | الحكم | الموقع |
|---|---|---|
| لا `KeyError` ولا traceback عند غياب `error` | مغلق للحالة المختبرة | `cli.py:327-331` يستخدم `payload.get('error')` ثم اسم الحالة. |
| إيصال `status=conflict` بلا `error` يخرج 4 | مغلق | فحص قراءة فقط: المحوّل 4 → الـCLI 4، stderr = `nasq-cli: conflict`، بلا `Traceback`. |
| إيصال `needs_intervention` بلا `error` يخرج 6 | مغلق في الفحص، غير مغطى باختبار | نفس الفحص: 6 بلا traceback. اختبار CLI الجديد لا يمرّر إيصالًا بلا حقل `error`. |
| لا تسريب لمحتوى الرسالة | مغلق في الفحص والاختبار | `secret-detail` لا يظهر في stderr؛ الاختبار في `test_nasq_cli.py:113-128` يثبت ذلك عندما يوجد `error`. |
| تأكيد الحدّ لم يعد 1 | مغلق | `adapter-boundary.test.ts:161` أصبح `toBe(4)` على نفس سيناريو `status=conflict`، مع بقاء digest و`operation=tenant.create` و`policy_verified=false` وno-write. |
| parser يبقى 2 | سليم | الاستثناء عند `stage==parser` لا يُعاد تعيينه (`cli.py:322`). فحص: `health --json` بلا target يخرج 2. |

## العيب المفتوح

**F1-R1 — high.** `tools/nasq_cli/cli.py:322-323`.

بعد `run()` يعيد الرمز الذي أعاده المحوّل، ثم:

```python
if status in status_codes and payload.get('stage') != 'parser':
    exit_code = EXIT_CODES[status_codes[status]]
```

`managed_adapter` يضع `status='error'` لكل رفض ليس conflict ولا needs_intervention، ويعيد رمزه الحقيقي (`managed_runtime.py:830-839`). الخريطة الموثّقة في الاختبار `test_t48` هي: إدخال غير صالح = 2، تفويض = 3، تعارض = 4، انقطاع = 6. إعادة الكتابة تجعل كل `status=error` يخرج 5.

فحص قراءة فقط على الشجرة الموحدة (`PYTHONPATH=tools`، بلا كتابة):

| الحالة | رمز المحوّل | رمز `cli.main` | stderr |
|---|---|---|---|
| `status=error` / `invalid_input` | 2 | **5** | `nasq-cli: invalid_input` |
| `status=error` / `descriptor_not_private` | 3 | **5** | `nasq-cli: descriptor_not_private` |
| `status=conflict` بلا `error` | 4 | 4 | `nasq-cli: conflict` |
| `status=needs_intervention` بلا `error` | 6 | 6 | `nasq-cli: needs_intervention` |

الأثر: عقد CP0 (§11 في رأس `cli.py`) الذي يفصل 2 و3 عن 5 مكسور على المسار الذي يستدعيه العامل (`python -m nasq_cli.managed_runtime`). `test_managed_runtime.py` يستدعي `managed_adapter` مباشرة، لذلك 64 اختبارًا تبقى خضراء وترى 2/3. اختبار CLI الجديد (`test_nasq_cli.py:105-128`) يمرّر إيصالًا يحمل `error` ورمزًا مساويًا للتوقع أصلًا، فلا يثبت شكل F1 الأصلي ولا يحمي 2/3. العامل يعامل أي رمز ≠ 0 كفشل مغلق في مسار التحقق، فلا خطر تنشيط؛ العيب هو ضياع التمييز الموثّق بين رفض الإدخال ورفض التفويض وفشل العملية.

الإصلاح اللازم، خطوة واحدة: لا تستبدل رمز المحوّل عندما يكون 2 أو 3. أبقِ رمز المحوّل كما هو، واطبع `error.code` فقط إن وُجد؛ إن غاب فاستخدم اسم الحالة (`conflict` / `needs_intervention`) دون قلب 2/3 إلى 5. أضف حالتي CLI: إيصال `status=error` برمز محوّل 2 يبقى 2، وبرمز 3 يبقى 3، وحالة `conflict` بلا حقل `error` تخرج 4 بلا traceback. لا تُبقِ إعادة الكتابة العامة.

نص قبول t7 طلب `error/failed→5`. ذلك أوسع من عيب F1، وهو سبب هذا الكسر. التضييق أعلاه هو الإصلاح، لا توسيع الخريطة.

## ما لا يُعاد فتحه

- A-1 وC-1 وR1 الأصلي (KeyError على conflict) لا تُعاد. الجزء المغلق من F1 يبقى مغلقًا.
- `policy_verified=false` والحجر لم يتغيرا في هذا الإصلاح. `managed_runtime.py` خارج النطاق ولم يُمس.
- F2 (نقل fixtures) وF3 (تغطية العامل end-to-end) خارج هذا الإصلاح.

## حدود الأدلة

- لم أُعد تشغيل `npm test` ولا مجموعة control-plane ولا ruff في هذه المراجعة. أرقام t7 (CLI 28، adapter 64، control 65 مع skip، npm test) هي تسجيل المنفّذ، لا إعادة تحقق مستقلة.
- `npm -w apps/control-plane run test` بلا `CONTROL_TEST_DATABASE_URL` يتخطى `service.test.ts`. ذلك ليس قبول PostgreSQL. دليل التكامل الحي يبقى t3/t4 على scratch أُسقطت، ولم يُعاد هنا.
- فحص الخروج أعلاه يثبت سلوك `cli.main` الحالي فقط. ليس دليل نشر ولا قبول SaaS.
