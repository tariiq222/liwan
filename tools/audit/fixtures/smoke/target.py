"""Small, dependency-free module the framework smoke test inspects.

It deliberately contains one clear long line so a line-length probe has something deterministic to
find, and it exposes two functions so the AST inventory can prove it parsed the file.
"""


def add(left: int, right: int) -> int:
    """Return the sum of two integers."""
    return left + right


def banner(name: str) -> str:
    """Return a fixed-width banner; the literal is long enough to exercise a length probe without a bug."""
    return '=' * 20 + f' {name} ' + '=' * 20 + ' end-of-banner-marker-that-makes-this-line-more-than-one-hundred-characters-long'
