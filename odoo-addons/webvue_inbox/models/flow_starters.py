# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Sector starter forms: ready-made drafts a tenant edits and publishes. Each is a valid form write body (packages/contracts)."""


def _text(key, label, required=True, input_type='text'):
    return {
        'kind': 'text_input', 'key': key, 'label': label, 'required': required, 'sensitive': False,
        'input_type': input_type, 'helper_text': None, 'min_chars': None, 'max_chars': None,
    }


def _area(key, label, required=False):
    return {
        'kind': 'text_area', 'key': key, 'label': label, 'required': required, 'sensitive': False,
        'helper_text': None, 'max_length': None,
    }


def _choice(kind, key, label, titles, required=True):
    return {
        'kind': kind, 'key': key, 'label': label, 'required': required, 'sensitive': False,
        'options': [{'title': title, 'description': None} for title in titles],
    }


def _date(key, label):
    return {
        'kind': 'date', 'key': key, 'label': label, 'required': True, 'sensitive': False,
        'helper_text': None, 'min_date': None, 'max_date': None,
    }


def _form(name, category, completion_message, *screens):
    return {
        'name': name, 'category': category, 'language': 'ar', 'completion_message': completion_message,
        'screens': [{'title': title, 'footer_label': footer, 'fields': list(fields)} for title, footer, fields in screens],
    }


FLOW_STARTERS = {
    'clinic': [_form(
        'طلب موعد', 'appointment_booking', 'استلمنا طلب موعدك وسنؤكده معك قريبًا.',
        ('بيانات المراجع', 'التالي', [
            _text('full_name', 'الاسم الكامل'), _text('phone', 'رقم الجوال', input_type='phone'),
            _choice('dropdown', 'visit_type', 'نوع الزيارة', ['كشف جديد', 'مراجعة', 'استشارة']),
        ]),
        ('الموعد', 'إرسال الطلب', [
            _date('preferred_day', 'التاريخ المفضل'), _choice('radio', 'period', 'الفترة المناسبة', ['صباحًا', 'مساءً']),
            _area('notes', 'ملاحظات'),
        ]),
    )],
    'store': [_form(
        'استفسار عن طلب', 'customer_support', 'استلمنا استفسارك وسنرد عليك قريبًا.',
        ('بيانات الطلب', 'التالي', [
            _text('order_number', 'رقم الطلب', required=False),
            _choice('dropdown', 'topic', 'نوع الاستفسار', ['تتبع الشحنة', 'استرجاع', 'منتج تالف', 'أخرى']),
        ]),
        ('التفاصيل', 'إرسال', [_area('details', 'تفاصيل الاستفسار', required=True)]),
    )],
    'public_service': [_form(
        'تقديم طلب أو شكوى', 'customer_support', 'استلمنا طلبك وسنوافيك بالرد في أقرب وقت.',
        ('نوع الطلب', 'التالي', [
            _choice('dropdown', 'request_type', 'نوع الطلب', ['طلب خدمة', 'شكوى', 'متابعة معاملة']),
            _text('reference', 'رقم المعاملة', required=False),
        ]),
        ('التفاصيل', 'إرسال', [
            _area('details', 'تفاصيل الطلب', required=True),
            {'kind': 'opt_in', 'key': 'confirmed', 'label': 'أقر بصحة البيانات', 'required': True},
        ]),
    )],
}
