# Substrate user guide

## What Substrate is

Substrate is a code editor for your repositories that also runs Claude Code for you. Each Claude Code session works in its own copy of your project (a git worktree), so several agents can work at once without touching your files. When they finish you read their changes hunk by hunk, commit them under your own name and push. Substrate also shows what formslot already knows about your code, so an agent reuses it instead of writing it again. Nothing leaves your computer except what git and Claude Code themselves send.

## Install

You need [git](https://git-scm.com) and [Claude Code](https://claude.com/product/claude-code). Language servers are optional and are found on your computer; Substrate never installs programs for you and never bundles git, `claude` or a language server.

Substrate looks for `claude` the way a terminal would find it, even when the app was opened from Finder, the Dock or the Start menu: the app's own PATH, the usual install folders (such as `~/.local/bin` and `~/.claude/local`), then the PATH your login shell sets up. To point it at one program, set `FORMSUBSTRATE_CLAUDE_BIN` to its full path before starting Substrate.

Only one Substrate runs at a time. Opening it again brings the running window forward.

Pick one way:

- **macOS:** double-click `Install formsubstrate.command` in the Substrate folder. The first time, macOS may refuse because the file was downloaded. Right-click the file, choose Open, then choose Open again in the question that appears. You only do this once. When the install finishes the window offers to start Substrate and stays open until you press Enter.
- **Windows:** double-click `Install formsubstrate.bat`. Windows SmartScreen may show a blue "Windows protected your PC" box. Click "More info", then "Run anyway". This appears because the file is new to Windows, not because anything is wrong. When it finishes, start Substrate with `formsubstrate.bat` in the same folder.
- **One command, any system:** open a terminal in the Substrate folder and run `./formsubstrate_oc_install` (on Windows `formsubstrate_oc_install.bat`). Then start it with `./formsubstrate` (on Windows `formsubstrate.bat`). `./formsubstrate doctor` checks the toolchain, the installs and the ports and tells you what is missing.

If you were given a packaged app (a `.dmg`, an installer or a `.deb`), install it the usual way for your system. The same macOS and Windows warnings can appear for an app that is not signed for your machine.

## First start and Home

The first start shows a splash, then Home. If no folder is open, a Welcome dialog also opens once. It is a readiness check: it shows whether the engine, git and the `claude` command were found, whether an API key is saved in the keychain, and whether a folder is open. You can open it again any time from Help > Welcome.

Home is the start page. Click the Substrate name at the top left to return to it, or use View > Home. It offers:

- Open a folder, open a file, clone a repo (File > Clone Repo...) or start a New Form app (File > New Form App). You can also drop a folder anywhere on the window.
- Quick actions: New Claude session, Claude terminal, New Form app, Review changes, Start formslot, Language servers.
- Recent workspaces, and your agent sessions grouped as Needs input, Working and Done.
- **The formslot card.** It follows one path. If formslot is not installed it offers Install formslot (it opens a terminal that does the work; if you already unpacked formslot, set its folder under Preferences > formslot). If it is installed but not set up it offers Set up formslot, which walks through formslot's short setup. If it is set up but the open project is not added, it offers Add this project. When everything is ready it shows that the service is running and how many tokens it has saved. The card only runs commands that contain plain paths; a path with odd characters is refused with a message.

## Opening a project and trusting it

Use File > Open Folder... (`Ctrl+O`, `Cmd+O` on macOS), pick a recent workspace, or drop a folder on the window. Agent sessions need a git repository with at least one commit.

Some projects carry their own programs: a language server, a Python environment, plugins or tool nodes in a graph. Substrate does not run these until you say so. If the folder has such tools, a banner asks "Trust <folder name>?" and lists the tools, with Trust this workspace or Not now. You can also use File > Trust This Workspace at any time, and revoke trust under Preferences > Workspace > Trusted workspaces.

Trusting a workspace lets Substrate:

- start language servers and debug adapters that live inside the project, and any custom language server you added in Preferences;
- read the project's debug launch file (`.formsubstrate/launch.json`);
- run Studio graphs through Claude, and graphs that contain tool nodes (the simulator without tool nodes needs no trust);
- let Cogentics channels run agent turns;
- let triggers start recipes;
- load plugins from the project's `.formsubstrate/plugins` folder (bundled plugins load without trust).

Without trust you can still edit, search, review and commit.

## Editing, search, palette, previews, split and panels

- **Editing.** Open files from the Files section on the left. `Ctrl+S` saves, `Ctrl+W` closes the tab, `Ctrl+F` finds in the file, `Ctrl+D` adds the next occurrence. Language servers give hover, diagnostics, go to definition (`F12`), find all references (`Shift+F12`), rename (`F2`) and format (`Shift+Alt+F`). The Go menu also has Show Outline, Show Problems, Language Servers... and Restart Language Servers. Fold a block with the arrow in the gutter or `Shift+Ctrl+[` (unfold with `Shift+Ctrl+]`; fold and unfold all with `Alt+Ctrl+[` and `Alt+Ctrl+]`). `Alt+click` adds a cursor and `Alt+Shift+drag` selects a column. Brackets are coloured by depth, auto save writes a changed file after a short pause and when the window loses focus, and format on save asks the language server to format before saving; all three are under Preferences > Editor. Auto save is off until you turn it on, and it never saves over a file that changed on disk.
- **Quick fixes.** When the language server has a fix for the line the cursor is on, a light bulb shows in the gutter. Click it, press `Ctrl+.`, or right-click in the editor and choose Quick Fix... to see the list, with the server's preferred fix first; the tooltip of a problem offers its first fix too. The same context menu has Source Action... and Organize Imports (`Alt+Shift+O`) when the server offers them, the language commands, and Cut, Copy, Paste and Select All. A fix is one undo in each open file. A fix that changes files you do not have open writes them on disk, and can create or rename a file; undo in the editor does not take those back. A fix made for text you have since changed, or one that reaches outside the workspace, is refused with a notice.
- **Custom language servers.** TypeScript and Python servers are built in. For another language, open Preferences > Language Servers > Custom servers. One click adds a preset for rust-analyzer or for the JSON, HTML, CSS or YAML server; Add custom server takes any program with its arguments, file extensions and language id. Substrate never installs a server: under one that was not found it shows the install line for you to run. A custom server starts on the first file of its kind and gives the same hover, completion, definition, references, rename, format and diagnostics. It runs only in a trusted workspace; until then the status bar says it needs trust.
- **Run and Debug.** The Run and Debug section on the left (`Shift+Ctrl+D`) debugs Python and Node.js. `F5` starts or continues, `Shift+F5` stops, `F10`, `F11` and `Shift+F11` step, and `F9` or a click in the gutter toggles a breakpoint. Right-click the breakpoint gutter to add a conditional breakpoint, a hit count or a logpoint, and to edit, disable or remove one; the expression is typed in a line under the code. A logpoint prints its message to the Debug Console with the file and line, and does not stop. Watch holds expressions that are evaluated again at every stop and every frame change. The picker at the top offers Current File and the configurations in `.formsubstrate/launch.json`; when that file does not exist, `.vscode/launch.json` is read instead. The launch file is read only in a trusted workspace, it runs `launch` configurations of type `python`, `debugpy`, `node` or `pwa-node`, and the panel names the ones and the fields it cannot use. The gear opens the file, or writes a starter one first (Add Configuration). Python needs debugpy in the Python it runs: the project's `.venv` or `venv` when the workspace is trusted, else the system Python. Node.js is debugged through Microsoft's js-debug, which Substrate never downloads: get js-debug-dap from the vscode-js-debug releases page on GitHub, unpack it, and set the folder under Preferences > Language Servers > Run and Debug. Breakpoints and watch expressions are kept per workspace.
- **Search.** Edit > Find in Files... (`Shift+Ctrl+F`) opens the Search section. Regular expressions work with or without ripgrep installed; a pattern that runs too long stops after a few seconds and says so. Type a replacement and choose Replace all to see every file with a checkbox and its diff before anything is written; `$1`, `${name}` and `$&` take the matched groups. Files with unsaved changes in a tab are left out, open tabs without changes show the new text at once, and a file that changed after the preview is refused.
- **Go to File.** `Ctrl+P` finds a file of the workspace by part of its name. With nothing typed it lists the files you opened last; `name:120` opens at line 120, and `>` turns it into the command palette.
- **Command palette.** `Shift+Ctrl+P` or `Ctrl+K`. Type to find a command. Type `@` to jump to a symbol in the current file (also Go > Go to Symbol in File..., `Alt+Ctrl+O`), or `#` to find a symbol anywhere in the workspace (Go > Go to Symbol in Workspace..., `Ctrl+T`). Start with `/` to search the text of every file.
- **Previews.** Markdown, images, media and HTML open in a preview. `Shift+Ctrl+V` toggles the Markdown preview, and View > Open Preview to the Side shows it beside the source.
- **Split and panels.** View > Toggle Editor Split (`Alt+Ctrl+\`) splits the editor. `Ctrl+B` hides the left side bar, `Alt+Ctrl+B` hides the right panel, `Ctrl+J` shows or hides the terminal dock. View > File Graph (`Alt+Shift+G`) draws how your files import each other. Panel borders can be dragged.

On macOS read `Ctrl` as `Cmd` and `Alt` as `Option`. See the table at the end.

## Terminals and Claude Code sessions

Open the terminal dock with `Ctrl+J`. Terminal > New Terminal opens your shell in the workspace. Terminal > New Claude Code Terminal opens a terminal that runs `claude` there.

For real agent work, use Agents > New Claude Code Session (`Shift+Ctrl+A`). Give it a title, choose a mode and a base branch (blank means the current commit):

- **Interactive** opens a Claude Code terminal in the dock.
- **Headless** runs a prompt you type and streams the transcript. It has no person to approve each tool, so the permission mode you pick matters: the default is Accept edits, which lets it change files inside its own worktree only. Bash and other tools are denied. Change the default under Preferences > Agents.

Either way the session gets its own git worktree and branch. Your own working copy is never touched. The Sessions section on the left and Agents > Agent Sessions list them, and Home groups them by state. Sessions get Substrate's MCP server, formMCP and formslot through a `.formsubstrate/mcp.json` in their worktree.

## The review pane, commits and Sign and Push

Open Git > Review Changes (or the Review changes tile on Home). Pick the workspace or a session in the Target list to see its uncommitted changes as hunks. For each hunk you can Accept, Reject, or write a comment. A comment on a session's hunk is sent to that session. Accept all and commit stages everything and commits with the message from Source Control. Rejecting a file keeps a snapshot first, so it can be rewound.

The Source Control section (Git > Git Status) has the commit box (`Ctrl+Enter` commits), Commit All, snapshots (Git > Take Snapshot, with Rewind), and Push and Sign and Push.

- **Branches.** Click the branch name at the top of Source Control or in the status bar. The menu creates a branch (from the current branch or any other), switches to a local or remote branch, and deletes one. A switch that would overwrite your changes is refused, names the files and offers to stash them first. An agent session's worktree stays on its own branch.
- **Fetch and Pull.** Fetch updates what Substrate knows of the remote. Pull fast-forwards your branch. When your branch and its upstream have both moved, Pull changes nothing and says so; Pull with a Merge Commit merges them, and is undone if it conflicts. Substrate never rebases.
- **Stashes and tags.** Stash Changes... sets your changes aside (with untracked files if you choose); the Stashes list applies, pops or drops one. Create Tag... makes a tag, annotated when you give a message, and the Tags list pushes one.
- **Merge conflicts.** Conflicted files are listed under Merge Changes. Open one: each conflict has Accept Current Change, Accept Incoming Change and Accept Both Changes above it. Accept All Current and Accept All Incoming take one side for the whole file (a snapshot is kept first), and Mark Resolved stages the file; if conflict markers are still in it, Substrate asks first. Commit then finishes the merge.
- **File History.** Right-click a tab, a file in Files or a row in Source Control and choose Open File History (also in the palette). The list follows renames; click a commit to see what it changed in that file.

Commits made from Substrate, by you or by an agent, use the name and email you set under Preferences > Git and Identity. If no identity is set, commits use your global git identity (or are refused when none exists). If an agent adds a trailer such as a `Co-Authored-By:` line, or commits under another identity, or skips the commit hook, the commit is flagged. **Sign and Push** (Git > Sign and Push) re-signs and cleans the unpushed commits, checks them and then pushes. History is only rewritten when you click it. Signing uses an SSH public key at the path you set; the private key is never read or stored by Substrate.

## Permission gates and the slot card

When an agent is about to write a file, Substrate asks formslot whether something like it already exists. The same check covers common shell writes (redirections, `cp`, `mv`, `tee`, `sed -i`, `curl -o`, `rsync`, archive extraction and more). The command is read, never run. If a match exists, the write waits for you and a card appears:

- **Use:** tell the agent to reuse the existing slot.
- **Adapt:** tell the agent to adapt the existing slot instead of writing a parallel copy.
- **Write new anyway:** let the write go ahead.

If the session is an interactive terminal, the card shows as a bar at the bottom of that terminal's tab: "Substrate is waiting for your answer", with the slot name and the same three buttons. The tab also carries a small badge, and `+2` means two more are waiting. `Alt+Ctrl+G` (Answer Existing Slot Prompt) jumps to the first open card. Only the window can answer; the agent cannot answer its own gate. If the agent retries the same write after Use or Adapt, you are asked again.

The right panel has a **Slots** tab. It shows which slots or known code units cover the file you have open, or "No slot or unit covers this file". The formslot section on the left searches slots.

**Skipped gates.** If the check could not run (the engine did not answer, or the hook failed), the write is allowed rather than stuck, and the review pane marks the file "Gate skipped" with the reason and shows a count such as "1 gate skipped" in its header. Look at those files by hand. A Bash write that overlapped a slot after the fact is marked "Written by Bash, overlaps slot".

## Studio and graph runs

View > Studio (`Alt+Shift+S`) opens a node canvas where you build agent graphs; View > New Graph creates one. Graphs are saved in `.formsubstrate/graphs` in the project. Build by dragging nodes from the palette and wiring them; the canvas can be edited with the keyboard too.

Run a graph from the Runs tab on the right (or press `Alt+Ctrl+R`, Run Graph). Type a task, choose a mode and press Run:

- **Simulator** runs the graph with no model. It is safe for checking the shape of a graph.
- **Claude** runs each agent through your `claude` command. It needs the `claude` command on this computer and a trusted workspace.

A graph needs a start node. If a step is set to "Wait for approval before running", or a step needs a decision before a shell command or file write, the run waits and the Approvals tab on the right shows one card per waiting step with an Approve button. A toast says "Run waiting".

When a Claude graph can edit files, it runs in its own worktree on a branch named `sf/run-<id>`, with the same formslot gate as a session. When the run finishes, the Review run changes button in the Runs tab opens the review pane on that run's worktree so you can accept or reject its work like a session's. The Node tab inspects any node, showing what it did in a run and its run settings.

## Recipes, triggers and webhooks

A **recipe** is a graph plus a task template and declared inputs, run from a form. Use the Recipes section on the left (or the New Recipe... command) to create, edit and run them, with the simulator or Claude.

A **trigger** starts a recipe or graph for you. The Triggers section on the left makes four kinds:

- every N seconds (at least 10);
- once after N seconds;
- when files matching a pattern change (for example `src/**`);
- a signed webhook.

The webhook gets a path on the engine, `/api/hooks/<id>`, and a secret of 24 or more characters (leave the field blank to generate one). Callers sign the body and send the `X-FormSubstrate-Signature`, `X-FormSubstrate-Timestamp` and `X-FormSubstrate-Nonce` headers; the webhook dialog shows the exact header and secret. A body larger than 256 KB is refused. The engine listens on this computer only, so a webhook is reachable by programs on this computer.

**Triggers and webhooks run only while Substrate is open.** If a trigger was due while the app was closed, the panel says "missed while the app was closed"; it does not catch up. If a recipe changed after you made the trigger, you must confirm it again before it runs. The runs that triggers start show in the Automation tab on the right. The workspace must be trusted for triggers to run Claude or tool nodes.

## Cogentics, insight and the console

- **Cogentics** (right panel) holds shared channels where you and agent members work on one ledger of turns. It needs a trusted workspace to run agent turns, and uses the Claude command or a provider key set in its panel.
- **Insight** (right panel; the command palette has Show Usage and Changes) shows usage and the changes per turn. Cogentics links into it.
- **Console** is a tab in the terminal dock (command palette: Show Console). It shows engine health, approvals and provider status in one place.

## Extensions, plugins, MCP servers, collections, blocks and activity

- **Extensions** (left side, or the command palette: Extensions) lists the built-in extensions and lets you enable or disable them. It has three tabs: Extensions, Plugins and MCP.
- **Plugins** are backend Python plugins and connectors with their own settings. Bundled ones load at once. Plugins in the project's `.formsubstrate/plugins` folder are held until you trust the workspace. Secret settings go to the system keyring. The command palette has Reload Plugins.
- **MCP servers** (Extensions > MCP) are the tool servers you connect to Substrate's own engine. Their headers are kept in the keyring. This is separate from Substrate being an MCP server itself for agents, described in `docs/MCP.md`.
- **Collections** (right panel) are searchable knowledge collections of the workspace.
- **Tools** (left side) lists the live tool registry with a call form, and the blocks (HTML snippets) used by the editor and the Studio palette.
- **Activity** (right panel) is a live feed of tool calls, plugin and MCP changes, collection writes and Studio runs, with filters.

## Preferences essentials

Open File > Preferences... (`Ctrl+,`). Pages: General, Interface, Workspace, Editor, Terminal, Agents, Git and Identity, formslot, Language Servers, Keys, Updates.

- **Interface:** theme, accent and intensity, text size, animations, and the custom title bar (changes at the next start).
- **Workspace:** reopen what you had, the typed path field for Open Folder, trusted workspaces (Revoke), and folder names to hide from the file tree.
- **Editor:** font size, tab size, word wrap, bracket pair colours, auto save and its delay (500 ms to 10 s), and format on save.
- **Agents:** the Claude Code model, the default permission mode for headless sessions, and an Anthropic API key. The key is sent to the engine and kept in your system keychain; the page never reads it back.
- **Git and Identity:** author name and email, signing, and the SSH signing key path.
- **formslot:** whether the service is used and started for you, and the path to a formslot folder or program.
- **Language Servers:** which servers were found and how to install the missing ones; Custom servers, where you add a server for another language from a preset or by hand; and Run and Debug, the folder of js-debug for Node.js debugging.
- **Keys:** the list of shortcuts. They cannot be changed yet.
- **Updates:** the version.

Preferences can also be reset, which returns every preference and the theme to how Substrate comes and keeps your files.

## Upgrading from the earlier name

Substrate used to have another name. On the first start of the new version, if the new data folder does not exist and the old one does, your recent workspaces, identity, library, triggers, secrets list and Cogentics settings are copied across once. Sessions and worktrees are not copied, and nothing old is deleted, so you can remove the old install by hand later. Secrets stored in the keychain under the old name are copied to the new name once. Plugin secrets must be entered again. Old environment variables with the earlier prefix still work for now (`FORMSUBSTRATE_*` wins) and log a warning; rename them. A workspace's folder of graphs, recipes and plugins is renamed to `.formsubstrate` when you open it, and its snapshots move with it. Your theme and preferences in the window are copied once on first start; on macOS they may be empty because the new bundle has its own storage. Settings that name absolute paths inside the old folder are not rewritten.

## Troubleshooting

- **The engine does not start.** The packaged app shows "The Substrate engine failed to start. Please relaunch the app." In a source checkout, run `./formsubstrate doctor`, then `./formsubstrate install` if packages are missing. The engine log is `Logs/formsubstrate-engine.log` in the data folder (see below). Home shows "Engine offline" when the window cannot reach it.
- **A port is in use.** In a source checkout, Substrate uses 5650 for the window and 5655 for the engine; `./formsubstrate doctor` says which is taken. Set another engine port with `FORMSUBSTRATE_PORT=5660 ./formsubstrate`. The desktop app picks a free port by itself.
- **The keyring is missing.** The Anthropic API key in Preferences and the Cogentics provider key go to the system keyring, and where this computer has none they go to `secrets-local.json` in the data folder, which only your user can read (on Windows your user profile's permissions protect it). Preferences then says "Saved in a file only you can read". Plugin secrets, webhook secrets and MCP headers live only in the system keyring and are not saved without one. On Linux install and unlock a keyring service (for example GNOME Keyring or KWallet), then save the key again to move it there.
- **The key says "Not checked yet".** After an update Substrate may not know yet whether a key is in the keychain, because it no longer reads the keychain just to show a status. Saving the key again, or removing it, settles it; the Cogentics key is also settled the first time a chat uses it.
- **A language server is not found.** Open Go > Language Servers... to see what was found and the install commands for the rest. Servers are found on your computer, never bundled. A server inside the project, and every custom server, only starts after you trust the workspace; when the status bar says a server needs trust, open Language Servers... and trust the workspace there, or use File > Trust This Workspace. If it still does not start, use Go > Restart Language Servers.
- **formslot is not found.** Home shows "formslot is not installed". Use Install formslot, or point Substrate at your formslot folder under Preferences > formslot. When a New Form app is made without it, the plugin step reports "formslot not found, plugin skipped".
- **The window token in development builds.** Changes only you may make (answering a gate, trusting, committing identity, imports) need a secret window token. In the desktop app the shell hands it to the window and nothing else can ask for it. In a browser development build (a source checkout opened at `http://localhost:5650`) the window asks the engine for it, which any program on this computer can do; this is a convenience for developers, not a security boundary. If actions fail with a 403 after the engine restarted, reload the window.

## What Substrate sends over the network

Nothing leaves your computer unless you use a feature that needs it. Substrate collects no usage data: there is no telemetry, no crash reporting and no update check. The engine and the window talk to each other on `127.0.0.1` only. Opening Home, Welcome or Preferences sends nothing and does not read the system keychain.

- **The model provider you configure** (Cogentics, under the console's Providers page). Chats, Test connection and the model price list go to the provider's address: OpenRouter (`https://openrouter.ai/api/v1`) by default, Ollama (`localhost:11434`) or LM Studio (`localhost:1234`) on this computer, or a custom address you enter. Your API key goes only to that address. The price list is fetched when the Cogentics panel loads its models, and only when a provider other than a custom one is configured. Requests to OpenRouter carry `HTTP-Referer: http://localhost:5650` and `X-Title: Substrate`.
- **The web search plugin.** When an agent or recipe runs it, the search words go to DuckDuckGo (`html.duckduckgo.com`) with the user agent `formsubstrate/0.17`.
- **The HTTP connector plugin.** Requests go to the address its settings name, only when it runs.
- **MCP servers you add.** An HTTP server gets requests at the address you gave, with the headers you saved, when Substrate connects to it to list or call its tools. A command server runs as a program on your computer and does whatever that program does.
- **git.** Clone repo runs `git clone` on the address you enter (https and ssh only). Push runs `git push` to the remote you pick; Sign and Push runs `git fetch` and then `git push`. Fetch, Pull and pushing a tag in Source Control reach the remotes your repository already names, when you click them. Nothing is fetched or pushed in the background.
- **Claude Code.** Sessions run the `claude` command found on your computer. Its traffic to Anthropic is Claude Code's own, under its own settings; Substrate does not see or relay it.
- **Language servers and debuggers** you installed run as your programs; what they download is up to them. The install commands Substrate shows (for Claude Code, other agents and language servers) are text for you to copy; Substrate does not run them.
- **formslot** is reached on this computer only (`127.0.0.1`).
- **Links.** The desktop app opens an `http`, `https` or `mailto` link in your browser only when you click it.
- **Snippets.** The Media block snippet uses an image drawn inline, so inserting it fetches nothing.

## Where data lives

The data folder is, in order: `FORMSUBSTRATE_DATA_DIR` if you set it; `FormSubstrateData` beside the app in portable mode; `~/FormSubstrate` if it exists; else `~/Library/Application Support/formsubstrate` on macOS, `%APPDATA%\formsubstrate` on Windows, and `~/.local/share/formsubstrate` on Linux. It holds `recent.json`, `identity.json`, the library, triggers, Cogentics settings, `worktrees/` (one folder per session), `run-worktrees.json`, `engine.port` and `Logs/formsubstrate-engine.log`. The Help > About Substrate window shows the folder in use. Secrets are never in these files: they live in the system keyring under the service name `formsubstrate`. `secrets-index.json` names which keys are saved and where, never their values. Only on a computer without a keyring are the Preferences and Cogentics keys kept in `secrets-local.json`, readable by your user only. Inside a project Substrate writes only to `.formsubstrate/` (graphs, recipes, plugins, MCP settings) and, for sessions, to their worktrees. Your own working copy is changed only when you accept a hunk or save a file.

## Keyboard shortcuts

`Ctrl` is `Cmd` on macOS and `Alt` is `Option`. Commands without a shortcut are in the menus and the palette.

| Action | Windows and Linux | macOS |
| --- | --- | --- |
| Command palette | `Shift+Ctrl+P` or `Ctrl+K` | `Shift+Cmd+P` or `Cmd+K` |
| Go to File | `Ctrl+P` | `Cmd+P` |
| Open Folder | `Ctrl+O` | `Cmd+O` |
| Open File | `Shift+Ctrl+O` | `Shift+Cmd+O` |
| Save | `Ctrl+S` | `Cmd+S` |
| Save All | `Alt+Ctrl+S` | `Option+Cmd+S` |
| Close Tab | `Ctrl+W` | `Cmd+W` |
| Preferences | `Ctrl+,` | `Cmd+,` |
| Find | `Ctrl+F` | `Cmd+F` |
| Find in Files | `Shift+Ctrl+F` | `Shift+Cmd+F` |
| Add Next Occurrence | `Ctrl+D` | `Cmd+D` |
| Select All Occurrences | `Shift+Ctrl+L` | `Shift+Cmd+L` |
| Word Wrap | `Alt+Z` | `Option+Z` |
| Fold, Unfold | `Shift+Ctrl+[`, `Shift+Ctrl+]` | `Option+Cmd+[`, `Option+Cmd+]` |
| Fold All, Unfold All | `Alt+Ctrl+[`, `Alt+Ctrl+]` | `Ctrl+Option+[`, `Ctrl+Option+]` |
| Add Cursor, Column Selection | `Alt+click`, `Alt+Shift+drag` | `Option+click`, `Option+Shift+drag` |
| Go to Symbol in File (`@`) | `Alt+Ctrl+O` | `Option+Cmd+O` |
| Go to Symbol in Workspace (`#`) | `Ctrl+T` | `Cmd+T` |
| Next or Previous Tab | `Alt+Ctrl+Right` or `Left` | `Option+Cmd+Right` or `Left` |
| Toggle Side Bar | `Ctrl+B` | `Cmd+B` |
| Toggle Right Panel | `Alt+Ctrl+B` | `Option+Cmd+B` |
| Toggle Editor Split | `Alt+Ctrl+\` | `Option+Cmd+\` |
| Focus Files | `Shift+Ctrl+E` | `Shift+Cmd+E` |
| Toggle Terminal | `Ctrl+J` | `Cmd+J` |
| Toggle Markdown Preview | `Shift+Ctrl+V` | `Shift+Cmd+V` |
| File Graph | `Alt+Shift+G` | `Option+Shift+G` |
| Studio | `Alt+Shift+S` | `Option+Shift+S` |
| Run Graph | `Alt+Ctrl+R` | `Option+Cmd+R` |
| New Claude Code Session | `Shift+Ctrl+A` | `Shift+Cmd+A` |
| Answer Existing Slot Prompt | `Alt+Ctrl+G` | `Option+Cmd+G` |
| Go to Definition | `F12` | `F12` |
| Find All References | `Shift+F12` | `Shift+F12` |
| Rename Symbol | `F2` | `F2` |
| Format Document | `Shift+Alt+F` | `Shift+Option+F` |
| Quick Fix | `Ctrl+.` | `Cmd+.` |
| Organize Imports | `Alt+Shift+O` | `Option+Shift+O` |
| Start or Continue Debugging | `F5` | `F5` |
| Stop Debugging | `Shift+F5` | `Shift+F5` |
| Step Over, Into, Out | `F10`, `F11`, `Shift+F11` | `F10`, `F11`, `Shift+F11` |
| Toggle Breakpoint | `F9` | `F9` |
| Run and Debug | `Shift+Ctrl+D` | `Shift+Cmd+D` |
| Zoom In, Out, Reset | `Ctrl+=`, `Ctrl+-`, `Ctrl+0` | `Cmd+=`, `Cmd+-`, `Cmd+0` |
| Minimize | `Ctrl+M` | `Cmd+M` |
| Commit (in the commit box) | `Ctrl+Enter` | `Cmd+Enter` |
| Back to the editor from Home | `Esc` | `Esc` |

`Run Task` and `Help` (`F1`) are in the menus but not available yet.
