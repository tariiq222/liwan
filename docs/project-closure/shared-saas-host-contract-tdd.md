# عقد Host→Tenant الأول — دليل شريحة معزولة

**الفرع:** `codex/managed-saas-acceptance` عند HEAD `d780862e468e027286374ecebb9643f1490cc9e6` مع تغييرات عمل سابقة غير ملتزمة. **النطاق:** دالة pure في `apps/web/server/utils/tenantHostResolver.ts` واختباراتها؛ لا ربط بـNuxt handler أو Caddy أو Odoo، ولا سجل هدف حي أو قاعدة حقيقية. المرجع [عقد الاستضافة](../superpowers/specs/webvue-shared-saas-and-sovereign-deployment.md) AC-01 (جزئيًا فقط).

| المرحلة | الأمر | النتيجة |
|---|---|---|
| RED | `npm -w apps/web test -- server/utils/__tests__/tenantHostResolver.test.ts` | ملف test يستورد resolver غير موجود؛ فشل compile/import متوقع بسبب تنفيذ مفقود، 0 test. |
| GREEN مبدئي | الأمر نفسه | 15 نجاح/فشل واحد: قيد tenantId منع fixture `tenant-a`؛ صُحّح التفريق بين معرف tenant واسم مورد DB/filestore. |
| GREEN | الأمر نفسه ثم `npm -w apps/web run lint` | 16/16 نجاحًا و`vue-tsc --build --noEmit` نجح. |
| بوابة عامة قبل المراجعة | `npm -w apps/web test && npm -w apps/web run lint && git diff --check` | 894/894 اختبارًا في 132 ملفًا وlint وdiff-check ناجحة؛ تحذيرات Vue في fixtures لا تعني إثبات متصفح. |
| RED ملاحظات المراجع | الاختبار الموجه بعد إضافة الحالات | 2 فشل مقصود: سجل ناقص/قيمة array مرّت بالـregex، وUnicode compatibility/newline في Host. |
| GREEN إصلاح المراجعة | الاختبار الموجه ثم lint | 18/18 نجاحًا و`vue-tsc` نجح. |
| بوابة نهائية بعد المراجعة | `npm -w apps/web test && npm -w apps/web run lint && git diff --check` | 896/896 اختبارًا في 132 ملفًا وlint وdiff-check ناجحة؛ تحذيرات Vue في fixtures لا تعني إثبات متصفح. |

يقبل resolver اسم Host حرفيًا وفق صيغة ASCII مبسطة، بعد case folding فقط، ويبحث snapshot كاملًا يرفض صفًا فاسدًا أو duplicate host/tenant/database/filestore. يُرجع tenantId وdatabase وfilestore للهدف المفعّل الوحيد؛ يعترض Host مجهولًا/ملتبسًا/مُعطّلًا/مزورًا مع عدة أمثلة لحقن المسار والترويسة والمنفذ. **ليس** شبكة ثقة كاملة: `Host: example:443` غير مدعوم حتى تقرر طبقة proxy إزالة المنفذ في الحدود الموثوقة؛ لا نستخدم هذه الدالة لاختيار DB في طلب فعلي حتى تصبح ملكية السجل ونسخته وتوثيق ingress والجلسة والـWS والـjobs محققة ومراجعة.

**ليست نتيجة إطلاق:** لا إثبات عزل زوجين حيين، فكيف بـ90 زوجًا بين عشرة عملاء؛ لا تثبيت DB أو دفع أو ملفات أو backup/restore أو حكومة offline في هذه الشريحة. لا commit/merge/push/deploy أو لمس عملاء وموارد قائمة. لا نسبة تغطية مقاسة.
