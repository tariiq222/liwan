# مراجعة شريحة control — t8

**الحكم: needs_revision.** ليس قبول تكامل. PostgreSQL المتخطى ليس نجاحًا.

المراجع لم يعدّل source. العيب A-1 في شريحة adapter منفصل: العامل هنا يطابق `operation` مع `tenant.create` عند `worker.ts:252`، وهذا صحيح لهذه الشريحة.

## ما ثبت

- مسار واحد `resolveTargetLane` يُستخدم للإدراج والتنفيذ. scratch يبقى على `nasq_cli.operator`، وcompose-local على `nasq_cli.managed_runtime` مع نفس ملف البايتات في استدعاء status الداخلي.
- create المُدار يُجبر `policy_verified=false` و`deployment_ready=false` ويوسم `_control_lane=managed`. لا يصبح `active` من `succeeded` وحده، و`observed_policy` لا يُنسخ من desired في هذا المسار.
- health لا يرفع الحجر. `non_saas` يبقى مرفوضًا على entitle. لا مصالحة جديدة.
- فروع `status` في `http.ts:161` و`worker.ts:161` و`:238` غير قابلة للوصول: المخطط لا يحوي نوع `status`. لا تسريب منها اليوم. حذفها تنظيف، لا شرط قبول.
- `publicReceipt` يرفض المسارات المطلقة. النمط ليس `tgt_` الصارم، لكن الهدف المُدار مقيّد قبل ذلك. ليس عيب قبول.
- t6: 62 اختبارًا نجحت وملف PostgreSQL تُخطي. دليل وحدة فقط.

## العيب

| id | الشدة | الموقع | الأثر | الإصلاح |
|---|---|---|---|---|
| C-1 | medium | `apps/control-plane/src/db.ts:52-54` | إعفاء scratch يستخدم `result->>'deployment_ready'='false'`. المفتاح الغائب أو غير البولياني يجعل الشرط NULL، و`NOT (NULL)` يستبعد الصف فيُقرأ كمعفى. العقد §4 يمنع ذلك. الوسم `_control_lane` لا يغلق هذه الحالة. | اشترط `jsonb_typeof(result->'deployment_ready')='boolean'` و`result->'deployment_ready'='false'::jsonb` مع بقية شروط scratch فقط، وأضف اختبار مسند للغائب وغير البولياني. |
