# Meetings UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. The user approved this plan for isolated implementation on 2026-10-16; no Git integration is authorized. No commit, merge, push, deployment or cleanup is authorized by this document.

**Goal:** رحلة اجتماعات واضحة من العثور والتجهيز إلى المحضر والتوصيات والإنهاء والمتابعة، مع حفظ السياق والمسودة والصلاحيات.

**Architecture:** تحديث الصفحات والمكونات القائمة في موضعها، باستخدام Nuxt UI وقوالب Storybook المعتمدة. صفحة متابعة واحدة جديدة تستخدم قراءة خادمية في `nasq_meetings`، وربط PMO يبقى في `nasq_meetings_pmo`؛ لا نماذج أو حقول مخزنة جديدة.

**Tech Stack:** Nuxt 4 / Vue 3، Nuxt UI، TanStack Vue Query، Zod، Odoo 19 Community، Vitest وPlaywright واختبارات Odoo في scratch فقط.

**Spec:** [تصور الاجتماعات](../specs/2026-10-16-meetings-ux-design.md).

## Global Constraints

- التنفيذ بعد اعتماد المستخدم فقط، من أحدث `main` في worktree مستقل `codex/meetings-ux`؛ هذه الخطة مبنية على `03f0da9b` وتُراجع مقابل فرق main عند التنفيذ.
- `DESIGN.md` هو سياسة الواجهة؛ `/new` في `SharedCreatePanel` والتعديل صفحة، وثيم نسق وتوكناته وقصصه هي المصدر. لا نسخة مكوّن محلية ولا نافذة أعمال متراكبة.
- العربية RTL والإنجليزية LTR، فاتح/داكن، أحجام الخط14/16/18 بالعربية؛ قياسات قبول390/768/1440px.
- حالات الاجتماع تبقى `draft | confirmed | done | cancelled`. أسماء المعتمد والتوقيع بيانات مستند، لا محرك موافقات.
- `minutes_form` للمحضر المنظم، `agenda` لجدول الأعمال، `minutes` للملاحظات الإضافية الموجودة؛ لا حذف بيانات أو حقول ولا نسخ متوازية أو ترحيل تلقائي للمحتوى.
- حماية المسودة و`write_date` للسجل، والنسخ التاريخية، والمصدر والفلاتر وhash والروابط المباشرة تبقى. لا توسيع allowlist بلا صلاحية ولا اعتماد على history.
- API جلسة cookie، `json2`، `auth=user`، `api_handler`، ميزة التطبيق والقدرات والشركة وقواعد السجل؛ الغلاف `{items, total}`. لا `sudo()` جديد.
- استقلال الاجتماعات عن المشاريع إلزامي. لا تعديلات في Odoo upstream أو `nasq_pmo` أو تفاصيل المهام لتسهيل الواجهة.
- لا تشغيل اختبارات على `odoo19`. dependencies و`.nuxt` والقاعدة والمنافذ مستقلة؛ لا symlinks. لا commit/merge/push/deploy أو حذف مواد دون إذن مستقل.

## Review Focus

1. فتح لقاء من سلسلة مفلترة ثم تعديل/طباعة/توصية يجب أن يعود إلى السلسلة نفسها؛ اختبار المرحلة1 و3.
2. إنشاء توصية نجح ثم حصل refresh/فشل تنقل يجب ألا ينشئ ثانية أو يربطها بموضوع آخر؛ اختبار المرحلة3.
3. مهمة مرتبطة غير مقروءة أو مؤرشفة يجب ألا تسرّب حالة/رابطًا أو تفتح تنفيذًا بديلًا؛ اختبار المرحلة4.
4. حفظ متزامن أو فقد جلسة أثناء المحضر يجب أن يبقي المدخلات ولا يعلن حفظًا؛ اختبار المرحلة3.
5. نسخة محضر قديمة بعد إعادة الفتح أو تحديث تنفيذ المهمة يجب أن تبقى تاريخية في الشاشة والطباعة؛ اختبار المرحلتين3 و5.

