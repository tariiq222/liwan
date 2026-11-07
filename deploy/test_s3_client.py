# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The S3-compatible client must sign exactly what AWS documents and store what it is given.

The SigV4 vector below is AWS's own published "GET Object" example, so a mistake in
canonicalisation is a failing test rather than a mysterious 403 in Riyadh. The
filesystem store is a first-class backend, not a test stub only: an operator without a
bucket can still run the pipeline and the drill, and it is what the tests exercise.
"""
from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

from deploy import s3_client
from deploy.s3_client import (
    Credentials,
    FilesystemStore,
    S3Client,
    SigningRequest,
    canonical_query_string,
    sha256_hex,
)

AWS_VECTOR = Credentials(
    access_key='AKIAIOSFODNN7EXAMPLE',
    secret_key='wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region='us-east-1',
    endpoint='https://examplebucket.s3.amazonaws.com',
    bucket='examplebucket',
)


class TestSigV4MatchesThePublishedVector(unittest.TestCase):
    def test_get_object_canonical_request_and_signature(self):
        # AWS "Signature Calculations for the Authorization Header: GET Object".
        request = SigningRequest(
            method='GET',
            url='https://examplebucket.s3.amazonaws.com/test.txt',
            headers={'Range': 'bytes=0-9', 'Host': 'examplebucket.s3.amazonaws.com'},
            payload_sha256=sha256_hex(b''),
            amz_date='20130524T000000Z',
        )
        signed = S3Client(AWS_VECTOR).sign(request)
        self.assertEqual(
            signed.canonical_request.split('\n')[:3],
            ['GET', '/test.txt', ''],
        )
        self.assertEqual(
            signed.authorization,
            'AWS4-HMAC-SHA256 '
            'Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
            'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, '
            'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
        )
        self.assertEqual(signed.headers['x-amz-date'], '20130524T000000Z')
        self.assertEqual(signed.headers['x-amz-content-sha256'], sha256_hex(b''))

    def test_empty_payload_hash_is_the_standard_constant(self):
        self.assertEqual(
            sha256_hex(b''),
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        )

    def test_query_parameters_are_sorted_and_percent_encoded(self):
        self.assertEqual(
            canonical_query_string({'list-type': '2', 'prefix': 'a b/', 'delimiter': '/'}),
            'delimiter=%2F&list-type=2&prefix=a%20b%2F',
        )

    def test_a_different_secret_produces_a_different_signature(self):
        other = Credentials(access_key=AWS_VECTOR.access_key, secret_key='another-secret',
                            region='us-east-1', endpoint=AWS_VECTOR.endpoint,
                            bucket=AWS_VECTOR.bucket)
        request = SigningRequest(method='GET', url=AWS_VECTOR.endpoint + '/test.txt',
                                 headers={'Host': 'examplebucket.s3.amazonaws.com'},
                                 payload_sha256=sha256_hex(b''), amz_date='20130524T000000Z')
        self.assertNotEqual(S3Client(AWS_VECTOR).sign(request).authorization,
                            S3Client(other).sign(request).authorization)

    def test_credentials_refuse_to_be_built_with_empty_values(self):
        for field in ('access_key', 'secret_key', 'region', 'endpoint', 'bucket'):
            with self.subTest(field=field), self.assertRaises(s3_client.StorageError):
                Credentials(**{**AWS_VECTOR.__dict__, field: ''})

    def test_credentials_from_the_environment_and_no_default(self):
        env = {
            'LIWAN_BACKUP_S3_ENDPOINT': 'https://objectstorage.me-jeddah-1.oraclecloud.com',
            'LIWAN_BACKUP_S3_REGION': 'me-jeddah-1',
            'LIWAN_BACKUP_S3_BUCKET': 'liwan-backups',
            'LIWAN_BACKUP_S3_ACCESS_KEY': 'synthetic-access',
            'LIWAN_BACKUP_S3_SECRET_KEY': 'synthetic-secret',
        }
        credentials = Credentials.from_environment(env)
        self.assertEqual(credentials.bucket, 'liwan-backups')
        self.assertEqual(credentials.region, 'me-jeddah-1')
        for missing in env:
            with self.subTest(missing=missing), self.assertRaises(s3_client.StorageError):
                Credentials.from_environment({k: v for k, v in env.items() if k != missing})

    def test_the_signing_key_never_appears_in_the_authorization_header(self):
        request = SigningRequest(method='GET', url=AWS_VECTOR.endpoint + '/test.txt',
                                 headers={'Host': 'examplebucket.s3.amazonaws.com'},
                                 payload_sha256=sha256_hex(b''), amz_date='20130524T000000Z')
        authorization = S3Client(AWS_VECTOR).sign(request).authorization
        self.assertNotIn(AWS_VECTOR.secret_key, authorization)


class TestFilesystemStoreLayout(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='liwan-store-'))
        self.store = FilesystemStore(self.root)

    def test_put_get_head_list_delete_round_trip(self):
        self.store.put('tenant_a/hourly/2026-11-08T000000Z.dump.age', b'ciphertext')
        self.assertEqual(self.store.get('tenant_a/hourly/2026-11-08T000000Z.dump.age'), b'ciphertext')
        self.assertEqual(self.store.head('tenant_a/hourly/2026-11-08T000000Z.dump.age'), 10)
        self.assertEqual(self.store.list('tenant_a/hourly/'),
                         ['tenant_a/hourly/2026-11-08T000000Z.dump.age'])
        with self.assertRaises(s3_client.StorageError):
            self.store.put('tenant_a/hourly/2026-11-08T000000Z.dump.age', b'overwrite')
        self.store.delete('tenant_a/hourly/2026-11-08T000000Z.dump.age')
        self.assertEqual(self.store.list('tenant_a/hourly/'), [])

    def test_missing_objects_raise_instead_of_returning_none(self):
        with self.assertRaises(s3_client.StorageError):
            self.store.get('absent')
        with self.assertRaises(s3_client.StorageError):
            self.store.head('absent')
        with self.assertRaises(s3_client.StorageError):
            self.store.delete('absent')

    def test_a_key_that_escapes_the_root_is_refused(self):
        for key in ('../escape', '/absolute', 'a/../../b'):
            with self.subTest(key=key), self.assertRaises(s3_client.StorageError):
                self.store.put(key, b'x')

    def test_listing_is_ordered_and_prefix_scoped(self):
        for name in ('t/hourly/b', 't/daily/c', 't/hourly/a', 'other/hourly/z'):
            self.store.put(name, b'x')
        self.assertEqual(self.store.list('t/hourly/'), ['t/hourly/a', 't/hourly/b'])
        self.assertEqual(self.store.list('t/'), ['t/daily/c', 't/hourly/a', 't/hourly/b'])

    def test_a_key_that_collides_with_a_directory_or_a_file_raises(self):
        self.store.put('a', b'x')
        with self.assertRaises(s3_client.StorageError):
            self.store.put('a/b', b'y')
        (self.root / 'occupied').mkdir()
        with self.assertRaises(s3_client.StorageError):
            self.store.put('occupied', b'y')


class TestS3StoreOverAnInjectedTransport(unittest.TestCase):
    """The HTTP store signs real requests; a fake transport keeps the socket closed."""

    def setUp(self):
        self.credentials = Credentials(
            access_key='synthetic-access',
            secret_key='synthetic-secret-value',
            region='me-jeddah-1',
            endpoint='https://objectstorage.me-jeddah-1.oraclecloud.com',
            bucket='liwan-backups',
        )
        self.sent = []
        self.reply = (200, {}, b'')
        self.store = s3_client.S3Store(self.credentials, transport=self.transport)

    def transport(self, request):
        self.sent.append(request)
        return self.reply

    def test_a_get_is_signed_for_the_bucket_path(self):
        self.reply = (200, {'Content-Length': '10'}, b'ciphertext')
        self.assertEqual(self.store.get('tenant_a/hourly/x.dump.age'), b'ciphertext')
        request = self.sent[0]
        self.assertEqual(request.method, 'GET')
        self.assertEqual(
            request.url,
            'https://objectstorage.me-jeddah-1.oraclecloud.com/liwan-backups/tenant_a/hourly/x.dump.age',
        )
        self.assertEqual(request.body, b'')
        self.assertEqual(
            request.headers['x-amz-content-sha256'],
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        )
        date_stamp = request.headers['x-amz-date'][:8]
        self.assertEqual(len(request.headers['x-amz-date']), 16)
        expected = s3_client.S3Client(self.credentials).sign(
            _as_signing_request(request),
        ).authorization
        self.assertEqual(request.headers['authorization'], expected)
        self.assertIn(
            f'Credential=synthetic-access/{date_stamp}/me-jeddah-1/s3/aws4_request',
            request.headers['authorization'],
        )
        self.assertIn(
            'SignedHeaders=host;x-amz-content-sha256;x-amz-date',
            request.headers['authorization'],
        )

    def test_a_put_carries_the_payload_hash_and_refuses_overwrite(self):
        self.reply = (412, {}, b'')
        with self.assertRaises(s3_client.StorageError):
            self.store.put('tenant_a/hourly/x.dump.age', b'ciphertext')
        request = self.sent[0]
        self.assertEqual(request.method, 'PUT')
        self.assertEqual(request.body, b'ciphertext')
        self.assertEqual(
            request.headers['x-amz-content-sha256'],
            hashlib.sha256(b'ciphertext').hexdigest(),
        )
        self.assertEqual(request.headers['if-none-match'], '*')

    def test_a_forbidden_answer_raises_without_the_secret(self):
        self.reply = (403, {}, b'')
        with self.assertRaises(s3_client.StorageError) as caught:
            self.store.get('tenant_a/hourly/x.dump.age')
        self.assertNotIn(self.credentials.secret_key, str(caught.exception))
        self.assertNotIn(self.credentials.access_key, str(caught.exception))
        self.assertIn('403', str(caught.exception))

    def test_a_listing_page_is_parsed_into_sorted_keys(self):
        self.reply = (
            200,
            {'Content-Type': 'application/xml'},
            (
                b'<?xml version="1.0" encoding="UTF-8"?>'
                b'<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                b'<IsTruncated>false</IsTruncated>'
                b'<Contents><Key>t/hourly/b</Key><Size>1</Size></Contents>'
                b'<Contents><Key>t/hourly/a</Key><Size>2</Size></Contents>'
                b'</ListBucketResult>'
            ),
        )
        self.assertEqual(self.store.list('t/hourly/'), ['t/hourly/a', 't/hourly/b'])
        request = self.sent[0]
        self.assertEqual(request.method, 'GET')
        self.assertTrue(
            request.url.endswith('/liwan-backups?list-type=2&prefix=t%2Fhourly%2F'),
            request.url,
        )

    def test_a_truncated_listing_follows_its_continuation_token(self):
        first = (
            200,
            {},
            (
                b'<ListBucketResult>'
                b'<IsTruncated>true</IsTruncated>'
                b'<NextContinuationToken>page-two</NextContinuationToken>'
                b'<Contents><Key>t/a</Key></Contents>'
                b'</ListBucketResult>'
            ),
        )
        second = (
            200,
            {},
            (
                b'<ListBucketResult>'
                b'<IsTruncated>false</IsTruncated>'
                b'<Contents><Key>t/c</Key></Contents>'
                b'</ListBucketResult>'
            ),
        )
        replies = [first, second]
        store = s3_client.S3Store(self.credentials, transport=lambda request: replies.pop(0))
        self.assertEqual(store.list('t/'), ['t/a', 't/c'])

    def test_head_reads_the_content_length_and_an_unusable_one_raises(self):
        self.reply = (200, {'Content-Length': '10'}, b'')
        self.assertEqual(self.store.head('tenant_a/hourly/x.dump.age'), 10)
        self.assertEqual(self.sent[0].method, 'HEAD')
        self.reply = (200, {}, b'')
        with self.assertRaises(s3_client.StorageError):
            self.store.head('tenant_a/hourly/x.dump.age')

    def test_delete_refuses_a_missing_object_like_the_filesystem_store(self):
        # Retention pruning behaves the same against a bucket and a directory: an
        # absent key is an error in both, never a silent success in one.
        self.reply = (404, {}, b'')
        with self.assertRaises(s3_client.StorageError):
            self.store.delete('tenant_a/hourly/absent.dump.age')
        self.assertEqual([request.method for request in self.sent], ['HEAD'])
        self.sent.clear()
        # Presence is proven with a HEAD first; only then is the DELETE sent, so a
        # store that is already gone can never be reported as pruned.
        self.reply = (200, {'Content-Length': '4'}, b'')
        self.store.delete('tenant_a/hourly/x.dump.age')
        self.assertEqual([request.method for request in self.sent], ['HEAD', 'DELETE'])

    def test_delete_refuses_a_key_that_escapes(self):
        for key in ('../escape', '/absolute', 'a/../../b', ''):
            with self.subTest(key=key), self.assertRaises(s3_client.StorageError):
                self.store.delete(key)

    def test_a_non_http_endpoint_is_refused(self):
        with self.assertRaises(s3_client.StorageError):
            s3_client.S3Store(
                Credentials(
                    access_key=self.credentials.access_key,
                    secret_key=self.credentials.secret_key,
                    region=self.credentials.region,
                    endpoint='file:///tmp',
                    bucket=self.credentials.bucket,
                ),
            )


def _as_signing_request(request):
    headers = {
        name: value for name, value in request.headers.items()
        if name not in ('authorization', 'x-amz-content-sha256', 'x-amz-date')
    }
    return SigningRequest(
        method=request.method,
        url=request.url,
        headers=headers,
        payload_sha256=request.headers['x-amz-content-sha256'],
        amz_date=request.headers['x-amz-date'],
    )


if __name__ == '__main__':
    unittest.main()
