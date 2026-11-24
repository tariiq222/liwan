"""Isolated checks of the OCI provisioning container: an in-memory OCI, no network, no docker, no real key."""
import json
import os
import re
import stat
import tempfile
import time
import unittest
from unittest.mock import patch

from tools.shared_saas_lifecycle import oci_provision as oci

TENANCY = 'ocid1.tenancy.oc1..aaaaaaaaexample'
USER = 'ocid1.user.oc1..aaaaaaaaprovision'
COMPARTMENT = 'ocid1.compartment.oc1..aaaaaaaatenants'
FINGERPRINT = ':'.join(['ab'] * 16)
NAMING_KEY = b'naming-key-for-tests'
REQUEST_A = '687674dc-5789-4a99-b151-12d69f010cc3'
REQUEST_B = '5f1c6f9e-0d68-4a5b-9d0c-2a52d3a1c001'
KEY_DELAY = 420  # a new OCI key works after about 7 minutes
ENV = {'OCI_TENANCY_OCID': TENANCY, 'OCI_USER_OCID': USER, 'OCI_FINGERPRINT': FINGERPRINT, 'OCI_COMPARTMENT_OCID': COMPARTMENT,
       'OCI_REGION': 'me-jeddah-1', 'OCI_NAMESPACE': 'tenantns'}


def iso(seconds):
    return time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(seconds))


class FakeOci:
    """The OciRest methods over dictionaries, plus the access rule of the two policy shapes the provisioner writes."""

    def __init__(self, clock):
        self.clock = clock
        self.buckets, self.users, self.groups, self.policies, self.members, self.keys = {}, {}, {}, {}, set(), {}
        self.objects = {}
        self.uploads = {}
        self.created = []
        self.fail = None  # an OciError code raised by every call
        self.deny_all = False  # the service refuses every key, whatever the policies say

    def _check(self):
        if self.fail:
            raise oci.OciError(self.fail)

    def namespace(self):
        self._check()
        return 'tenantns'

    def get_bucket(self, namespace, name):
        self._check()
        return {'name': name} if name in self.buckets else None

    def create_bucket(self, namespace, compartment, name):
        self.buckets[name] = compartment
        self.objects[name] = set()
        self.created.append(('bucket', name))
        return {'name': name}

    def delete_bucket(self, namespace, name):
        self._check()
        if self.uploads.get(name):
            raise oci.OciError('oci_refused')  # OCI keeps a bucket non-empty while an upload is in progress
        self.buckets.pop(name, None)
        self.objects.pop(name, None)
        self.uploads.pop(name, None)
        self.created.append(('bucket_delete', name))

    def list_multipart_uploads(self, namespace, name, limit):
        self._check()
        return list(self.uploads.get(name, []))[:limit]

    def abort_multipart_upload(self, namespace, name, object_name, upload_id):
        self._check()
        self.uploads[name] = [item for item in self.uploads.get(name, []) if item != (object_name, upload_id)]
        self.created.append(('upload_abort', object_name))

    def list_objects(self, namespace, name, limit):
        self._check()
        return sorted(self.objects.get(name, set()))[:limit]

    def delete_objects(self, namespace, name, names):
        self._check()
        hold = self.objects.setdefault(name, set())
        for item in names:
            hold.discard(item)
        self.created.append(('objects', len(names)))
        return len(names)

    def _by_name(self, table, name):
        return next((item for item in table.values() if item['name'] == name), None)

    def find_user(self, name):
        self._check()
        return self._by_name(self.users, name)

    def create_user(self, name):
        user = {'id': 'u-' + name, 'name': name}
        self.users[user['id']] = user
        self.keys[user['id']] = []
        self.created.append(('user', name))
        return user

    def find_group(self, name):
        return self._by_name(self.groups, name)

    def create_group(self, name):
        group = {'id': 'g-' + name, 'name': name}
        self.groups[group['id']] = group
        self.created.append(('group', name))
        return group

    def is_member(self, user_id, group_id):
        return (user_id, group_id) in self.members

    def add_member(self, user_id, group_id):
        self.members.add((user_id, group_id))
        self.created.append(('member', user_id))

    def find_memberships(self, user_id, group_id):
        return [{'id': 'm-' + user_id + '-' + group_id}] if (user_id, group_id) in self.members else []

    def remove_membership(self, membership_id):
        for pair in list(self.members):
            if 'm-' + pair[0] + '-' + pair[1] == membership_id:
                self.members.discard(pair)
        self.created.append(('membership_delete', membership_id))

    def delete_user(self, user_id):
        self._check()
        self.users.pop(user_id, None)
        self.keys.pop(user_id, None)
        self.created.append(('user_delete', user_id))

    def delete_group(self, group_id):
        self._check()
        self.groups.pop(group_id, None)
        self.created.append(('group_delete', group_id))

    def delete_policy(self, policy_id):
        self._check()
        for name, policy in list(self.policies.items()):
            if policy['id'] == policy_id:
                del self.policies[name]
                self.created.append(('policy_delete', policy_id))

    def find_policy(self, name):
        return self._by_name(self.policies, name)

    def create_policy(self, name, statements):
        self.policies[name] = {'id': 'p-' + name, 'name': name, 'statements': list(statements)}
        self.created.append(('policy', name))
        return self.policies[name]

    def update_policy(self, policy_id, statements):
        next(p for p in self.policies.values() if p['id'] == policy_id)['statements'] = list(statements)
        self.created.append(('policy_update', policy_id))

    def list_keys(self, user_id):
        self._check()
        return [{k: v for k, v in key.items() if k != 'key'} for key in self.keys[user_id]]

    def create_key(self, user_id, display_name):
        if len(self.keys[user_id]) >= 2:
            raise oci.OciError('limit_reached')
        key = {'id': f'ak-{len(self.created)}-{self.clock()}', 'displayName': display_name, 'timeCreated': iso(self.clock()),
               'lifecycleState': 'ACTIVE', 'key': 'secret-' + os.urandom(8).hex(), 'born': self.clock()}
        self.keys[user_id].append(key)
        self.created.append(('key', key['id']))
        return {k: v for k, v in key.items() if k != 'born'}

    def delete_key(self, user_id, key_id):
        self.keys[user_id] = [key for key in self.keys[user_id] if key['id'] != key_id]

    # -- the access rule of the real service, as far as these policies go
    def can_access(self, access_key_id, secret, bucket):
        if self.deny_all:
            return False
        for user_id, keys in self.keys.items():
            for key in keys:
                if key['id'] == access_key_id and key['key'] == secret and self.clock() - key['born'] >= KEY_DELAY:
                    return self._policy_allows(self.users[user_id], bucket)
        return False

    def _policy_allows(self, user, bucket):
        for policy in self.policies.values():
            for statement in policy['statements']:
                if not statement.startswith('Allow') or 'manage objects' not in statement:
                    continue
                if 'request.user.name = target.bucket.name' in statement and user['name'] == bucket:
                    return True
                group = re.match(r"Allow group (\S+) to manage objects .* where target\.bucket\.name = '([^']+)'", statement)
                if group and group.group(2) == bucket and (user['id'], 'g-' + group.group(1)) in self.members:
                    return True
        return False


