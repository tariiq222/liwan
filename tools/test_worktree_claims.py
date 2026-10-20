# Part of Odoo. See LICENSE file for full copyright and licensing details.
import tempfile
import unittest
from pathlib import Path

from worktree_claims import (
    CLAIM_TTL_HOURS,
    ClaimError,
    claim_path,
    is_expired,
    make_claim,
    normalize_scope,
    overlapping,
    read_claim,
    scopes_overlap,
    write_claim,
)


class TestScopes(unittest.TestCase):
    def test_normalize_keeps_relative_paths_and_refuses_the_rest(self):
        self.assertEqual(normalize_scope(' apps/web/./app/ '), 'apps/web/app')
        self.assertEqual(normalize_scope('.'), '.')
        for bad in ('', '/etc', '../x', 'a/../../x'):
            with self.subTest(bad=bad), self.assertRaises(ClaimError):
                normalize_scope(bad)

    def test_overlap_compares_whole_path_segments(self):
        self.assertTrue(scopes_overlap('apps/web', 'apps/web/app/x.vue'))
        self.assertTrue(scopes_overlap('tools/wt.py', 'tools/wt.py'))
        self.assertFalse(scopes_overlap('apps/web', 'apps/webhooks'))
        self.assertTrue(scopes_overlap('.', 'docs'))
        self.assertEqual(overlapping(('a', 'b/c'), ('b', 'd')), [('b/c', 'b')])


class TestClaim(unittest.TestCase):
    def test_make_claim_validates_and_sorts_unique_scopes(self):
        claim = make_claim(' me ', ' task ', 'main', ['b', 'a/', 'b'], 7)
        self.assertEqual((claim.owner, claim.task, claim.scopes, claim.claimed_at, claim.refreshed_at),
                         ('me', 'task', ('a', 'b'), 7, 7))
        self.assertEqual(make_claim('me', 't', 'main', ['a'], 9, claimed_at=3).claimed_at, 3)
        for owner, task, scopes in ((' ', 't', ['a']), ('me', ' ', ['a']), ('me', 't', [])):
            with self.subTest(owner=owner, task=task, scopes=scopes), self.assertRaises(ClaimError):
                make_claim(owner, task, 'main', scopes, 1)

    def test_write_and_read_round_trip_and_absence(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(read_claim(tmp))
            claim = make_claim('مالك', 'مهمة', 'main', ['docs'], 5, 'agreed')
            write_claim(tmp, claim)
            self.assertEqual(read_claim(tmp), claim)

    def test_an_unreadable_claim_fails_loudly(self):
        with tempfile.TemporaryDirectory() as tmp:
            claim_path(tmp).write_text('{"owner": "x"}', encoding='utf-8')
            with self.assertRaises(ClaimError):
                read_claim(tmp)
            claim_path(tmp).write_text('not json', encoding='utf-8')
            with self.assertRaises(ClaimError):
                read_claim(Path(tmp))

    def test_expiry_is_strictly_after_the_ttl(self):
        limit = CLAIM_TTL_HOURS * 3600
        self.assertFalse(is_expired(0, now=limit))
        self.assertTrue(is_expired(0, now=limit + 1))


if __name__ == '__main__':
    unittest.main()
