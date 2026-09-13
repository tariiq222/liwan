# Storybook نسق — اللبنات المتكررة — 13 سبتمبر 2026

**طلب المستخدم:** مرجع Storybook متكامل يعرض مكونات النظام في صفحة واحدة، بحيث يظهر أي تعديل على كود المكوّن أو التوكن في Storybook والتطبيق معًا. Storybook أداة **عرض واختبار** فقط؛ لا يُحرَّر منه شيء، ولا يصبح مصدر تصميم.

**القرار المعتمد:** الطريقة ب — `@storybook/vue3-vite` بإصدار رسمي، بلا وحدة Nuxt. أُثبتت في تجربة `codex/storybook-spike-b` (`f164a58`) مقابل الطريقة أ (`codex/storybook-spike-a`، `ab1e470`) التي احتاجت نسخة ليلية غير مدعومة لـ Nuxt 4 وثلاثة overrides وأربع ترقيعات. كود التجربتين مرجع فقط ولا يُدمج.

## 1. الهدف والنطاق

**معيار الاختيار (قرار المستخدم):** Storybook للمكونات **المتكررة** فقط، لا لما يظهر مرة واحدة. المكوّن يدخل إذا استُخدم في ملفين أو أكثر، أو تكرر داخل ملف واحد (مثل بطاقة لكل مهمة)، **وكان لبنة** تُبنى بها الصفحات، لا نموذج إنشاء/تعديل أو قسم صفحة كامل. العدّ من الكود في 13 سبتمبر 2026: 53 مكونًا في ملفين أو أكثر، و3 مكررة داخل ملف، و68 مرة واحدة، و1 غير مستخدم كوسم.

النطاق:

1. **التوكنات:** الألوان والأسطح والحالات والخطوط والمسافات والزوايا والظلال وطبقات z، في المظاهر الثلاثة `light | dark | cream`، مع عائلة `--primary*` و`--chart-*` المشتقة من لون الهوية.
2. **وصفات Nuxt UI:** كل مكوّن مخصص في `apps/web/app/app.config.ts` (16): button (رتب الأزرار)، input، inputNumber، select، selectMenu، dropdownMenu، tooltip، popover، calendar، textarea، card، table، progress، badge، slideover، modal. تُعرض مكونات Nuxt UI نفسها بالوصفة الحقيقية، لا مغلفات.
3. **اللبنات المتكررة (30)** — بين قوسين عدد الملفات المستخدِمة:
   - الصفحة والحالة: `shared/PageHeader` (84)، `shared/PageState` (82)، `shared/PageContainer` (74)، `shared/UnsavedChanges` (29)، `shared/FormSection` (23)، `shared/RecordNumber` (18)، `settings/SettingsLayout` (17)، `shared/EmptyState` (11).
   - الحقول والفلاتر: `shared/FilterBar` (21)، `shared/DateField` (14)، `task/DescriptionEditor` (6)، `meetings/MeetingProjectFilter` (5)، `meetings/MeetingPeopleFields` (4)، `shared/FileField` (3)، `project/ProjectFieldHelp` (23 استخدامًا في ملفين).
   - الشارات: `project/ProjectStatusBadge` (6)، `task/StateBadge` (3)، `task/DeadlineBadge` (2)، `access/AccessStateBadge` (3)، `hr/AccessBadge` (2).
   - المنتقيات والقوائم: `task/PrioritySelect`، `task/StateMenu`، `task/TagPicker`، `project/ProjectMenu`، `shell/SidebarCreateAction`، `chat/ChatAttachment` (2 لكل منها).
   - البطاقات والرسوم: `task/TaskCard` (لكل مهمة في اللوحة)، `project/dashboard/DashboardChartPanel` (5 مرات)، `shared/DashboardChart` (2)، `charts/ChartContainer` (مرتان).
4. **الصفحة الشاملة «كل المكونات»:** صفحة docs واحدة تضم التوكنات والوصفات واللبنات بالترتيب أعلاه.

**خارج النطاق:** المكونات المستخدمة مرة واحدة (68)، ومنها `shared/FilterCard` و`charts/ChartLegendContent` و`charts/ChartStyle` و`charts/ChartTooltipContent` التي تظهر فقط داخل آبائها؛ المكونات المتكررة التي هي نماذج إنشاء/تعديل أو أقسام صفحات (26، مثل `MilestoneForm` و`TaskTable` و`ChatWorkspace`)؛ نشر Storybook أو استضافته؛ لقطات الانحدار البصري؛ تحرير التوكنات من الواجهة.