---

## حزم العمل والملكية

المنسق يملك التكامل وmanifest وlocales وعقود البيانات وموارد التشغيل والمراجعة النهائية. حزم1–3 مترابطة في صفحة الاجتماع؛ لا يكتب وكيلان هذه الصفحة أو ملفات query معًا. حزمة4 تنقسم عند التنفيذ، بعد تثبيت عقد القراءة، إلى خادم/bridge ثم واجهة، ويمكن فصل حزمة5 بعد انتهاء تحرير المحضر. قرار هذه المراجعة: **inline** للتحقيق وكتابة الخطة، ووكيل مستقل لأسئلة بناء التصور. عند التنفيذ نعيد تقييم جدوى التوازي، لا نشغّل عددًا ثابتًا من الوكلاء.

كل وكيل منفّذ أو مراجع يستخدم `gpt-6.1-sol`، الجهد medium للعرض المحدد وhigh للعودة/الحفظ/الصلاحيات. لا أبناء دون تعيين. يحدد المنسق ملكية الملفات قبل أي dispatch، ويسجل القياس وفق `usage-policy.md`؛ لا تُنسب تكلفة الحساب كاملة لهذه المهمة.

## المرحلة 1: عزل التبويبات وإصلاح أصول الرحلة

**Files — Modify:**
`apps/web/app/pages/meetings/[id].vue`، `components/meetings/MeetingResolutionsTab.vue`، `components/meetings/MeetingTimeline.vue`، `pages/meetings/series/[id].vue`، `modules/meetings/manifest.ts`، `modules/meetings/navigation.ts` (المسارات المختصرة تحت `apps/web/app/`).
**Tests:** extend `apps/web/app/pages/__tests__/meetingNavigation.test.ts`، `meetingEditors.test.ts`؛ add `apps/web/e2e/meetings-ux.spec.ts` للاختبار المرئي الحقيقي للعزل؛ وحده فحص AST لا يثبت إخفاء التبويب.

**Interfaces:** استعمل `useRecordListPaths(owning)` و`recordChildTo` و`recordParentTo` و`recordSiblingTo` القائمة. أضف في manifest تسجيل مصدر `/^\/meetings\/series\/[1-9]\d*$/` بقدرة `meetings.read`، دون تسجيل مسارات edit/new أو كل `/meetings/**`. تمرّر مكونات التوصيات `sourcePaths.value` بدل الثابت وحده.

- [ ] أضف اختبار فشل: في `tab=summary|agenda|minutes|attachments|history|versions` تكون منطقة `#meeting-resolutions` و`#meeting-follow-up` مخفيتين، وتظهران عند resolutions؛ تغيير التبويب لا يمحو البحث أو ينتج إرسالًا ثانيًا لطلب جارٍ.
- [ ] أضف اختبار فشل لمسار `/meetings/series/1?tab=sessions&session_q=review&session_view=table` ← لقاء ← edit/minutes/print/resolution ← لقاء ← نفس السلسلة؛ اختبر المصدر المزور والخارجي والمسار الذي سقطت صلاحيته.
- [ ] شغّل الاختبارات وسجّل أنها تفشل للأسباب المحددة، ثم أصلح الحاوية متعددة الجذور وروابط القادم/السابق/المتابعة/إضافة اللقاء باستخدام أدوات الرحلة القائمة.
- [ ] تحقق من روابط المشروع المدمجة سابقًا `/projects/:id/meetings` والبحث والإشعارات؛ لا تعدل أدوات العودة المشتركة إلا إذا أثبت الاختبار خللًا مشتركًا، وعندها تراجع ملكيتها أولًا.
- [ ] روابط المهمة المرتبطة تفتح تبويبًا جديدًا مع وصف ظاهر وقابل للوصول؛ بعد التحويل لا يستدعي المكوّن `navigateTo('/tasks/...')` تلقائيًا، بل يظهر رابط النتيجة داخل الاجتماع. ينطبق ذلك أيضًا على متابعة الدوري والعامة؛ لا تُنشأ المهمة مرتين عند تعثر فتح التبويب، ولا تُستخدم popup بعد الطلب async.
- [ ] شغّل: `npm -w apps/web run test -- app/pages/__tests__/meetingNavigation.test.ts app/pages/__tests__/meetingEditors.test.ts`؛ اختبر العزل والرجوع بصريًا في المعاينة المعزولة. الناتج المطلوب A1 وA2، لا مجرد تعديل CSS.

