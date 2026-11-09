# 19.0.1.9.0

`liwan.ai.settings` gains `input_tokens_per_run`: the tenant's own ceiling on the input tokens of one assistant request
(issue #554), 0 meaning no cap of its own. It is a new column with a non-null default, so existing rows take
`DEFAULT_INPUT_TOKENS_PER_RUN` (100000) when the column is added; no data moves and no separate migration script is
needed. A tenant that wants no ceiling and no change for it sets 0 in its AI settings.
