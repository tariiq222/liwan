# Migration 19.0.1.5.0

No data changes. The channel's WhatsApp account id and token moved to the channel's connection in `liwan_inbox`
19.0.1.23.0 (`pre-move-accounts-to-connections.py`), which drops the columns this bridge matched on and declared
a group list for. The bridge no longer redeclares `access_token_enc`; the catalog keeps its own `business_account_id`
and is matched to its channels through `connection_id.external_id`.
