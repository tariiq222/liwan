# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Exercise the repository's actual ignore policy without a user's global rules."""
from pathlib import Path
import subprocess
import tempfile
import unittest


class GitignoreTests(unittest.TestCase):
    def test_private_and_generated_paths_are_ignored(self):
        self.check_paths(True, [
            '.env', 'apps/web/.env', '.env.worktree', 'deploy/.env.production',
            'certs/server.pem', 'apps/web/public/private.key', 'keys/client.p12',
            'keys/client.pfx', 'keys/signing.p8', 'keys/app.jks', 'keys/app.keystore',
            'backups/customer.sql', 'dumps/customer.dump', 'artifacts/session.json',
            'screenshots/customer.png', 'local.sqlite3', 'data/customer.db',
            '.codex/config.toml', '.agents/skills/local/SKILL.md', '.dsh/settings.json',
            '.claude/launch.json', '.claude/skills/webvue-dev-servers/SKILL.md',
            '.claude/skills/vendor-pack/SKILL.md', '.claude/settings.local.json',
            '.claude/agents/local-agent.md', '.claude/scripts/private.sh',
            '.scratch/plan.md', '.worktrees/task/source.ts', '.runtime/odoo.log',
            '.agent-teams/team/team.json', '.agent-teams-webvue/team/team.json',
            '.agent-teams-anyproject/inbox/member.jsonl',
            '.council/audit-r1/R0-inventory.md', '.project-council/state.json',
            'apps/web/.nuxt/tsconfig.json', 'node_modules/example/index.js',
            'apps/web/test-results/trace.zip', 'apps/web/coverage/index.html',
        ])

    def test_required_sources_and_shared_configuration_are_visible(self):
        self.check_paths(False, [
            '.env.example', 'apps/web/.env.example', 'deploy/.env.example',
            '.env.sample', '.env.template', '.github/workflows/ci.yml',
            '.claude/settings.json', '.claude/agents/frontend-theme.md', '.claude/agents/odoo-reviewer.md',
            '.claude/scripts/guard-bash.sh', '.claude/scripts/session-start.sh',
            '.claude/skills/e2e/SKILL.md', '.claude/skills/e2e/references/cli.md',
            'apps/control-plane/src/schema_tenants.sql', 'tools/fixtures/example.json',
            'odoo-addons/webvue_hr/data/leave_types.xml',
            'odoo-addons/webvue_hr/security/ir.model.access.csv',
            'apps/web/app/pages/reports/index.vue', 'docs/reports/acceptance.md',
            'apps/web/public/logo.svg', 'apps/web/public/font.woff2',
            'apps/web/e2e/fixtures/example.json', 'package-lock.json', 'AGENTS.md',
        ])

    def check_paths(self, expected, paths):
        policy = (Path(__file__).resolve().parents[1] / '.gitignore').read_text()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(['git', 'init', '-q', directory], check=True)
            (root / '.gitignore').write_text(policy)
            for path in paths:
                with self.subTest(path=path):
                    result = subprocess.run(
                        ['git', '-c', 'core.excludesFile=/dev/null', 'check-ignore',
                         '--no-index', '-q', path], cwd=root, check=False,
                    )
                    self.assertIn(result.returncode, (0, 1))
                    self.assertEqual(result.returncode == 0, expected)


if __name__ == '__main__':
    unittest.main()
