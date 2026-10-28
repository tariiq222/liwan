# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Sector presets: the departments, tags and canned replies a tenant of that sector starts with."""

PRESETS = {
    'clinic': {
        'departments': ['الاستقبال', 'المواعيد', 'الحسابات'],
        'tags': ['استفسار', 'حجز موعد', 'تغيير موعد', 'شكوى'],
        'canned_replies': [
            ('hello', 'أهلًا بك في عيادتنا، كيف نخدمك؟'),
            ('hours', 'ساعات الدوام من الأحد إلى الخميس، من 9 صباحًا حتى 9 مساءً.'),
            ('book', 'يسعدنا حجز موعد لك، فضلًا أرسل لنا اسمك والوقت المناسب.'),
        ],
    },
    'store': {
        'departments': ['المبيعات', 'الدعم', 'الشحن'],
        'tags': ['استفسار عن منتج', 'طلب جديد', 'تتبع الشحنة', 'استرجاع'],
        'canned_replies': [
            ('hello', 'أهلًا بك في متجرنا، كيف نساعدك؟'),
            ('track', 'فضلًا أرسل لنا رقم الطلب لنتحقق من حالة الشحنة.'),
            ('return', 'يمكنك استرجاع المنتج خلال 14 يومًا من الاستلام بحالته الأصلية.'),
        ],
    },
    'public_service': {
        'departments': ['خدمة المستفيدين', 'الشكاوى'],
        'tags': ['استفسار', 'شكوى', 'طلب خدمة', 'متابعة معاملة'],
        'canned_replies': [
            ('hello', 'مرحبًا بك، كيف يمكننا خدمتك؟'),
            ('received', 'استلمنا طلبك وسنوافيك بالرد في أقرب وقت.'),
            ('ticket', 'فضلًا أرسل لنا رقم المعاملة لنتابع طلبك.'),
        ],
        'settings': {'visibility_policy': 'assigned_only', 'retention_months': 60},
    },
}
