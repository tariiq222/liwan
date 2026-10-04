# الجزء C — الترحيل والقبول وجاهزية الإطلاق — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Steps use checkbox (`- [ ]`) syntax. Coordinator runs integrated verification and owns runtime/isolated resources. This plan does not authorize deployment or cleanup of existing resources.

**Goal:** نقل الموجود بأمان وإثبات رحلة SaaS التجارية على خدمتها الفعلية، ثم تحديد جاهزية تشغيلها للبيع بأدلة مستقلة عن المحاكاة.

**Architecture:** مهاجرات توسعية قابلة للاستئناف، snapshots وread models موثقة، اختبارات مستقلة للحساب والـSQL وOdoo والمتصفح والمزود، ثم قبول staging/سعة/تعافٍ بحدود رقمية معتمدة.

**Tech Stack:** PostgreSQL، Odoo 19، Docker Compose المعزول، Python lifecycle، Vitest/Playwright، Woodpecker الحالية، مزود sandbox ثم إنتاج مأذون.

**Spec:** [تصميم المنتج](../specs/2026-10-02-saas-commercial-product.md) و[الخطة الرئيسية](2026-10-02-saas-commercial-master.md)؛ العقود من الجزأين A وB.

## Global Constraints

- التحقق المحلي والبيانات التجريبية لا يثبتان الدفع الحقيقي أو السعة أو الإنتاج.
- الاختبارات مع قواعد وخدمات معزولة؛ يمنع الاختبار على `odoo19` أو تنظيف موارد الآخرين.
- الأسعار والشروط المنشورة وإصدارات الاشتراك والفواتير السابقة لا يعاد كتابتها.
- الحفاظ على non_saas والسياسات المحلية مستقلة عن فوترة SaaS.
- Odoo 19.0؛ المصدر الأصلي للقراءة فقط. نوسع الموديولات الموجودة ولا ننسخ أعمدة `project` أو `hr`.
- هذه خطة فقط؛ لا تتضمن تفويض commit أو merge أو push أو deploy أو حذف عمل قائم.

## Review Focus

1. عميل قديم بلا سعر مسجل: يبقى مستخدمًا لخدمته، ويوسم «يحتاج إعداد اتفاق تجاري»؛ لا تصنع له فاتورة صفرية أو دينًا — C1.
2. ترحيل يتوقف ثم يعاد: نفس النتيجة ونفس عدد الكيانات، ولا انحراف في policy/بيانات Odoo — C1.
3. استعادة نسخة قديمة تعيد features/branch IDs قديمة: التحقق والمصالحة قبل فتح المساحة وعدم مضاعفة الفرع أو الفاتورة — C2.
4. صور/مرفقات وروابط host/IDs صحيحة لشركة أخرى: المنع يظهر في API والواجهة والملف نفسه — C2.
5. backup أو module upgrade يوقف خدمة مشتركة: يقاس الأثر على عملاء آخرين، ولا نعدهم بعزل تشغيل أو RPO/RTO غير مثبت — C3.

### C1 — نقل الحزم والعملاء والتوافق

**الملفات الجديدة:** `apps/control-plane/src/commercial/legacy-mapping.ts`، مهاجرة `schema_014.sql` بعد إعادة حجز الرقم عند التنفيذ، `__tests__/commercial-migration.test.ts`، `tools/saas_commercial_migration.py`؛ `docs/verification/saas-commercial-migration.md`. **تعديل:** `db.ts`, `docs/migrations.md` وتوثيق التنفيذ. مهاجرات Odoo في addon المعني حسب version bump؛ لا تنشأ ملفات في core.

**يعتمد على:** A/B وعقود الأرقام المجمدة. **المخرج:** mapping قابل للتتبع من legacy package/catalog assignment إلى bundle/subscription التجاري، دون محو التاريخ أو اختراع بيانات.

- [ ] اختبار fixtures تمثل: عميل catalog-only، عميل package revision، حزمة مسودة/منشورة/مسحوبة، job قيد التنفيذ، non_saas، حدود0/null، عميل بلا بيانات فوترة.

