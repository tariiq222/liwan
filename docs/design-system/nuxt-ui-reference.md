# مرجع واجهة Nuxt UI

المرجع الملزم هو [DESIGN.md](../../DESIGN.md)، أما هذا الملف فيصف مصدر
التنفيذ وحدود المكتبة. مكونات العميل الفعلية في `apps/web/app` هي مصدر التشغيل
الوحيد. مصدر Vue/CSS في `/Users/tariq/Downloads/nasq-ui` للمقارنة فقط.

## المصدر والملكية

| الجزء | المصدر الحالي |
| --- | --- |
| مكتبة الواجهة | `@nuxt/ui` بالإصدار المثبت في `apps/web/package.json` و`package-lock.json` |
| وصفات Nuxt UI | `apps/web/app/app.config.ts` |
| مدخل CSS والخط | `apps/web/app/assets/css/main.css`؛ يستورد `tokens.css` و`components.css` و`shell.css` وخط IBM Plex Sans Arabic المحلي |
| توكنات الأسطح والتحكم | `apps/web/app/assets/css/tokens.css`, `apps/web/app/assets/css/components.css`, `apps/web/app/assets/css/shell.css` |
| لون الهوية | `apps/web/app/utils/brandTheme.ts`؛ الإدخال هو `primary_color` وتُشتق منه حالات التفاعل والروابط والاختيار والرسوم |
| حالة المظهر والخط | `apps/web/app/composables/useAppearance.ts` و`apps/web/app/utils/appearance.ts`؛ الحالة وcookie هنا |
| الرسوم | `apps/web/app/components/shared/DashboardChart.client.vue` ومحولات `apps/web/app/components/charts/` باستخدام Unovis |
| ملكية المكونات | [فهرس المكونات](components.md)؛ كل مسار فيه يبدأ بـ `apps/web/app/components/` |

المحايدات وأساليب الحالة منفصلة عن لون الهوية. لا يثبت العميل لونًا ثانيًا؛
`brandTheme.ts` يشتق عائلة `--primary*` و`--chart-*` من اللون الأساسي لكل مظهر،
مع إبقاء أسطح المظهر وتوكنات النجاح والتحذير والخطأ والمعلومة دلالية. ولا تُنقل
ملفات المصدر المقارن أو بياناته أو مساراته التجريبية إلى التشغيل.

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
