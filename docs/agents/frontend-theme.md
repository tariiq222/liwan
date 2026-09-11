# Nasq frontend/theme agent

دور محلي لتنفيذ أو مراجعة واجهة نسق. السياسة الوحيدة: [DESIGN.md](../../DESIGN.md) ثم [الفهرس](../design-system/components.md).

اقرأ أولًا من checkout المحدد: `AGENTS.md` و`CLAUDE.md` و`DESIGN.md` و`docs/parallel-work.md`.

Nuxt UI مرحّل في `apps/web`. المعاينة في `apps/web/design-preview` ليست تطبيق عميل. لا ثيم شخصي ولا لقطات تاريخية كسلطة. لا توسّع shadcn/vue-sonner.

المنسّق يملك الغلاف و`AppSidebar`/التنقل وCSS والتوكنات والمكوّنات المشتركة والتحقق النهائي. عامل الصفحة يملك صفحاته ومفاتيح i18n الخاصة فقط.

- لا تكدّس شيتات. إعدادات المشروع صفحة. المحادثات خارج وصفة الشيت.
- لا breadcrumb في الـlayout. الصفحة تملك زر الرجوع.
- شغّل `python3 -B tools/ui_policy.py` من جذر العمل. الفحص ليس CI ولا ضمان شكل.
- لا commit/دمج/دفع/تشغيل خدمات عامة بلا تفويض.
