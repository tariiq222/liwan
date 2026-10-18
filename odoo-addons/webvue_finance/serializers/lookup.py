# Part of Odoo. See LICENSE file for full copyright and licensing details.


def dump_country(country):
    return {'id': country.id, 'name': country.name, 'code': country.code or ''}


def dump_countries(countries):
    return [dump_country(country) for country in countries]


def dump_state(state):
    return {'id': state.id, 'name': state.name, 'code': state.code}


def dump_states(states):
    return [dump_state(state) for state in states]
