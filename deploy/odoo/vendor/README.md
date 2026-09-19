# Vendored wkhtmltox packages

These packages are the official `wkhtmltox 0.12.6.1-3` Bookworm release
assets from the upstream packaging project:

<https://github.com/wkhtmltopdf/packaging/releases/tag/0.12.6.1-3>

The repository keeps one package for each supported Docker architecture:

- `wkhtmltox_0.12.6.1-3.bookworm_amd64.deb`
- `wkhtmltox_0.12.6.1-3.bookworm_arm64.deb`

`SHA256SUMS` contains checksums calculated from those downloaded official
release assets, using the standard two-space filename format. They are
build-integrity checks for the files stored here; the manifest does not claim
to be a publisher-signed checksum file.

The Dockerfile selects the package through BuildKit's `TARGETARCH`, verifies
the matching checksum with `sha256sum -c --ignore-missing`, and installs it
without downloading the renderer binary during the build. Debian dependencies
are still installed through apt.

The base layer still contains the Debian package bytes. The final runtime
filesystem removes that package before installing this replacement; retaining
the earlier layer preserves the already-validated source and dependency build
cache at the cost of additional image size.
