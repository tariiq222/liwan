"""Tests for deploy/release/proof.py: the signed staging proof, its transport and every accepted outcome.

Everything runs without openssl except the real-key cases at the end, which generate an Ed25519 key and skip on
LibreSSL (macOS) so CI, where openssl 3 is installed, proves the command shapes too.
"""
from __future__ import annotations

import base64
import hashlib
import http.client
import json
import subprocess
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from deploy.release import proof
from deploy.release.common import Runner

COMMIT = '0123456789abcdef0123456789abcdef01234567'
TAG = 'release/19.0.1.0.7'
DIGEST = 'f' * 64
PAYLOAD = {'tag': TAG, 'commit': COMMIT, 'releaseDocumentDigest': DIGEST, 'environment': 'staging',
           'at': '2026-11-24T10:00:00+00:00'}
# Frozen: the exact bytes a signature covers for PAYLOAD. A change here is a change of the signed format.
CANONICAL = (b'{"at":"2026-11-24T10:00:00+00:00","commit":"0123456789abcdef0123456789abcdef01234567",'
             b'"environment":"staging",'
             b'"releaseDocumentDigest":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",'
             b'"tag":"release/19.0.1.0.7"}')
DOCUMENT = b'{"release":{"odooCommit":"1"}}\n'
DOCUMENT_SHA256 = '4240880fb4ed9b086a6b057406d16660b64ca8fd74f9a98d3139cb3158b9048f'
PROOF_URL = f'https://staging.example/_liwan/release-proof/{COMMIT}.json'
FAKE_SIGNATURE = b'fake-ed25519-signature'


class FakeOpenSSL:
    """The openssl CLI without openssl: records argv, writes a canned signature, accepts or refuses the check."""

    def __init__(self, accepts=True, rejects=(), missing=False):
        self.accepts, self.rejects, self.missing = accepts, set(rejects), missing
        self.calls, self.signed_message = [], None

    def __call__(self, argv, *, stdin=None, env=None, check=True, timeout=None, cwd=None):
        self.calls.append(argv)
        if self.missing:
            raise FileNotFoundError(2, 'No such file or directory', argv[0])
        if '-sign' in argv:
            self.signed_message = Path(argv[argv.index('-in') + 1]).read_bytes()
            Path(argv[argv.index('-out') + 1]).write_bytes(FAKE_SIGNATURE)
            return 0, ''
        if '-verify' in argv:
            if not self.accepts or argv[argv.index('-inkey') + 1] in self.rejects:
                return 1, 'Signature Verification Failure\n'
            return 0, 'Signature Verified Successfully\n'
        raise AssertionError(f'unexpected command {argv}')


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, size):
        return self.body[:size]


class FakeOpener:
    def __init__(self, error=None, body=b''):
        self.error, self.body, self.request, self.timeout = error, body, None, None

    def open(self, request, timeout=None):
        self.request, self.timeout = request, timeout
        if self.error is not None:
            raise self.error
        return FakeResponse(self.body)


