# Changelog

Versions follow `v*.*.*` with dots. Dates are US Eastern. The newest version is first.

The app was renamed Substrate (family name FormSubstrate, machine name `formsubstrate`) at 0.17.0. The entries below read with the new name throughout; the git history keeps the former one.

## 0.25.1 · 2026-11-22

Documents brought up to date; one small fix.

- `SECURITY.md`: how to report a security problem privately, and how Substrate protects your computer (local only, the window key, session and client tokens, workspace trust, where secrets are kept).
- The README says plainly what Substrate is today and what it does not have.
- The user guide, the release notes for maintainers and the parity table were checked against the app and corrected.
- The web search plugin now sends the app's real version in its user agent; it said 0.17.

## 0.25.0 · 2026-11-22

Tasks, your own shortcuts, the family's four agent programs, and FormNET.

- Tasks: Run > Run Task... lists the tasks of `.formsubstrate/tasks.json` (or `.vscode/tasks.json` when there is none) and the scripts of `package.json`. Run Build Task is `Shift+Ctrl+B` (`Shift+Cmd+B` on a Mac), Stop Task ends a task, and Configure Tasks writes a starter file. A task runs in a terminal, only in a workspace you have trusted, and its errors appear in Problems.
- Shortcuts can be changed: Preferences > Keys has Change, Remove, Reset and Reset All, warns when a key belongs to another command, and keeps your changes after a restart.
- Sessions for Codex, Cursor and Antigravity beside Claude Code: New Session offers the programs found on this computer, each in its own worktree. Codex gets the session's MCP servers; Cursor and Antigravity are started plainly. Gate cards need Claude Code. Preferences > Agents shows what was found and takes a path for each program.
- Route through FormNET (Preferences > Terminal, off by default): new terminals and sessions use FormNET's proxy on this computer and trust its certificate, so FormNET can show what they send. If FormNET is not running, terminals start without it.
- Claude Code in the editor (Preferences > Agents, off by default): Claude Code in a Substrate terminal can read Problems, the open files and your selection, and show a change for you to accept or reject. It follows the connection Claude Code documents for VS Code and has not been tried with every version of Claude Code.
- Removing a workspace's trust stops its running tasks.

## 0.24.0 · 2026-11-22

More languages, quick fixes, and a debugger with the features people expect.

- Custom language servers: Preferences > Language Servers > Custom servers takes a program, its arguments and file extensions, with one-click presets for Rust (rust-analyzer), JSON, HTML, CSS and YAML. Substrate shows the install line and never installs a server. A custom server runs only in a workspace you have trusted.
- Quick fixes: a light bulb marks a line with fixes; `Ctrl+.` (`Cmd+.` on a Mac), the editor's new right-click menu and a problem's tooltip list them. Organize Imports is `Alt+Shift+O`. A fix is one undo.
- Debugger: conditional breakpoints, hit counts and logpoints from a right-click in the breakpoint gutter; a Watch list; a launch file (`.formsubstrate/launch.json`, or `.vscode/launch.json` when there is none) with a configuration picker. Breakpoints and watches are remembered per workspace.
- Node.js debugging through Microsoft's js-debug. Substrate does not download it; set its folder in Preferences > Language Servers > Run and Debug.
- Workspace trust for language servers, the debugger and triggers is now kept by the engine, so another program on your computer cannot start a workspace's server or debugger by claiming the workspace is trusted.
- The Format Document shortcut (`Alt+Shift+F`) now works.

## 0.23.0 · 2026-11-22

Routine git work without leaving Substrate.

- Branches: the branch button in Source Control and the branch in the status bar open a menu to create a branch from any start point, switch to a local or remote branch, and delete one. A switch that would overwrite your changes is refused and offers to stash first.
- Fetch and Pull. Pull fast-forwards; when your branch and its upstream have both moved it says so and changes nothing unless you choose Pull with a Merge Commit. A merge that conflicts is undone.
- Stashes: stash changes with or without untracked files, then apply, pop or drop from the Stashes list.
- Tags: create a lightweight or annotated tag and push it.
- Merge conflicts: a conflicted file opens with Accept Current Change, Accept Incoming Change and Accept Both Changes above each conflict. Source Control lists conflicted files under Merge Changes with Accept All Current, Accept All Incoming and Mark Resolved, and Commit finishes the merge.
- File History: from a tab, the Files panel, a Source Control row or the palette, see a file's commits across renames and open the diff of any of them.
- An agent session's worktree stays on its own branch; switch and pull are for your workspace.

