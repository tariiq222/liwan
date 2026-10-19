"""The Odoo test shards: balanced, complete, disjoint and stable."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import odoo_shards


class SplitTest(unittest.TestCase):
    WEIGHTS = {'a': 475, 'b': 372, 'c': 165, 'd': 137, 'e': 110, 'f': 97, 'g': 1}

    def test_every_module_lands_in_exactly_one_shard(self):
        shards = odoo_shards.split(self.WEIGHTS, 3)
        flat = [m for shard in shards for m in shard]
        self.assertEqual(sorted(flat), sorted(self.WEIGHTS))

    def test_shards_are_balanced_and_stable(self):
        shards = odoo_shards.split(self.WEIGHTS, 3)
        totals = [sum(self.WEIGHTS[m] for m in shard) for shard in shards]
        self.assertLessEqual(max(totals) - min(totals), 150)
        self.assertEqual(shards, odoo_shards.split(dict(reversed(list(self.WEIGHTS.items()))), 3))

    def test_selector_is_validated(self):
        self.assertEqual(odoo_shards.parse_selector('2/3'), (2, 3))
        for bad in ('0/3', '4/3', '2', 'a/b', '1/0'):
            with self.subTest(selector=bad), self.assertRaises(odoo_shards.ShardError):
                odoo_shards.parse_selector(bad)


class WeightTest(unittest.TestCase):
    def test_counts_test_methods_and_floors_at_one(self):
        with tempfile.TemporaryDirectory() as root:
            tests = Path(root) / 'm' / 'tests'
            tests.mkdir(parents=True)
            (tests / 'test_a.py').write_text('class T:\n    def test_x(self): pass\n    def test_y(self): pass\n    def helper(self): pass\n')
            (tests / 'common.py').write_text('def test_not_counted(): pass\n')
            (Path(root) / 'empty' / 'tests').mkdir(parents=True)
            self.assertEqual(odoo_shards.weight('m', Path(root)), 2)
            self.assertEqual(odoo_shards.weight('empty', Path(root)), 1)


class CommandTest(unittest.TestCase):
    def output(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(odoo_shards.main(list(argv)), 0)
        return out.getvalue().strip()

    def test_matrix_lists_every_shard_number(self):
        self.assertEqual(json.loads(self.output('matrix')), list(range(1, odoo_shards.SHARD_COUNT + 1)))

    def test_selector_picks_that_shards_tags(self):
        count = odoo_shards.SHARD_COUNT
        planned = odoo_shards.plan(count)
        for k in range(1, count + 1):
            self.assertEqual(self.output('tags', '%d/%d' % (k, count)), ','.join('/' + m for m in planned[k - 1]))

    def test_invalid_count_and_missing_port_are_refused(self):
        with self.assertRaises(odoo_shards.ShardError):
            odoo_shards.plan(0)
        with self.assertRaises(odoo_shards.ShardError):
            odoo_shards.run_all(0)


class ReleaseTest(unittest.TestCase):
    def test_shard_tags_cover_the_release_modules_once(self):
        count = odoo_shards.SHARD_COUNT
        tagged = [t for k in range(1, count + 1) for t in odoo_shards.tags('%d/%d' % (k, count)).split(',')]
        self.assertEqual(sorted(tagged), sorted('/' + m for m in odoo_shards.release_modules()))


if __name__ == '__main__':
    unittest.main()
