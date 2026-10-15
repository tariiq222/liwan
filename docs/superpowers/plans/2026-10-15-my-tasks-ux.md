# مهامي — خطة تحسين تجربة الاستخدام

> **For agentic workers:** بعد اعتماد المالك فقط، استخدم superpowers:executing-plans لتنفيذ المهام بالترتيب. الكاتب واحد بسبب تداخل المسودة والتوجيه والنموذج. التفويض غير مطلوب الآن، ولا تُعد هذه الوثيقة إذن تنفيذ أو كومت أو دمج. مربعات التنفيذ تبقى غير معلّمة حتى وجود دليل حديث.

**Goal:** إكمال رحلة «مهامي» والمهام الشخصية على أساس نسق المشترك، من العثور والإنشاء إلى التعديل والمتابعة والعودة، دون فقد نص أو سياق.

**Architecture:** تطوير المستهلكين الحاليين والقوالب المشتركة دون استنساخها. فصل صفحة التعديل عن قراءة المهمة، ونموذج واحد للحقول، وحارس واحد لكل صفحة، وحالة قائمة في URL. API وصلاحيات ونماذج Odoo وعلاقات مهام المشاريع لا تتغير.

**Tech Stack:** Nuxt 4، Vue 3، Nuxt UI 4، TanStack Vue Query، Storybook، Vitest، Playwright؛ الإصدارات المثبتة دون ترقية أو اعتماد جديد.

**Spec:** [مراجعة الرحلة والتصور](../specs/2026-10-15-my-tasks-ux-design.md). **الحالة:** معتمدة للتنفيذ من المالك؛ شرط البدء حفظ الأعمال الحالية أولًا بكومتات منظمة، ودون دمج أو push أو نشر. لا تُعد كومتات حفظ العمل السابق إذنًا تلقائيًا لكومت تغييرات التنفيذ الجديدة.

## Global Constraints

- الاسم المعتمد «مهامي / My tasks»، وتسمية الإنشاء «مهمة شخصية جديدة». لا تغيير `tasks`/`nasq_tasks` أو القدرات.
- قائمة مهامي تبقى جامعة للموارد التي يعيدها الخادم؛ تفاصيل مهام المشاريع ولوحتها واعتمادها خارج النطاق.
- `DESIGN.md` السياسة النافذة. إنشاء `/new` في SharedCreatePanel بعرض 640px/full phone، والتعديل صفحة، والإجراءات الهدامة inline.
- `returnTo` للسجل و`listOrigin` للتعديل، مع حفظ الأب المختلف والبحث والنطاق والترتيب والصفحة وhash. لا history مجهول.
- لا API أو schema أو قاعدة بيانات أو default إسناد جديد. `/api/v1/people` يبقى user-id picker و`{items,total}` يبقى envelope.
- لا كتابات تلقائية مكررة أو نجاح قبل الخادم. تبقى المدخلات عند 422/403/409/500 والانقطاع، و403/404 للقراءة يحجبان جسم السجل.
- لا نسخ v2 أو compatibility aliases أو suppressions/baseline إضافية؛ المنقول يحذف موضعه القديم ومستهلكيه المنتهين.
- اعتماد العربية/الإنجليزية والمظهرين والخطوط الثلاثة وعروض 390/768/1440، و44px للمس التفاعلي.
- لا تنفيذ على نسخة معاينة المالك النشطة. لا اختبارات على `odoo19`، ولا كومت/دمج/push/نشر أو تنظيف مدمر ضمن التفويض الحالي.

## Review Focus

1. تحديث خلفي أثناء كتابة تعديل لا يبدّل baseline أو يمسح القيم؛ T1 يختبره مع 409 وفشل الشبكة.
2. تعليق أو فرعية غير مرسلة قبل التحويل: حسم المسودة قبل أول POST، لا بعد انتقال لا يمكن التراجع عنه؛ T4.
3. صفحة قائمة ثانية وبحث عربي يحوي `&` ونقرة قبل debounce: يكتمل أصل العودة دون offset قديم أو فقد hash؛ T2.
4. فقد صلاحية بعد قراءة ناجحة: 403/404 يخفيان السجل وأفعاله، بينما 500 يبقي البيانات مع تنبيه؛ T3.
5. اسم فرعية أو تعليق مع عملية معلقة ومغادرة بالمتصفح: نافذة واحدة، البقاء يحفظ النص ويعيد التركيز، ولا وعد بإلغاء خادمي؛ T4/T5.

