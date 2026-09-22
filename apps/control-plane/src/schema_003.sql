-- The CP2 journal treats request IDs as global identities. Refuse migration if
-- existing cross-scope duplicates need manual reconciliation.
CREATE UNIQUE INDEX operations_request_id_global ON operations(request_id);