class Clock:
    def __init__(self, start=1_800_000_000):
        self.now = start

    def __call__(self):
        return self.now


class TickingClock(Clock):
    """A clock that moves `step` seconds on every read, so a time budget is spent by the calls themselves."""

    def __init__(self, step, start=1_800_000_000):
        super().__init__(start)
        self.step = step

    def __call__(self):
        self.now += self.step
        return self.now


def provisioner(api, clock, mode='per_tenant'):
    config = oci.Config({**ENV, 'OCI_POLICY_MODE': mode})
    return oci.Provisioner(api, config, NAMING_KEY, clock)


def handle(prov, operation, tenant='acme', **extra):
    return prov.handle({'operation': operation, 'tenantId': tenant, 'requestId': REQUEST_A, **extra})


class NamesTest(unittest.TestCase):
    def test_a_name_is_opaque_deterministic_and_a_valid_bucket_name(self):
        name = oci.resource_name('acme', NAMING_KEY)
        self.assertEqual(name, oci.resource_name('acme', NAMING_KEY))
        self.assertRegex(name, r'^lw-[0-9a-f]{24}$')
        self.assertNotIn('acme', name)

    def test_other_tenants_and_other_naming_keys_get_other_names(self):
        self.assertNotEqual(oci.resource_name('acme', NAMING_KEY), oci.resource_name('acme2', NAMING_KEY))
        self.assertNotEqual(oci.resource_name('acme', NAMING_KEY), oci.resource_name('acme', b'another'))


