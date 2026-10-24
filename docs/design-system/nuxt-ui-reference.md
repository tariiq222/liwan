# مرجع واجهة Nuxt UI

المرجع الملزم هو [DESIGN.md](../../DESIGN.md)، أما هذا الملف فيصف مصدر
التنفيذ وحدود المكتبة. مكونات العميل الفعلية في `apps/web/app` والطبقتين
المشتركتين `packages/ui/app` و`packages/commercial-ui/app` هي مصادر التشغيل.
مصدر Vue/CSS في `/Users/tariq/Downloads/nasq-ui` للمقارنة فقط.

## المصدر والملكية

| الجزء | المصدر الحالي |
| --- | --- |
| مكتبة الواجهة | `@nuxt/ui` بالإصدار المثبت في `apps/web/package.json` و`package-lock.json` |
| وصفات Nuxt UI | `packages/ui/app/app.config.ts` |
| مدخل CSS والخط | `packages/ui/app/assets/css/main.css`؛ يستورد `tokens.css` و`components.css` و`shell.css` وخط IBM Plex Sans Arabic المحلي |
| توكنات الأسطح والتحكم | `packages/ui/app/assets/css/tokens.css`, `packages/ui/app/assets/css/components.css`, `packages/ui/app/assets/css/shell.css` |
| لون الهوية | `primary_color` يُحفظ للمستندات والتقارير (الفواتير والمطبوعات) فقط؛ ألوان الواجهة ثابتة من `tokens.css` ولا تتبعه |
| حالة المظهر والخط | `apps/web/app/composables/useAppearance.ts` و`apps/web/app/utils/appearance.ts`؛ الحالة وcookie هنا |
| الرسوم | `apps/web/app/components/shared/data/DashboardChart.client.vue` ومحولات `apps/web/app/components/charts/` باستخدام Unovis |
| ملكية المكونات | [فهرس المكونات](components.md)؛ المسارات تشمل `apps/web/app/components/` و`packages/ui/app/components/` و`packages/commercial-ui/app/` |

مدخلات الثيم (كما في DESIGN.md §1): لوحة ويب فيو الثابتة (أزرق ويب فيو
`#007ff8` للتعبئات والأيقونات والحلقات بلا نص، و`#0066cc` لكل تعبئة ممتلئة بنص أبيض) تغذّي `primary`، والمحايد `slate`، وهوية ويب فيو: الأزرق الليلي
والليموني `#c6f432` في `tokens.css`، وخط IBM Plex Sans Arabic بثلاثة أحجام،
ومظهران فقط (فاتح وداكن؛ أي قيمة قديمة مخزنة تُقرأ فاتحًا). الكثافة من
`--webvue-control-h` (32px) و`--webvue-row-h` (44px)، والزوايا من
`--radius-card` (18px) و`--radius-control` (12px)، والظلال للطبقات العائمة فقط. الريل ثابت
بـ `--webvue-rail`. هندسة الغلاف في قسم «الغلاف» أدناه.
اللون الافتراضي للشركة (`primary_color`) هو `#0066cc`. الواجهة لا تتبع لون الشركة: عائلة `--primary*` و`--chart-*` وتوكنات النجاح
والتحذير والخطأ والمعلومة ثابتة في `tokens.css` لكل مظهر. الشعار المعتمد في
`packages/ui/app/components/shared/layout/BrandWordmark.vue`. ولا تُنقل ملفات المصدر المقارن
أو بياناته أو مساراته التجريبية إلى التشغيل.

## حدود الاستخدام

- استخدم Nuxt UI مباشرة عندما تكفي، وسجّل المكوّن المركب في [الفهرس](components.md)
  بمسار كامل ووظيفة واضحة.
- Reka وTanStack وTiptap وUnovis تبعيات تخصص؛ ليست مكتبة تحكم أو ثيمًا ثانيًا.
- تبقى المسارات والحقول والفلاتر والحسابات والصلاحيات وحماية المسودة والطباعة
  مملوكة للصفحات والمكونات الحالية؛ تغيير الشكل لا يعيد تعريفها.
- لا تُستورد واجهة HTML أو بيانات نموذجية أو composables أو hash routes من
  `/Users/tariq/Downloads/nasq-ui` إلى العميل.
- حدود الترخيص للكود المحتفظ به تبقى مع ذلك الكود، ولا تُنسخ ملفات أو lockfile
  المصدر المقارن إلى المستودع.