```text
Before: tenant T -> package P, users=2, storage=2, projects=1, no price
After: same tenant/host/database/admin data and same effective policy;
       legacy mapping retained; commercial_setup_required=true;
       no issued invoice, no automatic payment, no price invented
Run migration again -> identical mapping/row counts and same source digest
```

- [ ] snapshot/schema inventory وعدّ الكيانات وpolicy hashes قبل النقل؛ dry-run يخرج تصنيفًا وعددًا وخطأ لكل صف غير قابل للنقل. لا يعدل بيانات العملاء أثناء dry-run.
- [ ] إضافة جداول وأعمدة اختيارية أولًا، backfill idempotent بمعرف مصدر ثابت؛ كل عميل غير مكتمل التسعير يستمر على applied policy الحالية إلى حين إعداد اتفاق واعتماده.
- [ ] نقل الحزمة المنشورة القديمة كتكوين تراثي صريح لا كحزمة جديدة عامة جاهزة للبيع تلقائيًا. المحافظة على private audiences/withdrawal والحصة الحالية وروابط package/release الأصلية.
- [ ] قراءة الموديل الجديد للأسماء والعرض بعد اكتمال mapping؛ legacy enrollment وإعادة job قديم يعملان طوال نافذة الانتقال؛ تمنع كتابة مزدوجة متنافسة. لا تسقط الأعمدة القديمة في التسليم الأول.
- [ ] run forward→interrupt→resume على نسخة scratch، ثم مقارنة counts/hashes وURLs والمرفقات والسياسات وتاريخ الفواتير/التدقيق. يثبت rollback للكود على البنية التوسعية أو استعادة موثقة إذا وقع أثر لا يمكن عكسه.
- [ ] إغلاق تقرير يحدد السجلات التي تحتاج إعدادًا تجاريًا يدويًا أو قرارًا؛ لا يعاملها النجاح العام للتشغيل على أنها مبيعة.

**القبول:** لا فقد بيانات أو صلاحيات أو وظيفة معتمدة، ولا فرض أسعار جديدة على عميل قائم؛ الترحيل قابل لإعادة التنفيذ والمراجعة.

### C2 — قبول الرحلة الكاملة

**ملفات جديدة:** `tools/shared_saas_lifecycle/commercial_acceptance.py`، `commercial_readback.py`، `commercial-journey.spec.mjs` بجانب `playwright.config.mjs` الحالي، `apps/web/e2e/saas-commercial.spec.ts` لاختبارات الواجهة المعزولة؛ `docs/verification/saas-commercial-integrated-acceptance.md` للأدلة. لا تحول mock Playwright إلى دليل Odoo live بوضع اسم مشابه.

**يعتمد على:** C1 واستقرار A/B. **البيئة:** Compose مخصص باسم `nasq-saas-commercial-acceptance` أو اسم فريد موثق، منافذ وvolumes وقواعد ودليل صور وبيانات scratch خاصة به، ومزود sandbox بمفاتيح اختبار. قبل التشغيل تحقق من عدم التصادم مع الخدمات الحالية. customer frontend يبنى shared وvendor frontend dedicated وفق الحراس الحالية؛ لا تعطل guard لبناء واحد.

**سيناريو البيانات المقرر:**

- شركة ألف: باقة تشمل المشاريع ومقرًا وفرعًا إضافيًا مجانيًا؛3 فروع إضافية، سعر الفرع500 لكل دورة معلنة → فرعان مدفوعان1000 قبل الضريبة؛ مسؤول شركة ومستخدم فرع واحد.
- شركة باء: باقة وحدود مختلفة وحزمة HR وأسعار خاصة؛ فرع إضافي مجاني وفق تخصيصها. لا تقبل اختيار الحزمة الخاصة بألف.
- إنشاء سجل ومرفق فريد لكل شركة وفرع، مع بصمة bytes محفوظة في دليل القبول. تواريخ الساعة الوهمية في محرك الفوترة محقونة، وليست تعديلًا لساعة الجهاز أو المزود.

