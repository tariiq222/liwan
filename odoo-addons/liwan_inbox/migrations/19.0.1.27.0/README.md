# 19.0.1.27.0

New stored Boolean `external` on `liwan.inbox.message`: a message sent outside LiwanOS (a TikTok echo of the TikTok app,
a TikTok auto message or imported history) is not counted toward the monthly `inbox.messages_out` quota. Existing rows
read as false; no data needs carrying because the product has no released tenant, and an existing echo cannot be told
apart from a LiwanOS send without guessing.