الفحص الساكن المحلي هو `python3 -B tools/ui_policy.py`. يراجع الفحص مسارات
المكونات والتبعيات والاستيرادات والألوان؛ لا يثبت وحده الشكل أو السلوك أو صحة
Odoo أو API أو النشر. الاختبارات والبناء ومراجعة المتصفح مسؤولية المنسق.

## الوصفات

لا وصفات مخصصة إلا المعتمدة في DESIGN.md «وصفات الثيم المعتمدة»: `app.config.ts` يضبط `colors` والوصفات المذكورة وطبقات z، و`components.css` قواعد الغلاف فقط. الاستثناء اللوني الوحيد: الزر الأساسي الممتلئ في الوضع الداكن يُرسم من `--primary-solid` عبر `compoundVariants` لـ`button`. المكوّنات تُستخدم بوصفاتها الأصلية كما في Figma «Nuxt UI v4 (Community)»، والأسطح المسطّحة بأدوات المكتبة (`rounded-lg ring ring-default bg-default`).

## Storybook

Storybook في `apps/web` هو **فهرس المكونات الملزم** لكل وكيل: يعرض المكونات المتكررة وتوكنات النظام ووصفات Nuxt UI الحقيقية، ومنه تؤخذ اللبنة. لا يحرر شيئًا ولا يضيف مصدرًا بصريًا؛ القرار الشكلي لـ DESIGN.md. المكوّن المستخدم مرة واحدة لا يدخله.

| الجزء | المسار |
| --- | --- |
| الإعداد | `apps/web/.storybook/main.ts`، `preview.ts` |
| الاستيرادات التلقائية | تُولَّد من `.nuxt/imports.d.ts` و`.nuxt/components.d.ts` في `nuxt-imports.mjs` |
| بدائل Nuxt | `apps/web/.storybook/nuxt-shims.ts`؛ البناء يفشل إذا استدعى كود التطبيق واجهة Nuxt بلا بديل |
| القصص | `apps/web/stories/**`؛ كل قصة مكوّن تذكر سياقها الحقيقي بـ `storyContext('ملف:سطر')` |
| البيانات والـ API | `apps/web/stories/fixtures/**` تمر عبر مخططات `@webvue/contracts`؛ `apps/web/stories/handlers/api.ts` يحاكي `/api/v1` عبر MSW |
| قائمة التغطية | `STORYBOOK_COMPONENTS` في `tools/ui_policy.py` |

التشغيل: `npm -w apps/web run storybook` (منفذ 6006، أو `-- -p <port>`). البناء: `npm -w apps/web run build-storybook`. الفحص: `cd apps/web && npx playwright test e2e/storybook-smoke.spec.ts` بعد البناء (بلا فلترة grep؛ فحص الأنواع `cd apps/web && npx vue-tsc --noEmit -p .storybook/tsconfig.json` يجب أن يخرج بـ 0 مباشرة (لا تستخدم `npx -w`؛ `npx` لا يدعمها فيفحص لا شيء ويخرج بـ 0 كاذب)).

إضافة لبنة: عندما يُستخدم مكوّن في ملفين أو أكثر، أضف مساره إلى `STORYBOOK_COMPONENTS` واكتب قصته داخل سياق استخدامه.

**Vite:** إضافة `vite@8.2.2` إلى `apps/web/devDependencies` رفعت نسخة Vite على مستوى المستودع كله، فصار Nuxt وStorybook وvitest يحلّون جميعًا على 8.2.2 بدل 7.3.6 التي كان vitest يستخدمها وحده سابقًا. القرار المعتمد: الإبقاء على 8.2.2 كنسخة موحّدة، لا الرجوع عنها؛ كل تابع لـ Vite في المستودع يقبل `^8` وحزمة الويب الكاملة تمر بنجاح عليها (`npm ls vite` يُظهر نسخة واحدة مُوحَّدة).

**سطح البدائل اليدوية** (كل بند فيه فحص يراقبه):