## المرحلة 2: المدخل والتقويم وصفحة الاجتماع

**Files — Modify:** `apps/web/app/pages/meetings/index.vue`، `calendar.vue`، `[id].vue`؛ `app/utils/meetingTabs.ts` و`meetingRoutes.ts` و`meetingListFilters.ts`؛ `app/components/meetings/MeetingRecordTabs.vue`؛ `app/modules/meetings/manifest.ts`؛ `apps/web/i18n/locales/{ar,en}/meetings.json` و`common.json`؛ قصص المكونات المعدلة في `apps/web/stories/meetings/`.
**Tests:** `apps/web/app/pages/__tests__/meetingCalendar.test.ts`، `meetingForms.test.ts`، `meetingEditors.test.ts`؛ `app/utils/__tests__/meetingTabs.test.ts` و`meetingListFilters.test.ts`؛ `e2e/meetings-ux.spec.ts`.

**Interfaces:** المساران `/meetings` و`/meetings/calendar` باقيان. يمر مبدّل العرض `q,mine,state,project_id,organizer_id,series_id`؛ التقويم يرسلها فعلًا إلى hook القراءة القائمة. يحتفظ month/year/day في رابط التقويم، وتبقى date_from/date_to فلاتر القائمة ولا تستبدل المدى الذي يجلبه التقويم للشهر. عند الانتقال إلى التقويم يُستعمل شهر date_from الصحيح إن وجد، وإلا الشهر الحالي؛ العودة من التقويم تبني فترة الشهر المعروض عند غياب فترة قائمة صريحة. لا حاجة لمخزن تفضيل عرض جديد.

- [ ] ثبّت اختبارات الانتقال بين العرضين، refresh، يوم مختار، فلتر غير مدعوم/تاريخ غير صالح، ووصول أول نقرة بعد hydration. لا تُسقط الفلاتر في تغيير العرض.
- [ ] غيّر الأعمدة إلى الاجتماع/الموعد/المنظّم/الحالة/التوصيات. المرجع تحت الاسم، والتاريخ والوقت في الموعد. قوائم الجوال تحمل المعلومات الأساسية نفسها.
- [ ] أضف تبديل قائمة/تقويم، وزر إنشاء بالتقويم يحمل `date=YYYY-MM-DD` لليوم المختار فقط. اقرأ `date` في نموذج الإنشاء بعد التحقق منه؛ project/series لا تستنتجان من أسماء query.
- [ ] طبّق التبويبات الخمسة: summary باسم «نظرة عامة»، minutes، resolutions، attachments، history. `meetingTabFromRoute` يحتفظ بقبول الروابط القائمة: agenda يفتح summary وقسمه، versions يفتح history مع عرض النسخ؛ hash الحالي يفتح المحتوى الموافق. لا تنشئ صفحة تحويل أو نسخة قديمة من المكوّن.
- [ ] في السجل استخدم ملخصًا تشغيليًا ظاهرًا للموعد والمنظّم والرابط، وخصائص مساندة غير مكررة؛ اختصر المسميات الجانبية فقط، واحتفظ بعنوان breadcrumb الكامل كما في المشاريع.
- [ ] نفّذ اختبار ظهور واحد للمحتوى/العنوان، لوحة المفاتيح، العرض الضيق، وعدم ظهور إنشاء لمن لا يملكه. Run: `npm -w apps/web run test -- app/pages/__tests__/meetingCalendar.test.ts app/pages/__tests__/meetingForms.test.ts app/utils/__tests__/meetingTabs.test.ts app/utils/__tests__/meetingListFilters.test.ts`؛ راجع A2 وA8 بصريًا.

