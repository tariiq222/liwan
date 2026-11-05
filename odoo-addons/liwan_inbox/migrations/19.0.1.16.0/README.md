No data change. A new model `liwan.inbox.tiktok.shortcut` stores a TikTok channel's suggested questions
and chat prompts (with the TikTok id and audit status of each), and the channel gains the nullable
`tiktok_questions_enabled`/`tiktok_prompts_enabled` switches, both false by default. No existing
channel had a TikTok item to carry forward.