## المسؤولية وتسلسل التنفيذ

الحزم: T1 نموذج ومسودة وتوجيه، T2 قائمة ودلالة وترقيم، T3 سجل وحالات، T4 تفاعلات مكملة وتحويل، T5 قبول مشترك. يمكن قراءة الأدلة بشكل مستقل، لكن الكتابة متتابعة لأن T3/T4 يملكان صفحة السجل ويتشاركان حارس المغادرة. القرار **inline**؛ لا حاجة لوكلاء تنفيذ متزامنين.

قبل التنفيذ: إعادة فحص main والفرع والملفات المتسخة. تحسينات الأساس الحالية غير مثبتة بكومت؛ يُنشأ checkout مستقل يحمل الحالة المعتمدة منها بعد توثيق الملفات المنقولة، دون كومت أو دمج أو تغيير معاينة المالك. منافذ وnode_modules و.nuxt وmock مستقلة. لا يجوز بدء نسخة من main الخام وإسقاط تحسينات الأساس أو نسخ عمل غير متعلق دون مراجعة ملكيته.

## Task 1: نموذج واضح وإنشاء وتعديل يحميان المسودة

**Files:**
- Move: `apps/web/app/pages/my-tasks/[id].vue` إلى `apps/web/app/pages/my-tasks/[id]/index.vue`؛ لا proxy في الموضع القديم.
- Create: `apps/web/app/pages/my-tasks/[id]/edit.vue`.
- Modify: `apps/web/app/pages/my-tasks/new.vue`، `components/personal-tasks/MyTaskForm.vue`، `utils/myTaskPayload.ts`، `utils/myTaskDetail.ts`، `i18n/locales/{ar,en}/my-tasks.json`.
- Modify stories: `apps/web/stories/my-tasks/MyTaskForm.stories.ts`، مع قصص create/edit/errors/pending.
- Test: `apps/web/app/utils/__tests__/myTaskPayload.test.ts`، `myTaskDetail.test.ts`، `apps/web/e2e/my-tasks-new.spec.ts` و`my-tasks-detail.spec.ts`، واختبار الصفحة `app/pages/__tests__/tasmim6-my-tasks-record.test.ts` لتحديث مسار الملف المنقول.

**Interfaces:** النموذج يقبل `task?: PersonalTask` و`pending?: boolean` و`error?: Error|null`. غياب task يعني إنشاء، ووجودها يعني تعديل؛ لا mode آخر مكرر. أحداث typed: `create(MyTaskCreate)` و`update(MyTaskBody)` و`cancel()`. `markSaved()` يبقى مكشوفًا للصفحة. الإنشاء يستخدم `buildMyTaskPayload(values)`، والتعديل يستخدم `changedFields(baseline, draft)` مع تحويل `values.deadline` إلى `draft.date_deadline`. لا استخدام builder الإنشاء للتعديل، لأنه يحذف حقول التفريغ.

- [x] تثبيت فشل فقد مسودة التعديل باختبار الرحلة قبل تغيير التنفيذ. تحديث الصفحة الحالية إلى رابط التعديل، لا إبقاء محرر inline موازٍ.
- [x] نقل سجل المهمة إلى `[id]/index.vue` وإضافة صفحة edit حقيقية؛ التحقق من `/my-tasks/7` و`/my-tasks/7/edit` والتحديث المباشر، وقراءة الملفات الجديدة من Nuxt بعد prepare.
- [x] تعميم MyTaskForm في موضعه. تُنشأ نسخة baseline ثابتة عند تحميل النموذج؛ لا يعاد ضبط القيم بسبب refetch أثناء dirty. الحارس داخل النموذج الوحيد في الإنشاء/التعديل مع guardRouteUpdates=true لحماية الانتقال بين معرّفات المهام دون unmount.
- [x] تطبيق `validateMyTaskName` و`myTaskFormField` في الحالين؛ تركيز أول حقل خاطئ بعد nextTick وربط aria-describedby، وإظهار أخطاء aliases ومنها `user_ids` عند المكلفين. لا أخطاء حقول مخفية.
- [x] الإلغاء والتنقل وBack تمر عبر الحارس. النجاح يستدعي markSaved قبل replace للسجل مع returnTo المشتق من listOrigin. لا request عند عدم وجود تغييرات.
- [x] تحديث القصص والمستهلكين والاختبارات ومفاتيح اللغة وإزالة محرر الصفحة المحلي وحقوله/حالته المنتهية.