## المرحلة 3: المحضر والحفظ والتوصية والإنهاء

**Files — Modify:** `apps/web/app/pages/meetings/new.vue`، `[id]/edit.vue`، `[id]/minutes.vue`، `[id].vue`، `[id]/resolutions/new.vue`، `[id]/resolutions/[resolutionId]/edit.vue`؛ `app/components/meetings/MeetingMinutesForm.vue` و`MeetingMinutesDocument.vue`؛ `app/composables/useMeetingTransitions.ts` و`useMeetingSubmitError.ts`؛ `app/utils/meetingMinutesForm.ts`؛ locales/قصص الاجتماعات.
**Create:** `apps/web/app/utils/meetingEditorContext.ts` واختباره `__tests__/meetingEditorContext.test.ts`.
**Tests:** extend `pages/__tests__/meetingEditors.test.ts`، `meetingForms.test.ts`، `meetingPrint.test.ts`؛ `composables/__tests__/useMeetingTransitions.test.ts`، `e2e/meetings-ux.spec.ts`.

**Interfaces:**
- `parseMeetingEditorContext(query: LocationQuery): {topicKey: string | null; newResolutionId: number | null} | null` يقبل `editor=minutes` فقط، مع معرّف موجب صالح وtopic_key نصي ضمن حد200 الحالي.
- `meetingRecommendationCreateTo(meetingId: number, query: LocationQuery, sourcePaths: readonly string[], topicKey?: string): RouteLocationRaw` يحمل سياق المحرر وأصل القائمة المسموح دون تعشيق returnTo.
- `meetingMinutesEditorTo(meetingId: number, query: LocationQuery, sourcePaths: readonly string[], newResolutionId?: number): RouteLocationRaw` يبني الرجوع للمحرر، لا من URL حر. إنشاء التوصية من تبويبها العادي يبقى راجعًا إلى resolutions.
- حدث `save-and-create-resolution` في `MeetingMinutesForm` يحمل `[topicKey?: string]`: زر في الموضوع يمرّر key؛ الزر العام ينشئ توصية غير مرتبطة بموضوع.
- لا endpoint كتابة جديد: POST التوصية القائم، ثم تحديد محلي في المحضر يُثبت فقط عند PATCH التالي. تؤخذ هوية السجل والموضوع من البيانات المحمّلة، ولا يُقبل ربط توصية لا تخص الاجتماع أو تعيينها لموضوعين.

