# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Streams a finished export directory as one zip, entry by entry, without building the zip on disk or in memory."""
import time
import zipfile
from pathlib import Path

CHUNK = 1 << 20
FILE_MODE = 0o644
# Already compressed (a spreadsheet is a zip) or incompressible content is stored, so the stream spends no CPU on it.
STORED_SUFFIXES = frozenset({'.xlsx', '.zip', '.png', '.jpg', '.jpeg', '.pdf', '.docx'})


class _Sink:
    """The write side of an unseekable stream: it keeps what the zip writer produced until the generator takes it."""

    def __init__(self):
        self.chunks = []
        self.position = 0

    def write(self, data):
        self.chunks.append(bytes(data))
        self.position += len(data)
        return len(data)

    def tell(self):
        return self.position

    def flush(self):
        """Nothing to flush: the generator drains the sink."""

    def drain(self):
        data = b''.join(self.chunks)
        self.chunks = []
        return data


def entry_info(root, path):
    """The zip entry of a file of the tree: its relative path, its time and a normal file mode."""
    info = zipfile.ZipInfo(path.relative_to(root).as_posix(), date_time=time.localtime(max(path.stat().st_mtime, 315532800))[:6])
    info.compress_type = zipfile.ZIP_STORED if path.suffix.lower() in STORED_SUFFIXES else zipfile.ZIP_DEFLATED
    info.external_attr = FILE_MODE << 16
    return info


def iter_zip(root):
    """Yield the bytes of a zip of every file under ``root`` (a ``.part`` temporary is never part of it)."""
    root = Path(root)
    sink = _Sink()
    with zipfile.ZipFile(sink, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        for path in sorted(root.rglob('*')):
            if not path.is_file() or path.suffix == '.part':
                continue
            with path.open('rb') as source, archive.open(entry_info(root, path), 'w', force_zip64=True) as target:
                while chunk := source.read(CHUNK):
                    target.write(chunk)
                    if data := sink.drain():
                        yield data
    if data := sink.drain():
        yield data
