---
name: liwan-audit-setup
description: Health-check the LiwanOS engineering audit framework before trusting any audit result — verifies the framework files, every pinned scanner, the scratch-database boundary, and the report directory, and names what is missing without running a scan. Use when asked whether the audit setup is ready, after installing or upgrading a scanner, when a run reports Not Verified, before the first audit of a session, or when audit tooling seems broken.
---

# liwan-audit-setup: is the audit framework ready?

Answers one question with evidence: **can this checkout produce a trustworthy audit result right now?**
It runs no scan, starts no database and writes nothing outside `.audit/`. It never reports a tool as
ready because it is on `PATH`; a tool is ready only when it answered a version probe.

## Run it

```sh
python3 -B tools/audit/audit.py setup           # human summary
python3 -B tools/audit/audit.py setup --json    # machine-readable, for a report
```

Discovery facts are written to `.audit/setup.json` (git-ignored). The command reports: repository,
branch, head, dirty paths, addon and workspace counts, CI stages, installed skills/agents/plugins,
and every tool with its path and version.

## What each result means

| Section | Ready when | If not |
| --- | --- | --- |
| `tools` | `available: true` **and** a non-empty `version` | the tool is missing or broken; a stage using it is Not Verified, never failed |
| `git` | `branch`, `head` present, `dirty` listed | audit runs still work; record the dirty paths in the report, never commit them |
| `addons` | every `odoo-addons/*/__manifest__.py` parsed | an unreadable manifest hides an addon from every later check |
| `ci_stages` | non-empty, 13 stages | the workflow reader or `tools/ci_scope.py` changed |
| `skills` / `agents` | the `liwan-audit-*` entries appear | the skill is not discoverable; fix the path before relying on it |
| `databases` | lists `liwan_scratch_*` names only | never audit `liwan_dev` or `odoo19` |

## Hard rules

- **Never** run a scan in this skill. Setup answers availability, not findings.
- **Never** touch `liwan_dev`, `odoo19`, port `:3000` or `:8069`. The only audit databases are
  `liwan_scratch_*`; the only active targets are loopback and never those ports.
- A missing scanner is recorded, not installed. Installing a tool, a plugin or a service is the
  owner's decision; report the exact command instead of running it.
- The framework is optional tooling: a broken scanner must never block a product task. Say which
  axes lose evidence, then continue.

## Reporting back

State in this order: ready tools with versions, missing tools with the stage each one blocks, the
scratch-database boundary in force, and the exact next command. Keep it to a short table; do not
paste raw discovery JSON.

If a tool answers `--version` but fails when it actually scans, that is not a setup pass — run the
owning profile (`liwan-audit-security`, `liwan-audit-regression`, `liwan-audit-performance`) and
report the runtime failure with its log path under `.audit/logs/`.