class EnsureTest(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.api = FakeOci(self.clock)

    def test_ensure_creates_the_bucket_user_group_membership_and_per_tenant_policy(self):
        result = handle(provisioner(self.api, self.clock), 'ensure')
        name = oci.resource_name('acme', NAMING_KEY)
        self.assertEqual(name, result['bucket'])
        self.assertEqual('https://tenantns.compat.objectstorage.me-jeddah-1.oraclecloud.com', result['endpointUrl'])
        self.assertEqual([], result['keys'])
        self.assertEqual({'bucket', 'user', 'group', 'member', 'policy'}, {kind for kind, _ in self.api.created})
        statements = self.api.policies[name]['statements']
        self.assertTrue(all(f"target.bucket.name = '{name}'" in s and f'group {name}' in s for s in statements))
        self.assertTrue(any('read buckets' in s for s in statements) and any('manage objects' in s for s in statements))

    def test_a_repeated_ensure_creates_nothing(self):
        prov = provisioner(self.api, self.clock)
        handle(prov, 'ensure')
        before = list(self.api.created)
        handle(prov, 'ensure')
        self.assertEqual(before, self.api.created)

    def test_a_policy_that_drifted_is_rewritten(self):
        prov = provisioner(self.api, self.clock)
        handle(prov, 'ensure')
        policy = next(iter(self.api.policies.values()))
        policy['statements'] = ['Allow any-user to manage all-resources in tenancy']
        handle(prov, 'ensure')
        self.assertTrue(all('target.bucket.name' in s for s in policy['statements']))

    def test_the_fixed_policy_is_one_statement_set_for_every_tenant_and_makes_no_group(self):
        prov = provisioner(self.api, self.clock, 'fixed')
        handle(prov, 'ensure', 'acme')
        handle(prov, 'ensure', 'other')
        self.assertEqual({oci.FIXED_POLICY_NAME}, set(self.api.policies))
        self.assertEqual({}, self.api.groups)
        self.assertEqual(2, len([c for c in self.api.created if c[0] == 'user']))
        self.assertEqual(1, len([c for c in self.api.created if c[0] == 'policy']))
        self.assertTrue(all('request.user.name = target.bucket.name' in s for s in self.api.policies[oci.FIXED_POLICY_NAME]['statements']))

    def test_ensure_lists_the_keys_with_their_age(self):
        prov = provisioner(self.api, self.clock)
        handle(prov, 'ensure')
        issued = handle(prov, 'issue', keepKeyIds=[])
        self.clock.now += 100
        keys = handle(prov, 'ensure')['keys']
        self.assertEqual([{'id': issued['accessKeyId'], 'createdAt': issued['createdAt']}], keys)
        self.assertEqual(self.clock.now - 100, keys[0]['createdAt'])

    def test_an_oci_failure_is_a_code(self):
        for code in ('oci_refused', 'oci_unreachable', 'limit_reached'):
            self.api.fail = code
            answer = oci.run(json.dumps({'operation': 'ensure', 'tenantId': 'acme', 'requestId': REQUEST_A}), ENV,
                             api=self.api, naming_key=NAMING_KEY)
            self.assertEqual({'error_code': code}, answer)


class IsolationTest(unittest.TestCase):
    """The simulated access rule of the policies: a tenant's key reaches its own bucket and no other."""

    def _check(self, mode):
        clock = Clock()
        api = FakeOci(clock)
        prov = provisioner(api, clock, mode)
        buckets, keys = {}, {}
        for tenant in ('acme', 'beta'):
            buckets[tenant] = handle(prov, 'ensure', tenant)['bucket']
            keys[tenant] = handle(prov, 'issue', tenant, keepKeyIds=[])
        clock.now += KEY_DELAY
        for own, other in (('acme', 'beta'), ('beta', 'acme')):
            key = keys[own]
            self.assertTrue(api.can_access(key['accessKeyId'], key['secret'], buckets[own]))
            self.assertFalse(api.can_access(key['accessKeyId'], key['secret'], buckets[other]))

    def test_cross_tenant_access_is_refused_with_a_policy_per_tenant(self):
        self._check('per_tenant')

    def test_cross_tenant_access_is_refused_with_the_fixed_policy(self):
        self._check('fixed')

    def test_a_key_is_refused_before_it_has_propagated(self):
        clock = Clock()
        api = FakeOci(clock)
        prov = provisioner(api, clock)
        bucket = handle(prov, 'ensure')['bucket']
        key = handle(prov, 'issue', keepKeyIds=[])
        self.assertFalse(api.can_access(key['accessKeyId'], key['secret'], bucket))


class IssueTest(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.api = FakeOci(self.clock)
        self.prov = provisioner(self.api, self.clock)

    def test_issue_before_ensure_is_refused(self):
        with self.assertRaises(oci.OciError) as caught:
            handle(self.prov, 'issue', keepKeyIds=[])
        self.assertEqual('oci_refused', caught.exception.code)

    def test_issue_returns_the_secret_once_and_names_the_key_after_the_job(self):
        handle(self.prov, 'ensure')
        issued = handle(self.prov, 'issue', keepKeyIds=[])
        self.assertEqual({'accessKeyId', 'secret', 'createdAt'}, set(issued))
        self.assertEqual('lw-687674dc', next(iter(self.api.keys.values()))[0]['displayName'])
        self.assertNotIn('key', handle(self.prov, 'ensure')['keys'][0])
        self.assertNotIn(issued['secret'], json.dumps(handle(self.prov, 'inspect')))

    def test_issue_removes_keys_that_nothing_stores_and_keeps_the_named_one(self):
        handle(self.prov, 'ensure')
        stored = handle(self.prov, 'issue', keepKeyIds=[])
        stranded = handle(self.prov, 'issue', keepKeyIds=[stored['accessKeyId']])
        newest = handle(self.prov, 'issue', keepKeyIds=[stored['accessKeyId']])
        ids = [k['id'] for k in handle(self.prov, 'inspect')['keys']]
        self.assertEqual(sorted([stored['accessKeyId'], newest['accessKeyId']]), sorted(ids))
        self.assertNotIn(stranded['accessKeyId'], ids)

    def test_issue_without_a_keep_list_replaces_every_key(self):
        handle(self.prov, 'ensure')
        first = handle(self.prov, 'issue', keepKeyIds=[])
        second = handle(self.prov, 'issue', keepKeyIds=[])
        self.assertEqual([second['accessKeyId']], [k['id'] for k in handle(self.prov, 'inspect')['keys']])
        self.assertNotEqual(first['accessKeyId'], second['accessKeyId'])

    def test_an_inactive_key_is_cleaned_so_the_limit_of_two_cannot_wedge_issuance(self):
        handle(self.prov, 'ensure')
        user = next(iter(self.api.users.values()))
        first, second = handle(self.prov, 'issue', keepKeyIds=[]), None
        self.api.keys[user['id']].append({'id': 'ak-inactive', 'displayName': 'old', 'timeCreated': iso(self.clock()), 'lifecycleState': 'INACTIVE', 'key': 'x', 'born': 0})
        self.assertEqual(2, len(self.api.keys[user['id']]))  # at the limit: a plain create would be refused
        second = handle(self.prov, 'issue', keepKeyIds=[first['accessKeyId']])
        ids = [key['id'] for key in self.api.keys[user['id']]]
        self.assertEqual(sorted([first['accessKeyId'], second['accessKeyId']]), sorted(ids))
        self.assertNotIn('ak-inactive', ids)

    def test_inspect_and_ensure_list_only_active_keys_but_delete_key_reaches_an_inactive_one(self):
        handle(self.prov, 'ensure')
        user = next(iter(self.api.users.values()))
        self.api.keys[user['id']].append({'id': 'ak-inactive', 'displayName': 'old', 'timeCreated': iso(self.clock()), 'lifecycleState': 'INACTIVE', 'key': 'x', 'born': 0})
        self.assertEqual([], handle(self.prov, 'inspect')['keys'])
        handle(self.prov, 'delete_key', keyId='ak-inactive')
        self.assertEqual([], self.api.keys[user['id']])

    def test_a_malformed_keep_list_or_request_id_is_refused(self):
        handle(self.prov, 'ensure')
        for extra in ({'keepKeyIds': 'x'}, {'keepKeyIds': ['a', 'b']}, {'keepKeyIds': ['../x']}, {}):
            with self.assertRaises(oci.OciError):
                handle(self.prov, 'issue', **extra)
        with self.assertRaises(oci.OciError):
            self.prov.handle({'operation': 'issue', 'tenantId': 'acme', 'requestId': 'x', 'keepKeyIds': []})

    def test_delete_key_removes_only_a_key_of_this_tenant(self):
        handle(self.prov, 'ensure', 'acme')
        handle(self.prov, 'ensure', 'beta')
        mine = handle(self.prov, 'issue', 'acme', keepKeyIds=[])
        theirs = handle(self.prov, 'issue', 'beta', keepKeyIds=[])
        handle(self.prov, 'delete_key', 'acme', keyId=theirs['accessKeyId'])
        self.assertEqual(1, len(handle(self.prov, 'inspect', 'beta')['keys']))
        handle(self.prov, 'delete_key', 'acme', keyId=mine['accessKeyId'])
        self.assertEqual([], handle(self.prov, 'inspect', 'acme')['keys'])
        handle(self.prov, 'delete_key', 'acme', keyId=mine['accessKeyId'])  # repeated: nothing to do

    def test_inspect_of_an_unknown_tenant_is_empty(self):
        self.assertEqual({'bucket': oci.resource_name('nobody', NAMING_KEY), 'bucketExists': False, 'keys': []}, handle(self.prov, 'inspect', 'nobody'))


class RunTest(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.api = FakeOci(self.clock)

    def run_request(self, request, env=ENV, raw=None):
        return oci.run(raw if raw is not None else json.dumps(request), env, api=self.api, naming_key=NAMING_KEY)

    def test_the_answer_is_a_result_and_an_error_never_raises(self):
        ok = self.run_request({'operation': 'ensure', 'tenantId': 'acme', 'requestId': REQUEST_A})
        self.assertEqual({'result'}, set(ok))
        for bad in ({'operation': 'destroy', 'tenantId': 'acme'}, {'operation': 'ensure', 'tenantId': '../x'},
                    {'operation': 'ensure', 'tenantId': 5}, []):
            self.assertEqual({'error_code': 'script_failed'}, self.run_request(bad))
        self.assertEqual({'error_code': 'script_failed'}, self.run_request(None, raw='{not json'))
        self.assertEqual({'error_code': 'script_failed'}, self.run_request(None, raw=' ' * (oci.MAX_REQUEST + 1)))

    def test_an_unexpected_failure_carries_no_text(self):
        self.api.namespace = lambda: (_ for _ in ()).throw(RuntimeError('secret-in-message'))
        answer = self.run_request({'operation': 'ensure', 'tenantId': 'acme', 'requestId': REQUEST_A})
        self.assertEqual({'error_code': 'script_failed'}, answer)

    def test_configuration_is_validated(self):
        request = {'operation': 'ensure', 'tenantId': 'acme', 'requestId': REQUEST_A}
        for key, value in (('OCI_TENANCY_OCID', 'nope'), ('OCI_FINGERPRINT', 'abc'), ('OCI_REGION', 'Jeddah'),
                           ('OCI_POLICY_MODE', 'wide'), ('OCI_NAMESPACE', 'a/b'), ('OCI_COMPARTMENT_OCID', '')):
            with self.subTest(key=key):
                self.assertEqual({'error_code': 'oci_refused'}, self.run_request(request, {**ENV, key: value}))
        self.assertEqual({'error_code': 'oci_refused'}, self.run_request(request, {k: v for k, v in ENV.items() if k != 'OCI_USER_OCID'}))

    def test_a_key_file_that_others_can_read_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, 'key')
            with open(path, 'wb') as handle_:
                handle_.write(b'fixture-provisioning-key')
            os.chmod(path, 0o644)
            with self.assertRaises(oci.OciError):
                oci.read_secret_file(path)
            os.chmod(path, 0o600)
            self.assertEqual(b'fixture-provisioning-key', oci.read_secret_file(path))
            link = os.path.join(directory, 'link')
            os.symlink(path, link)
            with self.assertRaises(oci.OciError):
                oci.read_secret_file(link)
            with self.assertRaises(oci.OciError):
                oci.read_secret_file(os.path.join(directory, 'missing'))
            empty = os.path.join(directory, 'empty')
            open(empty, 'wb').close()
            os.chmod(empty, 0o600)
            with self.assertRaises(oci.OciError):
                oci.read_secret_file(empty)
            self.assertEqual(0, stat.S_IMODE(os.stat(path).st_mode) & 0o077)

    def test_the_default_files_are_under_run_secrets_not_the_environment(self):
        config = oci.Config(ENV)
        self.assertEqual('/run/secrets/oci_provision_key', config.key_file)
        self.assertEqual('/run/secrets/oci_naming_key', config.naming_key_file)
        self.assertFalse(any('KEY' in name and name.endswith(('_SECRET', '_PRIVATE')) for name in ENV))


class FakeTransport:
    def __init__(self, status=200, body=b'{}'):
        self.status, self.body, self.calls = status, body, []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, headers, body))
        if isinstance(self.status, Exception):
            raise self.status
        return self.status, self.body


