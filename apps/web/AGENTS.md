# LiwanOS frontend instructions

ابدأ من [DESIGN.md](../../DESIGN.md): سياسة الواجهة الوحيدة وروابط الفهرس والمرجع التقني. التقارير والأرشيف ليست تعليمات تصميم نشطة.

واجهة العميل تسكن في `apps/web/app` مع الطبقتين المشتركتين `packages/ui` و`packages/commercial-ui` (المجلدات والبادئات في [web-rules.md](../../docs/agents/web-rules.md))، و`apps/vendor-admin` تطبيق منفصل يستعمل الطبقتين نفسيهما. لا توجد معاينة أو بيانات وهمية داخل مسار التشغيل.
استخدم مكونات Nuxt UI مباشرة ولا تنشئ مكتبة واجهات ثانية أو تغليفًا لكل زر. سجّل كل مكوّن مركّب في الفهرس.
اتبع [UPDATE_POLICY.md](../../docs/UPDATE_POLICY.md). شغّل `python3 -B tools/ui_policy.py` من جذر العمل.

اقرأ [AGENTS.md](../../AGENTS.md) و[CLAUDE.md](../../CLAUDE.md) قبل العمل.
تغييرات الغلاف والتوكنات والتنقل المشترك والمكوّنات المشتركة لها مالك واحد.