## 2. المبدأ الحاكم: لا نسخ

فشل `apps/web/design-preview` لأنه نسخ المكونات والثيم فانحرف. القواعد:

- كل قصة تستورد المكوّن من مساره الحقيقي في `apps/web/app/components/**`.
- لا ملفات `.vue` داخل `apps/web/stories/` أو `apps/web/.storybook/`.
- الثيم يأتي فقط من `apps/web/app/assets/css/main.css` و`app.config.ts` و`utils/brandTheme.ts` الحقيقية.
- قوائم التوكنات تُقرأ من `tokens.css` نفسه (استيراد `?raw` وتحليله عند العرض) ومن `getComputedStyle`، لا قوائم مكتوبة يدويًا.
- البيانات الوهمية بيانات اختبار تُمرَّر عبر مخططات Zod من `@nasq/contracts`؛ ليست مرجعًا بصريًا ولا تُستورد إلى `apps/web/app`.

## 3. المعمارية

```
apps/web/
  .storybook/
    main.ts              إطار vue3-vite، aliases، ‏@nuxt/ui/vite بخيارات nuxt.config/app.config الحقيقية
    nuxt-imports.mjs     يولّد الاستيرادات التلقائية والمكونات من .nuxt/imports.d.ts و.nuxt/components.d.ts (مكونات app/ فقط)
    nuxt-shims.ts        بدائل واجهات Nuxt وقت التشغيل (قائمة §4)
    nuxt-shim-report.mjs يفحص app/ ويفشل البناء إذا استُدعيت واجهة Nuxt بلا بديل
    preview.ts           i18n الحقيقي، vue-query، MSW، الـ decorator العام، أدوات الشريط
    public/mockServiceWorker.js
  stories/
    Overview.mdx                   الصفحة الشاملة
    foundations/*.mdx              التوكنات
    nuxt-ui/*.stories.ts           وصفات app.config
    shared/*.stories.ts
    charts/*.stories.ts
    fixtures/*.ts                  بيانات مُمررة عبر Zod
    handlers/*.ts                  معالجات MSW لـ /api/v1
```

**الحزم (devDependencies في `apps/web`، إصدارات مثبتة بدقة):** `storybook`، `@storybook/vue3-vite`، `@storybook/addon-docs` (10.6.x)، `msw`، `msw-storybook-addon`، `@vitejs/plugin-vue`.

**Vite:** التطبيق يُبنى فعليًا بـ Vite 8.2.2 (داخل `@nuxt/vite-builder`) بينما المستوى الأعلى 7.3.6 مصدره vitest. يُربط Storybook بـ Vite 8.2.2 ليطابق التطبيق. شرط القبول: `npm test` يبقى ناجحًا بلا تغيير في نسخة Vite التي يستخدمها vitest. إن تعذّر ذلك دون overrides، يبقى Storybook على 7.3.6 ويُسجَّل الفرق صراحةً في المرجع التقني.

**المتطلب المسبق:** `nuxt prepare` قبل `storybook dev/build` (السكربتات تشغّله).

## 4. بدائل Nuxt وحدود الانحراف

البدائل في ملف واحد `nuxt-shims.ts`، كل منها أدنى سلوك يحتاجه مكوّن فعلي:
`useFetch`، `useNuxtData`، `refreshNuxtData`، `useState`، `useCookie`، `$fetch`، `useRequestHeaders`، `useRuntimeConfig`، `useNuxtApp`/`tryUseNuxtApp`، `navigateTo`، `useRoute`/`useRouter` (vue-router حقيقي بذاكرة)، `useHead`؛ ومكونات `NuxtLink`، `ClientOnly`، `NuxtPage`.