| ID | السيناريو | الدليل اللازم للإغلاق |
|---|---|---|
| E01 | إنشاء حزمة من التطبيقات، تعديلها، اعتمادها ونشرها | record محفوظ، digest، متصفح ورفض unsupported feature |
| E02 | باقة بمدة وفوترة وأسعار وفروع | عرض صحيح للمدة والفترة والمشمول والاختياري، ورفض نشر ناقص |
| E03 | عرض العميل وتخصيصه | breakdown من الخادم؛0/null/الإرث واضحة؛ عميل آخر لا يتغير |
| E04 | اختيار/تأكيد اشتراك/دفع/تجهيز/دعوة/دخول | ربط quote→order→invoice→provider attempt→job→Odoo readback→browser login |
| E05 | الخدمات المشتركة والتطبيقات والحصص | مستخدمون وصلاحيات/هوية/بحث/مرفقات، app on/off، users/projects/storage بما فيها الحد0 وغير محدود |
| E06 | الفروع | المقر مجاني؛ الإضافي المجاني واحد؛ فرعان مدفوعان1000؛ branch bindings حقيقية |
| E07 | فرع وسط الدورة |500×15/31=241.94 قبل الضريبة وفق السياسة المقرّة؛ invoice والسعر القادم مطابقان |
| E08 | طلبات متزامنة/إعادة إرسال | آخر مجاني لا يمنح مرتين؛ لا فرع/فاتورة/تحصيل مزدوج؛ conflict يتبعه requote واضح |
| E09 | تغيير الحزمة/الباقة/الحد | معاينة فرق، نسخة هدف، تحقق الخدمة؛ رفض تخفيض غير آمن وحفظ السجلات والمرفقات |
| E10 | تغيير سعر عام وسحب حزمة | فاتورة/اتفاق قديم محفوظان؛ أهلية بيع جديد صحيحة وإعادة job قديم تعمل |
| E11 | الدفع والتجديد | نجاح/رفض/إلغاء/timeout/duplicate/out-of-order؛ invoice واحدة للفترة؛ past_due/مهلة حسب السياسة |
| E12 | عامل يتعطل قبل/بعد الأثر | استئناف بالobservation، لا success كاذب ولا بيانات ضائعة، وتعويض الدفع مسجل |
| E13 | عزل الشركات والفروع | منع API وملف وصورة وبحث وحالة/فاتورة وhost مزور؛ صلاحيات فرع لا تمنح الشركة الأخرى |
| E14 | نسخة واستعادة قاعدة ومرفقات | بصمات bytes/rows مطابقة، login وصلاحيات بعد الاستعادة؛ reconcile للاشتراك الحالي قبل الفتح |
| E15 | لوحة المدير والعميل صفحةً صفحة | حالات تحميل/فراغ/فشل/منع/نجاح، direct URL/refresh/back،390/768/1440،عربي/إنجليزي/RTL/keyboard |
| E16 | النقل وnon_saas | استمرار legacy وتطابق policy/history؛ non_saas يعمل دون اشتراك أو مزود دفع |

- [ ] كتابة اختبار browser يمر E01–E04 ثم readback يقارن IDs والحالات، ويوقف run إذا استبدلت API حقيقية بمحاكاة دون إعلان.
- [ ] إضافة E05–E10 مع طلبات API مباشرة بجانب المتصفح؛ toast success ليس دليل تغير Odoo، ولقطة الشاشة وحدها لا تثبت العزل.
- [ ] تنفيذ fault injection محدود E11/E12 مع ledger assertions؛ لا إعادة إنشاء بيئة كلما ظهر خلل حتى يضيع دليل الاستئناف.
- [ ] E13 بمستخدم محدود ومدير شركة وشركة ثانية؛ جرّب IDs الصحيحة المقروءة من fixture أخرى، لا IDs وهمية ترجع404 لأسباب غير العزل.
- [ ] E14 من backup فعلي database+filestore إلى target معزول؛ اختبار أن registry/policy/branch mapping متصالحة مع الاشتراك الحالي. استعادة نسخة قبل إضافة فرع تضع الفرع المدفوع في reconciliation ولا تفوتر فرعًا وهميًا أو تنشئ duplicate.
- [ ] حفظ الأوامر والخروج والعدد غير الصفري وSHA/runtime build IDs وساعات الدليل وصور محددة وأرقام الطلبات بعد تنقيح الأسرار. كل حالة PASS/FAIL/BLOCKED مع سبب ونوع دليل.
- [ ] إعادة اختبار الحالات المتأثرة بعد إصلاح فقط، ثم دورة قبول مدمجة واحدة للدفعة النهائية. لا تغيير لتوقعات regression المعتمدة لمجرد تمرير الاختبار.

