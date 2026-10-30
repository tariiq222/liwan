"""Pool composition validates operator inputs before producing runtime data."""
import unittest
from .compose import render_pool
from .test_manifest import release


def operator(pool='green'):
    upstreams = {'odoo': f'http://{pool}-odoo:8069', 'web': f'http://{pool}-web:3000',
                 'ws': f'http://{pool}-odoo:8072'}
    return {'runtimeDbUser':'pool_role','runtimeUid':501,'httpConfigDigest':'a'*64,'cronConfigDigest':'b'*64,
            'guardWebNetwork':'liwan_guard_web','guardOdooNetwork':'liwan_guard_odoo','databaseNetwork':'liwan_database',
            'releaseRoutesDir':'/run/liwan/releases','poolId': pool, 'tenancyMode': 'shared', 'upstreams': upstreams,
            'allowedUpstreams': [*upstreams.values(), 'http://guard:8080'], 'guardUrl': 'http://guard:8080', 'sessionStore': 'liwan_sessions',
            'filestore': 'liwan_filestore', 'assetsStore': 'liwan_assets',
            'httpConfig': f'/etc/liwan/{pool}-http.conf', 'cronConfig': f'/etc/liwan/{pool}-cron.conf',
            'cronDatabases': ['tenant_a', 'tenant_b'], 'runtimeSecret': f'/etc/liwan/{pool}-runtime.conf'}


class ComposeTests(unittest.TestCase):
    def test_pool_generation_has_independent_services(self):
        blue, green = render_pool(release(), operator('blue')), render_pool(release(), operator())
        self.assertFalse(set(blue['services']) & set(green['services']))
        for bundle in (blue, green):
            for service in bundle['services'].values():
                self.assertNotIn('ports', service)
                self.assertIn('@sha256:', service['image'])
            self.assertTrue(all(volume['external'] for volume in bundle['volumes'].values()))

    def test_http_cannot_run_cron_and_cron_membership_is_explicit(self):
        services = render_pool(release(), operator())['services']
        self.assertIn('--max-cron-threads=0', services['green-odoo']['command'])
        self.assertIn('--no-http', services['green-cron-tenant_a']['command'])
        self.assertIn('--database=tenant_a', services['green-cron-tenant_a']['command'])
        self.assertNotIn('--database', ' '.join(services['green-odoo']['command']))

    def test_session_store_is_shared_without_identity_change(self):
        blue, green = render_pool(release(), operator('blue')), render_pool(release(), operator())
        mounts = lambda bundle, name: [entry for entry in bundle['services'][name]['volumes'] if entry['target'] == '/var/lib/odoo/sessions']
        self.assertEqual(mounts(blue, 'blue-odoo'), mounts(green, 'green-odoo'))
        self.assertEqual(green['x-liwan-pool']['releaseId'], 'r20261016')
        self.assertEqual(green['services']['green-web']['labels']['liwan.pool'], 'green')

    def test_rejects_arbitrary_upstreams_names_paths_and_empty_cron_membership(self):
        cases = [dict(upstreams={'odoo': 'http://169.254.169.254:80', 'web': 'http://green-web:3000', 'ws': 'http://green-odoo:8072'}),
                 dict(poolId='../bad'), dict(httpConfig='/etc/../secret'), dict(cronDatabases=[]),
                 dict(runtimeSecret='password'), dict(sessionStore='../../sessions')]
        for patch in cases:
            value = operator(); value.update(patch)
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                render_pool(release(), value)
        value = operator()
        value['upstreams']['web'] = 'https://example.com'
        value['allowedUpstreams'].append('https://example.com')
        with self.assertRaises(ValueError):
            render_pool(release(), value)

    def test_ai_generation_is_stable_on_restart_and_unique_when_reusing_pool(self):
        def generation(pool, release_id):
            manifest = release(releaseId=release_id, images={**release()['images'], 'ai': 'liwan/ai@sha256:' + 'c' * 64})
            value = operator(pool)
            value['upstreams']['ai'] = f'http://{pool}-ai:8081'
            value['allowedUpstreams'].append(value['upstreams']['ai'])
            value['ai'] = {'mode': 'pool', 'stateStore': 'ai_state', 'config': '/etc/liwan/ai.conf'}
            return render_pool(manifest, value)['services'][pool + '-ai']['environment']['AI_GENERATION_ID']
        blue = generation('blue', 'r1')
        self.assertEqual(blue, generation('blue', 'r1'))
        self.assertNotEqual(blue, generation('green', 'r1'))
        self.assertNotEqual(blue, generation('blue', 'r3'))
        self.assertRegex(blue, r'^[a-z][a-z0-9_-]{0,62}$')

    def test_runtime_secret_files_are_consumed_by_services(self):
        result = render_pool(release(), operator())
        self.assertEqual(result['services']['green-web']['env_file'], ['/etc/liwan/green-runtime.conf'])

    def test_service_mounts_cannot_alias_secret_or_persistent_paths(self):
        for patch in ({'httpConfig': '/etc/liwan/green-cron.conf'},
                      {'sessionStore': 'liwan_filestore'}):
            value = operator(); value.update(patch)
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                render_pool(release(), value)

    def test_shared_web_retains_guard_authority(self):
        result = render_pool(release(), operator())
        self.assertEqual(result['services']['green-web']['environment']['NUXT_ODOO_URL'], 'http://guard:8080')
        value = operator(); del value['guardUrl']
        with self.assertRaises(ValueError):
            render_pool(release(), value)

    def test_ai_requires_explicit_pool_or_stable_state_configuration(self):
        manifest = release(images={**release()['images'], 'ai': 'liwan/ai@sha256:' + 'c' * 64})
        with self.assertRaises(ValueError):
            render_pool(manifest, operator())
        value = operator()
        value['upstreams']['ai'] = 'http://green-ai:8081'
        value['allowedUpstreams'].append(value['upstreams']['ai'])
        value['ai'] = {'mode': 'pool', 'stateStore': 'ai_state', 'config': '/etc/liwan/ai.conf'}
        self.assertEqual(render_pool(manifest, value)['services']['green-ai']['image'], manifest['images']['ai'])
        stable = operator(); stable['ai'] = {'mode': 'stable', 'url': 'http://stable-ai:8081'}
        stable['upstreams']['ai'] = 'http://stable-ai:8081'; stable['allowedUpstreams'].append('http://stable-ai:8081')
        self.assertNotIn('green-ai', render_pool(manifest, stable)['services'])


if __name__ == '__main__':
    unittest.main()
