# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The settings resource routes: teams, stages, categories, tags, channels and types."""
from .common import LiwanHelpdeskCase


class ResourcesApiTest(LiwanHelpdeskCase):

    def resources(self):
        response = self.api('GET', '/api/v1/helpdesk/settings/resources')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def save(self, kind, **payload):
        return self.api('POST', f'/api/v1/helpdesk/settings/{kind}', json=payload)

    def test_a_manager_reads_every_reference_list(self):
        self.as_user(self.manager)
        body = self.resources()
        self.assertIn(self.team.id, [team['id'] for team in body['teams']])
        self.assertTrue(any(stage['closed'] for stage in body['stages']))
        for key in ('categories', 'tags', 'channels', 'types'):
            self.assertIn(key, body)
        self.assertEqual(body['teams'][0]['member_ids'][0]['id'], self.agent.id)

    def test_only_the_settings_readers_open_the_lists(self):
        self.as_user(self.agent)
        self.assertEqual(self.api('GET', '/api/v1/helpdesk/settings/resources').status_code, 403)
        self.as_user(self.supervisor)
        self.assertEqual(self.api('GET', '/api/v1/helpdesk/settings/resources').status_code, 200)
        created = self.as_user(self.manager).save('tags', name='billing')
        self.assertEqual(created.status_code, 200, created.text)

    def test_an_agent_cannot_change_the_lists(self):
        self.as_user(self.agent)
        self.assertEqual(self.save('tags', name='billing').status_code, 403)

    def test_a_team_is_created_with_its_members_and_leader(self):
        self.as_user(self.manager)
        response = self.save('teams', name='Second line', member_ids=[self.agent.id, self.agent2.id],
                             leader_id=self.agent2.id, sequence=5)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['leader_id'], self.agent2.id)
        self.assertEqual({member['id'] for member in body['member_ids']}, {self.agent.id, self.agent2.id})
        # The leader must be a member.
        refused = self.save('teams', name='Empty line', member_ids=[self.agent.id], leader_id=self.agent2.id)
        self.assertEqual((refused.status_code, refused.json()['field']), (422, 'leader_id'))

    def test_the_default_team_and_a_team_with_open_tickets_are_not_archived(self):
        self.as_user(self.manager)
        default = self.save('teams', id=self.team.id, name=self.team.name, active=False)
        self.assertEqual((default.status_code, default.json()['code']), (422, 'invalid'))
        self.as_user(self.agent)
        self.ticket_body()
        self.as_user(self.manager)
        busy = self.save('teams', id=self.team.id, name=self.team.name, active=False)
        self.assertEqual((busy.status_code, busy.json()['field']), (422, 'active'))

    def test_a_stage_is_created_with_its_flags(self):
        self.as_user(self.manager)
        created = self.save('stages', name='Waiting on customer', unattended=True, sequence=3)
        self.assertEqual(created.status_code, 200, created.text)
        body = created.json()
        self.assertTrue(body['unattended'])
        self.assertFalse(body['closed'])
        closed = self.save('stages', name='Resolved', closed=True, sequence=4)
        self.assertTrue(closed.json()['closed'])
        archived = self.save('stages', id=closed.json()['id'], name='Resolved', active=False)
        self.assertEqual(archived.status_code, 200, archived.text)
        self.assertFalse(archived.json()['active'])

    def test_a_stage_holding_open_tickets_is_not_archived(self):
        self.as_user(self.manager)
        stage = self.save('stages', name='Triage', sequence=2).json()
        self.as_user(self.agent)
        ticket = self.ticket_body()
        self.as_user(self.agent)
        self.api('POST', f'/api/v1/helpdesk/tickets/{ticket["id"]}/stage', json={'stage_id': stage['id']})
        self.as_user(self.manager)
        refused = self.save('stages', id=stage['id'], name='Triage', active=False)
        self.assertEqual((refused.status_code, refused.json()['field']), (422, 'active'))

    def test_categories_keep_their_tree(self):
        self.as_user(self.manager)
        parent = self.save('categories', name='Network').json()
        child = self.save('categories', name='VPN', parent_id=parent['id'])
        self.assertEqual(child.status_code, 200, child.text)
        self.assertEqual(child.json()['name'], 'Network / VPN')
        self.assertEqual(child.json()['parent_id'], parent['id'])
        self_parent = self.save('categories', id=parent['id'], name='Network', parent_id=parent['id'])
        self.assertEqual((self_parent.status_code, self_parent.json()['field']), (422, 'parent_id'))

    def test_the_flat_lists_are_saved_and_archived(self):
        self.as_user(self.manager)
        for kind in ('tags', 'channels', 'types'):
            created = self.save(kind, name='%s one' % kind)
            self.assertEqual(created.status_code, 200, '%s: %s' % (kind, created.text))
            record = created.json()
            self.assertEqual(record['name'], '%s one' % kind)
            archived = self.save(kind, id=record['id'], name=record['name'], active=False)
            self.assertEqual(archived.status_code, 200, archived.text)
            self.assertFalse(archived.json()['active'])

    def test_a_record_of_another_company_is_not_found(self):
        other = self._team(self.other_company, 'Other company team')
        self.as_user(self.manager)
        response = self.save('teams', id=other.id, name='Hijacked')
        self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'))

    def test_the_body_is_validated(self):
        self.as_user(self.manager)
        self.assertEqual(self.save('tags', name='').json()['field'], 'name')
        self.assertEqual(self.save('tags', name='x', wat=1).status_code, 422)
        self.assertEqual(self.save('tags', unknown='x').status_code, 422)
        self.assertEqual(self.save('teams', name='T', sequence=-2).json()['field'], 'sequence')
        self.assertEqual(self.save('teams', name='T', active='yes').json()['field'], 'active')
