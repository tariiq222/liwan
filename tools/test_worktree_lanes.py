# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import tempfile
import unittest
from pathlib import Path

import worktree_lanes as lanes
from worktree_lanes import (
    LaneError,
    Take,
    commit_refusal,
    read_take,
    resting,
    write_take,
)

TAKEN = Take('tools-x', 'session-a', 'a task', 100, 'abc', 'orch-1')


class TestRecord(unittest.TestCase):
    def test_a_record_round_trips_and_a_missing_one_is_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(read_take(tmp))
            write_take(tmp, TAKEN)
            self.assertEqual(read_take(tmp), TAKEN)
            write_take(tmp, resting('abc'))
            self.assertEqual(read_take(tmp), Take(None, None, None, None, 'abc'))
            self.assertEqual([p.name for p in Path(tmp).iterdir()], [lanes.TAKE_FILE])  # no draft file is left behind

    def test_an_old_record_without_an_orchestrator_reads_as_none(self):
        old = {key: value for key, value in TAKEN.as_json().items() if key != 'orchestrator'}
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / lanes.TAKE_FILE).write_text(json.dumps(old), encoding='utf-8')
            self.assertEqual(read_take(tmp), TAKEN._replace(orchestrator=None))

    def test_an_unreadable_record_raises_with_its_path(self):
        bad = ('not json', '{}', json.dumps({**TAKEN.as_json(), 'orchestrator': 3}), json.dumps({**TAKEN.as_json(), 'branch': 3}), json.dumps({**TAKEN.as_json(), 'taken_at': 'x'}))
        for text in bad:
            with self.subTest(text=text), tempfile.TemporaryDirectory() as tmp:
                (Path(tmp) / lanes.TAKE_FILE).write_text(text, encoding='utf-8')
                with self.assertRaisesRegex(LaneError, 'unreadable lane record'):
                    read_take(tmp)

    def test_names_are_one_folder_name(self):
        self.assertEqual(lanes.validate_name('lane-1'), 'lane-1')
        for bad in ('', '..', 'a/b', '-x', 'a b', '.hidden'):
            with self.subTest(name=bad), self.assertRaises(LaneError):
                lanes.validate_name(bad)

    def test_lane_name_is_a_direct_child_of_the_pool(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertEqual(lanes.lane_name_of(root, root / '.worktrees' / 'one'), 'one')
            self.assertIsNone(lanes.lane_name_of(root, root / '.worktrees' / 'one' / 'sub'))
            self.assertIsNone(lanes.lane_name_of(root, root))
            self.assertIsNone(lanes.lane_name_of(root, root / 'other'))


class TestCommitRefusal(unittest.TestCase):
    def test_main_is_refused_everywhere(self):
        for take, linked in ((None, False), (None, True), (TAKEN, True), (resting(), True)):
            with self.subTest(take=take, linked=linked):
                self.assertIn('main', commit_refusal('main', take, linked))

    def test_a_lane_allows_only_its_recorded_branch(self):
        self.assertIsNone(commit_refusal('tools-x', TAKEN, True))
        self.assertIn('holds tools-x but other is checked out', commit_refusal('other', TAKEN, True))
        self.assertIn('a detached HEAD', commit_refusal('', TAKEN, True))
        self.assertIn('resting', commit_refusal('anything', resting(), True))

    def test_a_linked_worktree_without_a_record_is_refused_but_the_main_checkout_is_not(self):
        self.assertIn('lane add <name>', commit_refusal('tools-x', None, True))
        self.assertIsNone(commit_refusal('tools-x', None, False))
        self.assertIsNone(commit_refusal('', None, False))


if __name__ == '__main__':
    unittest.main()
