> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# نتيجة قفل Nuxt UI — 2026-09-10

**تحديث التنفيذ:** بعد إلغاء المستخدم للهوك، ثُبت هذا القفل وفُحصت الشجرة
المحلية. الأسطر التالية تسجل نتيجة
مرحلة lock-only السابقة، وليست حالة انتظار تثبيت حالية. تقارير الموافقة
تاريخية؛ السياسة الحالية لا تطلبها للتشغيل المحلي. التنبيه المنخفض لم يُخفَ.

## ما نُفّذ

نُفّذ إجراء lock-only المطابق للتقرير الموافق عليه
`docs/nuxt-ui-lock-review-approval.json`، ونجح دون install scripts أو إنشاء
node_modules. تغير `apps/web/package.json` بإضافتي Nuxt UI والأيقونات فقط،
وتولد ملف القفل المرشح. الواجهة وOdoo وmain لم تتغير.

| البند | النتيجة |
| --- | --- |
| baseline | `fce4561330200947e4db88b508285fecf9bb05a5` |
| SHA-256 للقفل المرشح | `0f0da85f61f231934fa383b2c7cfcfc7ebb3f788117e3194752ed75d3b74e26d` |
| SHA-256 لـmanifest الويب المرشح | `879270764e63aa53089d0de561f7f5e28ebc58ae422666f6453b0043698159e1` |
| المسارات الجديدة في lock | 92، تشمل النسخ المتداخلة وحزم esbuild الاختيارية للمنصات |
| المسارات المحذوفة | صفر |
| تغيير إصدار/مصدر/integrity لحزمة موجودة | صفر |
| التغييرات الأخرى في الحزم الموجودة | إزالة dev من `@standard-schema/spec`؛ إزالة optional من Tiptap bubble-menu وfloating-menu |
| مطابقة resolved/integrity مع metadata npm المنشورة | 92 من 92؛ لا ادعاء تحقق بايتات tarball قبل التنزيل |

## جرد الإضافات المحددة

الأسماء دون مسار خاص تقع مباشرة تحت `node_modules/`. كل اسم/نسخة أدناه
مطابق لمعلومات السجل المنشورة. حزم المنصات داخل fontless اختيارية، ولن تُثبت
كل المنصات على macOS؛ القفل يسجلها لإعادة البناء على منصات مختلفة.

| المجموعة | الإصدارات |
| --- | --- |
| الأساس | `@nuxt/ui@4.11.1`, `@iconify-json/lucide@1.2.129`, `@nuxt/icon@2.5.1`, `@nuxt/fonts@0.14.0`, `@nuxtjs/color-mode@4.0.1` |
| Iconify | `@iconify/collections@1.0.735`, `@iconify/types@2.0.0`, `@iconify/utils@3.1.7`, `@iconify/vue@5.0.1` |
| البناء | `@alloc/quick-lru@5.3.0`, `@antfu/install-pkg@2.0.1`, `@tailwindcss/postcss@4.3.3`, `package-manager-detector@1.8.0`, `import-meta-resolve@4.2.0`, `unplugin-auto-import@21.1.0`, `unplugin-vue-components@32.1.0`, `tailwind-variants@3.3.1` |
| نسختان متداخلتان | `magic-string@1.3.1` تحت `@nuxt/ui/node_modules` و`unplugin-auto-import/node_modules`؛ النسخ القديمة لم تتغير |
| Tiptap | `@tiptap/extension-collaboration`, `extension-drag-handle`, `extension-drag-handle-vue-3`, `extension-image`, `extension-mention`, `extension-node-range`, `extension-placeholder`, `markdown`, `suggestion` كلها ضمن `@tiptap/` وبالإصدار `3.31.3` |
| المحرر والتعاون | `@tiptap/y-tiptap@3.0.9`, `marked@17.0.6`, `yjs@13.6.32`, `y-protocols@1.0.7`, `lib0@0.2.117`, `isomorphic.js@0.2.5` |
| الحركة | `motion-v@2.4.2`, `framer-motion@13.2.0`, `motion-dom@13.2.0`, `motion-utils@13.0.0`, `hey-listen@1.0.8`, `wheel-gestures@2.3.0` |
| Embla | `embla-carousel` وامتداداته `auto-height`, `auto-scroll`, `autoplay`, `class-names`, `fade`, `reactive-utils`, `vue` كلها `8.6.0`؛ `embla-carousel-wheel-gestures@8.1.0` |
| أدوات أخرى | `@vueuse/integrations@14.4.0`, `colortranslator@5.0.0` |
| الخطوط | `@capsizecss/unpack@4.0.1`, `fontaine@0.8.0`, `fontkitten@1.0.3`, `fontless@0.2.1`, `tiny-inflate@1.0.3`, `unifont@0.7.5` |
| تحت fontaine | `node_modules/fontaine/node_modules/unplugin@2.3.11` |
| تحت fontless | `node_modules/fontless/node_modules/esbuild@0.27.7` |
| Vaul | `vaul-vue@0.4.1` |
| تحت vaul-vue | `@types/web-bluetooth@0.0.20` و`@vueuse/core`, `@vueuse/metadata`, `@vueuse/shared` بالإصدار `10.11.1`؛ نسختا `vue-demi@0.14.10` داخل core/shared |

