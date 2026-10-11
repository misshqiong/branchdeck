<p align="center">
  <img src="assets/icon.png" width="88" alt="BranchDeck icon" />
</p>

# BranchDeck

**Your projects, worktrees, and terminals. One workspace.**

[English](README.md) · [简体中文](README.zh-CN.md) · [使用指南](docs/usage.zh-CN.md)

BranchDeck is a macOS desktop app that brings your local development work into one place. It discovers projects and Git worktrees from Codex, Claude Code, and local folders, turns relevant shell history into project shortcuts, and keeps your terminals available as you move between projects.

## Why BranchDeck?

Working across several repositories or parallel AI coding sessions leaves a trail of checkout folders, terminal tabs, and commands to remember. BranchDeck gives each workspace a place to return to: its branch, useful commands, files, and running terminals together.

Open a worktree, start its dev server, run a test in another terminal, then switch to a second project. When you come back, the first project's terminals and output are still there while the app remains running.

## What it does

| Feature | What you get |
| --- | --- |
| **Find your workspaces** | Discover Codex and Claude Code projects, local repositories, and Git worktrees. Group related checkouts, see their branches, and search by project or source. |
| **Bring back useful commands** | Get shortcuts from matching shell history and project scripts. Keep the commands you use, reorder them, and dismiss suggestions you do not need. |
| **Keep terminal context** | Use interactive zsh terminals with your aliases, completion, history, and Ctrl+C. Switching workspaces preserves each terminal's process, working directory, input, and output. |
| **Run and manage dev services** | Give services dedicated tabs, check configured ports, and stop the processes launched by the app. Running a service again focuses its existing tab. |
| **Stay close to your files** | Browse folders, preview text files, and open a terminal in a subdirectory without leaving the workspace. |

### Built for multiple checkouts

BranchDeck reads local project metadata from **Codex** and **Claude Code**, and uses **Git worktree** information to connect related checkouts. It also finds projects in common development folders and supports manually adding a directory.

Discovery extracts directory metadata from project indexes and bounded Claude session records; it never infers paths from conversation text or modifies the coding tools' configuration or databases. The **Claude sessions** tab lets you explicitly open associated local transcripts, memory documents, and cached text files in a read-only, paginated viewer. Contents stay local and are not executed. Existing scratchpads and temporary output directories referenced by Claude tool records are also discovered as **Claude temporary folders**, ready to browse from the Files tab. BranchDeck manages the local workspaces and terminals around those tools; it does not run or coordinate their AI conversations.

### Shortcuts that fit the project

The first time you open a workspace, BranchDeck suggests a small set of useful commands from matching shell history and recognized project scripts. Later discoveries appear as suggestions you can accept or dismiss.

You can execute a shortcut, fill it into a terminal for editing, or customize its directory and environment. Ordinary commands reuse an idle shell when possible; busy terminals and unfinished input are preserved.

History matching uses explicit paths or unambiguous project configuration. It does not reconstruct a command's working directory from a preceding `cd`, and discovering a command never executes it.

## Get started

You need **macOS**, **Node.js 22.12+**, **npm**, **Git**, and **zsh**. Runtime checks also use `ps`, `lsof`, and `sqlite3`.

From a checkout of this repository:

```sh
npm ci
npm run dev
```

To build a local app:

```sh
npm run pack
open release/mac-arm64/BranchDeck.app
```

The path above is for Apple Silicon; Intel builds use `release/mac`. Packaging requires the Developer ID Application certificate and private key in the local keychain; select it using the `CSC_NAME` environment variable. Builds fail if the signing identity is unavailable.

Run `npm run dist` to create signed DMG and ZIP artifacts. Apple notarization requires separate credentials; without them, artifacts are signed but not notarized. See the [macOS signing and packaging guide (Chinese)](docs/macos-signing.md). The app supports English and Simplified Chinese; switch languages in Settings.

The separate store build uses `npm run pack:mas:dev` for sandbox testing and `npm run pack:mas` for a store installer. It supports user-selected locations and persistent access bookmarks. See the [Mac App Store build guide (Chinese)](docs/mac-app-store.md) for signing requirements and sandbox acceptance checks.

## A typical workflow

1. **Pick a workspace.** Search the discovered projects or add a folder. Related worktrees appear together.
2. **Choose a command.** Use a suggested dev, test, or build command, or add your own.
3. **Work in the terminal.** Type freely, create additional tabs, or open a terminal from a subdirectory.
4. **Switch projects and return.** Terminals keep running while you visit other workspaces or hide the window.

| Shortcut | Action |
| --- | --- |
| `⌘T` | New terminal |
| `⌘W` | Close the current terminal, with confirmation when busy or holding unfinished input |
| `⌘B` | Toggle the command and file panel |

Closing the window keeps the app in the menu bar. Fully quitting closes its terminals and managed services. Sessions are not restored after a restart, and commands are not replayed automatically.

## Local data and privacy

Workspace discovery and shell-history processing happen on your machine. BranchDeck does not upload that history. Claude session browsing and the optional chat-cache recovery read locally available content; recovered snapshots remain on your Mac. Saved commands, preferences, and service logs live in `~/Library/Application Support/BranchDeck/`.

The repository contains source code, icons, documentation, and tests with temporary fixtures. Personal workspace lists, shell history, logs, screenshots, environment files, and packaged builds are excluded from version control.

Saved environment variables are plain text, and log redaction is best effort. Commands run with your shell environment and can access files or the network according to what you execute.

## Development and scope

Built with Electron, React, TypeScript, xterm.js, and node-pty.

```sh
npm test
npm run build
```

Desktop smoke scripts in `scripts/` cover terminal interaction, command organization, workspace removal, history import, and lifecycle behavior using temporary fixtures. See the [detailed usage guide (Chinese)](docs/usage.zh-CN.md) for commands and configuration.

Current scope: local macOS workspaces and interactive zsh terminals. Windows, remote workspaces, bash/fish session tracking, and multi-service dependency orchestration are not supported. Up to 32 terminal tabs can stay open during an app session.

## License and contributions

Licensed under [MIT](LICENSE). Fork the repository to build your own version, or propose improvements through a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and contribution steps.

## New in 0.11

- One-click Claude local chat-cache recovery with categories for downloads, attachments, chat content, media, and Cowork files. Each scan creates a separate local snapshot and does not retrieve cloud history.
- Click a result category to browse its files; copy its save location or open it in Finder.
- Preview PDF, XLSX, CSV, images, Markdown, HTML, JSON, and text files. Active HTML content is disabled.
- English and Simplified Chinese interfaces.