## 0.22.0 · 2026-11-22

The everyday editing a code editor is expected to have.

- Go to File: Ctrl+P (Cmd+P on a Mac) finds a workspace file by part of its name. Recent files come first, `name:120` opens at line 120, and `>` switches to commands.
- Replace across files: type a replacement in Search and choose Replace all. Each file is listed with a checkbox and a diff before anything is written; files with unsaved changes in a tab are left out, and open tabs without changes show the new text at once. A file that changed after the preview is refused.
- Regular expression search works without ripgrep installed, in the window and for agents through the MCP search tool. A pattern that would run for ever stops after a few seconds.
- Code folding, auto save (off until you turn it on; it never saves over a file changed on disk) and format on save (through the language server; the file is saved anyway if formatting does not answer).
- Alt+click (Option+click) adds a cursor, Alt+Shift+drag selects a column, and brackets are coloured by depth. All four are in Preferences > Editor.
- About 80 short labels, such as status words in Git, formslot and Cogentics, showed in English in every language; they are now translated.
- A slow language server no longer leaves an error behind while it starts.

## 0.21.0 · 2026-11-22

Substrate's MCP server works from the installed app and for outside clients you approve, and agents can read more of what the window shows.

- Preferences > Agents > MCP clients: add Claude Code, Codex or Cursor running outside Substrate. The token is shown once with a ready config snippet; Substrate keeps only a hash of it. A client can read the open workspace, the session list and session status, graph runs, FormSlot slots and language-server problems; it cannot write, comment, read terminals or answer gates. Remove a client and its token stops at once.
- The installed app's engine takes `--mcp`, so outside clients need no source checkout, and agent sessions of the installed app now get Substrate's own MCP server too.
- Five new read-only tools: `run_list` and `run_status` for graph runs, `gate_notes`, `formslot_slot` for the slots a file belongs to, and `problems` for what language servers report. 14 tools in all, 13 read-only.
- The server follows MCP 2025-11-25 and 2025-06-18. A request naming a protocol version it does not follow gets a clear 400 instead of being served.
- `./formsubstrate agents sync` writes the tool reference agents read, and the check workflow fails when it is out of date.
- A second skill pack, `formsubstrate-use`, helps people and agents use Substrate: sessions, review, gate cards, MCP clients and graph runs.
- The two preset skills say when an agent should use them.

## 0.20.0 · 2026-11-22

Substrate wears the suite's look and speaks the family's 30 languages.

- Studio Dark, the suite's theme, is the default for new installs, and Substrate's accent is purple (`#a077e0`) everywhere. If you were on Substrata without choosing it, you stay on Substrata; a theme you chose is kept. An accent that Substrate had set for you (the old orange or violet) becomes the new purple; one you chose is kept.
- A new AMOLED theme with a pure black background.
- With Auto on, the window opens in the system's light or dark choice from the first frame. With no dark theme chosen, dark is Studio Dark.
- The splash is dark with a purple bar. If the window cannot be built, or the engine does not answer within 90 seconds, a dialog says so instead of leaving the splash up or the app running with no window. A light theme no longer shows a dark frame behind the page as the window appears.
- Side panel heads and lists follow the suite's style: a strip with the panel name as a chip, and rounded rows where the chosen one glows.
- The recipe list in Triggers, the visit list in the Inspector and the model list in Cogentics change in place without flicker.
- Welcome's Preferences button opens Preferences at the API key.
- Every interface language the family ships: English, Spanish (Spain and Mexico), Portuguese (Brazil), French (France and Canada), German, Italian, Dutch, Danish, Finnish, Norwegian, Swedish, Russian, Polish, Czech, Hungarian, Ukrainian, Turkish, Greek, Serbian (Latin), Chinese (Simplified and Traditional), Japanese, Korean, Indonesian, Thai, Vietnamese, Arabic (right to left) and Hindi. Choose one in Preferences > General > Language; the window opens in it from the first frame.
- The skill source chip in Sessions reads workspace or personal.

