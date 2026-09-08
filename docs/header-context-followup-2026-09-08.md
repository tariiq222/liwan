# Header context follow-up — 2026-09-08

Fresh screenshots after the main restart showed residual duplication on Chat, meeting creation and employee detail: the breadcrumb repeated the page title or a section already represented by the contextual sidebar. This clarifies and supersedes the earlier decision to append the current title on deeper routes.

The shared breadcrumb now omits the current-page entry and filters ancestor links already represented by the same resolved permitted contextual destination. Query strings and hashes are compared through the router, so a different filtered destination retains its useful link. The shared return-target registry remains available to suppress an identical header back when contextual navigation already supplies it. Different record/history returns survive. No sidebar/chat layout, data, actions, backend or route serialization was changed.

Base is canonical main `d6a71ad4576562b8d5c86d8a01f931a42e35119d`, including the recent chat conversation sidebar. Implementation is isolated in `codex/header-context-final`. DESIGN.md and component/agent guidance now document the clarified behavior. Previous navigation regressions remain; focused display-policy regressions cover exact destinations, filters/hash, missing context and current-page entries.

Verification uses an isolated synthetic API at port4500 and Nuxt at3500 (`nasq_header_context_final_mock`). No tests access Odoo or `odoo19`. Browser cases cover the three supplied screens, module roots, distinct record returns, search/notifications and filtered meeting/HR/settings returns, at390/768/1440. Final outcomes are recorded below.

Final verification:

- Built-server browser sweep: 42/42 passed across390/768/1440, including all three screenshot cases; one H1, absent repeated rows, preserved filtered/different return destinations, no page errors or horizontal document overflow.
- Vue/TypeScript check and Nuxt build passed.
- Web suite:578 passed, one pre-existing `meetingNavigation.test.ts` harness failure (`refDebounced is not defined`), previously reproduced on canonical main. No new failure was introduced. The meeting test was preserved.
- Focused shell/navigation/header tests:37 passed. Coordinator reviewed the actual helper/template diff and independently ran broader checks. A separate review-agent follow-up was unavailable due to the agent thread limit; no independent reviewer acceptance is claimed for this follow-up.
- Earlier dev sweep had one dynamic-import error during live source updates; the complete42-case sweep was rerun successfully against the finished build.

Artifacts are stored under `/Users/tariq/.codex/visualizations/2026/09/08/01a0801f-047b-7b43-9c28-c81f9c6b352a/header-context-followup/`. This is isolated local UI verification, not a production deployment claim.
