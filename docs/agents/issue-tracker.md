# Planner-skill outputs: local only

Skills that plan work — spec, ticket breakdown, triage — keep their output **inside this
checkout**. Nothing they produce is published to GitHub Issues, sub-issues, labels or
comments. The repository is public and its issues are world-readable.

This file governs the *output of planner skills*. It does not change how the team tracks
accepted work: GitHub Issues remain the durable record for decisions, reviews and delivery.

## Where the files live

- One feature per directory: `.scratch/<feature-slug>/`
- Spec: `.scratch/<feature-slug>/spec.md`
- Tickets: `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, one file per
  ticket, blockers first — never one combined tickets file
- Blocking edges: a `Blocked by: NN, NN` line near the top; a ticket is unblocked when every
  file it lists is `resolved`
- State: a `Status:` line near the top (`open`, `claimed`, `blocked`, `resolved`)
- Comments and conversation history append at the bottom under a `## Comments` heading

`.scratch/` is git-ignored, so these files never reach a commit, a PR or GitHub.

## When a skill says "publish to the issue tracker"

Write the file under `.scratch/<feature-slug>/`, creating the directory if needed. Do not run
`gh issue create`, `gh issue edit`, `gh issue comment` or apply labels.

## When a skill says "fetch the relevant ticket"

Read the referenced file. The user normally passes the path or the ticket number directly.

## Promotion to the public tracker

An accepted decision may be summarized into the existing GitHub issue by the owner, in the
owner's words, with no secrets, customer data, credentials or exploit details — the public
tracker carries scope and outcome, not working notes. Promotion is an owner action and stays
separate from delivery authorization.

## Vocabulary

Local tickets use the `Status:` line above and need no labels. Public issues keep the
repository's existing vocabulary (`state:*`, `agent-fix`, `needs-decision`, `wontfix`);
planner skills do not create new labels.
