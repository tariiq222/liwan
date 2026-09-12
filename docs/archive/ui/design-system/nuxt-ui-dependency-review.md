> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# مراجعة اعتماديات Nuxt UI — 2026-09-10

**الحالة الأحدث:** أُلغي هوك الموافقة بقرار المستخدم، وثُبتت الحزم وفُحصت
الشجرة المرشحة. ما يلي سجل المراجعة
قبل التثبيت؛ لا يعيد اشتراط سجلات الموافقة الملغاة. التنبيه المنخفض الموثق
بقي قائمًا؛ لم يُدمج القفل أو ينشر.

**تحديث:** نُفّذ إجراء lock-only الموافق عليه. [نتيجة القفل](nuxt-ui-lock-result.md)
تتقدم على حالة «غير محلول» في هذا التقرير الأولي: 92 مسارًا جديدًا، ولا
تغيير لإصدارات الحزم القديمة، مع تنبيه منخفض جديد خاص بـWindows. تقرير
تقرير التثبيت المحلي محفوظ خارج هذا الفهرس؛ لا يُعد موافقة دمج أو نشر.

## النتيجة والقرار المطلوب

Nuxt UI مناسب مبدئيًا لبنية نسق، لكن **التثبيت النهائي غير جاهز للموافقة**:
المكتبة الجديدة تجلب حزمًا لم تُحسم إصداراتها الانتقالية بعد. لا نختزلها في
«إضافة مكتبة واحدة». التصنيف الحالي **unknown** للشجرة الكاملة؛ الهدف تغيير
وظيفي/بصري، وليس تحديثًا أمنيًا فقط.

المطلوب الآن اعتماد **توليد قفل مرشح فقط** في worktree المهمة، عبر
`--package-lock-only --ignore-scripts`. يعدّل هذا ملفات الاعتماديات المرشحة،
ولا يثبّت حزمًا في node_modules أو يشغّل Nuxt أو Odoo. بعده نراجع كل إضافة
وتغيير وحذف ثم نعرض تقرير تثبيت منفصل بالشجرة المحددة والبصمات.

تقرير الإجراء المحمي: [nuxt-ui-lock-review-approval.json](../../../nuxt-ui-lock-review-approval.json).
هذا منفصل عن الموافقة السابقة على تعليمات الوكلاء.

## الأدلة الحالية

- worktree: `/Users/tariq/code/nasq-nuxt-ui-reference`، الفرع
  `codex/nuxt-ui-reference`، baseline `fce4561330200947e4db88b508285fecf9bb05a5`.
- ملفات الاعتماديات لم تتغير عن baseline؛ تغييرات المرحلة الأولى في الوثائق
  والفحص محفوظة ولم تدمج.
- Node المحلي `26.7.0` وnpm `11.19.0`؛ لا اقتراح لتحديثهما.
- SHA-256 الحالي لملف القفل:
  `c7263bae4c131692122e561a9cc988e51ff5dc352571e41d43d0f0520438cdf6`.
- SHA-256 الحالي لـ`apps/web/package.json`:
  `f5c3bbcbc611d4ec4a22b3c7fcf6d217131d1d02b2c415885e395687a8fde0f2`.
- تمت قراءة metadata الحزم المنشورة ومقارنتها بقفل نسق، دون تنفيذ npm
  install أو resolver. وفُحص المصدر الرسمي والإصدار والتنبيهات الأمنية.

## الحزمتان المستهدفتان

| الاسم | الحالي | المستهدف | السبب |
| --- | --- | --- | --- |
| `@nuxt/ui` | غير موجود | `4.11.1` ثابت | المكونات الموحدة |
| `@iconify-json/lucide` | غير موجود | `1.2.129` ثابت | بيانات أيقونات محلية لتغطية الأيقونات الافتراضية داخل Nuxt UI بدل الاعتماد على API خارجي؛ لا استبدال تلقائي لاستعمالات `@lucide/vue` الحالية |

