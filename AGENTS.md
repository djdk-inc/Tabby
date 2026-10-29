# Tabby project instructions

- Every new distributable extension build must increment the semantic version before packaging.
- Use a patch increment for fixes and packaging corrections, a minor increment for backward-compatible features, and a major increment for breaking changes.
- Keep the version identical in `extension/manifest.json`, `package.json`, `package-lock.json`, the test report, install instructions, ZIP filenames, and Git tag.
- Never overwrite an existing versioned ZIP with different contents. Produce a new versioned artifact instead.
- Extract and load-test the exact install ZIP before publishing it.
- Push the release commit and matching `vMAJOR.MINOR.PATCH` Git tag to GitHub.
- Documentation-only or test-only commits that do not produce a distributable build do not require a version increment.
