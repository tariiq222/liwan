# Part of Odoo. See LICENSE file for full copyright and licensing details.
import fcntl
import tempfile
import unittest
from pathlib import Path

from worktree_claims import (
    CLAIM_TTL_HOURS,
    CLAIMS_LOCK_FILE,
    LANE_FILE,
    ClaimError,
    Lane,
    claim_path,
    claims_lock,
    commit_refusal,
    is_expired,
    lane_path,
    make_claim,
    normalize_scope,
    overlapping,
    read_claim,
    read_lane,
    scopes_overlap,
    write_claim,
    write_lane,
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


def session(owner, *scopes):
    return make_claim(owner, 'task of ' + owner, 'tools-x', scopes, 10)


class TestLaneRecord(unittest.TestCase):
    def test_write_and_read_round_trip_and_absence(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(read_lane(tmp))
            lane = Lane('tools-x', (session('a', 'tools'), session('b', 'docs')))
            write_lane(tmp, lane)
            self.assertEqual(read_lane(tmp), lane)
            write_lane(tmp, Lane(None, ()))
            self.assertEqual(read_lane(Path(tmp)), Lane(None, ()))
            self.assertEqual([path.name for path in Path(tmp).iterdir()], [LANE_FILE])

    def test_the_claims_lock_makes_a_second_writer_wait(self):
        with tempfile.TemporaryDirectory() as tmp, claims_lock(tmp):
            with open(Path(tmp) / CLAIMS_LOCK_FILE, 'w', encoding='utf-8') as other:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_an_unreadable_lane_record_fails_loudly(self):
        with tempfile.TemporaryDirectory() as tmp:
            for text in ('not json', '{"branch": "x"}', '{"branch": 3, "sessions": []}', '{"branch": null, "sessions": [{"owner": "a"}]}'):
                lane_path(tmp).write_text(text, encoding='utf-8')
                with self.subTest(text=text), self.assertRaises(ClaimError):
                    read_lane(tmp)


class TestCommitRefusal(unittest.TestCase):
    LANE = Lane('tools-x', (session('a', 'tools/wt.py', 'docs'), session('b', 'apps/web')))

    def refusal(self, **overrides):
        values = dict(lane_name='claude-1', lane=self.LANE, branch='tools-x', session='a', staged=['tools/wt.py'], merging=False, now=10)
        values.update(overrides)
        return commit_refusal(**values)

    def test_a_session_committing_inside_its_claim_is_allowed(self):
        self.assertIsNone(self.refusal())
        self.assertIsNone(self.refusal(staged=['docs/a.md', 'docs/deep/b.md', 'tools/wt.py']))
        self.assertIsNone(self.refusal(staged=[]))

    def test_a_lane_without_a_record_or_a_started_branch_is_refused(self):
        self.assertIn('lane setup claude-1', self.refusal(lane=None))
        self.assertIn('lane start claude-1 <branch>', self.refusal(lane=Lane(None, ())))

    def test_another_branch_is_refused_and_names_the_way_back(self):
        message = self.refusal(branch='other')
        self.assertIn('claude-1 is on other but its started branch is tools-x', message)
        self.assertIn('git switch tools-x', message)
        self.assertIn('a detached HEAD', self.refusal(branch=''))

    def test_a_missing_session_or_claim_is_refused(self):
        self.assertIn('LIWAN_SESSION=<owner>', self.refusal(session=''))
        message = self.refusal(session='c')
        self.assertIn('session c has no claim in lane claude-1', message)
        self.assertIn('claim --owner c', message)

    def test_an_expired_claim_is_refused_until_the_session_renews_it(self):
        limit = 10 + CLAIM_TTL_HOURS * 3600
        self.assertIsNone(self.refusal(now=limit))
        for merging in (False, True):
            message = self.refusal(now=limit + 1, merging=merging)
            self.assertIn('the claim of session a in lane claude-1 expired', message)
            self.assertIn('claim --owner a', message)

    def test_paths_outside_the_claim_are_listed_with_the_session_that_covers_them(self):
        message = self.refusal(staged=['tools/wt.py', 'apps/web/app/a.vue', 'README.md', 'tools/wt.pyc', 'docs'])
        self.assertIn('  apps/web/app/a.vue (claimed by session b)', message)
        self.assertIn('  README.md\n', message)
        self.assertIn('  tools/wt.pyc\n', message)  # whole segments: tools/wt.py does not cover tools/wt.pyc
        self.assertNotIn('  tools/wt.py\n', message)
        self.assertIn('lane claude-1', message)

    def test_a_deletion_outside_the_claim_is_refused_like_any_other_path(self):
        self.assertIn('  apps/web/gone.vue (claimed by session b)', self.refusal(staged=['apps/web/gone.vue']))

    def test_a_merge_in_progress_is_exempt_from_the_scope_rule_only(self):
        self.assertIsNone(self.refusal(staged=['apps/web/app/a.vue'], merging=True))
        self.assertIn('LIWAN_SESSION', self.refusal(session='', merging=True))
        self.assertIn('git switch', self.refusal(branch='other', merging=True))

    def test_the_whole_repository_scope_covers_every_path(self):
        lane = Lane('tools-x', (session('a', '.'),))
        self.assertIsNone(self.refusal(lane=lane, staged=['anything/at/all.py']))


if __name__ == '__main__':
    unittest.main()