| الملف | الغرض | يُراقبه |
| --- | --- | --- |
| `nuxt-shims.ts` | بدائل واجهات Nuxt وقت التشغيل (`useFetch`، `useState`، `useRoute`… راجع §4 في المواصفة) | فحص `nuxt-imports.mjs` وقت البناء يفشل إذا استدعى كود التطبيق واجهة بلا بديل هنا |
| `nuxt-ui-imports-shim.mjs` | يوفّر `#imports` لداخليات Nuxt UI (`useAsyncData`، `onNuxtReady`…) التي لا يغطيها بديل `@nuxt/ui` نفسه | يُستخدم عبر alias `#imports` في `main.ts`؛ أي فشل في تحميله يظهر فورًا كخطأ بناء |
| `nuxt-icon-client-bundle-shim.mjs` | يسجّل مجموعة lucide الكاملة عبر `addCollection` بدل حزمة العميل المولَّدة من `#build/nuxt-icon-client-bundle` | يُستدعى في `preview.ts` قبل أي عرض؛ راجع حد الانحراف أدناه |
| مُلحق استبدال `import.meta.*` | يستبدل `import.meta.server/client/dev` داخل `node_modules` لأن Vite dev-server يتجاوز ملفات `.js` الصالحة هناك | `importMetaEnvShim()` في `main.ts` |
| متغيرات `defineNuxtConfig`/`defineAppConfig` العامة واستعادة خيارات الأيقونة | تُبقي `nuxt.config.ts`/`app.config.ts` الحقيقيين قابلين للاستيراد كما هما، وتستعيد `cssSelectorPrefix`/`collections` التي يوفرها Nuxt عادة | أعلى `main.ts` وداخل خيارات `ui()` فيه |

**حد معروف — تعتيم الأيقونات:** يسجّل Storybook مجموعة lucide كاملة، بينما يشحن التطبيق فعليًا حزمة العميل الممسوحة فقط مع `icon: { fallbackToApi: false }` في `nuxt.config.ts`. أيقونة غائبة عن مسح التطبيق قد تظهر في Storybook ولا تظهر في التطبيق نفسه؛ هذا التعتيم متعمّد لسرعة العرض وليس خطأ في البديل.

حدود معروفة أخرى: الـ bus وmiddleware المسارات وplugins Nuxt غير محاكاة؛ كاش `useFetch` في البدائل مبسّط؛ أرشفة المشروع في `ProjectMenu` تعرض خطأ 422 بدل النجاح.

## الغلاف

غلاف ويب فيو مخصص (`apps/web/app/components/shell/`) ولا يستخدم `UDashboard*`، لثلاثة أسباب: الهيدر يجب أن يعلو القائمة السياقية، ونقطة التوقف `lg` مثبتة داخل المكونات، ولكل شريط جانبي درج جوال خاص بجهة ثابتة على اليسار. زر طي القائمة السياقية يبقى معطلًا حتى الترطيب (قاعدة `useHydrated()`)، أما حالته فتُحفظ في كوكي `webvue-context-sidebar` يقرؤه الخادم فتُرسم من أول إطار، بالأسلوب نفسه الذي يستخدمه `useResizable`. المكونات المستخدمة داخله: `USlideover` و`UButton` و`UTooltip` و`UBreadcrumb` و`UBadge`.

تُستخدم `UCommandPalette` داخل `UModal` في `shell/GlobalSearch.vue` وحده، ويمنع `ui_policy` استخدامها في مكان آخر. إعداداتها:

- المجموعات معروضة بـ`preserve-group-order`.
- مجموعات البحث `ignoreFilter`، لأن المزوّد طابق النص مسبقًا.
- `fuse.resultLimit` أكبر من الافتراضي 12.
- `#item-trailing` يعرض المفاتيح، ويخفيها عن قارئ الشاشة في الصفوف القابلة للتنفيذ حتى يبقى اسم الخيار هو عنوانه.
- `#close` فيه زر الرجوع من عرض الاختصارات وزر الإغلاق.
- `#footer` فيه تلميحات التنقل.

`defineShortcuts` غير مستخدم، لأن نسخة 4.11.1 لا تناسب الاختصارات المطلوبة:

- لا تطابق `/` و`?` و`[` في الوضع المستقل عن التخطيط.
- لا تقرأ `isComposing`.
- لا تعرف القوائم المفتوحة.


## القوالب والحالات

القوالب مكونات مركبة رقيقة فوق Nuxt UI، ولا تُغيّر وصفات المكتبة:

- `SharedDataTable` فوق `UTable` و`UCheckbox`، والترقيم بـ`SharedPagination`. الأعمدة `TableColumn<T>` كما هي، وخانات `#<column>-cell` تمر إلى `UTable`.
- `SharedViewSwitch` مجموعة `UButton`.
- الحالات: `USkeleton`، و`UAlert` للخطأ، و`UIcon` و`UButton`.
- `SharedStatusBadge` فوق `UBadge`، ولونها من `STATUS_COLOR` (`utils/statusTone.ts`).
- `SharedRouteTabs` روابط `UButton`، لا `UTabs`، لأن التبويب هنا مسار.
- لا قالب يضيف `UModal` أو `USlideover` أو `UDrawer`. `SharedCreatePanel` يبقى لوحة `/new` الوحيدة.

الخصائص والخانات والأحداث في `catalog.json` المولّد.