**القبول:** كل E01–E16 ناجح ضمن البيئة المعلنة؛ أي بند مزود/قناة دعوة غير مهيأ يبقى BLOCKED ولا يتحول التقرير إلى «المنتج جاهز».

### C3 — ما قبل الإنتاج وقرار الإطلاق

**الملفات:** `docs/operations/saas-commercial-runbook.md` جديد، `docs/verification/saas-commercial-staging.md` جديد، تحديث ملفات deploy المستهدفة فقط بعد اختيار بيئة واستضافة الموارد، ومراقبة العامل والـoutbox/الدفع/المصالحة/النسخ. لا أوامر نشر مسبقة في الخطة قبل معرفة الوجهة المعتمدة.

**يعتمد على:** C2، ميزانية/سعة/خدمة متفق عليها ومزود/نطاقات/وسيلة رسائل إنتاجية. **المخرج:** قبول مستقل يسمح باتخاذ قرار إطلاق محدود، ولا يساوي الإذن بالنشر.

- [ ] تثبيت أهداف قابلة للقياس قبل اختبار الحمل: عدد الشركات والمستخدمين المتزامنين وحجم الملفات ومعدل provisioning/branch changes، زمن استجابة p95/نسبة أخطاء، زمن انتظار الطابور، RPO/RTO، مدة الاحتفاظ وفترة صيانة مقبولة. لا نخترع أرقامًا من جهاز التطوير.
- [ ] اختبار الحمل على staging بحجم وموارد ممثلة، مع تقرير زمن/CPU/RAM/DB connections/backlog وأثر noisy neighbor. الفشل يعالج أو يحد عدد العملاء المسموح به بقرار موثق.
- [ ] قياس أثر تشغيل/ترقية tenant ونسخه على بقية tenants. النسخ المحلي الحالي قد يوقف خدمة Odoo المشتركة فترة قصيرة؛ يجب إما علاج الأثر أو تحديد نافذة ومستوى خدمة لا يتعارض معه. lease المحلي محدود بمضيف واحد؛ قبول تشغيل متعدد العمال/المضيفين يحتاج قفلًا وفencing مثبتين.
- [ ] تمرين تعافٍ وفشل أثناء restore لاختبار journal والحسم والاستئناف وcutover/عودة routes. تحقق backup خارج المضيف وتشفير/احتفاظ/سلامة واسترداد معتمد قبل وعد SLA.
- [ ] تشغيل monitoring: payment webhook rejection/reconciliation، invoice duplication، stalled fulfillment، mismatch desired/observed، usage stale، invitations delivery، backup age/restore failure؛ كل تنبيه له إجراء ومسؤول واضح.
- [ ] تحقق domains/TLS/session isolation وinvitation delivery ومزود production بعد تفويض واضح وبوسيلة اختبار يجيزها المزود. مفاتيح sandbox لا تحقق هذا البند، ولا تستخدم مفاتيح الإنتاج في اختبارات محلية.
- [ ] مراجعة التجديد والإلغاء/التعليق والتسويات والضريبة والفاتورة مع سياسة التاجر المعتمدة؛ لا نصيحة قانونية مفترضة في الكود. لا تربط إطلاق المنتج بتقديم خصائص محاسبية غير منفذة.
- [ ] إعداد release candidate واحد وخطة rollout/rollback وعدد أولي من العملاء المتفق عليه، مع قرار قبول مكتوب يشير إلى الأدلة. تبقى commit/merge/push/deploy إجراءات تتطلب تفويضها الفعلي في وقتها.

