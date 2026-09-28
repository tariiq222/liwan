# قبول إنشاء عميل SaaS محلي حسب الكتالوج

## الحكم الحالي

**نجحت تجربة إنشاء العميل عبر محوّل compose-local الحقيقي** في `codex/managed-saas-acceptance`، المبني على main عند `d780862e468e027286374ecebb9643f1490cc9e6`. هذا قبول محلي للشريحة وليس نشرًا أو اعتمادًا إنتاجيًا. اكتملت المراجعة المستقلة بنتيجة scoped pass دون ملاحظة جوهرية في نطاق الإنشاء والإثبات؛ نجح فحص control-plane الأوسع بعد إصلاح fixtures والتمييز بين رفض Docker context قبل الأثر وبين نشر غير مكتمل.

## تجربة النجاح

الأمر: `PYTHONPATH=tools python3 -B tools/managed_local_acceptance.py`، المهمة `bash-14`، **exit 0**.

| حقل | قيمة مثبتة |
|---|---|
| Target | `tgt_local_54b24f06` |
| Compose project | `nasq-accept-54b24f06` |
| Database | `nasq_scratch_54b24f06` |
| Operation | `op_7ac14c1a999141e2ac2e650c1f4e6909` |
| Request | `96bf5ac9-7678-43e0-8740-f8d26b2d0d58` |
| الحالة | `ok / provisioned` |
| بوابة الإثبات | `policy_verified=true / deployment_ready=true` |
| التصنيف | `saas / control_plane` |
| السياسة | `hr.enabled=true, users.limit=null, storage.limit_mb=null` |
| مراجعة السياسة | `1` |
| واجهة العميل المحلية | `http://127.0.0.1:53019/login` |
| منافذ التجربة | PostgreSQL `53017`، Odoo `53018`، proxy `53019`؛ كلها loopback |

الوحدات الخاصة المثبتة فعلًا: `nasq_core,nasq_platform,nasq_api,nasq_hr`. لم تثبت `nasq_pmo` أو `nasq_chat`. وجود `project` و`hr` و`cyan_meeting_minutes` بين تبعيات Odoo لا يعني اختيار ركائز Nasq غير المختارة.

## سلسلة الإثبات المنفّذة

1. كتالوج المصدر وبصمته، تركيب base+people وسياسة worker الافتراضية، قبل الأثر.
2. صورة مثبتة لكل خدمة، Compose محدود، موارد غير موجودة ومنافذ متاحة، Docker Unix socket محلي مثبت لكل عملية.
3. مطابقة أسرار الملفات الخاصة مع INI، وبصمات Compose وملفات RO وإعادة فحصها قبل كل أمر.
4. قاعدة جديدة فقط ثم انتظار TCP، وتثبيت الوحدات المختارة دون HTTP.
5. تطبيق السياسة تحت قفل singleton ومصدر موثوق وحالة أولية؛ commit واحد ثم **جلسة Odoo مستقلة read-only** تؤكد المصدر والوحدات والميزات والمراجعة.
6. تعيين كلمة مرور المسؤول البشري غير الافتراضية عبر helper Nasq المصرح، ثم **جلسة مستقلة read-only** تتحقق من hash الفعلي وترفض `admin`. السر لا يظهر في argv أو الإيصال.
7. تشغيل الخدمات ثم فحص الهويات الكاملة للحاويات والصور والمنافذ؛ branding مطابق مباشرة وعبر proxy وصفحة دخول Nuxt الفعلية.
8. إعادة الطلب نفسه بإيصال النجاح مع runner/probe/resolver ترفض أي استدعاء: نجحت دون آثار. status أعاد سياسة verified مطابقة. تغيير بايتات السياسة أعاد request_conflict؛ طلب إنشاء جديد للهدف provisioned أعاد lifecycle_conflict.

## الإخفاقات الحقيقية والإصلاحات

- `bash-11` خرج4، `conflict/preflight/changed=false`: parser يفترض Labels مفصولة بفواصل بلا فواصل داخل قيمها، وvolume rows الكاملة تتجاوز64KiB. أصلح الإسقاط إلى اسم وcompose-project فقط؛ لا قبول للخرج المبتور.
- `bash-12` خرج6، `initial_policy/quarantined`: Odoo الجديد يعيد حقل JSON غير المهيأ `False` لا `{}`. أضيف RED ثم إصلاح يقبل False حصريًا عند revision0 قبل التطبيق؛ readback لا يقبله.
- `bash-13` خرج6، `health/quarantined`: Compose ps يعيد ID مختصرًا افتراضيًا. أضيف `--no-trunc` بدل تخفيف شرط الهوية الكاملة. قراءة مستقلة لاحقة أثبتت السياسة revision1 وصحة الهدف، **لكن لم نغير إيصال الحجر أو نعلنه نجاحًا**.
- `bash-14` هدف جديد نجح بكامل المسار وإعادة الطلب.

