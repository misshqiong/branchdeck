# Product Hunt launch preparation

Status: preparation only; no launch scheduled or submitted.

## Listing copy

Name: BranchDeck

Tagline: Keep your worktrees, commands, and terminals in context

Description:

Juggling Codex, Claude Code, and several Git worktrees? BranchDeck keeps each local checkout, useful commands, and running terminals together on macOS. Find the right workspace, test a feature, and return to your dev server while the app stays running. Discovery happens locally; no BranchDeck account required.

Maker comment draft:

I built BranchDeck because working across several repositories and worktrees left me constantly finding the right folder, terminal, and command again. It brings those pieces together: pick a workspace, run a useful command, and come back to your running terminal later. It works alongside coding tools such as Codex and Claude Code. I would love to hear which part of switching between projects still slows you down.

## Required before submission

- Choose a neutral public domain, point DNS, and enable HTTPS.
- Verify anonymous download access and SHA-256 checksums from outside the server.
- Publish a support contact that does not expose a personal account.
- Decide launch date and accurate pricing label; do not infer a pricing commitment.
- Complete and verify the English UI, then package and notarize a matching release. The existing 0.10.1 installer is Chinese; the website discloses this.
- Capture actual app screenshots using only fictional repositories and paths. The website illustration is explicitly labeled as an illustration, not a screenshot.
- Prepare a square thumbnail and a few gallery images showing project discovery, shortcuts, and running terminals.
- Recheck names, paths, emails, terminal prompts, browser chrome, and image metadata before upload.
- Review the listing and maker comment before posting. Do not promise session recovery after quitting or AI conversation orchestration.

## Deployment

The self-contained static site is in `website/`. Serve it from an independent directory with a separate Nginx server block; do not replace another product's configuration. The template in `deploy/branchdeck.nginx.template` contains no server credentials or personal hostnames. Provision TLS after the domain is selected.

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
| Download transparency | 19/20 | Version, architecture, Chinese UI, signed distribution, checksums, setup and session limits are disclosed. Public domain and support contact remain launch prerequisites. |
| Readability and interaction | 19/20 | Desktop and narrow-screen layouts checked, walkthrough click and keyboard paths verified, semantic headings and live status added. No independent accessibility audit. |

The page intentionally makes no adoption, time-saved, pricing, or testimonial claims. The interactive example executes no commands. Public website text contains only fictional project names and neutral paths.