مثال وحدة مطلوب:
```ts
expect(changedFields(baseline, { ...draftFromTask(baseline), date_deadline: null, assignees: [] }))
  .toEqual({ date_deadline: null, assignees: [] }) // baseline يحتوي موعدًا ومكلّفًا
```
مثال متصفح مطلوب، مع mock task fixture صريحة:
```ts
await page.goto('/my-tasks/7/edit?listOrigin=%2Fmy-tasks%3Fscope%3Dcreated')
await page.getByLabel('عنوان المهمة', { exact: false }).first().fill('عنوان مسودة')
await page.getByRole('button', { name: 'إلغاء', exact: true }).click()
await expect(page.getByTestId('unsaved-changes-dialog')).toBeVisible()
await page.getByRole('button', { name: 'البقاء في الصفحة', exact: true }).click()
await expect(page.getByLabel('عنوان المهمة', { exact: false }).first()).toHaveValue('عنوان مسودة')
```

**Verify:** وحدات payload/detail والصفحة المنقولة، ثم new/detail Playwright على mock مستقل. الحالات: عنوان فارغ/255/256 حرفًا، تعريب، alias، تفريغ موعد ومكلفين، 422/403/409/500/انقطاع، refetch أثناء dirty، ونقرتان/Enter = كتابة واحدة. **Acceptance:** A3/A4؛ لا مسح للمدخلات أو ازدواج محرر.

## Task 2: قائمة مهامي وأسماء الحالات والترقيم

**Files:** `apps/web/app/pages/my-tasks/index.vue`، `utils/myTaskList.ts`، `components/personal-tasks/MyTaskRow.vue`، `modules/tasks/manifest.ts`، `i18n/locales/{ar,en}/my-tasks.json`؛ نقل `composables/useMyTaskPages.ts` إلى `composables/useMyTaskList.ts` وتعديل المستهلك الوحيد. الاختبارات: `utils/__tests__/myTaskList.test.ts`، `pages/__tests__/tasmim6-my-tasks-list.test.ts`، `e2e/my-tasks-list.spec.ts`، `e2e/tasmim6-my-tasks-list.spec.ts`. قصة جديدة: `stories/my-tasks/MyTaskRow.stories.ts` للمصدرين والأولوية والموعد/الجوال.

**Interfaces:** `MyTaskListState` يحفظ tab=`open|closed` وscope/sort/q وoffset غير سالب. `useMyTaskList(params)` يقرأ صفحة واحدة عبر useQuery، queryKey يتضمن limit=50 وoffset، ويجيب data بالشكل الحالي `{items,total}`. `toListParams` يربط closed بـ`closed=1`. SharedPagination يستخدم page=`floor(offset/50)+1` وpages=`ceil(total/50)`، ولا hook قديم بلا مستهلك. هوية الصف تبقى `source:id`؛ موارد الخادم الحالية تشترك في project.task ولا يُفترض تعارض IDs من جدولين.

- [x] تثبيت اختبار نطاق مغلق به مهمة done وأخرى cancelled؛ العنوان «المغلقة» وشرح الحالتين، دون تغيير enum للبيانات.
- [x] استبدال tab=done في URL بالمفتاح closed في المصدر والقصص والاختبارات المملوكة. لا alias؛ القيم غير المعروفة تستعمل الافتراضي كما تفعل parser الحالية.
- [x] استبدال infinite query والترقيم القائم بالـoffset وSharedPagination. تغيير أي فلتر/ترتيب يصفر offset، والبحث الحي في returnTo يتضمن offset الصحيح. إذا نقص total وصار offset خارج النهاية يُنقل إلى آخر صفحة صالحة دون حلقة؛ صفر total يعيد offset=0. الصفحة القصيرة أو الفارغة لا تعيد حساب total من عدد الصفوف؛ قد يستبعد الخادم بعض النتائج، فتبقى إمكانية التنقل وفق total مع نص فراغ الصفحة المناسب.
- [x] تعريف فراغ أول استخدام وفراغ بحث وفراغ نطاق، مع إجراء مسموح وواضح، وإظهار «متأخرة» نصًا في الموعد.
- [x] تثبيت اسم مهامي في العنوان والرجوع والقصص؛ تنظيف تعليق manifest القديم دون تغيير nav id أو مسارات PMO.

مثال عقد URL مطلوب:
```ts
expect(listPatch({ q: 'سابق', offset: '50', scope: 'created', view: 'board' }, { q: 'بحث & عربي' }))
  .toEqual({ q: 'بحث & عربي', scope: 'created', view: 'board' })
```

