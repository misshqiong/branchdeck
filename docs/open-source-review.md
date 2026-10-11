# Public source review — 2026-10-11

Reviewed the repository before making it public:

- All 11 reachable commits at the review baseline, branch and tag metadata, historical paths, and 138 unique file versions were scanned.
- Remote references contained `main` and `v0.10.1`. The retired `v0.10.0` tag was local only and is not being republished.
- Commit and tag authors use the project identity and a non-personal placeholder email.
- No known personal names, personal home-directory paths, Apple team identifiers, private keys, or common access-token formats were found in reachable file history.
- IP literals were loopback addresses used by development and tests.
- Email matches were the owner-approved public support contact and explicit test placeholders.
- Image metadata contained dimensions only; published screenshots use isolated fictional projects and neutral temporary paths.
- Local application data, signing credentials, environment files, deployment records and binaries remain excluded by `.gitignore`.

The reachable history already reflects the earlier privacy cleanup; no further history rewrite was necessary. This review is not a guarantee that hosting-provider caches, previously deleted objects or downloaded copies have disappeared. The GitHub account name in the repository URL and the approved support contact are intentionally public. Distributed Developer ID signatures identify their signer independently of the source repository.

The source is licensed under MIT, attributed to BranchDeck Contributors. Third-party dependencies retain their own licenses. Contributions use forks and pull requests; publishing source does not give visitors write access to the upstream repository.
