---
name: workspace-and-trust
description: Open a project in Substrate and decide whether to trust it. Covers prerequisites, first start and Home, File > Open Folder, the trust banner, what trust unlocks, and revoking trust in Preferences.
---

# workspace-and-trust

## Purpose

Get a folder open in Substrate and set its trust correctly, so sessions, language servers and graphs can run where they should and nowhere else.

## Before the first start

- Substrate needs `git` and Claude Code (`claude`) on the computer. Language servers are optional. Substrate finds these the way a terminal would (the app's PATH, the usual install folders such as `~/.local/bin` and `~/.claude/local`, then the login shell's PATH) and never bundles or installs them. To force one `claude` program, give its path under Preferences > Agents > Agent programs, or set `FORMSUBSTRATE_CLAUDE_BIN` to its full path before starting Substrate. Codex, Cursor and Antigravity are optional and found the same way.
- Only one Substrate runs at a time; opening it again brings the running window forward.
- From a source checkout: `./formsubstrate_oc_install`, then `./formsubstrate` (Windows: the `.bat` files). `./formsubstrate doctor` reports what is missing.

## First start and Home

- A Welcome dialog opens once when no folder is open. It is a readiness check: engine, `git`, `claude`, a saved API key, an open folder. Reopen it with Help > Welcome.
- Home is the start page (click the Substrate name at top left, or View > Home). It offers Open a folder, open a file, File > Clone Repo..., File > New Form App, quick actions (New Claude session, Claude terminal, Review changes, Start formslot, Language servers), recent workspaces, sessions grouped as Needs input, Working and Done, and the formslot card.

## Open a folder

1. File > Open Folder... (`Ctrl+O`, `Cmd+O` on macOS), a recent workspace on Home, or drop a folder on the window.
2. For agent sessions the folder must be a git repository with at least one commit.

## Trust

Some projects carry their own programs: a language server, a Python environment, plugins, or tool nodes in a graph. Substrate runs none of them until the workspace is trusted.

- When the folder has such tools, a banner asks "Trust [folder name]?", lists them, and offers Trust this workspace or Not now.
- File > Trust This Workspace trusts the open folder at any time.
- Preferences > Workspace > Trusted workspaces lists trusted folders, each with Revoke.

Trust lets Substrate:

- start language servers and debug adapters that live inside the project, and any custom language server added under Preferences > Language Servers > Custom servers;
- read the project's debug launch file (`.formsubstrate/launch.json`, or `.vscode/launch.json` when that file does not exist);
- list and run the project's tasks: Run > Run Task..., Run > Run Build Task (`Shift+Ctrl+B`), Run > Stop Task and Run > Configure Tasks. Tasks come from `.formsubstrate/tasks.json` (or `.vscode/tasks.json` when that file does not exist) and from the scripts in the `package.json` at the top of the workspace. Without trust the list says the workspace must be trusted, and revoking trust stops running tasks;
- run Studio graphs through Claude, and graphs that contain tool nodes (the simulator without tool nodes needs no trust);
- let Cogentics channels run agent turns;
- let triggers start recipes;
- load plugins from the project's `.formsubstrate/plugins` folder (bundled plugins load without trust).

Without trust you can still edit, search, review and commit. Advise trust only for a project whose programs the person would run themselves; a cloned stranger's repository can stay untrusted and still be reviewed.

## Gate

The person can name the folder that is open, whether it is a git repository with a commit, and whether it is trusted, and knows where to revoke.

## Owned resources

None. Shortcuts, the data folder and startup failures are in `references/places-and-fixes.md` at the pack root.
