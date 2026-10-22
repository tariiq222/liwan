"""Shared boundary for privileged default-branch controllers."""
import os


def require_main():
    if os.environ.get('GITHUB_REF') != 'refs/heads/main':
        message = 'Privileged automation runs only from trusted main'
        raise RuntimeError(message)
