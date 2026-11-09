# 19.0.1.10.0

`liwan.ai.usage` gains `call_id` (the provider's own id of the attempt) and a unique index on
`(user_id, conversation_id, call_id)`, so a usage batch Odoo accepted before a timeout is not counted twice when the spool
re-sends it (issue #557).

Development databases hold no live usage rows before release. The pre-migration clears what the old shape recorded, because
a row without the provider's call id cannot be told apart from a re-sent one; the column and the unique index are then
created by the ordinary `-u` load. Nothing else moves.
