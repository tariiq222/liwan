# تسليم إصلاحات الاجتماعات — 2026-11-03

> حزمة عمل محلية على `codex/meetings-fixes`، وليست إصدارًا أو موافقة نشر. لا commit ولا push ولا PR ولا merge. صحّح القائد هذا التقرير بعد مقارنة رواية التجميع بالسكربتات واللوقات مباشرة.

## 1. الهدف

تنفيذ إصلاحات الاجتماعات المعتمدة: التحقق من المشروع قبل الحفظ، رسائل تحويل التوصيات وعدد اللقاءات، تبسيط القوائم والمحضر وإدخال الوقت، تعطيل الحفظ حتى التغيير، التأكيد المضمّن، التكرار اليومي، نافذة التذكير وبادئة المرجع. قرار المالك: عدّاد واحد للنظام وبادئة لكل شركة. الحضور من خارج الموظفين مستبعد.

## 2. الحالة الحالية

**جاهزة للمراجعة والقرار محليًا، لا لإغلاق قبول شامل بلا تحفظات:** التنفيذ والمراجعات والفحوص المسجلة اكتملت، لكن تباين `MTG-163` ومؤشر خطأ حقل التذكير وحدود التغطية الحية باقية.

| البند | الحالة والدليل |
| --- | --- |
| الشجرة والفرع | [كود] [نسخة العمل](/Users/tariq/code/webvue/.worktrees/meetings-fixes)، `codex/meetings-fixes`، HEAD = `a448f857dbd1ac17bdbd882b3d2e60623638df75`؛ لا commit جديد |
| الفروق | [اختبار] `git diff --shortstat`: **44 ملفًا متتبعًا، 651 إضافة و147 حذفًا**؛ `git status --porcelain`: **9 مسارات غير متتبعة** تشمل التقرير = **53 مسارًا**. أعداد الإضافة والحذف تخص المتتبع فقط |
| سجل السيناريوهات | [كود] [سجل الاجتماعات](/Users/tariq/code/webvue/e2e/scenarios/meetings.md) معدل في النسخة الرئيسية، منفصل عن نسخة العمل؛ التعديلات السابقة محفوظة |
| بيئة الاختبار | [اختبار] خادما الجولة على 8170 و3101 أُوقفا؛ لا مستمع عليهما عند فحص القائد. قاعدة `liwan_scratch_meetings_fixes` حُذفت بحسب المختبِر؛ لا حذف لنسخة العمل |
| الموارد | [اختبار] تجاوزت الذاكرة الفعلية السقف: **22–23GB من 24GB**. أُوقف فحص Odoo الإضافي؛ لا يجوز الادعاء بالالتزام الدائم بسقف80% أو اعتبار `memory_pressure` بديلًا لنسبة RAM الفعلية |

## 3. ما أُنجز مع الدليل

الوسوم: **[كود]** قراءة مصدر مسمى؛ **[اختبار]** أمر أو تجربة حية موثقة؛ **[لم يُفحص]** لا دليل كافٍ لهذه الطبقة. اكتمال مهمة فريق لا يعني نجاح كل سيناريو أو جاهزية إنتاج.

### 3.1 الخادم والعقود