class ProofCase(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory(prefix='liwan-proof-test-')
        self.addCleanup(self.work.cleanup)
        self.public = Path(self.work.name, 'release-proof.pub')
        self.public.write_text('the fake verifier never reads this\n', encoding='ascii')
        self.public.chmod(0o644)

    def proof_file(self, payload=None, signature=base64.b64encode(FAKE_SIGNATURE).decode('ascii')):
        return proof.canonical({'contract': proof.CONTRACT,
                                'payload': PAYLOAD if payload is None else payload, 'signature': signature})

    def require(self, raw, runner, **expected):
        wanted = {'tag': TAG, 'commit': COMMIT, 'digest': DIGEST, **expected}
        return proof.require(raw, public_key_files=[self.public], run=runner, **wanted)

    def assert_refused(self, reason, raw, runner, **expected):
        with self.assertRaises(proof.ProofError) as caught:
            self.require(raw, runner, **expected)
        self.assertEqual(caught.exception.reason, reason)
        return caught.exception


class FormatTest(unittest.TestCase):
    def test_canonical_bytes_are_sorted_ascii_and_have_no_trailing_newline(self):
        self.assertEqual(proof.canonical(PAYLOAD), CANONICAL)
        self.assertFalse(proof.canonical(PAYLOAD).endswith(b'\n'))
        self.assertEqual(proof.canonical({'tag': 'é'}), b'{"tag":"\\u00e9"}')

    def test_document_digest_covers_the_raw_bytes_and_does_not_normalise_them(self):
        self.assertEqual(proof.document_digest(DOCUMENT), DOCUMENT_SHA256)
        self.assertNotEqual(proof.document_digest(DOCUMENT), proof.document_digest(DOCUMENT.rstrip()))
        self.assertEqual(proof.document_digest(b''), hashlib.sha256(b'').hexdigest())


class SignTest(ProofCase):
    def test_sign_returns_the_proof_file_and_signs_the_canonical_payload(self):
        runner = FakeOpenSSL()
        body = proof.sign(PAYLOAD, '/etc/liwan-release/staging-release-proof.key', run=runner)
        self.assertEqual(json.loads(body), {'contract': 1, 'payload': PAYLOAD,
                                            'signature': base64.b64encode(FAKE_SIGNATURE).decode('ascii')})
        self.assertEqual(runner.signed_message, CANONICAL)
        self.assertEqual(runner.calls[0][:5], ['openssl', 'pkeyutl', '-sign', '-rawin', '-inkey'])


class RequireTest(ProofCase):
    def test_a_valid_proof_is_accepted_and_the_public_key_flags_are_pinned(self):
        runner = FakeOpenSSL()
        self.assertEqual(self.require(self.proof_file(), runner), PAYLOAD)
        self.assertIn('-pubin', runner.calls[0])
        self.assertEqual(runner.calls[0][:5], ['openssl', 'pkeyutl', '-verify', '-pubin', '-inkey'])

    def test_a_wrong_tag_is_staging_proof_invalid(self):
        error = self.assert_refused(proof.PROOF_INVALID, self.proof_file(dict(PAYLOAD, tag='release/19.0.1.0.8')),
                                    FakeOpenSSL())
        self.assertIn('tag', error.detail)

    def test_a_wrong_commit_is_staging_proof_invalid(self):
        error = self.assert_refused(proof.PROOF_INVALID, self.proof_file(dict(PAYLOAD, commit='8' * 40)),
                                    FakeOpenSSL())
        self.assertIn('commit', error.detail)

    def test_a_wrong_document_digest_is_staging_proof_invalid(self):
        error = self.assert_refused(proof.PROOF_INVALID, self.proof_file(), FakeOpenSSL(), digest='0' * 64)
        self.assertIn('releaseDocumentDigest', error.detail)

    def test_the_signed_environment_is_never_compared(self):
        payload = self.require(self.proof_file(dict(PAYLOAD, environment='somewhere-else')), FakeOpenSSL())
        self.assertEqual(payload['environment'], 'somewhere-else')

    def test_a_signature_no_pinned_key_made_is_staging_proof_invalid(self):
        error = self.assert_refused(proof.PROOF_INVALID, self.proof_file(), FakeOpenSSL(accepts=False))
        self.assertIn('matches no pinned public key', error.detail)

    def test_a_signature_that_is_not_base64_is_staging_proof_invalid(self):
        self.assert_refused(proof.PROOF_INVALID, self.proof_file(signature='not base64!'), FakeOpenSSL())

    def test_a_verifier_that_cannot_run_is_staging_proof_invalid_with_a_detail(self):
        error = self.assert_refused(proof.PROOF_INVALID, self.proof_file(), FakeOpenSSL(missing=True))
        self.assertIn('openssl verifier cannot run', error.detail)

    def test_malformed_json_is_staging_proof_invalid_before_openssl(self):
        runner = FakeOpenSSL()
        self.assert_refused(proof.PROOF_INVALID, b'{"contract":1,', runner)
        self.assertEqual(runner.calls, [])

    def test_an_unknown_contract_is_staging_proof_invalid(self):
        raw = proof.canonical({'contract': 2, 'payload': PAYLOAD, 'signature': 'AAAA'})
        self.assert_refused(proof.PROOF_INVALID, raw, FakeOpenSSL())

    def test_a_payload_without_the_signed_fields_is_staging_proof_invalid(self):
        self.assert_refused(proof.PROOF_INVALID, self.proof_file({'tag': TAG}), FakeOpenSSL())

    def test_a_world_writable_public_key_is_refused_before_openssl(self):
        self.public.chmod(0o666)
        runner = FakeOpenSSL()
        error = self.assert_refused(proof.PROOF_INVALID, self.proof_file(), runner)
        self.assertIn('writable by group or others', error.detail)
        self.assertEqual(runner.calls, [])

    def test_a_missing_public_key_file_is_staging_proof_invalid(self):
        self.public.unlink()
        self.assert_refused(proof.PROOF_INVALID, self.proof_file(), FakeOpenSSL())

    def test_a_second_pinned_key_still_verifies_within_the_rotation_window(self):
        other = Path(self.work.name, 'previous-release-proof.pub')
        other.write_text('the fake verifier never reads this\n', encoding='ascii')
        other.chmod(0o644)
        runner = FakeOpenSSL(rejects=[str(self.public)])
        payload = proof.require(self.proof_file(), public_key_files=f'{self.public},{other}', run=runner,
                                tag=TAG, commit=COMMIT, digest=DIGEST)
        self.assertEqual(payload, PAYLOAD)
        self.assertEqual(len(runner.calls), 2)


class HttpsGetTest(unittest.TestCase):
    def fetch(self, opener, url=PROOF_URL, **kwargs):
        with mock.patch.object(proof.urllib.request, 'build_opener', return_value=opener):
            return proof.https_get(url, **kwargs)

    def test_a_404_is_staging_proof_missing_and_the_request_carries_the_release_identity(self):
        opener = FakeOpener(urllib.error.HTTPError(PROOF_URL, 404, 'Not Found', {}, None))
        with self.assertRaises(proof.ProofError) as caught:
            self.fetch(opener)
        self.assertEqual(caught.exception.reason, proof.PROOF_MISSING)
        self.assertEqual(opener.request.get_header('User-agent'), f'liwan-release/{COMMIT}')
        self.assertIsNone(opener.request.get_header('Authorization'))
        self.assertEqual(opener.timeout, 10)

    def test_an_unreachable_host_is_staging_proof_missing(self):
        opener = FakeOpener(urllib.error.URLError(OSError('connection refused')))
        with self.assertRaises(proof.ProofError) as caught:
            self.fetch(opener)
        self.assertEqual(caught.exception.reason, proof.PROOF_MISSING)
        self.assertIn('unreachable', caught.exception.detail)

    def test_a_broken_response_stream_is_staging_proof_missing(self):
        with self.assertRaises(proof.ProofError) as caught:
            self.fetch(FakeOpener(http.client.IncompleteRead(b'{"contract"')))
        self.assertEqual(caught.exception.reason, proof.PROOF_MISSING)

    def test_a_redirect_is_never_followed(self):
        self.assertIsNone(proof._NoRedirect().redirect_request(None, None, 302, '', {}, PROOF_URL))
        opener = FakeOpener(urllib.error.HTTPError(PROOF_URL, 302, 'Found', {}, None))
        with self.assertRaises(proof.ProofError) as caught:
            self.fetch(opener)
        self.assertEqual(caught.exception.reason, proof.PROOF_MISSING)

    def test_an_oversized_proof_is_staging_proof_invalid(self):
        with self.assertRaises(proof.ProofError) as caught:
            self.fetch(FakeOpener(body=b'x' * 8193))
        self.assertEqual(caught.exception.reason, proof.PROOF_INVALID)

    def test_a_url_that_is_not_the_pinned_https_proof_path_is_staging_proof_invalid(self):
        for url in (PROOF_URL.replace('https', 'http'), PROOF_URL.replace(COMMIT, 'main'),
                    f'https://user:secret@staging.example/_liwan/release-proof/{COMMIT}.json'):
            with self.subTest(url=url):
                with self.assertRaises(proof.ProofError) as caught:
                    self.fetch(FakeOpener(body=b'{}'), url=url)
                self.assertEqual(caught.exception.reason, proof.PROOF_INVALID)


def openssl_ed25519() -> bool:
    """Whether this host's openssl can make an Ed25519 key (LibreSSL, e.g. macOS, cannot)."""
    with tempfile.TemporaryDirectory(prefix='liwan-openssl-probe-') as work:
        try:
            done = subprocess.run(['openssl', 'genpkey', '-algorithm', 'ED25519', '-out', str(Path(work, 'probe.key'))],
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
        except OSError:
            return False
    return done.returncode == 0


HAS_OPENSSL_ED25519 = openssl_ed25519()


@unittest.skipUnless(HAS_OPENSSL_ED25519, 'openssl 3 with Ed25519 is required (LibreSSL and macOS skip; CI runs it)')
class RealOpenSSLTest(ProofCase):
    def setUp(self):
        super().setUp()
        self.runner = Runner(lambda _: None)
        self.key = Path(self.work.name, 'staging-release-proof.key')
        self.public = Path(self.work.name, 'staging-release-proof.pub')
        self.runner(['openssl', 'genpkey', '-algorithm', 'ED25519', '-out', str(self.key)])
        self.key.chmod(0o600)
        self.runner(['openssl', 'pkey', '-in', str(self.key), '-pubout', '-out', str(self.public)])
        self.public.chmod(0o644)

    def test_a_proof_signed_on_this_host_verifies(self):
        body = proof.sign(PAYLOAD, self.key, run=self.runner)
        self.assertEqual(proof.require(body, tag=TAG, commit=COMMIT, digest=DIGEST,
                                       public_key_files=[self.public], run=self.runner), PAYLOAD)

    def test_a_tampered_payload_no_longer_verifies(self):
        body = json.loads(proof.sign(PAYLOAD, self.key, run=self.runner))
        body['payload'] = dict(body['payload'], tag='release/19.0.1.0.8')
        with self.assertRaises(proof.ProofError) as caught:
            self.require(proof.canonical(body), self.runner)
        self.assertEqual(caught.exception.reason, proof.PROOF_INVALID)

    def test_a_world_writable_public_key_is_refused(self):
        self.public.chmod(0o666)
        with self.assertRaises(proof.ProofError) as caught:
            self.require(proof.sign(PAYLOAD, self.key, run=self.runner), self.runner)
        self.assertEqual(caught.exception.reason, proof.PROOF_INVALID)
