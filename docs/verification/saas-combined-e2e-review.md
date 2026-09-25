# مراجعة مستقلة لاختبار السلسلة الكاملة

الحكم الحالي (t18، جولة 2 على t17): **pass** ضمن العقد المعدّل. E2E-1 مغلق. F3 لمسار `deployment_incomplete` تبقى مفتوحة. الحكم السابق في الأسفل تاريخي.

## جولة 2 — t18

- التاريخ: 2026-09-24.
- المراجع: `grok-review`. لم يُعدَّل مصدر. أُعيد تشغيل ملف الاختبار فقط.
- المهمة المراجعة: **t17** بالعقد المعدّل، لا بشرط t15 الذي طلب create ناجحًا غير جاهز.
- الملف: `apps/control-plane/src/__tests__/worker-real-adapter.test.ts`.

### الحكم

**pass.** زراعة SQLite أُزيلت. المسار الثالث يمر `executeClaimed` إلى المحوّل الحقيقي، ويسجل رفض preflight مرة واحدة: `failed` / `preflight` / `preflight_unavailable`. لا `worker_error` ولا `active` ولا `needs_intervention`. الـdouble يكمل `BEGIN` ثم `COMMIT` بلا `ROLLBACK`. هذا ليس إثبات `deployment_incomplete`.

### ما طُبّق من العقد المعدّل

| المعيار | الحكم | الموقع |
|---|---|---|
| health وstatus عبر subprocess بلا `invokeAdapter` | مطبق | `:111-135`. `config` بلا seam. |
| إزالة الزراعة المضللة | مطبق | لا `sqlite3` ولا تحديث صف بعد الإنشاء. |
| create يثبت preflight fail-closed | مطبق | `:138-164`. النتيجة الوحيدة `status=conflict` و`stage=preflight` و`error.code=preflight_unavailable`. |
| كتابة نهائية واحدة بلا استثناء double | مطبق | `UPDATE operations` طولها 1، و`BEGIN`/`COMMIT` مرة، و`ROLLBACK` صفر، والمعاملة مغلقة. |
| F3 تبقى مفتوحة | مطبق في التسمية والنفي | اسم الاختبار يقول `deployment_incomplete remains unproven`، ولا تحديث tenant إلى `needs_intervention`. |

إعادة التشغيل المستقلة: 1 ملف، 3 اختبارات، EXIT=0، 318ms. المسار الثالث 64ms.

الرفض حقيقي: `preflight` يستدعي `probe('catalog_sha256')` (`managed_runtime.py:491`)، والمسبار الافتراضي يرفض كل فحص غير `port_in_use` بـ`preflight_unavailable` (`:859-872`) قبل أي runner. لا Docker ولا حقن مسبار.

### ما لا يُغلق

- **F3 تبقى مفتوحة.** العقد المعدّل لا يطلب إيصال `ok` مع `deployment_ready !== true`. ذلك مستحيل هنا بلا حقن مسبار، والاختبار لا يدّعيه.
- تخطي `service.test.ts` في مجموعة control بلا env ليس قبول PostgreSQL. لم أُعد `npm test` الكامل؛ أرقام t17 تسجيل المنفّذ.
- هذا ليس قبول SaaS ولا create ناجحًا ولا نشرًا. HD-4 ما زال نقلًا عند الدمج.

---

## جولة 1 — t15 (تاريخي، needs_revision، أُغلق E2E-1 في الجولة 2)

- التاريخ: 2026-09-24.
- المراجع: `grok-review`. لم يُعدَّل مصدر ولم تُشغَّل الاختبارات. الحكم من قراءة `worker-real-adapter.test.ts` و`worker.ts` و`process-group.ts` وأدلة t14.
- الشجرة: `/Users/tariq/code/nasq-team-saas-combined`.
- المهمة المراجعة: **t13**. الملف: `apps/control-plane/src/__tests__/worker-real-adapter.test.ts`.

## الحكم

**needs_revision.** المساران الأول والثاني يستدعيان المحوّل الحقيقي عبر subprocess ويثبتان `succeeded` و`receipt_unverified`. المسار الثالث لا يغطي «create غير جاهز دون active»: يزرع في SQLite إيصالًا لن يقرأه العامل، ثم يسقط في `worker_error`. لا يُغلق F3 بهذا الشكل، ولا يُحتسب skip قبول PostgreSQL.

## ما طُبّق

