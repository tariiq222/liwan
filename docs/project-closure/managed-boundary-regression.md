# Managed boundary regression evidence

The adapter-boundary and real-worker subprocess tests exercise the actual managed
runtime without connecting to Docker, a network service, or a database. Their
fixtures are bound to the checked-in platform catalog bytes and the catalog's
real `core` composition (`nasq_core`, `nasq_platform`, `nasq_api`, with
`users.limit` and `storage.limit_mb` both unbounded/null).

A private, isolated fake `docker` executable answers only the runtime's initial
`docker context inspect` request with a local Unix-socket context pointing to a
socket path that does not exist. The runtime refuses with
`docker_context_unavailable` before it can invoke Docker; the fixture records
and asserts that this context-inspection request was the only executable call.
No real Docker daemon, network endpoint, or database is contacted.

The tests retain the existing guarantees for descriptor fingerprint and request
digest binding, exact original policy bytes and receipt reuse, read-only status
inspection, and worker quarantine of an unverified create receipt. They also
assert the current real-adapter refusal semantics: a valid catalog/policy input
reaches `preflight`, returns a conflict receipt with `docker_context_unavailable`,
and the worker records one failed preflight without activating the tenant or
marking it for intervention. Worker classification preserves the registered
tenant state only for the explicit unchanged pre-effect conflict codes
`preflight_unavailable`, `docker_context_unavailable`, and
`docker_context_not_local`; this does not suppress other failures or change the
quarantine behavior for unverified receipts. The suite does not claim a
deployment was attempted or that `deployment_incomplete` was observed.