**القبول:** لا بوابات مفتوحة في نطاق الإطلاق المتفق عليه، ولا ادعاء شمول نطاق أعلى من المختبر. يجوز تسمية نهاية C2 «قبول محلي/تجريبي متكامل»؛ تسمية «جاهز للإطلاق» لا تستخدم إلا بعد إغلاق C3.

## أوامر التحقق المعتمدة وحدودها

من جذر checkout التنفيذ وبعد تجهيز قواعد الاختبار المعزولة. هذه أوامر تنفيذ مستقبلية؛ لم تشغل أثناء كتابة الخطة:

```sh
git diff --check
python3 tools/secret_guard.py
npm test
npm run test:commercial
npm -w packages/commercial-contracts run build
npm -w apps/control-plane run build
npm -w apps/web run lint
npm -w apps/web run build
python3 -B -m unittest discover -s tools/shared_saas_lifecycle -p 'test_*.py' -v
```

`npm test` يشمل العقود واختبارات الواجهة/السياسات؛ `test:commercial` يضيف control-plane. الـlive SQL متسلسل لأن script يستخدم `--no-file-parallelism --hookTimeout=60000` ويقطع جداول scratch؛ يجب ألا يشير إلى قاعدة سيناريو القبول المحفوظ. لا يعاد كامل الاختبار بلا تغيير يستدعيه.

Playwright الواجهة من `apps/web`: `npm run test:e2e`، وتضاف رحلة live التجارية إلى config الموجود تحت `tools/shared_saas_lifecycle` بإعداد endpoints/hosts/fixtures الموثقة. قبل نشر script wrapper الجديد، اجعله يرفض env ناقصة أو اسم DB غير scratch أو target غير مصرح؛ مخرجاته تحدد هل تم mock أو real Odoo/provider.

Odoo: أمر CLAUDE.md في فقرة Check commands ومرحلة `odoo` في `.woodpecker.yml` هو المرجع، مع تصنيف runtime fixture الموجود في CI، paths وإعداد scratch خاصة بالدفعة وقاعدة باسم فريد بدل أي اسم ثابت مشترك. يلزم install ثم upgrade وفق docs/migrations.md وtests غير صفرية وsecurity/i18n/ruff. لا تشغّل `odoo19`، ولا تضع كلمة مرور على command line، ولا تمس مصدر Odoo الأصلي.

خط Woodpecker الرئيسي حاليًا سبع مراحل: prepare/static/control-plane/odoo/upgrade/restore-drill/e2e-mock. نجاح e2e-mock ليس قبول E04/E14 الحقيقي؛ image gate منفصل واختياري حاليًا. تقرير CI يذكر المراحل الفعلية التي اشتغلت، ويفصل فشل البنية/الشبكة عن فشل المنتج.

## شكل تقرير إغلاق كل جزء

1. النتيجة المرئية والمخرجات المنفذة، وأرقام المطالبات/الاختبارات التي تغطيها.
2. checkout/branch/SHA وحالة الملفات غير الملتزمة، وما قبلها وما أضيف.
3. الملفات الأساسية وعقودها وأي تغيير في السياسة المعتمدة.
4. التحقق: الأمر/البيئة/عدد الاختبارات/exit code/روابط الدليل، مع وقت fresh observation.
5. المتبقي والأسباب والقرار المطلوب فقط عند الحاجة؛ لا مساواة نقص provider/delivery باجتياز محلي.
6. مخاطر تشغيل واقعية وخطة استئناف/عودة، دون ادعاء قبول إنتاج من المحلي.

لا يغلق الجزء إذا تعذر على المراجع ربط السلوك المطلوب بالدليل الفعلي. ولا يغيّر التقرير سجل قبول قديمًا ليبدو حديثًا؛ تنشأ أدلة جديدة للنتيجة الجديدة.