## الموارد المحتفظ بها دون تنظيف

| Project | DB | الحالة الأصلية |
|---|---|---|
| `nasq-accept-243b7e2a` | `nasq_scratch_243b7e2a` | حجر عند السياسة؛ DB فقط دون خدمات عميل |
| `nasq-accept-fb7a5b30` | `nasq_scratch_fb7a5b30` | حجر عند الصحة؛ الخدمات تعمل، الإيصال لم يُعاد تصنيفه |
| `nasq-accept-54b24f06` | `nasq_scratch_54b24f06` | نجاح القبول المحلي |

ملفات المدخلات والأسرار محفوظة في مجلدات خاصة خارج المستودع، وليست مرفقات تسليم. مجلد النجاح: `/private/var/folders/17/rgg6yjtn60d3jf_3xszmvtw00000gn/T/nasq-managed-acceptance-_z3h1u52`. لا نسخ للأسرار إلى الوثائق. لا صلاحية ضمنية لتنظيف أي مورد.

## بوابة التحقق النهائية

- `PYTHONPATH=tools python3 -B -m unittest discover -s tools -p 'test_managed*.py'`: **246 passed**.
- `PYTHONPATH=tools python3 -B -m unittest test_nasq_cli_operator test_nasq_cli_scratch_guards`: **56 passed**.
- Ruff لكل managed modules/tests ومشغل القبول: **passed**.
- `npm -w apps/control-plane test`: **95 passed،7 ملفات ناجحة،ملف service.test.ts متخطى**؛ لا يُحتسب هذا الملف كاختبار خدمة ناجح.
- `npm -w apps/control-plane run build`: **tsc --noEmit passed**.
- `git diff --check`: **passed**.
- مراجعة Luna مستقلة للفرع الصحيح: **scoped pass**؛ لم تُعد تشغيل Docker، واعتمد إثبات التشغيل على سجل المنسق.
- اختبار الفشل الحقيقي لغياب/رفض local Docker context حافظ على `registered` دون تفعيل ودون طلب مصالحة: كانت الحالة الجديدة تحتاج إضافتها إلى predicate رفض ما قبل الأثر؛ RED ثم GREEN. لا قبول للهدف عند فشل السياق.
- التغطية الشاملة للمشروع غير مقاسة. نسب trace الجزئية في تقارير المكونات ليست branch coverage أو نسبة موحّدة للمشروع.

## حدود لا يُدّعى اجتيازها

- لم يُختبر تسجيل العميل عبر واجهة control-plane ثم worker وقاعدة control-plane حقيقية end-to-end. توجد اختبارات عامل وإيصالات وحدود subprocess؛ التجربة الحية أعلاه تستدعي المحوّل مباشرة.
- أوامر `tenant.inspect` و`health` المستقلة لم تُرقَّ لمسار المصالحة أو فحص حي عام؛ لا تعتبرها لوحات مراقبة مكتملة. هذه الشريحة تثبت الصحة **داخل إنشاء العميل**.
- تهيئة hash ليست إثبات تسجيل دخول كامل أو MFA أو وصول مستخدم عميل إلى جميع الصفحات. websocket/billing/entitle/backup/restore/upgrade خارج الشريحة.
- صورة proxy الإنتاجية تعذر بناؤها لأن `github.com/mholt/caddy-ratelimit@v0.2.0` لا وجود له. استُخدم Caddy2.11.4 الرسمي محليًا دون rate-limit ودون TLS؛ لم نعدّل اعتماد الإنتاج أو ندّع اجتياز بوابته.
- الضبط يفترض مشغلًا محليًا موثوقًا. بصمات الملفات تقلل تغير المدخلات لكنها لا تلغي فجوة زمنية دقيقة بين القراءة وDocker. PostgreSQL image مثبت في Compose لا في حقل descriptor مستقل.
- الأسرار المؤقتة قوية وتبقى في ملفات خاصة؛ كلمة مرور DB manager والمسؤول البشري واحدة في تجربة القبول فقط. لا سياسة لإدارة أسرار الإنتاج هنا.
- لم يحدث commit أو merge أو push أو deploy أو تنظيف؛ canonical main والخدمات السابقة و`odoo19` لم تُعدَّل.