**Verify:** وحدات الحالة/الصفحة، ورحلات 0/1/50/51 صفًا والصفحة الثانية ثم سجل وعودة/refresh، و401 غير مفترض كبيانات. الحفاظ على فشل التحديث مع صفوف محملة وغياب صلاحية الإنشاء، ونقرة قبل debounce. **Acceptance:** A1/A2، ولا تغيّر عرض مهام المشاريع أو href القادم من الخادم.

## Task 3: سجل المهمة ومعلومات القرار والحالات

**Files:** `apps/web/app/pages/my-tasks/[id]/index.vue` الناتج من T1، `components/personal-tasks/MyTaskRow.vue` إن احتاج تسمية إجراء، ملفا لغة my-tasks؛ اختبارات `pages/__tests__/tasmim6-my-tasks-record.test.ts` و`e2e/tasmim6-my-tasks-record.spec.ts` و`e2e/my-tasks-detail.spec.ts`. قصة جديدة `stories/my-tasks/MyTaskRecord.stories.ts` عبر القوالب القائمة، دون مكون سجل موازٍ.

**Interfaces:** SharedRecordPage يبقى مستهلكًا كما هو: keepContent عند وجود مهمة، error الفعلي لا null لإخفائه، وsummary للمعلومات الحاسمة فقط. `allowed_actions` مرجع ظهور الفعل؛ refresh لا ينشئ حقائق محلية جديدة. props/slots مشتركة لا تتغير.

- [x] RED لحالة 500 بعد تحميل، وأخرى 403/404 بعد تحميل: الأولى تعرض خطأ مع معلومات، والأخريان تحجبان body/actions. لا تغيير في retry policy أو الخادم من أجل تمرير الاختبار.
- [x] إعادة ترتيب السجل وفق D3؛ منشئ وتواريخ أدنى المحتوى الأساسي، لا حذف أو تكرار نفس القيم. H1 واحد وعناوين أقسام H2.
- [x] إجراء حالة رئيسي، تعديل ثانوي، وإلغاء/تحويل ضمن قائمة الإجراءات الثانوية القائمة. تأكيد إلغاء المهمة inline، واسم واضح يختلف عن إلغاء التعديل.
- [x] الإكمال/إعادة الفتح لا يبدلان الحالة قبل الخادم. فشل الإجراء يظل واضحًا في السجل؛ التركيز يتبع الإجراء الجديد أو العنوان.
- [x] تجربة parent → child → back مع أصل قائمة فيه فلاتر وhash، ورابط مباشر لفرعية بلا أصل؛ لا بناء سياق غير معلوم.

**Verify:** اختبار DOM ترتيب الملخص/الوصف/الأقسام، قراءة فقط، task غير صالح/مفقود، scope withdraw، action delayed/double/network failure. لقطة 390px وخط كبير تؤكد وصول الوصف قبل بيانات التدقيق. **Acceptance:** A5/A9 وجزء A10.

## Task 4: مسودات الأقسام والمرفقات والتحويل

**Files:** `components/personal-tasks/{MyTaskComments,MyTaskSubtasks,MyTaskAttachments,ConvertToProject}.vue`، صفحة السجل، `components/shared/data/Checklist.vue` وقصتها `stories/shared/Checklist.stories.ts` فقط إذا لزم إخراج حالة المدخل، لغة my-tasks، واختبارات detail القائمة.

**Interfaces:** الصفحة تملك حارس SharedUnsavedChanges واحدًا. أقسام التطبيق تطلق `draft-change(boolean)` و`pending-change(boolean)` بحالة حقيقية؛ خريطة الصفحة بمالك القسم تجمع OR ولا تخلط تعديل السجل (أصبح صفحة أخرى). Checklist يستبدل ref الاسم الداخلي بـdefineModel<string>('draft', {default:''})؛ يعمل داخليًا دون binding لدى المستهلكين الحاليين، ويربطه MyTaskSubtasks بمسودته عبر v-model:draft، دون نسخة أخرى من النص أو ملكية طلبات أو حارس جديد. MyTaskComments وMyTaskSubtasks يقبلان discardDraftKey:number (افتراضي 0)؛ تغيره بعد موافقة صريحة يفرغ النص المحلي ويرفع draft-change=false. عند unmount/تبديل task id تُصفّر حالة القسم في خريطة الصفحة. ConvertToProject يقبل `open:boolean` و`hasDraft:boolean` و`pendingElsewhere:boolean` و`prepareConvert:()=>Promise<boolean>` ويطلق close/converted؛ prepareConvert في الصفحة يفرغ مسودات الأقسام بعد التأكيد، وينتظر nextTick ثم يجيب true فقط إذا لم تبق عملية جارية. الحارس في السجل يستخدم guardRouteUpdates=true. ويستعمل useConvertTargets يستعمل `{enabled:()=>open}` الموجودة؛ لا composable بحث جديد.

