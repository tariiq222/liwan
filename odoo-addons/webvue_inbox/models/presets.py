# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Sector presets: the departments, tags and canned replies a tenant of that sector starts with."""


def _buttons(body, *options):
    """Interactive reply buttons as automatic-message values: (option id, title) pairs, at most three."""
    return {
        'interactive_type': 'buttons', 'body': body,
        'option_ids': [(0, 0, {'sequence': index, 'option_id': option_id, 'title': title})
                       for index, (option_id, title) in enumerate(options)],
    }


def _rule(name, option_id, reply, department=None, tags=()):
    """A menu rule: the customer chose `option_id` of the welcome buttons."""
    return {'name': name, 'option_id': option_id, 'reply': {'body': reply}, 'department': department, 'tags': list(tags)}


PRESETS = {
    'clinic': {
        'departments': ['الاستقبال', 'المواعيد', 'الحسابات'],
        'tags': ['استفسار', 'حجز موعد', 'تغيير موعد', 'شكوى'],
        'canned_replies': [
            ('hello', 'أهلًا بك في عيادتنا، كيف نخدمك؟'),
            ('hours', 'ساعات الدوام من الأحد إلى الخميس، من 9 صباحًا حتى 9 مساءً.'),
            ('book', 'يسعدنا حجز موعد لك، فضلًا أرسل لنا اسمك والوقت المناسب.'),
        ],
        'campaigns': {
            'stop_keywords': ['إيقاف التذكيرات'], 'start_keywords': [],
            'stop_reply': 'تم إيقاف رسائل العروض والتذكيرات من العيادة. لإعادة تفعيلها أرسل «تفعيل العروض».',
            'start_reply': 'تم تفعيل رسائل العيادة من جديد.',
        },
        'automation': {
            'welcome': _buttons(
                'أهلًا بك في عيادتنا، كيف نخدمك؟',
                ('menu_book', 'حجز موعد'), ('menu_hours', 'ساعات الدوام'), ('menu_staff', 'التحدث مع موظف'),
            ),
            'away': {'body': 'شكرًا لتواصلك مع عيادتنا. نحن خارج ساعات الدوام الآن وسنرد عليك مع بداية الدوام.'},
            'rules': [
                _rule('قائمة: حجز موعد', 'menu_book', 'يسعدنا حجز موعد لك، فضلًا أرسل لنا اسمك والوقت المناسب.',
                      'المواعيد', ['حجز موعد']),
                _rule('قائمة: ساعات الدوام', 'menu_hours', 'ساعات الدوام من الأحد إلى الخميس، من 9 صباحًا حتى 9 مساءً.'),
                _rule('قائمة: التحدث مع موظف', 'menu_staff', 'سيتواصل معك أحد موظفينا قريبًا.', 'الاستقبال'),
            ],
        },
    },
    'store': {
        'departments': ['المبيعات', 'الدعم', 'الشحن'],
        'tags': ['استفسار عن منتج', 'طلب جديد', 'تتبع الشحنة', 'استرجاع'],
        'canned_replies': [
            ('hello', 'أهلًا بك في متجرنا، كيف نساعدك؟'),
            ('track', 'فضلًا أرسل لنا رقم الطلب لنتحقق من حالة الشحنة.'),
            ('return', 'يمكنك استرجاع المنتج خلال 14 يومًا من الاستلام بحالته الأصلية.'),
        ],
        'campaigns': {
            'stop_keywords': ['إيقاف العروض والتخفيضات'], 'start_keywords': [],
            'stop_reply': 'تم إيقاف رسائل العروض من المتجر. لإعادة تفعيلها أرسل «تفعيل العروض».',
            'start_reply': 'تم تفعيل رسائل العروض من المتجر من جديد.',
        },
        'automation': {
            'welcome': _buttons(
                'أهلًا بك في متجرنا، كيف نساعدك؟',
                ('menu_order', 'طلب جديد'), ('menu_track', 'تتبع الشحنة'), ('menu_staff', 'التحدث مع موظف'),
            ),
            'away': {'body': 'شكرًا لتواصلك مع متجرنا. نحن خارج ساعات الدوام الآن وسنرد عليك مع بداية الدوام.'},
            'rules': [
                _rule('قائمة: طلب جديد', 'menu_order', 'يسعدنا خدمتك، فضلًا أخبرنا بالمنتج الذي تريده.', 'المبيعات', ['طلب جديد']),
                _rule('قائمة: تتبع الشحنة', 'menu_track', 'فضلًا أرسل لنا رقم الطلب لنتحقق من حالة الشحنة.', 'الشحن', ['تتبع الشحنة']),
                _rule('قائمة: التحدث مع موظف', 'menu_staff', 'سيتواصل معك أحد موظفينا قريبًا.', 'الدعم'),
            ],
        },
    },
    'public_service': {
        'departments': ['خدمة المستفيدين', 'الشكاوى'],
        'tags': ['استفسار', 'شكوى', 'طلب خدمة', 'متابعة معاملة'],
        'canned_replies': [
            ('hello', 'مرحبًا بك، كيف يمكننا خدمتك؟'),
            ('received', 'استلمنا طلبك وسنوافيك بالرد في أقرب وقت.'),
            ('ticket', 'فضلًا أرسل لنا رقم المعاملة لنتابع طلبك.'),
        ],
        'campaigns': {
            'stop_keywords': ['إيقاف الإشعارات'], 'start_keywords': [],
            'stop_reply': 'تم إيقاف الإشعارات العامة. لإعادة تفعيلها أرسل «تفعيل العروض».',
            'start_reply': 'تم تفعيل الإشعارات العامة من جديد.',
        },
        'automation': {
            'welcome': _buttons(
                'مرحبًا بك، كيف يمكننا خدمتك؟',
                ('menu_request', 'طلب خدمة'), ('menu_follow', 'متابعة معاملة'), ('menu_complaint', 'تقديم شكوى'),
            ),
            'away': {'body': 'شكرًا لتواصلك. نحن خارج أوقات الدوام الرسمي الآن وسنوافيك بالرد في أقرب وقت.'},
            'rules': [
                _rule('قائمة: طلب خدمة', 'menu_request', 'استلمنا طلبك، فضلًا اذكر الخدمة المطلوبة.', 'خدمة المستفيدين', ['طلب خدمة']),
                _rule('قائمة: متابعة معاملة', 'menu_follow', 'فضلًا أرسل لنا رقم المعاملة لنتابع طلبك.', 'خدمة المستفيدين', ['متابعة معاملة']),
                _rule('قائمة: تقديم شكوى', 'menu_complaint', 'نأسف لما حدث، فضلًا اشرح لنا الشكوى وسنتابعها.', 'الشكاوى', ['شكوى']),
            ],
        },
        'settings': {'visibility_policy': 'assigned_only', 'retention_months': 60},
    },
}
