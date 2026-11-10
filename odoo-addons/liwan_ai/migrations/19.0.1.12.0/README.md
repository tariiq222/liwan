# 19.0.1.12.0

`liwan.ai.usage` gains `capability` (which kind of task a call served: quick, standard, analysis or writing), `cost` and
`charge` (integers in cost units of 0.00001 USD), each of the last two with a `*_reported` flag that tells null from 0.
`pre-usage_capability.py` fills `capability = 'standard'` on existing rows, because every earlier call ran on the one
configured model; `cost` and `charge` stay unreported on them (the new columns default to false and 0 in the ordinary `-u` load).