حزم `@esbuild/*@0.27.7` الاختيارية الـ26 تحت
`node_modules/fontless/node_modules/`:
`aix-ppc64`, `android-arm`, `android-arm64`, `android-x64`, `darwin-arm64`,
`darwin-x64`, `freebsd-arm64`, `freebsd-x64`, `linux-arm`, `linux-arm64`,
`linux-ia32`, `linux-loong64`, `linux-mips64el`, `linux-ppc64`, `linux-riscv64`,
`linux-s390x`, `linux-x64`, `netbsd-arm64`, `netbsd-x64`, `openbsd-arm64`,
`openbsd-x64`, `openharmony-arm64`, `sunos-x64`, `win32-arm64`, `win32-ia32`,
`win32-x64`.

## الأمن والترخيص — فرق حقيقي عن baseline

`npm audit --package-lock-only --json` على main: **صفر تنبيهات**.
على المرشح: **تنبيه منخفض واحد** في esbuild `0.27.7` المتداخل تحت fontless.
بقية مستويات الشدة صفر وقت الفحص؛ audit ليس تدقيقًا شاملًا لكل الكود.

[GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr)
يخص قراءة ملفات عبر path traversal في خادم esbuild التطويري على **Windows
فقط**. النطاق `>=0.27.3 <0.28.1` والإصلاح الأول `0.28.1`. لم يُطبّق override
أو audit fix. تعطيل موديول الخطوط لا يزيل الحزمة ولا ينظف نتيجة audit.

**التوصية التاريخية:** كان الفحص المحلي محصورًا في macOS و127.0.0.1، مع
`ui.fonts=false` وعدم تشغيل خادم esbuild من fontless. لا تُعد هذه التوصية
موافقة دمج/نشر أو استخدام Windows.
معالجة الاعتمادية قبل تبنيها العام تتطلب مراجعة توافق وتقريرًا منفصلًا؛ لا
إخفاء التنبيه أو اعتباره baseline سابقًا.

جميع الإضافات تعلن MIT، باستثناء `@iconify-json/lucide` (ISC) و
`colortranslator` (Apache-2.0). حقل ترخيص vaul-vue غائب في metadata؛ تحققنا
من [MIT في commit النشر](https://github.com/Elliot-Alexander/vaul-vue/blob/1b1f6dfdba6a775410508884097443d35c9a8690/LICENSE)
بدل افتراض ترخيصه. حفظ إشعارات الأصول واجب قبل التوزيع؛ لا نشر من هذا التقرير.

الجديد الذي يعلن install scripts: esbuild المتداخل ونسختا vue-demi.
سيُستخدم `--ignore-scripts` لكل التثبيت. لا rebuild أو تشغيل scripts لحل
مشكلة بناء دون مراجعة وموافقة مستقلة. لا يقرر وجود الحزم اعتماد أي مكون
متخصص أو تغييرًا في التشغيل.

## حدود مرحلة التثبيت المقترحة

التقرير التالي يربط npm ci ببصمة القفل أعلاه ويقتصر على worktree الحالي.
لا يغيّر config أو app أو CSS لواجهة نسق الحالية، ولا Odoo أو API أو بيانات
حقيقية أو إعدادات CORS.

الفحص المحلي يسجل حزمة الأيقونات باسمها المحدد فقط وبموجب موافقة التثبيت، لا
تغيير baseline أو فتح مكتبات أخرى. اختبار المكونات والحالات واللغة والثيم/SSR
لا يثبت ترحيل صفحات العملاء.

## التحقق وحالة التسليم

- تقرير التثبيت المحلي صالح بنيويًا؛ صحة البنية ليست موافقة بشرية ولا شهادة
  أمان.
- `git diff --check` ناجح؛ لا فرق في كود تشغيل الواجهة أو Odoo أو root manifest.
- `python3 -B tools/ui_policy.py` يبلغ مخالفة متوقعة واحدة:
  `dependency needs review: @iconify-json/lucide`. لم يخف الفحص أو يوسّع
  للسماح بها قبل موافقة التثبيت المحددة. لا يوجد خطأ مكوّن بصري جديد لأن
  مكونات التشغيل لم تتغير.
- لا تُعد نتائج هذا التقرير تشغيلًا أو نشرًا؛ main بقي نظيفًا عند `fce4561`،
  ولم يتم commit أو دمج أو نشر.
