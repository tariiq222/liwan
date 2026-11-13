# deploy/odoo-mail/Dockerfile — build context: deploy/odoo-mail
# The send-only SMTP relay of the shared overlay (relay.py: standard library only, no package is installed). The base is
# the repository's pinned Debian bookworm Python image (the same digest the Odoo and ai-egress images build on), so no
# floating tag enters the build. Nothing needs root: it listens on an unprivileged port, keeps no queue and writes no file.
FROM python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
COPY relay.py /usr/local/lib/odoo-mail/relay.py
RUN chmod 0644 /usr/local/lib/odoo-mail/relay.py
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# The compose file runs it as the same numeric user with every capability dropped and a read-only root.
USER 10002:10002
EXPOSE 2525
ENTRYPOINT ["python3", "-I", "/usr/local/lib/odoo-mail/relay.py"]
