# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .document import positive, strict
from odoo.addons.webvue_api.controllers.common import ApiError


def parse_access(payload):
    strict(payload, {'expected_revision', 'visibility', 'grants'})
    visibility = payload.get('visibility')
    grants = payload.get('grants')
    if visibility not in ('company', 'restricted') or not isinstance(grants, list):
        raise ApiError(422, 'invalid', 'visibility and grants are required')
    parsed = []
    for grant in grants:
        if (
            not isinstance(grant, dict)
            or set(grant) != {'user_id', 'access'}
            or grant.get('access') not in ('reader', 'editor')
        ):
            raise ApiError(422, 'invalid', 'invalid access grant', field='grants')
        parsed.append(
            {
                'user_id': positive(grant['user_id'], 'grants.user_id'),
                'access': grant['access'],
            },
        )
    if len({item['user_id'] for item in parsed}) != len(parsed):
        raise ApiError(422, 'invalid', 'duplicate access grant', field='grants')
    return visibility, parsed


def dump_grants(env, grants):
    users = env['webvue.directory']._webvue_people([item['user_id'] for item in grants])
    names = {user.id: user.name for user in users}
    return [
        {
            'user': {
                'id': item['user_id'],
                'name': names.get(item['user_id'], env._('Unavailable user')),
            },
            'access': item['access'],
        }
        for item in grants
    ]


def dump_access(document):
    document._webvue_require('access')
    grants = [
        {'user_id': grant.user_id.id, 'access': grant.access}
        for grant in document.grant_ids
    ]
    return {
        'visibility': document.visibility,
        'revision': document.revision,
        'grants': dump_grants(document.env, grants),
    }