- **كشف الانحراف:** `nuxt-shim-report.mjs` يمسح `app/**` عند كل تشغيل. في `dev` يطبع تحذيرًا؛ في `storybook build` يفشل البناء إذا ظهرت واجهة Nuxt غير مغطاة.
- **الأعلى خطرًا:** كاش `useFetch` المفتاحي (يعتمد عليه `useMe` و`useBranding`). `MeetingProjectFilter` يستخدم `useAccess` ← `useMe`، فيُختبر هذا المسار في هذه المرحلة بمحاكاة `/api/v1/me` عبر MSW.
- **مكونات تحتاج API (5):** `MeetingProjectFilter` (`/api/v1/me`، `/api/v1/projects`)، `MeetingPeopleFields` (`/api/v1/people`)، `TagPicker` (`/api/v1/tags`)، `StateMenu` (انتقال المهمة)، `ProjectMenu` (أرشفة المشروع). معالجات MSW تعيد بيانات تمر عبر مخططات العقود.
- **لا يُحاكى:** الـ bus، middleware المسارات، plugins Nuxt. أي مكوّن في النطاق يحتاجها يُسجَّل في §9 بدل ترقيعه.

## 5. الـ decorator وأدوات الشريط

**تحسين مستهدف في كود التطبيق:** منطق `<html>` في `apps/web/app/app.vue` (class المظهر، `data-font-size`، `lang`، `dir`) يُستخرج إلى دالة نقية `htmlAttrsFor({ mode, fontSize, lang, dir })` في `apps/web/app/utils/appearance.ts` مع اختبار وحدة. يستخدمها `app.vue` والـ decorator معًا، فلا يوجد نسخة ثانية تنحرف. سلوك التطبيق لا يتغير.

الـ decorator يلف كل قصة بـ `UApp` باللغة الصحيحة من `@nuxt/ui/locale`، ويطبّق `htmlAttrsFor`، ويحقن متغيرات `createBrandTheme(primary, mode)` الحقيقية.

**أدوات الشريط (globals):**

| الأداة | القيم | الافتراضي |
|---|---|---|
| اللغة/الاتجاه | `ar` (rtl) / `en` (ltr) | `ar` |
| المظهر | `light` / `dark` / `cream` | `light` |
| حجم الخط | `small` / `medium` / `large` | `small` |
| لون الهوية | لون hex يمر عبر `createBrandTheme` | `DEFAULT_PRIMARY` |

الـ decorator لا يكتب الحالة عند كل render (سبّب حلقة تحديث في التجربة)؛ يطبّقها عند تغيّر القيم فقط.

## 6. محتوى القصص

- **غلاف السياق الحقيقي:** غلاف كل قصة ينسخ عرض السياق الفعلي الذي يُستخدم فيه المكوّن وقيوده (العرض، الحشوة، الحد، والكلاسات الممررة للمكوّن مثل `w-full`)، ويذكر مصدره `ملف:سطر` في `parameters.nasqContext` وفي وصف القصة. لا عروض مخترعة مثل `max-w-xs`. مثال: `TaskCard` داخل عمود `w-72 p-2 border` من `apps/web/app/components/task/TaskBoard.vue:135`، و`DateField` بـ `class="w-full"` داخل حقل نموذج من `apps/web/app/pages/meetings/index.vue:247`.
- **تعدد السياقات:** إذا استُخدم المكوّن في أكثر من سياق مختلف الشكل، تكون لكل سياق قصة مسماة به، مثل «داخل نموذج» و«داخل عمود اللوحة». المكوّن الذي لا يُستخدم في أي مكان بعد تُكتب قصته بلا غلاف مع ملاحظة «غير مستخدم حاليًا». صفحات التوكنات ومعارض وصفات Nuxt UI مستثناة من شرط الغلاف لأن مصدرها `app.config.ts` وملفات CSS نفسها، لا سياق استخدام واحد.
- **كل مكوّن:** قصة `Default` + الحالات الواقعية التي يدعمها فعلًا (معطّل، خطأ تحقق، فارغ، تحميل، نص طويل يلتف). لا حالات مخترعة.
- **Controls:** props الحقيقية فقط؛ الأحداث تُسجَّل بـ actions.
- **التوكنات:** كل صفحة تعرض القيمة المحسوبة الحالية للمتغير، فتتغير مع أدوات الشريط.
- **الصفحة الشاملة:** `Overview.mdx` تعرض قصة `Default` لكل مكوّن ضمن أقسامها، مع رابط لصفحة المكوّن الكاملة. التوكنات تظهر كملخص (لوحة الألوان الأساسية والخطوط) مع رابط لصفحاتها.

