# لقطات مرجع Nuxt UI — مرشحة للمراجعة

المصدر الفعلي `apps/web/design-preview`، وليس نسخة HTML تقلّد المكتبة.
هذه لقطات المعاينة المحلية بتاريخ 2026-09-10؛ **لم يعتمد المستخدم بعد تعميم
هذه النسخة البصرية على صفحات العملاء**. المرجع الملزم هو DESIGN.md مع
الفهرس والمكونات والتوكنات، وليس لقطة تتجاوز قراراته.

الصور ناتجة عن اختبارات Playwright في `apps/web/test-results/` (مخرجات محلية
متجاهلة في Git، يعاد توليدها بتشغيل الاختبارات):

- [الإحصائيات على الكمبيوتر](../../../../apps/web/test-results/reference-all-recipes-have-09201-o-document-overflow-at-1440/dashboard-1440.png).
- [النموذج على الكمبيوتر](../../../../apps/web/test-results/reference-all-recipes-have-09201-o-document-overflow-at-1440/form-1440.png).
- [المكونات على الجوال](../../../../apps/web/test-results/reference-all-recipes-have-a1f5b-no-document-overflow-at-390/components-390.png).

لم تحفظ لقطات PNG داخل هذا المجلد؛ أداة تصوير المتصفح رفضت الكتابة في
worktree خارج جذورها المسموحة. لم نتجاوز القيد، ونستخدم مخرجات الاختبارات
الموجودة أصلًا. راجع كود المرجع والمعاينة الحية إذا لم تتوفر المخرجات المحلية.

[التشغيل والاختبارات والقيود](../../nuxt-ui-preview-delivery.md).
