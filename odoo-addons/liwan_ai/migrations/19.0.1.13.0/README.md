# 19.0.1.13.0

`liwan.ai.usage.kind` gains the value `route` (the call that classifies a new user message for the task router). The column is
a plain varchar, so no data or DDL changes: the ordinary `-u` load registers the new selection value, and existing rows keep
`plan` or `title`.