| البند | التنفيذ | الدليل |
| --- | --- | --- |
| أ1: المشروع | [كود] الإنشاء والتعديل يفحصان المشروع قبل الكتابة؛ المفقود أو المخفي يرفض دون نص Odoo خام، ومسح الرابط متاح | [مسارات الاجتماعات](/Users/tariq/code/webvue/.worktrees/meetings-fixes/odoo-addons/liwan_meetings/controllers/meetings.py)، [جسر المشروع](/Users/tariq/code/webvue/.worktrees/meetings-fixes/odoo-addons/liwan_meetings_pmo/models/meeting_links_pmo.py)، [اختبارات المشروع](/Users/tariq/code/webvue/.worktrees/meetings-fixes/odoo-addons/liwan_meetings_pmo/tests/test_meeting_project_check.py)؛ `MTG-84` حيًا، وتباين `MTG-163` أدناه |
| ترقيم واحد وبادئة شركة | [كود] استخدام العدّاد العام وبناء `<prefix>/<year>/<number>`، دون عدّادات شركة أو `_register_hook` جديد؛ لا تغيير للمراجع القائمة أو قيد `unique(reference)` | [نموذج الاجتماع](/Users/tariq/code/webvue/.worktrees/meetings-fixes/odoo-addons/liwan_meetings/models/meeting_minute.py#L205)، [تعريف العدّاد](/Users/tariq/code/webvue/.worktrees/meetings-fixes/odoo-addons/liwan_meetings/data/meeting_sequence.xml)، [ملاحظة الترحيل](/Users/tariq/code/webvue/.worktrees/meetings-fixes/odoo-addons/liwan_meetings/migrations/19.0.1.5.0/README.md). [اختبار] QAM/2026/0033 ثم MIN/2026/0036 في الجولة الحية |
| ج2: يومي | [كود] التكرار اليومي في الخادم والعقد والواجهة، مع حد60 لقاءً | [نموذج السلسلة](/Users/tariq/code/webvue/.worktrees/meetings-fixes/odoo-addons/liwan_meetings/models/meeting_series.py)، [التحقق الحي](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/logs/05-retest-round2.log#L9): ثلاثة أيام2027-04-01/02/03 |
| ج3: نافذة التذكير | [كود] 1..168 ساعة، افتراضي24، نطاق الشركة؛ التذكير يقرأ نافذة شركة الاجتماع | [الإعدادات](/Users/tariq/code/webvue/.worktrees/meetings-fixes/odoo-addons/liwan_meetings/models/meeting_settings.py)، [التذكير](/Users/tariq/code/webvue/.worktrees/meetings-fixes/odoo-addons/liwan_meetings/models/meeting_minute_reminders.py)، [اختبارات إعدادات الشركة](/Users/tariq/code/webvue/.worktrees/meetings-fixes/odoo-addons/liwan_meetings/tests/test_meeting_company_settings.py)؛ [اختبار] نافذة3 ساعات: القريب1 والبعيد0، والتشغيل الثاني لا يكرر بحسب t5 |
| ج4: البادئة وPATCH الجزئي | [كود] بادئة1..10 من A-Z و0-9، افتراضي MIN؛ حفظ الحقول المغيرة فقط مع المراجعة، 422 عند الحقل و409 للتعارض | [المسار](/Users/tariq/code/webvue/.worktrees/meetings-fixes/odoo-addons/liwan_meetings/controllers/meeting_settings.py)، [العقد](/Users/tariq/code/webvue/.worktrees/meetings-fixes/packages/contracts/src/meetings/policy.ts)، [اختبارات العقد](/Users/tariq/code/webvue/.worktrees/meetings-fixes/packages/contracts/src/meetings/__tests__/policy.test.ts) |
| إزالة sudo الجديد والترجمة | [اختبار] بوابتا sudo والمعمارية ناجحتان؛ مُعرفا القيدين العربيين صُححا وتحققت ترجمتهما في قاعدة مؤقتة | [الترجمة](/Users/tariq/code/webvue/.worktrees/meetings-fixes/odoo-addons/liwan_meetings/i18n/ar.po)، أدلة t3 والإضافة المسجلة عليه؛ الترحيل مصاحب لرفع الإصدار إلى19.0.1.5.0 في [البيان](/Users/tariq/code/webvue/.worktrees/meetings-fixes/odoo-addons/liwan_meetings/__manifest__.py) |

### 3.2 الواجهة

| البنود | التنفيذ والدليل | حدود الدليل |
| --- | --- | --- |
| أ2: تحويل التوصية | [كود] إعادة جلب الإسقاط بعد422 ورسالة alreadyConverted عند وجود المهمة؛ [اختبار] رسالة «هذه التوصية حُوّلت مسبقًا إلى مهمة.» ظهرت حيًا | [التوصيات](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/components/meetings/MeetingResolutionsTab.vue)، [اختبار الكاش الحقيقي](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/components/meetings/__tests__/conversionRefetch.test.ts)، [لوق التحويل](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/logs/06-convert-round2.log) |
| أ3 وإصلاح t11: العدد | [كود] قبول string أوnumber وتمييز required عنout_of_range، وحدود1..60؛ [اختبار] انحدار رقمي حقيقي ثم إعادة متصفح **بعد الإصلاح** | [التحقق](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/utils/meetingForm.ts)، [اختباراته](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/utils/__tests__/meetingForm.test.ts)، [اللوق](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/logs/05-retest-round2.log#L6-L8): رفض61/0 بلاPOST ثم3→طلب201واحد وثلاثة لقاءات |
| أ4: إعادة محاولة المنتقي | [كود] الزر داخل حالة empty ليبقى المنتقي مفتوحًا | [القائمة](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/pages/meetings/index.vue)؛ [لم يُفحص] لا يُعتمد السرد النهائي لـt5 وحده كإثبات مكتمل لكل فروع فشل جلب المنظمين؛ توجد لقطات أولية منفصلة |
| أ5 وب1–ب3: القوائم | [كود] صيغ جمع عربية، عنوان التوصيات المفتوحة، شرطة عند الصفر، وإخفاء عمود المهمة الخالي؛ [اختبار] الوحدات والمراجعة ناجحتان | [الجمع](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/i18n/__tests__/pluralRules.test.ts)، [السجل](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/pages/meetings/[id].vue)، [المتابعة](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/pages/meetings/follow-up.vue)، [الخط الزمني](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/components/meetings/MeetingTimeline.vue) |
| ب4: المحضر | [كود] عنوان المحضر ومنع تكرار جدول الأعمال واتساق الحفظ | [صفحة المحضر](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/pages/meetings/[id]/minutes.vue)، [النموذج](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/components/meetings/MeetingMinutesForm.vue)؛ [لم يُفحص] مسار القراءة فقط حيًا غير مثبت في هذه الجولة |
| ب5: الوقت24ساعة | [كود] حقل موحد مع قصة وفهرسة؛ فحص الأنواع والسياسة ناجح | [المكوّن](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/components/meetings/MeetingTimeField.vue)، [القصة](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/stories/meetings/MeetingTimeField.stories.ts)؛ [لم يُفحص] إدخال الوقت عبر هذا المكوّن حيًا والجوال غير مثبتين |
| ب6 وج1: الحفظ والتأكيد | [اختبار] تعطيل الحفظ حتى التعديل والنص الصريح؛ تأكيد مضمّن، إلغاؤه يبقي draft، والاعتماد ينتقل مرة واحدة | [الانتقالات](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/composables/useMeetingTransitions.ts)، [اختبار الظهور](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/pages/__tests__/meetingConfirmVisibility.test.ts)، [اللوق](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/logs/05-retest-round2.log#L2-L5) |
| ج3/ج4: البطاقة | [اختبار] كتابة48 ثمTab ثمحفظ أرسلتPATCHواحدًا للحقل المغيّر؛ أعادت القراءة48، ثم أُعيدت24. الحقلانrequired مع مساعدة | [البطاقة](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/components/meetings/MeetingScheduleCard.vue)، [اختباراتها](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/components/meetings/__tests__/MeetingScheduleCard.test.ts)، [لوق الإدخال والحفظ](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/logs/08-reminder-window-path.log)؛ مؤشر الخطأ المرصود باقٍ أدناه |
| التوثيق | [كود] تحديث فهرس البطاقة والحقل الجديد وتصحيح مراجع القصص المزاحة | [الفهرس](/Users/tariq/code/webvue/.worktrees/meetings-fixes/docs/design-system/components.md#L255-L256)؛ مراجعة مستقلة t10 مسجلة |

### 3.3 تسلسل الأدلة بعد إصلاح العدد

[اختبار] تحقّق القائد من السكربت واللوق والتوقيت مباشرة؛ صحح ذلك نفيًا خاطئًا في النسخة الأولى من هذا التقرير:

| الحدث | التوقيت المحلي2026-11-03 | الدليل |
| --- | --- | --- |
| آخر تعديل مصدر إصلاح العدد | 12:47:37 +03:00 | `stat` على [المصدر](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/utils/meetingForm.ts) |
| إعادة المتصفح بعده | لوق آخر تعديل13:06:34 | [السكربت](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/05-retest-round2.mjs#L70-L125) ينفذ `page.goto` ثم `page.reload({waitUntil:'networkidle'})`؛ [النتائج](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/logs/05-retest-round2.log) ثمانية فحوص ناجحة |
| فحص الأنواع | لوق آخر تعديل13:38:23 | [لوق lint](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/logs/web-lint-round2.log): `EXIT=0` |
| الاختبار الشامل | لوق آخر تعديل13:40:55 | [لوق npm](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/logs/npm-test-round2.log#L5273-L5274): web589ملفًا/5326اختبارًا؛ [النهاية](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/logs/npm-test-round2.log#L5490-L5495): vendor-admin664/71 ثم `EXIT=0` |

هذه أدلة بعدt11، وليست مطالبة بتشغيلها الآن مرة أخرى. توقيت الملف قرينة زمنية مساندة، والسكربت والمخرجات هما دليل التنفيذ. لوق المتصفح يسجل أيضًا تحذير hydration mismatch؛ لا ندّعي خلو المتصفح من كل التحذيرات.

### 3.4 السجل والتغطية

[اختبار] المختبِر حدّث سبعة صفوف وأضاف MTG-385/386/387 في [السجل الأساسي](/Users/tariq/code/webvue/e2e/scenarios/meetings.md)، محافظًا على التعديلات السابقة. MTG-84/120/168/280/289/322 والإعدادات والتكرار اليومي لها أدلة الجولة؛ MTG-163 يبقى مختلفًا حرفيًا عن المتوقع. وضعه القديم `manual 2026-11-02` لا يتحول إلىPASSحالي بمجرد إضافة ملاحظة.

[اختبار] **50/50 تعني تغطية رموز الاجتماعات في سجل التغطية، لا خمسين سيناريو ناجحًا، ولا إعادة كاملة للسجل.** الإجمالي1045/1300 بحسب t5؛ الرمز المجهول TSK-107 سابق لهذا التغيير، خارج الاجتماعات. مسار المحضر للقراءة فقط، وإدخال الوقت بالمكوّن الجديد، والجوال لم تثبت لها جولة حية مكتملة هنا. لا تُفسّر الاختبارات الخضراء كتغطية مستخدم شاملة.

## 4. ما تبقى

| البند | المالك | معيار الإغلاق |
| --- | --- | --- |
| تباين MTG-163 | المالك يقرّر العقد؛ منفّذ لاحق يحدّث المرجع والاختبار | المتوقع حرفيًا422، والفعلي404مقروء. إقرار404 وتحديث السجل المالك، أو طلب422وتنفيذه مع اختبارات عدم كشف السجل؛ لا تعديل توقع صامت |
| مؤشر الخطأ في نافذة التذكير | مهمة واجهة لاحقة | إزالة إطار الخطأ و`aria-invalid=true` عند القيمة الصالحة دون إخفاء خطأ حقيقي؛ إعادة متصفح ولوحة مفاتيح |
| التغطية الحية غير المثبتة | مختبِر الجولة التالية | دليل لكل فرع محدد أعلاه، دون اعتبارها مختبرة حاليًا |
| تحقق Odoo المقطوع | المنسق عند توفر الموارد | إن طُلب تشغيل جديد: قاعدة scratch وحمل فعلي تحت80%. دليل268/0منt3 باقٍ صالحًا للخادم الذي لم يتغير بعده؛ لا عطل خادمي جديد مُثبت |
| تحذيرات storyContext السابقة | مالك واجهة منفصل | تصحيح المراجع السابقة ضمن نطاق مستقل؛ لا توسيع هذه الحزمة |
| الحفظ فيGit والنشر | المالك ثم المنسق | تفويض صريح لكل إجراء والتحقق من أحدثmain وفق السياسة؛ لم تُنفذ هذه الإجراءات |

الالتزام علىblur/Enter والتقييد0→1 و169→168 سلوك مقصود لحقل العدد، **ليسا عيبين**؛ مسار كتابة48وحفظها مثبت.

## 5. المخاطر

| الخطر | الأثر | التخفيف |
| --- | --- | --- |
| تجاوز RAMللحد المعتمد | ضغط ذاكرة وSwap وأخطاءNodeOOM | لا فحوص ثقيلة إضافية حاليًا؛ قياسPhysMemمقابل24GB ومراقبة CPU، لاloadavg وحده. خفضheap وحده لا يثبت الالتزام |
| سجل عدّاد noupdateالقائم | تعريفXMLالقديم لا يُعاد تحميله تلقائيًا | [ملاحظة الترحيل](/Users/tariq/code/webvue/.worktrees/meetings-fixes/odoo-addons/liwan_meetings/migrations/19.0.1.5.0/README.md) تشرح استخراج الجزء العددي وعدم إعادة ترقيم الموجود؛ لا سكربت تحديث خفي |
| التغييرات غير ملتزمة وموزعة بين شجرتين | فقد أو إغفال أدلة عند جمع مرشح لاحق | لا تنظيف أوstashأونقل تلقائي؛ حافظ على نسخة العمل وعلى سجلmainكلٍّ في موضعه |
| الاختبار محلي وبيئته أُزيلت | لا دليل إنتاج ولا قاعدة حية مستمرة | إعادة تهيئة معزولة عند الحاجة، ولا إعادة استخدامodoo19 |
| فجوات القبول المعلنة | لا يصح إغلاق شامل أو إطلاق | إبقاء MTG-163 ومؤشر الخطأ وحدود التغطية في التسليم |

## 6. كيفية التشغيل والتحقق

### 6.1 أوامر التحقق المسجلة

تُنفّذ من نسخة العمل ما لم يُذكر خلاف ذلك؛ **لم تُعد أثناء تصحيح هذا التقرير**.

| الأمر | النتيجة | مصدر الدليل |
| --- | --- | --- |
| `npm test` | EXIT0؛ أدواتPython1178، contracts853، ui561، commercial-ui27، commercial-contracts122، web5326/589، vendor-admin664/71 | [لوق الجولة الثانية](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/logs/npm-test-round2.log) |
| `npm -w apps/web run lint` | EXIT0، بعد إصلاح العدد | [لوق الأنواع](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/logs/web-lint-round2.log)؛ احتاجت الجولات السابقة heapأكبرمنالافتراضي، ولا يبرر ذلك تجاوزRAMالمسموح |
| `python3 -B tools/arch_policy.py --base main` | EXIT0 | [دليل المعمارية](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/logs/arch-policy-round2.log) |
| `python3 -B tools/ui_policy.py` | PASS؛ تحذيراتstoryContextسابقة | t11وt10وt6؛ كما يندرج ضمنnpm test |
| `python3 -B tools/odoo_test.py --addons liwan_meetings,liwan_meetings_pmo` | آخر نجاح كامل268اختبارًا،0فشل،0أخطاء، منt3؛ المحاولة الإضافيةفيt5 **INTERRUPTED** | [لوق المحاولة المقطوعة](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/logs/odoo-test-round2.log)، وسجلt3. لم يتغير مصدر الخادم بعد النجاح |
| `npm run wt -- check` | `no rule violations` بحسبt6 | لا تعديلGitأوتنظيفمنالأمر |

### 6.2 استئناف البيئة عند الحاجة فقط

[كود] [سكربت الجولة](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/start-stack.sh) المستخدم سابقًا ينشئ نسخة من قاعدةfixture `liwan_scratch_e2e` إذا غابت قاعدة الجولة، ويحدّث الإضافتين، ثم يشغّل Odoo عبرPythonعلى8170 وNuxtعلى3101، مع إعداداته المعزولة. **79400كانPID، وليس منفذًا.**

قبل الاستئناف يلزم التحقق من توفرfixtureالمصدر، وخلوالمنفذين، وصحة [إعدادOdoo](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/odoo-8170.conf) وملف التصنيف المحلي الذي يشير إليه السكربت، وانخفاضRAM/CPUتحت80%، وعدم وجود جلسة تستخدمهما. السكربت ليس مراقبجاهزيةأوتحكمموارداكتفيًابذاته؛ على المنسق مراقبةاللوقوالصحةوإدارةالعمليات.

```bash
# مثال استئناف مسجل؛ لا يُنفذ قبل التحقق من الشروط أعلاه.
bash /Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02/start-stack.sh
```

[لم يُفحص] لم تُجرّب إعادة تهيئة جديدة بعد حذف قاعدةالجولة في نهايةt5؛ لا ندعي أن المثال أعلاه تحقق مجددًا في حالة الجهاز الحالية. مرجع العزل والتشغيل: [العمل المتوازي](/Users/tariq/code/webvue/docs/parallel-work.md)، [الاختبار](/Users/tariq/code/webvue/docs/testing.md)، [قواعدOdoo](/Users/tariq/code/webvue/docs/agents/odoo-rules.md). لا حاجة لإعادةالستاك لإثباتMTG-322، فدليله بعدالإصلاحموجود بالفعل.

## 7. القرارات

| القرار | المصدر والحدود |
| --- | --- |
| عدّاد واحد وبادئة لكل شركة | قرارالمالك2026-11-03؛ لاعدّادشركةولاsudoجديد |
| استبعاد الحضور الخارجي | قرارالمالك؛ ليست فجوة نعد بإصلاحها ضمنهذهالحزمة |
| اختيار بدائل الأعضاء دون انتظار قرار جديد | تفويضالمالك؛ لا يشملcommit/push/mergeأوتغييرعقدمنتج |
| عدم النشر | لاGitHubissuesجديدةلهذاالعمل، ولاcommit/push/PR/merge/deploy |
| التحقق الدقيق لا طلاء أخضر | تباينالسجلوحدودالمتصفحوالذاكرةتظهرصراحةً، حتىمعاكتمالمهامالفريق |

## 8. المسؤوليات والمسارات

| المسؤولية | صاحب الدليل | الموضع |
| --- | --- | --- |
| التنفيذ الخادمي والمراجعة | backend-fixer2ومراجعt3 | [إضافةالاجتماعات](/Users/tariq/code/webvue/.worktrees/meetings-fixes/odoo-addons/liwan_meetings)، [الجسر](/Users/tariq/code/webvue/.worktrees/meetings-fixes/odoo-addons/liwan_meetings_pmo) |
| إصلاح العدد والمراجعة | count-fixer-hiveوcount-reviewer | [المصدر](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/utils/meetingForm.ts)، [اختباراته](/Users/tariq/code/webvue/.worktrees/meetings-fixes/apps/web/app/utils/__tests__/meetingForm.test.ts) |
| التحقق الحي | verifierثمverifier-hive | [أدلةالجولة](/Users/tariq/code/webvue/.scratch/e2e-personas/fixes-2026-11-02)، [السجل](/Users/tariq/code/webvue/e2e/scenarios/meetings.md) |
| تجميعالتقريروتصحيحه | integratorثمcaptainفيt13 | [هذاالتقرير](/Users/tariq/code/webvue/.worktrees/meetings-fixes/docs/reports/2026-11-03-meetings-fixes-delivery.md) |

**مقترحاتcommitفقط،غيرمنفذة:**

- `feat(meetings): configure reminders and company reference prefixes`
- `feat(meetings): add daily meeting series`
- `fix(meetings): validate linked projects before writing`
- `fix(meetings): accept numeric recurrence counts`
- `fix(meetings): clarify confirmations and conversion errors`
- `fix(meetings): simplify lists and minutes editing`
- `feat(meetings): use consistent 24-hour time fields`
- `docs(meetings): record fixes and end-user retest evidence`

هذه موضوعات مقترحة لاخطةstagingمجرّبة: بعضالملفاتمشتركةبينعدةبنود، فتقسيمها يحتاج مراجعةالترابطوالعقودوالاختباراتقبلأيcommit. النسخةالعاملةوالأدلةمحفوظة، ولاحذفللفروعأوالشجرات.
