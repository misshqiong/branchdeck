# Contributing to BranchDeck

Fork this repository, create a branch in your fork, and open a pull request against `main`. You can also modify and run your fork independently under the [MIT license](LICENSE). Maintainers review and merge contributions; public access does not grant direct push access.

## Run locally

Use macOS, Node.js 22.12 or newer, npm, Git, and zsh:

```sh
npm ci
npm run dev
```

Development does not require an Apple signing certificate. For a source build and automated checks:

```sh
npm run build
npm test
```

Official macOS distribution uses Developer ID signing and notarization. Contributors do not need the maintainer's signing credentials; never request or share them. See [packaging documentation](docs/macos-signing.md) if you distribute your own builds with your own identity.

## Propose a change

- Describe the problem, the resulting behavior, and how you verified it.
- Keep unrelated changes out of the pull request.
- Use fictional projects and temporary directories in tests and screenshots.
- Exclude private project data, personal filesystem paths, shell history, logs, environment files, tokens, signing keys, and provisioning profiles.
- Review your Git author name and email before publishing commits. You can use a GitHub-provided no-reply email.

By submitting a contribution, you agree that it is provided under this repository's MIT license. Third-party dependencies retain their own licenses.
