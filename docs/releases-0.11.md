# BranchDeck 0.11.0

- Recover Claude locally cached chat files with one click, including downloads, attachments, available chat content, images, and Cowork outputs.
- Browse recovery results by category, copy the save location, or open it in Finder. Each scan saves an independent local snapshot without changing Claude's originals.
- Discover existing temporary output directories referenced by Claude Code session records.
- Preview PDF, XLSX, CSV, images, Markdown, HTML, JSON, and text. HTML active content is disabled.
- Switch between English and Simplified Chinese in Settings.

The core workflow remains local AI projects → branch checkouts → workspace-specific commands and terminals. Cache recovery only includes content retained on this Mac, does not fetch cloud chats, and cannot guarantee complete conversation history. Fully quitting stops running terminals; sessions are not restored after restarting.

Privacy review covered current source, reachable Git history, commit authors, public images, and packaged application resources. No personal mailbox, developer home path, private key, or real chat cache was found in the reviewed release content. Public repository links and the owner-approved Developer ID certificate identity remain visible. Example email addresses use the reserved `.invalid` domain. This review cannot retract previously downloaded or cached copies.

Validation: production build, 87 automated tests, native category navigation, copy-path feedback, keyboard navigation, and signature verification. Notarization is verified separately for the published downloads.