- [x] تثبيت RED: اكتب تعليقًا أو اسم فرعية ثم رجوع/Back/تنقل/انتقال إلى id آخر داخل نفس المكوّن؛ نافذة واحدة، والبقاء يحفظ النص والتركيز. نجاح التعليق/الفرعية يمسح مسودتهما فقط، والفشل لا يمسحها.
- [x] ربط pending للرفع/الحذف/التعليق/الفرعية؛ المغادرة أثناء العملية لا تُسمى إلغاء خادميًا، ولا كتابة تلقائية عند الرجوع. لا تخزين مسودات في localStorage ضمن هذه الخطة.
- [ ] مراجعة رفع ملف فارغ/نوع غير مسموح/أكبر من 10MB، وفشل500 والانقطاع، وإعادة اختيار نفس الملف. الحذف inline ويحترم صلاحية الكتابة ويمنع التكرار.
- [x] جعل التحويل disclosure inline من إجراء ثانوي. عرض isLoading/error/refetch وحالة قائمة فارغة الفعلية، والحفاظ على العنصر المختار خلال البحث.
- [x] تأكيد التحويل inline واحد يذكر عدم الرجوع، ويضيف تحذير تجاهل المسودات إن وجدت، بزر «متابعة الكتابة» أو «تجاهل المسودة والتحويل». أثناء pendingElsewhere يُعطّل الإجراء مع سبب واضح. لا POST قبل التأكيد واستدعاء prepareConvert وإجابته true؛ نافذة المغادرة تبقى واحدة عند تغيير route. إذا فشل التحويل بعد موافقة تجاهل صريحة، لا يُدّعى أن المسودة المتجاهلة محفوظة.
- [x] لا اختيار مشروع صالح يعني شرح السبب بجانب الإجراء، لا زر معطل مجهول. نجاح التحويل يتبع href الخادم ويحرر dirty بعد الإقرار؛ الفشل يبقي السجل وسبب الفشل. لا إنشاء واجهة جديدة داخل PMO.

مثال قبول قبل العملية غير القابلة للتراجع:
```ts
await page.getByPlaceholder('اكتب تعليقًا').fill('نص لم ينشر')
await page.getByRole('button', { name: 'المزيد', exact: true }).click()
await page.getByRole('menuitem', { name: 'تحويل إلى مهمة مشروع', exact: true }).click()
await page.getByRole('button', { name: 'المشروع', exact: true }).click()
await page.getByRole('option', { name: 'مشروع الأتمتة', exact: true }).click()
await page.getByRole('button', { name: 'تحويل المهمة', exact: true }).click()
expect(writes.filter(request => request.path.endsWith('/convert'))).toHaveLength(0)
await page.getByRole('button', { name: 'متابعة الكتابة', exact: true }).click()
await expect(page.getByPlaceholder('اكتب تعليقًا')).toHaveValue('نص لم ينشر')
```

**Verify:** 422/403/409/500/network لكل نوع كتابة، إعادة المحاولة اليدوية، إلغاء تأكيد، parent refresh بعد الفرعية، read-only، فقد وجهة التحويل، ونقرتان = POST واحد. إن تعارض التحويل مع النصوص، يُرفض POST محليًا أولًا. **Acceptance:** A6/A7/A8، مع عدم تكديس business dialogs.

## Task 5: قبول الرحلات وتسليم نسخة للمراجعة

**Files:** إنشاء `docs/verification/2026-10-15-my-tasks-ux-acceptance.md` وقت التنفيذ، ملف متصفح `apps/web/e2e/my-tasks-journey.spec.ts`، القصص والكتالوج بحسب التغيير؛ لا تعديل مصدر لمجرد تحسين تقرير.

