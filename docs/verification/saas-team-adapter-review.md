# مراجعة شريحة adapter — t7

**الحكم: needs_revision.** ليس قبول تكامل، وليس قبول تشغيل.

المراجع لم يعدّل source. الأساس `abde67b64155250f015b8ad213c26609532a124c`. العقد: `docs/superpowers/specs/saas-team-batch-contract.md`. التحقق المستقل في `docs/verification/saas-team-batch-verification.md` أُعيدت قراءته ثم فُحص المصدر؛ أرقام الاختبارات ليست الحكم.

## ما ثبت

- `journal.py` و`payload_digest` لم يتغيرا في هذه الشريحة. القراءة مرة واحدة في `_private_bytes` ثم تُستخدم البايتات المحفوظة؛ لا إعادة قراءة للملف داخل حساب البصمة.
- نفس البايتات بمسار مختلف replay، والبايتات المختلفة بنفس `request_id` conflict. `policy_verified=false` على نجاح status، والحجر لا يُرفع، وstatus لا يستدعي runner/probe.
- `--policy-bytes-file` خاص بـstatus. scratch لا يُجبر على هذا المدخل.
- t6 أعاد `test_managed_runtime.py` (64) و`test_nasq_cli.py` (27) وruff و`git diff --check` بنجاح. هذا دليل وحدة فقط. لا يثبت استدعاء العامل الحقيقي للمحوّل.
- بصمة الوصف: `descriptor_digest` في Python و`canonicalJson` في العامل أنتجتا نفس `sha256:0ef2774d…f21fc4` لوصف اجتاز `validate_descriptor`. ادعاء F-8 بأن التمثيل القانوني يختلف **لم يتأكد** على هذا الوصف. بايتات ملف المجلة ما زالت تشمل `descriptor_digest` بينما `lane.descriptorBytes` تحذفه؛ العامل لا يمرر buffer الوصف إلى `payload_digest`، فالاختلاف كامن لا فشلَ تحققٍ مثبتًا.

## العيب

| id | الشدة | الموقع | الأثر | الإصلاح |
|---|---|---|---|---|
| A-1 | high | `tools/nasq_cli/managed_runtime.py:161` و`:719` | إيصال status الناجح يضع `operation` من أمر البحث (`status`). العامل عند `worker.ts:252` يرفض الإيصال إلا إذا كان `operation === tenant.create`. كل create مُدار ناجح يُحجر `receipt_unverified`. الفشل مغلق، لكنه يكسر واجهة التحقق. اختبارات العامل تستخدم double يعيد `tenant.create`، لذلك لا ترى العيب. | اجعل `operation` في إيصال status هو عملية الصف المحفوظة `tenant.create`، لا أمر CLI. أضف اختبارًا يثبت ذلك ويبقي `policy_verified=false` وعدم الكتابة. |

لا عيب آخر في هذه الشريحة يلزم إصلاحه قبل إعادة المراجعة. F-1 وF-2 ملك control وتُحكم في t8.
