# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from no_external_refs import find_external_refs


class TestNoExternalRefs(unittest.TestCase):
    def test_flags_runtime_hosts(self):
        text = "@import url('https://fonts.googleapis.com/css2?family=X');\n<script src=\"//cdn.jsdelivr.net/x.js\">"
        self.assertEqual([n for _, n in find_external_refs('a.css', text)], [1, 2])

    def test_ignores_namespaces_and_reserved_example_hosts(self):
        text = '<svg xmlns="http://www.w3.org/2000/svg">\nconst u = "https://example.invalid/docs"\n'
        self.assertEqual(find_external_refs('a.vue', text), [])


if __name__ == '__main__':
    unittest.main()