| المعيار | الحكم | الموقع |
|---|---|---|
| بلا `invokeAdapter` | مطبق | `config` في `:68` لا يحمل الـseam. الإنتاج يذهب إلى `runProcessGroup` (`worker.ts:142`). |
| subprocess حقيقي في المسارين الأولين | مطبق | `spawn` في `process-group.ts:19` لـ`python3 -B -m nasq_cli.managed_runtime` مع `PYTHONPATH=tools` و`NASQ_MANAGED_INVENTORY` و`NASQ_CLI_STATE_DIR`. |
| health → succeeded | مطبق | الاختبار `:107-116` يؤكد إيصال `ok` ثم `UPDATE operations` بحالة `succeeded`، وبلا `active`. |
| status غير مطابق → `receipt_unverified` | مطبق | `:119-131`. `operation_id` المزروع `op_` + 32 من `d` لا يطابق الصف الحقيقي، فيفشل الربط عند `worker.ts:240` قبل أي تفعيل. |
| PG doubles فقط، بلا Docker أو عميل | مطبق في البنية | `fakePool` لا يفتح قاعدة. create يفشل عند preflight قبل runner. |
| حدود t14 صادقة في التصنيف | جزئي | t14 يقول إن الإغلاق ليس create ناجحًا ولا تكامل PG. هذا صحيح، لكنه يصف المسار الثالث كحجر لنتيجة غير محسومة، وهو غير ما ينفذه الاختبار. |

## العيب المفتوح

**E2E-1 — high.** `apps/control-plane/src/__tests__/worker-real-adapter.test.ts:134-158`.

الاختبار يكتب في journal إيصالًا `status=needs_intervention` و`changed=true`، ثم يستدعي `executeClaimed` لـ`tenant.create`. العامل لا يقرأ ذلك الصف كإيصال التنفيذ. يستدعي المحوّل من جديد (`worker.ts:236`)، والمحوّل يعيد إيصال التعارض الأصلي: رمز 4 و`status=conflict` و`changed=false` (`managed_runtime.py:611` و`:793-794`). شرط التحقق الدائم (`worker.ts:244`) يشترط رمز 0 و`status=ok`، فلا يُستشار الصف المزروع. ثم `valid` كاذب، و`receipt.status` ليس `needs_intervention`، و`changed` ليس `true` (`worker.ts:261`)، فالحالة `failed` لا `needs_intervention`.

`finishClaim` بعد ذلك يستعلم `SELECT id FROM tenants ... FOR UPDATE` (`worker.ts:195`). الـdouble يعيد `{rowCount:1, rows:[]}`، و`transaction` يصل إلى `client.query('COMMIT')` (`db.ts:73`). الـdouble لا يعرّف `COMMIT`، فيرمي، ويبتلع `executeClaimed` الاستثناء ويسجل `worker_error` / `needs_intervention` (`worker.ts:277-278`). التأكيد `:155` ينجح لهذا السبب، لا لأن create غير الجاهز حُجر. والتأكيد `:158` يمر لأن `worker_error` لمسار mutation يحدّث المستأجر إلى `needs_intervention` (`worker.ts:209`). التأكيد `:156` ينفي `deployment_incomplete`، أي ينفي المسار المطلوب نفسه.

الأثر: معيار t13 الثاني غير مثبت. F3 لا تُغلق: مسار incomplete create الذي يجبر `policy_verified=false` و`deployment_ready=false` ويمنع `active` (`worker.ts:260-267`) لم يُمشَ. نجاح الاختبار يوثق سقوط الـdouble لا سلوك المحوّل.

الإصلاح اللازم، خطوة واحدة: احذف زراعة SQLite. اجعل create الحقيقي يعيد إيصالًا يستوفي `code===0` و`status==='ok'` و`deployment_ready!==true` (المسبار المفترض في الاختبار فقط، لا Docker)، ثم أثبت `needs_intervention` و`deployment_incomplete` و`policy_verified=false` وغياب `active`. أضف `COMMIT`/`BEGIN`/`ROLLBACK` إلى double الـclient حتى لا يبتلع `transaction` الخطأ. لا تُبقِ التأكيد الحالي.

## ما لا يُعاد فتحه

- F1 وA-1 وC-1 خارج هذا الاختبار. نقل HD-4 إلى شريحة control مسألة دمج، لا عيب في منطق المسارين الأولين.
- المساران الأول والثاني لا يُعاد فتحهما: health حقيقي، وstatus غير المطابق يُحجر قبل التفعيل.

## الحدود

- لم أُعد تشغيل الاختبار. حكم t14 (3/3) يصف تشغيلًا ناجحًا، لا صحة المسار الثالث.
- `service.test.ts` المتخطى في مجموعة control بلا env ليس قبول PostgreSQL.
- هذا ليس قبول SaaS ولا نشرًا ولا create ناجحًا على خدمة حية.