## 7. فحص السياسة والتوثيق

**`tools/ui_policy.py`:**
- إضافة حزم §3 إلى القائمة المسموحة، مع تعليق يوضح أنها أدوات عرض لا مكتبة واجهة.
- رفض أي `.vue` تحت `apps/web/stories/` أو `apps/web/.storybook/`.
- رفض استيراد مكونات من خارج `apps/web/app/components/` داخل القصص، ورفض استيراد `stories/` من `apps/web/app/`.
- **شرط التغطية:** قائمة صريحة `STORYBOOK_COMPONENTS` في `tools/ui_policy.py` بمسارات اللبنات الثلاثين؛ كل مسار فيها يجب أن يكون المكوّن الأساسي لقصة. إضافة لبنة جديدة تعني إضافتها للقائمة وكتابة قصتها.
- **شرط مصدر السياق:** كل قصة تحمل `parameters.nasqContext` يشير إلى ملف موجود يستخدم المكوّن فعلًا. إذا تغيّر السطر ولم يعد يحوي استخدام المكوّن، يطبع الفحص تحذيرًا بتحديث المرجع.
- قاعدة `design-preview` المتقاعدة تبقى.

**التوثيق:**
- `DESIGN.md` جدول «ابدأ هنا»: سطر «رؤية المكونات والتوكنات حيّة ← Storybook (`npm -w apps/web run storybook`)؛ أداة عرض، ليست مصدر تصميم».
- `docs/design-system/nuxt-ui-reference.md`: قسم Storybook — المسارات، البدائل، حدود الانحراف، فرق Vite إن وُجد.
- `docs/design-system/components.md`: عمود أو ملاحظة بمسار القصة لكل مكوّن مغطى.

## 8. التحقق

1. `npm -w apps/web run build-storybook` ينجح (يشمل تقرير البدائل الصارم). المخرجات في `apps/web/storybook-static/` ضمن `.gitignore`.
2. اختبار Playwright `apps/web/e2e/storybook-smoke.spec.ts` يخدم البناء الثابت، يمر على كل قصة من `index.json` بالعربي/rtl ثم الإنجليزي/ltr والمظاهر الثلاثة، ويتأكد من عدم وجود أخطاء console أو استثناءات وأن جذر القصة غير فارغ.
3. `npm test`، `npx -w apps/web vue-tsc --noEmit`، `python3 -B tools/ui_policy.py` تبقى ناجحة. مجلد `.storybook` يُضاف إلى tsconfig مناسب حتى لا تبقى أخطاء الأنواع التي ظهرت في التجربة.
4. تحقق يدوي في المتصفح مع لقطات: الصفحة الشاملة، وتعديل كلاس في مكوّن حقيقي يظهر فورًا ثم يُعاد.

## 9. مخاطر ومسائل مفتوحة

- **مكونات تقاوم العزل:** `PageHeader` يعتمد على `usePageHeader` و`useProjectFrameHeading` و`useEscapeBack` والمسار؛ `PageContainer` على `useRoute`. تُعرض بمسار vue-router حقيقي بذاكرة. إن احتاج أيٌّ منها middleware أو بيانات جلسة، يُسجَّل هنا بدل ترقيعه في البدائل.
- **تباين التقويم في الوضع الداكن:** لقطة التجربة أظهرت أسماء أيام الأسبوع شبه غير مرئية. يُتحقق هل هي في التطبيق نفسه؛ إن كانت، تُبلَّغ كمشكلة منفصلة ولا تُصلح ضمن هذه المرحلة.
- **ترقيات Storybook:** إصدارات مثبتة بدقة؛ الترقية مهمة مستقلة تمر بفحص السياسة.
- **worktrees التجربتين** (`../nasq-storybook-spike-a`، `../nasq-storybook-spike-b`) تبقى مرجعًا حتى دمج هذا العمل، ثم تُحذف بموافقة المستخدم.

## 10. ما بعد هذه المرحلة

لا مراحل حسب الركائز. عندما يصبح مكوّن لبنةً متكررة (ملفان أو أكثر) يُضاف إلى `STORYBOOK_COMPONENTS` مع قصته. إذا تضخمت بدائل Nuxt عند إضافة مكونات تعتمد على الجلسة أو الـ bus، يُعاد تقييم الطريقة أ.
