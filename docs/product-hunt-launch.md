# Product Hunt launch preparation

Status (2026-10-11): website live at https://branchdeck.rabbitmoon.app with HTTPS and public downloads. Product Hunt confirmed "Successfully Scheduled" for October 11, 2026, 00:01 PT / 15:01 Asia/Shanghai. The launch is scheduled, not yet live.

Product page: https://www.producthunt.com/products/branchdeck?launch=branchdeck

Pricing: Free. Public feedback: https://github.com/misshqiong/branchdeck/issues.

Upload bundle: `launch/product-hunt/` contains the product icon, three actual app screenshots, and the submitted listing fields. The current gallery uses isolated fictional projects and neutral paths. The download remains the reviewed, signed and notarized Chinese-interface 0.10.1 build; local English UI changes are not included.

## Listing copy

Name: BranchDeck

Tagline: Keep your worktrees, commands, and terminals in context

Description:

Juggling Codex, Claude Code, and several Git worktrees? BranchDeck keeps each local checkout, useful commands, and running terminals together on macOS. Find the right workspace, test a feature, and return to your dev server while the app stays running. Discovery happens locally; no BranchDeck account required.

Maker comment draft:

I built BranchDeck because working across several repositories and worktrees left me constantly finding the right folder, terminal, and command again. It brings those pieces together: pick a workspace, run a useful command, and come back to your running terminal later. It works alongside coding tools such as Codex and Claude Code. I would love to hear which part of switching between projects still slows you down.

## Launch checks and follow-up

- DNS and HTTPS are configured; certificate renewal includes an Nginx reload hook.
- Homepage, walkthrough interaction, GitHub Issues feedback link, installer response and checksum file were verified through the public domain. Origin installer hashes match the reviewed artifacts.
- Product Hunt required fields were 100% complete before scheduling; Developer Tools and Productivity tags and Free pricing were selected.
- Names, paths and image metadata in the upload bundle were reviewed. Examples use fictional repositories.
- Future improvement: finish and verify the English UI, then build and notarize a matching release. Do not describe the current installer as English.
- Future improvement: add real app screenshots or a demo video using fictional data.
- Do not promise session recovery after quitting or AI conversation orchestration.

## Deployment

The self-contained static site is in `website/`. Serve it from an independent directory with a separate Nginx server block; do not replace another product's configuration. The template in `deploy/branchdeck.nginx.template` contains no server credentials or personal hostnames. The production domain uses its own TLS certificate. Cloudflare proxies requests; the privacy page discloses that service.

Place only the reviewed DMG, ZIP, and checksum file under `downloads/`. Never copy the repository, build logs, key files, local configuration, or retracted releases into the public directory. Keep website copy and download links aligned with the exact installer version.

## References

- https://www.producthunt.com/launch/preparing-for-launch
- https://help.producthunt.com/en/articles/484932-can-i-submit-an-unreleased-product

## Landing page review

Editorial self-assessment: **95/100 for the introduction page**, not a product-readiness score or a prediction of launch results.

| Criterion | Score | Evidence and remaining gap |
| --- | --- | --- |
| Positioning | 20/20 | First screen names the worktree workflow, audience, platform, and concrete benefit. |
| Differentiation | 19/20 | Explains checkout discovery, project shortcuts, and terminal continuity; value still needs validation with actual users. |
| Demonstration | 18/20 | Interactive three-step project switch, explicitly labeled as an illustration; actual app footage would provide stronger evidence. |
| Download transparency | 19/20 | Version, architecture, Chinese UI, signed distribution, checksums, setup and session limits are disclosed. Public HTTPS domain and owner-approved GitHub Issues feedback link are configured. |
| Readability and interaction | 19/20 | Desktop and narrow-screen layouts checked, walkthrough click and keyboard paths verified, semantic headings and live status added. No independent accessibility audit. |

The page intentionally makes no adoption, time-saved, or testimonial claims. The interactive example executes no commands. Public website text contains only fictional project names and neutral paths.

## Website positioning update — 2026-10-11

The website now leads with unified local Codex / Claude Code project directories, repository groups, branch checkouts and workspace-specific shortcut commands. Terminal continuity is a supporting benefit. Commands are described as directory-bound rather than automatically following Git branch names.

`website/assets/branches-and-commands.jpg` is a real screenshot of the packaged 0.10.1 application running with isolated fictional projects (`orbit-web`, `atlas-api`) and neutral temporary paths. The application code was unchanged; a separate local bundle identity isolated the capture instance. The selected feature/search checkout ran its real npm test shortcut successfully. The public installer was not modified.

Product Hunt tagline, description, gallery and maker comment were synchronized to this positioning on 2026-10-11. The gallery now uses three actual app screenshots: project/branch groups, workspace command configuration, and feature-branch test output. See `launch/product-hunt/listing.json` for the submitted text.

## 0.11.0 update

Release material now includes English and Simplified Chinese, one-click Claude local-cache recovery, category browsing, and document previews. The added gallery screenshot uses isolated fictional cache data; it does not show real chats, account details, or user paths. The original three workflow screenshots remain representative of the project/branch/command workflow. See `releases-0.11.md` for the release review.