- [x] بعد كل مهمة، تشغيل وحداتها ورحلتها الموجهة. عند استقرار المراحل، يشغّل المسؤول npm test وفحص الأنواع والسياسات مرة واحدة؛ لا إعادة full suite في كل خطوة.
- [x] بيانات mock تقبل السيناريوهات الموثقة صراحة، بما فيها create/update/transitions/comments/attachments/convert؛ لا الاعتماد على endpoint اصطناعي لا ينفذ الحفظ في تجربة المالك. إن احتاج القبول Odoo فعليًا لاحقًا فيكون scratch صريحًا منفصلًا، لا odoo19.
- [x] الجرد النهائي: list/create/record/edit/parent-child/comments/attachments/convert، ولكل دور read/create/write/convert حسب البيانات؛ لا كتابة أو بيانات مشاريع غير مخولة.
- [x] الرحلات: العثور → فتح → عودة؛ إنشاء → خطأ → تصحيح → نجاح؛ تعديل → مغادرة/409 → استكمال؛ فرعية → أب → قائمة؛ تعليق/مرفق فاشل → محاولة يدوية؛ تحويل → فشل/نجاح. مراقبة الطلبات تثبت غياب التكرار والنجاح الكاذب.
- [x] Storybook build واختبارات RTL القائمة، ومصفوفة 36 إعدادًا لقوالب مهامي مع screenshot قبل/بعد جديدتين منذ بداية هذه الدفعة. لا تُنسب صور أساس قديمة إلى هذه المقارنة.
- [ ] Tab/Shift+Tab/Enter/Escape، focus بعد الخطأ والبقاء وتغير الحالة، reduced motion، 44px، وviewport دون overflow. لوحة مفاتيح جوال ظاهرة على جهاز/محاكي إن توفر، وإلا تسجل كحد قبول.
- [ ] فحص diff الفعلي والتوثيق والقصص واللغة وحذف الملفات/الprops المنتهية؛ لا إضافة baseline أو تجاهل أخطاء. يُفتح runtime مستقل للمالك وتُسجل نتائج مراجعته، دون كومت أو دمج.

أوامر التحقق من worktree المستقبلي (المنافذ يختارها المنفذ بعد فحصها؛ لا يعيد استخدام 4401/4501/5501 الخاصة بمعاينة الأساس):
```sh
npm -w apps/web run test -- app/utils/__tests__/myTaskPayload.test.ts app/utils/__tests__/myTaskDetail.test.ts app/utils/__tests__/myTaskList.test.ts
E2E_MY_TASKS=1 E2E_BASE_URL=http://localhost:4402 npm -w apps/web run test:e2e -- e2e/my-tasks-new.spec.ts e2e/my-tasks-list.spec.ts e2e/my-tasks-detail.spec.ts e2e/my-tasks-journey.spec.ts
npm test
npm -w apps/web run lint
python3 -B tools/ui_policy.py
python3 -B tools/arch_policy.py --base main
node tools/ui_catalog.mjs
npm -w apps/web run build-storybook
```

4402 مثال مرشح بعد حجزه فقط، وليس ادعاء أن خادمًا يعمل عليه. إعداد Nuxt/mock يماثل بيئة الأساس بمنافذ مستقلة، ويتحقق المنفذ من أوامر RTL الحالية بدل اختراع gate جديد.

## تغطية التصور والاعتماد

| التصور | المرحلة | القبول |
|---|---|---|
| D1 | T2 | A1/A2 |
| D2 | T1 | A3/A4 |
| D3 | T3/T4 | A5/A7 |
| D4 | T4 | A6/A7/A8 |
| D5 | T1/T2/T3 | A2/A4/A9 |
| اللغة/الجوال/الملكية | T5 | A10/A11 |

هذه الخطة للمراجعة أولًا وفق طلب المالك. التنفيذ الموصى به متتابع داخل نسخة مستقلة بعد اعتمادها؛ لا كومت أو دمج ضمنيًا، ولا دخول إلى إعادة تصميم مهام المشاريع.

## نتيجة التنفيذ المحلي — 2026-10-16

نُفذت T1–T4 في نسخة مستقلة فوق كومتات حفظ العمل السابق، وأُنجزت فحوص T5 المحلية. الدليل التفصيلي وحدود التغطية في [تقرير القبول](../../verification/2026-10-15-my-tasks-ux-acceptance.md). المربعات الباقية جزئية: لم يُنفذ كل تركيب فشل للملفات، ولم تتوفر لوحة مفاتيح هاتف فعلية، وقبول المالك لم يصل بعد. التحقق الآلي واللمس المحاكى لا يستبدلان ذلك. التنفيذ الجديد غير مثبت بكومت، ولم يحدث دمج أو push أو نشر.