- [ ] اختبر قبل التنفيذ: فشل حفظ المحضر يمنع لوحة التوصية؛ النجاح يعود للموضوع؛ الإلغاء يعود للنسخة المحفوظة؛ refresh بعد POST لا يعيد POST؛ موضوع محذوف أو توصية محجوبة يظهران تنبيهًا ولا ربطًا بديلًا. بعد العودة يكون الربط المحلي dirty وتظهر عبارة أن حفظ المحضر مطلوب.
- [ ] اختبر 409 بعد فتح المحرر وrefetch أثناء وجود مسودة وفقد الجلسة ونتيجة إنشاء غير مؤكدة. احتفظ بـopenedWriteDate الحالي؛ لا تستبدله بآخر refetch ولا تعاود POST عند network error.
- [ ] حرّر agenda من edit فقط؛ في minutes اعرض مقتطفًا مقروءًا ورابط تعديل محمي بالمسودة. احذف agenda من payload حفظ المحضر. أعد ترتيب النموذج المنظم، وسمّ minutes «ملاحظات إضافية»، قابلة للطي لكن ظاهرة إن كان فيها نص. لا تحويل بيانات ولا تغيير عقد اكتمال الخادم.
- [ ] استخدم تحققًا بعد المحاولة للنماذج، مع أسماء أخطاء ومواضع تركيز فعلية، وloading على الحفظ. لا تعطّل الحفظ بسبب خطأ غير ظاهر؛ التعطيل عند عدم التغيير/عدم الصلاحية/الطلب يوضح سببه. طبّق `UFormField` على حقول المحضر بدل labels المتفرقة.
- [ ] ابنِ عرض المحضر للشاشة بمواضيع مقروءة، وبقي جدول الطباعة من المصدر نفسه. لا تجلب أسماء مشاريع محجوبة؛ غياب الاسم لا يبرر كشف رقم داخلي للمستخدم. إذا لم يوفر العقد اسم الموضوع استخدم «مشروع مرتبط»؛ الاسم المتاح يظل مع التوصية التابعة.
- [ ] قبل complete اعرض نواقص بداية/نهاية/محتوى وفق شرط `_nasq_completion_gap` الحالي وروابط إصلاحها، ثم التأكيد والتثبيت. لا تضف شرط اكتمال توقيع أو جميع التوصيات. تبقى سلطة القبول للخادم؛ عرض خطأ الانتقال في سياقه مع إمكان إعادة المحاولة بدل فقده في toast.
- [ ] الإجراء الرئيسي: draft «تأكيد الاجتماع» للمحرّر؛ confirmed في المحضر «تحرير المحضر» للمحرّر و«إنهاء الاجتماع» كإجراء ثانوي للمدير، وفي النظرة العامة يبرز «إنهاء الاجتماع» للمدير بعد الجاهزية؛ done معاينة المحضر، وإعادة الفتح إجراء ثانوي للمخوّل. لا يظهر إجراء أعلى من `can_edit/can_manage/allowed_actions`.
- [ ] Run: `npm -w apps/web run test -- app/pages/__tests__/meetingEditors.test.ts app/pages/__tests__/meetingForms.test.ts app/pages/__tests__/meetingPrint.test.ts app/utils/__tests__/meetingEditorContext.test.ts app/composables/__tests__/useMeetingTransitions.test.ts`؛ تحقق حي على scratch من حفظ/تعارض/إنهاء/إعادة فتح/نسخة قديمة. الناتج A3 وA4 وA5.

## المرحلة 4: المتابعة العامة ودلالة الحالة

**Files — Modify:** `odoo-addons/nasq_meetings/controllers/meeting_workspace.py`، `models/meeting_links.py`؛ `odoo-addons/nasq_meetings_pmo/models/meeting_links_pmo.py`؛ `packages/contracts/src/meetings/index.ts`؛ `apps/web/app/composables/useMeetingWorkspace.ts` و`meetingKeys.ts`؛ `app/modules/meetings/manifest.ts`، `app/pages/meetings/series/[id].vue`؛ locales.
**Create:** `apps/web/app/pages/meetings/follow-up.vue`؛ `odoo-addons/nasq_meetings/tests/test_meeting_followup.py`، `odoo-addons/nasq_meetings_pmo/tests/test_meeting_followup_pmo.py` وتسجيلهما في `tests/__init__.py`؛ `packages/contracts/src/meetings/__tests__/followup.test.ts`؛ `apps/web/app/composables/__tests__/useMeetingFollowup.test.ts`.

**Prerequisite:** قبل كود Odoo نفّذ `odoo-workflow` ومرجع19، وحدّث Context Brief من المصدر الفعلي. أهم مواضع البدء الحالية: `_nasq_meeting_access_domain` في `meeting_access.py:9`، `series_resolutions` في `meeting_workspace.py:89`، `dump_resolution` في `serializers/meeting.py:160`، و`_nasq_readable_links` في bridge. لا تغيير لـCyan أو قواعد الرؤية لمجرد إظهار مزيد من النتائج.