## 0.19.0 · 2026-11-22

Owner-only changes need the window's key, keys are handled without waking the keychain, and Substrate says what it sends over the network.

- Starting, resuming, stopping and removing a session, every git change (stage, unstage, discard, commit, push, Sign and Push, rewind, snapshots, identity, review comments) and every workspace change (open folder, forget recent, write, new folder, rename, delete) now need the window's key. Before, another program on this computer that knew the engine's address could make them. Reading stays open to this computer.
- Opening Welcome or Preferences no longer reads the keychain, so it raises no keychain prompt. Whether a key is saved comes from a small index that holds names only. The keychain is read when a key is used and written when you save or remove one.
- On a computer with no system keychain, a saved key goes into a file in the data folder that only your user can read. Before, saving answered an error.
- After an upgrade a key may show "Not checked yet" until it is first used, saved again or removed.
- The README and the guide list what Substrate sends over the network and when. It collects no usage data.
- The sample snippet draws its picture locally instead of loading one from the web.
- Failures that were swallowed are now logged where they matter.

## 0.18.1 · 2026-11-22

Release paperwork and checks for the first family build.

- The README's release links open this repository's own Releases page, where FormCompiler drafts each release. Before, they pointed at FormCompiler's releases, which holds none.
- This changelog.
- `docs/RELEASE.md` says what Microsoft and Apple say today: no certificate gives SmartScreen reputation at once, Artifact Signing (formerly Trusted Signing) is the recommended service, and Apple's notarization pages are readable and list what notarization needs.
- The check workflow type-checks the desktop shell on Windows and macOS (`cargo check --locked`).
- Three routes under `/api/presets/graphs` that could never be reached are removed from the runs router. The presets service answers the same addresses as before.

## 0.18.0 · 2026-11-22

Substrate starts once, finds Claude Code wherever a terminal would, and recovers from an engine left running.

- Opened from Finder, the Dock or the Start menu, Substrate finds Claude Code in the usual install folders and on your login shell's PATH. Before, it looked only on the short PATH such a launch gets and reported Claude Code missing. `FORMSUBSTRATE_CLAUDE_BIN` points it at one program.
- Terminals and agent sessions get that same PATH, with the program's own folder first.
- Opening Substrate a second time brings the running window forward. Before, the second start ended with "The Substrate engine failed to start".
- On Windows the engine now leaves when the app is gone, and a start that finds an engine left without its app ends it and carries on.
- The engine starts when it is given no output streams.
- The Web Inspector is in debug builds only.
- The Preferences switch "Check for updates at start" is removed; nothing read it. Updates come through FormPortal.

## 0.17.1 · 2026-11-22

Fixes for the first family build.

- A check workflow (`ci.yml`) builds and type-checks the window, installs the pinned engine on Python 3.13, runs its self check and compile, and checks the shell scripts' syntax.
- The Windows engine freeze passes the skill presets and the recipe presets as two `--add-data` arguments.
- `build_app.bat` stops with a message and exit code 1 when the engine or the window install fails.
- The Windows install from source has its window step, and the engine install prefers the Python on the path.
- The macOS engine installs the same pinned versions as `requirements.txt`.
- The window install runs `npm ci`, so it installs exactly the tracked `package-lock.json`.
- The macOS bundle maps the engine folder once.

## 0.17.0 · 2026-11-21

The app is Substrate.

- The application is Substrate, the family name is FormSubstrate, and every name a program reads is `formsubstrate`: the repository, the launcher, the packages, the bundle id `ai.nodemode.formsubstrate`, `FORMSUBSTRATE_*` variables, data folders, the MCP server and the skills.
- State from the former name is carried over once: the data folder, keychain entries, window storage, workspace folders and snapshot refs.
- Variables and webhook headers under the former name are still accepted, with a notice in the log.
