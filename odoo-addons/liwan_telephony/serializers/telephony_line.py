# Part of Odoo. See LICENSE file for full copyright and licensing details.


def dump_line(line):
    """The one wire shape of a line (packages/contracts/src/telephony/line.ts). No provider password exists here."""
    return {
        'id': line.id,
        'name': line.name,
        'kind': line.kind,
        'mode': line.mode,
        'authMethod': line.auth_method,
        'providerHost': line.provider_host or None,
        'providerPort': line.provider_port,
        'numbers': [row.number for row in line.number_ids],
        'outboundFormat': line.outbound_format or None,
        'callerId': line.caller_id or None,
        'maxConcurrent': line.max_concurrent,
    }


def dump_lines(lines):
    return [dump_line(line) for line in lines]
