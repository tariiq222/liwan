# Guarded internal Odoo runtime

This profile was verified on macOS arm64, CPython3.12.13, Odoo 19 at the commit pinned in `deploy/odoo/ODOO_COMMIT`. It does not update the Docker/customer template.

Install the frozen requirements into a separate Python3.12 virtual environment, not over the upstream Odoo `.venv`. Do not reinstall upstream requirements afterward: they reintroduce older vulnerable pins and PyPDF2.

```sh
uv venv /absolute/new-env --python python3.12
uv pip install --python /absolute/new-env/bin/python -r deploy/security/requirements-python312-macos.txt
uv pip check --python /absolute/new-env/bin/python
```

Start Odoo in a fresh process through `odoo_secure.py`. Pass an absolute official Odoo source root and explicit WebVue addons/database/data-dir/ports. Example for an existing isolated scratch database:

```sh
/absolute/new-env/bin/python deploy/security/odoo_secure.py \
  --odoo-root /absolute/odoo-source \
  --addons-path=/absolute/odoo-source/addons,/absolute/webvue/odoo-addons \
  -d webvue_security_scratch_example --data-dir=/absolute/isolated-data \
  --http-interface=127.0.0.1 --http-port=8966 --max-cron-threads=0
```

The launcher preserves pypdf's bounded decompressor after Odoo's import-time patch, rejects PyPDF2 precedence and retains the root during Odoo restart/gevent spawning. Do not pre-import Odoo before invoking the launcher. It does not claim that all Odoo/PDF paths are resource-bounded or that the entire application is vulnerability-free.

Tests require an installed official Odoo checkout and this environment:

```sh
WEBVUE_ODOO_ROOT=/absolute/odoo-source /absolute/new-env/bin/python \
  -m unittest discover -s deploy/security -p 'test_odoo_secure.py' -v
```

Never run tests on `odoo19`. The frozen environment excludes the legacy PyPDF2 distribution so Odoo selects its native modern-pypdf adapter.

No automatic boot service or recurring updater is installed by this change.