سجل npm لـ[Nuxt UI](https://registry.npmjs.org/@nuxt%2fui/4.11.1):
`sha512-6/xTMQNO4bcVesaaiIorH65cZ3eu0xenH+gC2L/b9pfmeVc0aMGXDKpW2JxoVUlrlcHo/beoUTI0B164HcwweQ==`

سجل npm لـ[Lucide JSON](https://registry.npmjs.org/@iconify-json%2flucide/1.2.129):
`sha512-pa0ufllJOXTDIH2BxE/BtWQEf/x46/lINDWcmncICV1/52veZ7KSBzQaVh9xDpmjDs8QN4j2Ex/LWlSSveL3yw==`

قراءة integrity ليست تحققًا من tarball محمّل؛ لم تُنزّل/تُشغّل الحزم.
المكتبة MIT وحزمة الأيقونات تعلن ISC؛ يلزم حفظ إشعارات الأصول عند التوزيع.

## مقارنة المستوى الأول من الاعتماديات

Nuxt UI يعلن **65 اعتمادًا مباشرًا**: 37 اسمًا موجودًا أصلًا في القفل و28
اسمًا جديدًا. Lucide JSON يضيف اسمًا آخر `@iconify/types`. هذه **ليست** أعداد
كل الحزم الانتقالية ولا قياسًا لحجم bundle؛ إلغاء استيراد مكوّن لا يزيل
بالضرورة اعتماديته من التثبيت.

### الموجود وله إصدار مطابق للحد الأدنى المطلوب

| الحزم | الإصدارات الموجودة ذات الصلة |
| --- | --- |
| Nuxt / Vue / Tailwind / TypeScript (تقنيات نسق) | `4.5.2` / `3.5.42` / `4.3.3` / `5.9.3` |
| `reka-ui` | `2.10.4`، وهو مطلوب بتثبيت صريح من Nuxt UI |
| `@nuxt/kit`, `@nuxt/schema` | `4.5.2`؛ يوجد kit `3.21.11` متداخل أيضًا |
| `@floating-ui/dom` | `1.8.0` |
| `@internationalized/date`, `@internationalized/number` | `3.12.4`, `3.6.8` |
| `@tanstack/vue-table`, `@tanstack/vue-virtual` | `8.21.3`, `3.13.36` |
| Tiptap: core/pm/vue-3/starter-kit/bubble-menu/code/floating-menu/horizontal-rule | `3.31.3` |
| `@unhead/vue` | `3.4.0` |
| VueUse: core/shared | `14.4.0` |
| `@standard-schema/spec`, `@tailwindcss/vite` | `1.1.0`, `4.3.3` |
| `consola`, `defu`, `fuse.js`, `knitwork`, `mlly` | `3.4.2`, `6.1.7`, `7.5.0`, `1.3.0`, `1.8.2` |
| `hookable`, `magic-string`, `unplugin` | `6.1.1`, `1.2.3`, `3.3.0`؛ توجد إصدارات أقدم متداخلة |
| `ohash`, `pathe`, `scule`, `tailwind-merge`, `tinyglobby`, `ufo`, `vue-component-type-helpers` | `2.0.12`, `2.0.3`, `1.3.0`, `3.6.0`, `0.2.17`, `1.6.4`, `3.3.11` |

وجود إصدار مناسب لا يثبت أن npm سيعيد استخدامه في كل موضع؛ نتحقق من القفل
المرشح بدل الادعاء بعدم تغير القديم.

### الأسماء الجديدة ونطاقات المورد (لم تُحل إلى إصدارات نهائية)

| الحزمة/المجموعة | النطاق المعلن |
| --- | --- |
| `@iconify/vue` | `^5.0.1` |
| `@nuxt/fonts`, `@nuxt/icon`, `@nuxtjs/color-mode` | `^0.14.0`, `^2.5.1`, `^4.0.1` |
| `@tailwindcss/postcss` | `^4.3.3` |
| Tiptap: extension-collaboration, extension-drag-handle, extension-drag-handle-vue-3, extension-image, extension-mention, extension-node-range, extension-placeholder, markdown, suggestion | `^3.31.3` لكل منها |
| `@vueuse/integrations` | `^14.4.0` |
| `colortranslator` | `^5.0.0` |
| Embla: auto-height, auto-scroll, autoplay, class-names, fade, vue | `^8.6.0` لكل منها، بالأسماء `embla-carousel-*` |
| `embla-carousel-wheel-gestures` | `^8.1.0` |
| `motion-v`, `tailwind-variants` | `^2.4.2`, `^3.2.2` |
| `unplugin-auto-import`, `unplugin-vue-components` | `^21.1.0`, `^32.1.0` |
| `vaul-vue` | `0.4.1` |
| `@iconify/types` (عبر Lucide JSON) | `*` |

لهذه الحزم انتقاليات وpeerDependencies قد تضيف أسماء أخرى؛ لم يُجرَ فحص
أمني شامل للشجرة غير المحلولة، ولا موافقة على تثبيتها بموجب هذا التقرير.

## التوافق والمخاطر الفعلية من المصدر

1. [module.ts](https://github.com/nuxt/ui/blob/v4.11.1/src/module.ts) يطلب
   Nuxt `>=4.1.0`. شرط Node في الحزمة `^20.19.0 || >=22.12.0`؛ البيئة
   الحالية تحقق الشروط المعلنة. هذا ليس إثبات بناء.
2. الموديول يضيف Tailwind Vite plugin؛ نسق يضيفه يدويًا حاليًا. عند الدمج
   يستخدم مالك واحد للـplugin، لا تسجيلان.
3. Nuxt UI يسجل fonts وcolor-mode افتراضيًا. يضبط العميل الحالي الموديول
   للحفاظ على الخط المحلي وcookie نسق والمظهر الكريمي. تبقى هذه الحزم ضمن
   dependency graph رغم تعطيل الموديول.
4. `@nuxt/icon` يسجل تلقائيًا ويحاول تضمين الأيقونات؛ عند نقصها قد يعود
   إلى جلب وقت التشغيل. يلزم تحقق شبكة يثبت محلية الأيقونات، لا مجرد تركيب JSON.
5. [App.vue](https://github.com/nuxt/ui/blob/v4.11.1/src/runtime/components/App.vue)
   يركب ConfigProvider وTooltip وToaster وOverlayProvider. لا يضاف Toaster
   ثانٍ للصفحات القديمة؛ يستخدم التطبيق مالكًا واحدًا للإشعارات ولا يغير
   سلوكها الحالي.
6. [CSS](https://github.com/nuxt/ui/blob/v4.11.1/src/runtime/index.css) و
   [colors plugin](https://github.com/nuxt/ui/blob/v4.11.1/src/runtime/plugins/colors.ts)
   يضيفان root/theme tokens. يملك التطبيق خريطة توكنات واحدة تحفظ هوية نسق
   ولا ينشئ مصدر CSS موازيًا.
7. [فرق 4.11.0 إلى 4.11.1](https://github.com/nuxt/ui/compare/v4.11.0...v4.11.1)
   يتضمن تغيير prefetch في Link ليناسب Nuxt 4.5، وتعديل method في Form
   المتداخل وتصحيحات Select/Table/NavigationMenu. ليس ترقيع ألوان فقط.

## الفحص الأمني المحدود

- [GHSA-gj2h-2fpw-fhv9](https://github.com/nuxt/ui/security/advisories/GHSA-gj2h-2fpw-fhv9):
  تنبيه متوسط عن إرسال حقول النموذج في GET قبل hydration، والنطاق المنشور
  `<=4.7.1`. حقل patched_versions في التنبيه فارغ، لكن مصدر Form في الإصدار
  المرشح يحدد POST للنموذج الخارجي. نحتفظ باختبار عدم تسرب حقول الدخول في
  URL، ولا نعيد بناء مصادقة نسق أو نعتمد على submit.prevent وحده.
- [GHSA-wpmj-r844-vvfg](https://github.com/nuxt/ui/security/advisories/GHSA-wpmj-r844-vvfg):
  تنبيه حرج منشور عن قالب المحادثات وHTML غير المنقّى، يذكر 3.3.2 ولا يحدد
  إصدار إصلاح واضحًا. لا نستنتج من ذلك ثغرة مثبتة في 4.11.1، ولا شهادة أمان.
  لا نستورد قالب المحادثات أو نعطّل تنقية النصوص في نسق؛ مراجعة المحادثات مستقلة.
- مصدر الأدلة: GitHub security advisories الرسمي وmetadata npm والإصدار
  المحدد. بعد توليد القفل يلزم تدقيق كل الحزم المتغيرة والتنبيهات الخاصة بها
  قبل تقرير التثبيت. لا npm audit fix ولا ترقية تلقائية.

## نطاق المرحلة التالية وخطة الرجوع

الآن: إجراء lock-only واحد، داخل worktree فقط، الحزمتان ثابتتان، scripts
ممنوعة وpeer conflicts تفشل بدل تجاوزها. قد يكتب npm cache/logs؛ لا تنزيل
شجرة تشغيل إلى node_modules ولا إعداد Nuxt ولا خدمة/قاعدة بيانات.

بعد الموافقة: نقارن ملفات الحزم مع baseline، نسجل القفل المرشح وبصمته وكل
إضافة/تغيير/حذف، نفحص الترخيص والأمن. أي تغير غير متوقع يوقف المسار؛ لا force
ولا legacy-peer-deps ولا محاولة بأمر مختلف دون تقرير جديد.

الرجوع: ملفات الحزم الأصلية محفوظة في baseline المذكور، والعمل السابق في
الوثائق والفحوص يبقى. عكس تغيير manifests/lock بعد موافقة الرجوع اللازمة
لا يحتاج رجوع بيانات، ولا reset/حذف worktree أو عبث بملفات عمل أخرى.

بعد تقرير تثبيت منفصل: تُفحص واجهة العميل نفسها دون API أو Odoo في هذا
المسار، وتُختبر اللغتان والمظاهر والأحجام وحالات الحقول ولوحة المفاتيح وSSR
قبل أي ادعاء بقبول الترحيل أو النشر.