**Interfaces:**
- `MeetingFollowupListSchema = {items: MeetingPreviousResolutionSchema[], total: number}`؛ قراءة `GET /api/v1/meetings/resolutions` بعقد القسم7 من التصور. اسم Zod جديد للوجهة، مع إعادة استعمال schema العنصر القائم دون نسخه.
- `useMeetingFollowup(params: MaybeRefOrGetter<{q?: string; mine?: boolean; state?: 'active'|'overdue'|'open'|'in_progress'|'done'|'cancelled'; limit?: number; offset?: number}>)` يعيد Vue Query المعتاد، ويستخدم مفتاحًا يضم جميع الفلاتر.
- hook جديد في `nasq.meeting.links`: `_nasq_resolution_execution_domain(states: tuple[str, ...]) -> list` يعيد domain على التوصيات مطابقًا لحالة serializer الحالية. الأساسي يستخدم state؛ bridge يطابق حالات المهام المقروءة فقط، ويستثني هذه الروابط من فرع state الأساسي. قيد التأخر يضاف إلى deadline بعد domain الحالة. لا filter/count بعد pagination.

- [ ] اكتب اختبارات فشل للعقد والعدد والصفحات:25 عنصرًا، أكثر من100، mine، invalid state422، لا قدرة403، شركة أخرى، مشارك/كاتب/مدير، ومسؤول غير مشارك لا يكتسب رؤية جديدة. كل سجل في total يطابق نفس مجال items.
- [ ] اختبر بدون PMO، ثم مع مهمة انتهت وتوصية state قديمة، ومهمة غير مقروءة ومؤرشفة. فلتر active/overdue والدوري والعام يطابق الشارة المصَفّاة، ولا يعرض task_id أو حالة مخفية من bridge. حافظ على behavior serializer الحالي عند غياب رابط مقروء.
- [ ] نفّذ القراءة في التطبيق والربط في bridge، واستعمل hook نفسه لتصحيح فلتر الدوري. راجع search/count على مجموعة كبيرة (5000 توصية، صفحات متعددة) وقارن عدد الاستعلامات على250 و5000 سجل؛ امنع استعلامًا لكل عنصر أو جلب كل المحتوى للعميل. أصلح أي N+1 داخل ملكية هذه الحزمة فقط.
- [ ] ابنِ صفحة متابعة قراءة وفتح مصدر فقط: بحث، «الكل / المسندة إلي»، الحالة، وصف المصدر، المسؤول، الموعد/مدة نصية، شارة التنفيذ، رابط الاجتماع والمهمة المسموحين. لا زر إنشاء توصية بلا اجتماع ولا محرر ثانٍ. النتائج والأخطاء والفراغ وpagination من المكونات المعتمدة.
- [ ] Run: `npm -w packages/contracts run test -- src/meetings/__tests__/followup.test.ts` و`npm -w apps/web run test -- app/composables/__tests__/useMeetingFollowup.test.ts`؛ اختبارات addonين على scratchين منفصلين (الاجتماعات منفردة ثم مع bridge) وفق `docs/agents/odoo-rules.md`، مع عدد اختبارات موجب. لا نعد mock دليل ACL. الناتج A6.

## المرحلة 5: الدوري والمرفقات والطباعة والقبول المتكامل

**Files — Modify:** `apps/web/app/pages/meetings/series.vue`، `series/new.vue`، `series/[id].vue`، `series/[id]/edit.vue`، `[id]/print.vue`؛ `app/components/meetings/MeetingAttachmentsTab.vue` و`MeetingVersionList.vue`؛ قصصها وترجماتها؛ اختبارات الاجتماع القائمة و`e2e/meetings-ux.spec.ts`.