class RestTest(unittest.TestCase):
    def rest(self, transport):
        self.signed = []
        return oci.OciRest(oci.Config(ENV), signer=lambda message: self.signed.append(message) or 'c2ln', transport=transport,
                           clock=lambda: 1_800_000_000)

    def test_a_get_is_signed_over_target_host_and_date(self):
        transport = FakeTransport(200, b'[{"id":"u1","name":"x"}]')
        self.assertEqual({'id': 'u1', 'name': 'x'}, self.rest(transport).find_user('x'))
        method, url, headers, body = transport.calls[0]
        self.assertEqual('GET', method)
        self.assertTrue(url.startswith('https://identity.me-jeddah-1.oci.oraclecloud.com/20160918/users?'))
        self.assertIn('keyId="' + '/'.join((TENANCY, USER, FINGERPRINT)) + '"', headers['authorization'])
        self.assertIn('headers="(request-target) host date"', headers['authorization'])
        self.assertTrue(self.signed[0].startswith('(request-target): get /20160918/users?'))
        self.assertIn('host: identity.me-jeddah-1.oci.oraclecloud.com\ndate: ', self.signed[0])
        self.assertIsNone(body)

    def test_a_post_signs_the_body_hash_type_and_length(self):
        transport = FakeTransport(200, b'{"id":"b"}')
        self.rest(transport).create_bucket('tenantns', COMPARTMENT, 'lw-x')
        method, url, headers, body = transport.calls[0]
        self.assertEqual('https://objectstorage.me-jeddah-1.oraclecloud.com/n/tenantns/b/', url)
        self.assertEqual(str(len(body)), headers['content-length'])
        self.assertIn('x-content-sha256 content-type content-length', headers['authorization'])
        self.assertIn('x-content-sha256: ' + headers['x-content-sha256'], self.signed[0])
        self.assertEqual('NoPublicAccess', json.loads(body)['publicAccessType'])

    def test_statuses_map_to_codes(self):
        for status, body, code in ((401, b'{}', 'oci_refused'), (403, b'{}', 'oci_refused'), (400, b'{"code":"LimitExceeded"}', 'limit_reached'),
                                   (429, b'{}', 'oci_unreachable'), (503, b'{}', 'oci_unreachable'), (400, b'{"code":"InvalidParameter"}', 'oci_refused')):
            with self.subTest(status=status):
                with self.assertRaises(oci.OciError) as caught:
                    self.rest(FakeTransport(status, body)).list_keys('u1')
                self.assertEqual(code, caught.exception.code)

    def test_not_found_and_conflict_are_values(self):
        self.assertIsNone(self.rest(FakeTransport(404)).get_bucket('ns', 'x'))
        self.assertEqual({'conflict': True}, self.rest(FakeTransport(409)).create_user('x'))

    def test_a_network_failure_is_unreachable_and_a_bad_body_too(self):
        with self.assertRaises(oci.OciError) as caught:
            self.rest(FakeTransport(oci.OciError('oci_unreachable'))).list_keys('u1')
        self.assertEqual('oci_unreachable', caught.exception.code)
        with self.assertRaises(oci.OciError):
            self.rest(FakeTransport(200, b'<html>')).list_keys('u1')

    def test_a_batch_delete_uses_the_batch_endpoint_and_its_own_body(self):
        transport = FakeTransport(200, json.dumps({'deleted': [{'objectName': 'a'}, {'objectName': 'b'}], 'failed': []}).encode())
        self.assertEqual(2, self.rest(transport).delete_objects('tenantns', 'lw-x', ['a', 'b']))
        method, url, headers, body = transport.calls[0]
        self.assertEqual('POST', method)
        self.assertEqual('https://objectstorage.me-jeddah-1.oraclecloud.com/n/tenantns/b/lw-x/actions/batchDeleteObjects', url)
        self.assertEqual({'objects': [{'objectName': 'a'}, {'objectName': 'b'}]}, json.loads(body))
        self.assertIn('x-content-sha256 content-type content-length', headers['authorization'])

    def test_a_batch_delete_counts_an_already_absent_object_as_gone_and_any_other_failure_as_a_refusal(self):
        not_found = FakeTransport(200, json.dumps({'deleted': [{'objectName': 'a'}],
                                                   'failed': [{'objectName': 'b', 'statusCode': 404, 'errorMessage': 'Not Found'}]}).encode())
        self.assertEqual(2, self.rest(not_found).delete_objects('ns', 'b', ['a', 'b']))
        for failed in ([{'objectName': 'b', 'statusCode': 500, 'errorMessage': 'Internal'}],
                       [{'objectName': 'b', 'statusCode': 409, 'errorMessage': 'Conflict'}], 'x'):
            with self.subTest(failed=failed):
                body = json.dumps({'deleted': [{'objectName': 'a'}], 'failed': failed}).encode()
                with self.assertRaises(oci.OciError) as caught:
                    self.rest(FakeTransport(200, body)).delete_objects('ns', 'b', ['a', 'b'])
                self.assertEqual('oci_refused', caught.exception.code)
        short = json.dumps({'deleted': [{'objectName': 'a'}], 'failed': []}).encode()
        with self.assertRaises(oci.OciError):
            self.rest(FakeTransport(200, short)).delete_objects('ns', 'b', ['a', 'b'])

    def test_an_incomplete_upload_is_listed_and_aborted_on_its_own_paths(self):
        transport = FakeTransport(200, json.dumps([{'object': 'big/a.bin', 'uploadId': 'up-1'}]).encode())
        rest = self.rest(transport)
        self.assertEqual([('big/a.bin', 'up-1')], rest.list_multipart_uploads('ns', 'lw-x', 1000))
        self.assertEqual('https://objectstorage.me-jeddah-1.oraclecloud.com/n/ns/b/lw-x/u?limit=1000', transport.calls[0][1])
        transport.status, transport.body = 204, b''
        self.assertEqual({}, rest.abort_multipart_upload('ns', 'lw-x', 'big/a.bin', 'up-1'))
        self.assertEqual(('DELETE', 'https://objectstorage.me-jeddah-1.oraclecloud.com/n/ns/b/lw-x/u/big/a.bin?uploadId=up-1'),
                         transport.calls[1][:2])
        # A name with a space or a special character stays one escaped path segment, and the signature covers the escaped target.
        transport.calls.clear()
        rest.abort_multipart_upload('ns', 'lw-x', 'big dir/a b.bin', 'up-2')
        self.assertEqual('https://objectstorage.me-jeddah-1.oraclecloud.com/n/ns/b/lw-x/u/big%20dir/a%20b.bin?uploadId=up-2', transport.calls[0][1])
        self.assertTrue(self.signed[-1].startswith('(request-target): delete /n/ns/b/lw-x/u/big%20dir/a%20b.bin?uploadId=up-2'))

    def test_a_conflicting_iam_delete_is_an_error_not_a_value(self):
        with self.assertRaises(oci.OciError) as caught:
            self.rest(FakeTransport(409)).delete_user('u1')
        self.assertEqual('oci_refused', caught.exception.code)
        for method, status, expect in (('remove_membership', 204, {}), ('delete_group', 404, None), ('delete_policy', 204, {})):
            with self.subTest(method=method):
                transport = FakeTransport(status, b'' if status == 204 else b'{}')
                rest = self.rest(transport)
                answer = getattr(rest, method)('x1')
                self.assertEqual(expect, answer)

    def test_only_the_two_oracle_hosts_are_ever_called(self):
        transport = FakeTransport(200, b'[]')
        rest = self.rest(transport)
        rest.find_user('x'), rest.find_group('x'), rest.find_policy('x'), rest.list_keys('u'), rest.get_bucket('ns', 'b')
        hosts = {call[1].split('/')[2] for call in transport.calls}
        self.assertEqual({'identity.me-jeddah-1.oci.oraclecloud.com', 'objectstorage.me-jeddah-1.oraclecloud.com'}, hosts)

    def test_iam_goes_to_the_home_region(self):
        config = oci.Config({**ENV, 'OCI_HOME_REGION': 'eu-frankfurt-1'})
        self.assertEqual('identity.eu-frankfurt-1.oci.oraclecloud.com', config.identity_host)
        self.assertEqual('objectstorage.me-jeddah-1.oraclecloud.com', config.object_storage_host)

    def test_the_time_of_a_key_is_read_as_utc_and_an_unreadable_one_counts_as_now(self):
        self.assertEqual(1_800_000_000, oci.epoch('2027-01-15T08:00:00.123Z', 5))
        self.assertEqual(7, oci.epoch('yesterday', 7))
        self.assertEqual(7, oci.epoch(None, 7))


