# 19.0.1.14.0

`liwan.ai.usage.kind` gains the value `summary` (the call that rewrites the rolling summary of a long conversation). The column is
a plain varchar, so no data or DDL changes: the ordinary `-u` load registers the new selection value, and existing rows keep
`plan`, `title` or `route`.
