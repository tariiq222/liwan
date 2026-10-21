# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_hr.serializers.assets.common import ref, reject_unknown

PROFILE_FIELDS = ('name', 'kind', 'delimiter', 'encoding', 'include_header', 'footer', 'columns')
SELECTION_FIELDS = ('kind', 'delimiter', 'encoding', 'footer')
COLUMN_FIELDS = ('source', 'label', 'constant_value')


def dump_profile(profile):
    return {
        'id': profile.id,
        'name': profile.name,
        'kind': profile.kind,
        'delimiter': profile.delimiter,
        'encoding': profile.encoding,
        'include_header': profile.include_header,
        'footer': profile.footer,
        'columns': [
            {'source': column.source, 'label': column.label, 'constant_value': column.constant_value or ''}
            for column in profile.column_ids.sorted('sequence')
        ],
        'shared': not profile.company_id,
    }


def parse_profile(payload, model, *, partial):
    """The writable profile values. A create needs ``name``, ``kind`` and ``columns``; a PATCH only what it changes."""
    reject_unknown(payload, PROFILE_FIELDS)
    if not partial:
        missing = [name for name in ('name', 'kind', 'columns') if name not in payload]
        if missing:
            raise ApiError(422, 'invalid', f'{missing[0]} is required', field=missing[0])
    vals = {}
    if 'name' in payload:
        name = payload['name']
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', 'name is required', field='name')
        vals['name'] = name.strip()
    for name in SELECTION_FIELDS:
        if name in payload:
            if payload[name] not in dict(model._fields[name].selection):
                raise ApiError(422, 'invalid', f'{name} is not a known value', field=name)
            vals[name] = payload[name]
    if 'include_header' in payload:
        if not isinstance(payload['include_header'], bool):
            raise ApiError(422, 'invalid', 'include_header must be true or false', field='include_header')
        vals['include_header'] = payload['include_header']
    if 'columns' in payload:
        column_model = model.env['webvue.hr.payroll.bank.profile.column']
        columns = [_parse_column(column, column_model, index) for index, column in enumerate(_column_list(payload['columns']))]
        vals['column_ids'] = [(5, 0, 0), *((0, 0, column) for column in columns)]
    return vals


def _column_list(columns):
    if not isinstance(columns, list) or not columns:
        raise ApiError(422, 'invalid', 'columns must be a non-empty list', field='columns')
    return columns


def _parse_column(column, model, index):
    if not isinstance(column, dict):
        raise ApiError(422, 'invalid', 'every column must be an object', field='columns')
    reject_unknown(column, COLUMN_FIELDS)
    source = column.get('source')
    label = column.get('label')
    constant = column.get('constant_value') or ''
    if source not in dict(model._fields['source'].selection):
        raise ApiError(422, 'invalid', 'a column source is not a known value', field='columns')
    if not isinstance(label, str) or not label.strip():
        raise ApiError(422, 'invalid', 'every column needs a label', field='columns')
    if not isinstance(constant, str) or bool(constant.strip()) != (source == 'constant'):
        raise ApiError(422, 'invalid', 'only a constant column carries a constant_value, and it needs one', field='columns')
    return {'sequence': (index + 1) * 10, 'source': source, 'label': label.strip(), 'constant_value': constant}


def dump_gosi_statement(statement):
    return {
        'month': statement['month'],
        'lines': [
            {
                'employee': ref(line['employee']),
                'gosi_number': line['gosi_number'],
                'nationality_class': line['nationality_class'],
                'contributory_wage': float(line['contributory_wage']),
                'branches': {
                    branch: {side: float(amount) for side, amount in amounts.items()}
                    for branch, amounts in line['branches'].items()
                },
                'employee_amount': float(line['employee_amount']),
                'employer_amount': float(line['employer_amount']),
            }
            for line in statement['lines']
        ],
        'totals': {
            key: float(sum((line[key] for line in statement['lines']), 0))
            for key in ('contributory_wage', 'employee_amount', 'employer_amount')
        },
    }