**Interfaces:** إعدادات السلسلة تبقى العقد الحالي (الاسم/الافتراضيات). `scope=this|this_and_following` ينتمي لتعديل/إلغاء اللقاء بعقده الحالي، ولا يوهم بتغيير المحضر/الحضور/الماضي. print يستخدم `selectMeetingMinutesSource` وversion_id، لا بيانات حية بدل نسخة تاريخية.

- [ ] اختبر نموذج دوري pristine بلا أخطاء، أسبوعي/كل أسبوعين/شهري/حسب الحاجة، حدعدد أو نهاية، منتصف الليل ومنطقة زمنية مختلفة، إعادة فتح النموذج وعدم تغيير افتراضياته فوق إدخال المستخدم؛ طبق التحقق ونصوص النطاق والمعاينة ذات الصلة.
- [ ] اختبر ملفًا صالحًا ورفض نوع/حجم10MiB، وفشل الشبكة، وفشل حذف لا يفقد صف الملف؛ التحميل والحذف pending وتأكيد داخل الصفحة. لا رفع أو حذف عند القراءة فقط أو اجتماع مقفل.
- [ ] اختبر عرض سجل النسخ وصفحة الطباعة: الاسم ورقم النسخة والتاريخ، اختيار نسخة قديمة بعد إعادة الفتح، عدم مزج حالة تنفيذ حية داخل مستند تاريخي؛ preview ورقي طويل عربي/إنجليزي دون قص التوصيات. أزرار الطباعة والرجوع لا تظهر على الورق.
- [ ] حدّث قصص المكونات والفهرس/الكتالوج فقط إن تغيرت واجهاتها: `node tools/ui_catalog.mjs`؛ لا تغييرات مولدة لا تتعلق بالحزمة.
- [ ] نفّذ رحلات A1–A8، مرة كمدير ومرة كمحرّر ومشارك ومستخدم دون قدرة الاجتماعات، وبـPMO مفعّل ومعطّل. browser mocks لفشل الشبكة، وOdoo scratch للكتابة والحالة والربط والعزل. لا تعاود التحقق نفسه بلا تغيير أو فشل.
- [ ] المنسق وحده يجري دفعة الختام: `npm test`، `npm -w apps/web run lint`، `ruff check odoo-addons/nasq_meetings odoo-addons/nasq_meetings_pmo`، `python3 -B tools/arch_policy.py --base main`، ومراجعة مستقلة للكود/العقود تشمل Odoo. جولات Playwright: `E2E_BASE_URL="$MEETINGS_UX_URL" npm -w apps/web run test:e2e -- e2e/meetings-ux.spec.ts` بعد تعريف `MEETINGS_UX_URL` من رابط خادم هذه المهمة المسجل والتحقق من أنه غير فارغ، واختبارات الحالة في scratch المسمّاة صراحةً.
- [ ] وثّق في `docs/verification/2026-10-16-meetings-ux.md` ما تحقق ولقطات الرحلات وحدود mock/Odoo والنتائج والمخاطر؛ حدّث تاريخ الوثيقة إن بدأ التنفيذ لاحقًا. سلّم النسخة للتجربة دون commit/merge. إذا طُلب الدمج لاحقًا تُطبّق قواعد التكامل كاملة مع أحدث main.

## مراجعة الخطة الحالية

تغطي المراحل قرارات الصفحات والرحلات وعقود A1–A8. الأخطار الخمسة مربوطة باختبارات في الحزم المالكة. نُفّذ التصور في الفرع المعزول codex/meetings-ux؛ نتائج التحقق الفعلية وحدودها في [سجل التحقق](../../verification/2026-10-16-meetings-ux.md)، ولا تُعد أوامر الخطة بحد ذاتها أدلة نجاح. قد تُعدّل أسماء helpers التفصيلية قبل التنفيذ إذا تغير المصدر، مع بقاء العقود والسلوك واعتماد النطاق.
