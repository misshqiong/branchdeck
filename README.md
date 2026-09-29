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

Discovery reads project metadata, not conversation bodies, and does not modify the coding tools' configuration or databases. BranchDeck manages the local workspaces and terminals around those tools; it does not run or coordinate their AI conversations.

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

The path above is for Apple Silicon; Intel builds use `release/mac`. Local builds are unsigned and not notarized. The app interface is currently in Chinese; this README provides an English introduction.

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

Workspace discovery and shell-history processing happen on your machine. BranchDeck does not upload that history or read coding conversation bodies. Saved commands, preferences, and service logs live in `~/Library/Application Support/BranchDeck/`.

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
