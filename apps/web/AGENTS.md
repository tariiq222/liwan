# Nasq frontend instructions

السياسة الوحيدة: [DESIGN.md](../../DESIGN.md) ثم [الفهرس](../../docs/design-system/components.md).

Nuxt UI مرحّل في `app/`. `design-preview/` معاينة معزولة ببيانات وهمية، لا تُستورد.
لا مكتبة ثانية ولا تغليف لكل زر ولا مستهلك shadcn جديد. سجّل كل مكوّن مركّب في الفهرس.
اتبع [UPDATE_POLICY.md](../../docs/UPDATE_POLICY.md). شغّل `python3 -B tools/ui_policy.py` من جذر العمل.

اقرأ [AGENTS.md](../../AGENTS.md) و[CLAUDE.md](../../CLAUDE.md) قبل العمل.
تغييرات الغلاف والتوكنات والتنقل المشترك والمكوّنات المشتركة لها مالك واحد.