class DropTest(unittest.TestCase):
    """The other direction of `ensure`: the tenant's own resources go, nothing of another tenant is looked at."""

    def setUp(self):
        self.clock = Clock()
        self.api = FakeOci(self.clock)

    def provisioned(self, tenant='acme', objects=0, mode='per_tenant'):
        prov = provisioner(self.api, self.clock, mode)
        bucket = handle(prov, 'ensure', tenant)['bucket']
        key = handle(prov, 'issue', tenant, keepKeyIds=[])
        self.api.objects[bucket] = {'obj-%03d' % n for n in range(objects)}
        return prov, bucket, key

    def test_drop_removes_this_tenants_objects_bucket_policy_group_membership_key_and_user(self):
        prov, bucket, key = self.provisioned(objects=5)
        other, other_bucket, other_key = self.provisioned('beta', objects=2)
        result = handle(prov, 'drop')
        self.assertEqual('removed', result['state'])
        self.assertEqual(5, result['objectsDeleted'])
        self.assertEqual(1, result['keysDeleted'])
        self.assertEqual({'bucket': True, 'policy': True, 'user': True, 'group': True}, result['removed'])
        self.assertNotIn(bucket, self.api.buckets)
        self.assertEqual([], [user for user in self.api.users.values() if user['name'] == bucket])
        self.assertNotIn(bucket, self.api.policies)
        self.assertFalse(any(user_id == 'u-' + bucket for user_id, _ in self.api.members))
        # the other tenant and its key are untouched
        self.assertIn(other_bucket, self.api.buckets)
        self.assertEqual(2, len(self.api.objects[other_bucket]))
        self.assertEqual(1, len(handle(other, 'inspect', 'beta')['keys']))
        self.assertEqual(other_key['accessKeyId'], handle(other, 'inspect', 'beta')['keys'][0]['id'])
        self.assertIn(other_bucket, self.api.policies)

    def test_a_repeated_drop_finds_nothing_and_still_answers_removed(self):
        prov, _, _ = self.provisioned(objects=3)
        handle(prov, 'drop')
        again = handle(prov, 'drop')
        self.assertEqual({'bucket': False, 'policy': False, 'user': False, 'group': False}, again['removed'])
        self.assertEqual((0, 0), (again['objectsDeleted'], again['keysDeleted']))

    def test_drop_removes_an_inactive_key_too(self):
        prov, bucket, _ = self.provisioned()
        user = next(user for user in self.api.users.values() if user['name'] == bucket)
        self.api.keys[user['id']].append({'id': 'ak-inactive', 'displayName': 'old', 'timeCreated': iso(self.clock()), 'lifecycleState': 'INACTIVE', 'key': 'x', 'born': 0})
        self.assertEqual(2, handle(prov, 'drop')['keysDeleted'])
        self.assertNotIn(user['id'], self.api.keys)

    def test_the_fixed_policy_and_group_belong_to_every_tenant_and_stay(self):
        prov, bucket, _ = self.provisioned(mode='fixed')
        self.provisioned('beta', mode='fixed')
        # a group left by an earlier per-tenant provisioning is shared by name with this tenant only, but the fixed policy is not:
        # the policy is the one every tenant uses, so it is never deleted.
        self.api.create_group(bucket)
        result = handle(provisioner(self.api, self.clock, 'fixed'), 'drop')
        self.assertEqual('removed', result['state'])
        self.assertEqual({'bucket': True, 'policy': False, 'user': True, 'group': False}, result['removed'])
        self.assertNotIn(bucket, self.api.buckets)
        self.assertIn(oci.FIXED_POLICY_NAME, self.api.policies)
        self.assertIn(bucket, [group['name'] for group in self.api.groups.values()])

    def test_a_bucket_too_large_for_one_call_reports_emptying_and_the_next_call_finishes(self):
        prov, bucket, _ = self.provisioned(objects=5)
        # A spent budget (zero seconds) after the first batch: the pass keeps what it removed and the next call continues.
        with patch.object(oci, 'EMPTY_BATCH', 2), patch.object(oci, 'DRAIN_SECONDS', 0):
            emptying = handle(prov, 'drop')
        self.assertEqual(('emptying', 2), (emptying['state'], emptying['objectsDeleted']))
        self.assertIn(bucket, self.api.buckets)
        self.assertEqual(3, len(self.api.objects[bucket]))
        done = handle(prov, 'drop')
        self.assertEqual(('removed', 3), (done['state'], done['objectsDeleted']))
        self.assertNotIn(bucket, self.api.buckets)

    def test_the_drain_stops_at_the_time_budget_and_keeps_the_progress_it_made(self):
        # One object per batch and every clock read 25 s on: the 60 s pass fits three batches, the fourth read is past the budget.
        ticking = TickingClock(25)
        prov = provisioner(self.api, ticking)
        bucket = handle(prov, 'ensure')['bucket']
        self.api.objects[bucket] = {'obj-%03d' % n for n in range(10)}
        with patch.object(oci, 'EMPTY_BATCH', 1):
            emptying = handle(prov, 'drop')
        self.assertEqual('emptying', emptying['state'])
        self.assertEqual(3, emptying['objectsDeleted'])  # progress is kept, not thrown away with the pass
        self.assertEqual(7, len(self.api.objects[bucket]))
        self.assertIn(bucket, self.api.buckets)
        self.assertNotIn(('bucket_delete', bucket), self.api.created)
        # A later pass on a spent clock finishes the same bucket.
        self.assertEqual('removed', handle(provisioner(self.api, self.clock), 'drop')['state'])
        self.assertNotIn(bucket, self.api.buckets)

    def test_one_pass_aborts_at_most_the_abort_limit_and_the_next_pass_finishes_them(self):
        prov, bucket, _ = self.provisioned()
        self.api.uploads[bucket] = [('big/%03d.bin' % n, 'up-%03d' % n) for n in range(250)]
        # A budget that never runs out isolates the cap: the pass aborts ABORT_LIMIT uploads and reports emptying.
        with patch.object(oci, 'DRAIN_SECONDS', 10 ** 6):
            emptying = handle(prov, 'drop')
            aborts = [call for call in self.api.created if call[0] == 'upload_abort']
            self.assertEqual(oci.ABORT_LIMIT, len(aborts))
            self.assertEqual('emptying', emptying['state'])
            self.assertEqual(50, len(self.api.uploads[bucket]))
            self.assertIn(bucket, self.api.buckets)
            self.assertEqual('removed', handle(prov, 'drop')['state'])
        self.assertNotIn(bucket, self.api.uploads)
        self.assertNotIn(bucket, self.api.buckets)

    def test_an_incomplete_multipart_upload_is_aborted_before_the_bucket_goes(self):
        prov, bucket, _ = self.provisioned()
        self.api.uploads[bucket] = [('big/archive.bin', 'up-1'), ('big/second.bin', 'up-2')]
        result = handle(prov, 'drop')
        self.assertEqual('removed', result['state'])
        self.assertNotIn(bucket, self.api.uploads)
        dropped = [call for call in self.api.created if call[0] in ('upload_abort', 'bucket_delete')]
        self.assertEqual([('upload_abort', 'big/archive.bin'), ('upload_abort', 'big/second.bin'), ('bucket_delete', bucket)], dropped)

    def test_an_upload_that_is_still_listed_after_the_abort_reports_emptying_and_keeps_the_bucket(self):
        prov, bucket, _ = self.provisioned()
        self.api.uploads[bucket] = [('big/archive.bin', 'up-1')]
        # The service accepts the abort and still lists it (a slow purge): the bucket is not deleted over it, and the next call continues.
        with patch.object(self.api, 'abort_multipart_upload', lambda *a: None):
            result = handle(prov, 'drop')
        self.assertEqual('emptying', result['state'])
        self.assertIn(bucket, self.api.buckets)
        self.assertNotIn(('bucket_delete', bucket), self.api.created)
        self.api.uploads.pop(bucket, None)
        self.assertEqual('removed', handle(prov, 'drop')['state'])

    def test_a_bucket_that_is_still_there_after_the_delete_is_a_code(self):
        prov, bucket, _ = self.provisioned()
        with patch.object(self.api, 'delete_bucket', lambda *a: None):
            with self.assertRaises(oci.OciError) as caught:
                handle(prov, 'drop')
        self.assertEqual('bucket_still_present', caught.exception.code)

    def test_an_oci_failure_is_a_code_and_nothing_is_reported_as_removed(self):
        prov, _, _ = self.provisioned(objects=1)
        self.api.fail = 'oci_unreachable'
        answer = oci.run(json.dumps({'operation': 'drop', 'tenantId': 'acme', 'requestId': REQUEST_A}), ENV,
                         api=self.api, naming_key=NAMING_KEY)
        self.assertEqual({'error_code': 'oci_unreachable'}, answer)


if __name__ == '__main__':
    unittest.main()
