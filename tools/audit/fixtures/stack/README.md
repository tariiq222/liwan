A stack fixture exists only to prove that the framework can detect Docker availability and validate
a Compose file without starting a service unless `--stack` is passed. The framework never runs it
against production Compose files, never publishes a port on a non-loopback interface and never
writes a volume.
