# Release builds: signing and notarization

This page is for the owner's Mac (and later a Windows machine). Nothing here is a secret and nothing secret goes in the repository: certificates live in the login keychain, the notary credentials in a keychain profile, and any CI values in the CI's secret store.

## What `./build_app` makes

1. `vite build` writes the window to `frontend/dist`.
2. `setup/freeze_backend` freezes the engine with PyInstaller (6.22.3, one-folder, from `backend/requirements_build.txt`) into `src-tauri/engine/`. Six data folders go inside it (`--add-data` in `setup/freeze_backend` and its `.bat`): the window as `frontend_dist`, the New Form app templates and the Studio graph templates as `app/templates`, the graph presets as `presets/graphs`, the recipe presets as `app/services/recipes/presets`, the bundled plugins as `app/services/library/bundled` and the built-in skills as `skills`. Without them a packaged app cannot scaffold and its preset, plugin and skill lists are empty. `--selfcheck` prints a count for `graph_presets`, `graph_templates`, `recipe_presets`, `bundled_plugins` and `skills`, and fails when any group is missing. The gate hook script is a string constant in `app/services/gate_hook.py`, so it needs no data file.
3. `tauri build` bundles that folder as the resource `engine` (`Contents/Resources/engine` on macOS) and compiles the shell. The shell finds it through `src-tauri/src/packaged.rs`.
4. macOS: `subform.app` and a `.dmg` under `src-tauri/target/release/bundle/`. Linux: a `.deb` (set `SUBFORM_BUNDLES` for others). Windows: `build_app.bat`.

The resource entry is passed by `build_app` on the command line, not stored in `tauri.conf.json`, so a plain `cargo build` or `tauri dev` does not need a frozen engine. On macOS the same entry is also in `tauri.macos.conf.json`.

Without `APPLE_SIGNING_IDENTITY` the app is ad-hoc signed (`signingIdentity` `-`): it runs on the machine that built it and shows a Gatekeeper prompt elsewhere.

## One-time setup on the Mac

1. A paid Apple Developer Program account (a free one cannot notarize).
2. In the developer portal create a **Developer ID Application** certificate (the Account Holder can). Download it, double-click to add it to the login keychain, and check:

   ```
   security find-identity -v -p codesigning
   ```

   The line looks like `Developer ID Application: NodeAgentc, Inc. (TEAMID)`.
3. Store notary credentials once, using an app-specific password (appleid.apple.com, Sign-In and Security) or an App Store Connect API key:

   ```
   xcrun notarytool store-credentials subform-notary --apple-id <apple id> --team-id <TEAMID>
   ```

   It prompts for the password and keeps it in the keychain under the profile name `subform-notary`. Nothing is written to the repository.
4. Xcode command line tools: `xcode-select --install`.

## Signing and notarizing, step by step

Export the identity name for the session only (not in a file in the repo):

```
export APPLE_SIGNING_IDENTITY="Developer ID Application: NodeAgentc, Inc. (TEAMID)"
./build_app --no-install
```

With the variable set:

- `setup/freeze_backend` passes `--codesign-identity` and `--osx-entitlements-file src-tauri/entitlements.plist` to PyInstaller, which signs every Mach-O file in the frozen folder (the Python library, extension modules, the bootloader) with the identity.
- `tauri build` signs the app with the same identity (`bundle.macOS.hardenedRuntime` is true and `entitlements` points at `entitlements.plist`).

Then verify, and notarize the app by hand so the sequence is under your eye:

```
APP=src-tauri/target/release/bundle/macos/subform.app
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dvv "$APP" 2>&1 | grep -E "Authority|flags|TeamIdentifier"
```

`flags=0x10000(runtime)` means the hardened runtime is on. If any nested file under `Contents/Resources/engine` lacks it, sign inside-out yourself, deepest files first, the app last:

```
find "$APP/Contents/Resources/engine" -type f \( -name "*.so" -o -name "*.dylib" -o -perm -u+x \) -print0 |
  xargs -0 -n1 codesign --force --options runtime --timestamp --entitlements src-tauri/entitlements.plist --sign "$APPLE_SIGNING_IDENTITY"
codesign --force --options runtime --timestamp --entitlements src-tauri/entitlements.plist --sign "$APPLE_SIGNING_IDENTITY" "$APP"
```

Submit and staple:

```
ditto -c -k --keepParent "$APP" subform.zip
xcrun notarytool submit subform.zip --keychain-profile subform-notary --wait
xcrun notarytool log <submission id> --keychain-profile subform-notary
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute --verbose "$APP"
```

Rebuild the disk image from the stapled app (the last part of `build_app` does this with `hdiutil`; run it again, or repeat those lines by hand), then sign, notarize and staple the `.dmg` the same way:

```
codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" subform_<version>_<arch>.dmg
xcrun notarytool submit subform_<version>_<arch>.dmg --keychain-profile subform-notary --wait
xcrun stapler staple subform_<version>_<arch>.dmg
```

Tauri can also notarize during `tauri build` when `APPLE_API_ISSUER`, `APPLE_API_KEY` and `APPLE_API_KEY_PATH` (App Store Connect API key) or `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` are set in the environment. Use that only if you do not also re-sign by hand, because re-signing after notarization invalidates the ticket.

## Entitlements for the frozen Python engine

`src-tauri/entitlements.plist` carries two keys, both needed by a PyInstaller folder under the hardened runtime:

- `com.apple.security.cs.disable-library-validation`: the frozen engine loads the Python shared library and extension modules that PyInstaller signs with the same identity but that Library Validation would otherwise reject if any was signed differently (for example a wheel's own ad-hoc signature).
- `com.apple.security.cs.allow-unsigned-executable-memory`: CPython's `ctypes` and `libffi` closures (used by `cffi` and the keyring backends) allocate executable memory.

The plist is the only one; the engine, the pty host and the shell all inherit it from the signing commands above. If the notary log or the first launch reports a missing entitlement, add the key to that file, note why in `src-tauri/HASHOUT_LOG.md`, and sign again.

Apple's own pages were not readable when this was written, so the nested-signing order and the entitlement pair above come from how the PyInstaller and Tauri tools behave, not from Apple's text. Read the first notarization log (`notarytool log`) before trusting this section, and correct it here.

## Checks after signing

- `./build_app` ran on the machine that signs, so the engine inside matches the host architecture. A universal build needs two frozen engines and is not set up.
- Open the stapled app from the `.dmg` on a second Mac that has never seen the build, with the network off: Gatekeeper must accept the ticket without contacting Apple.
- The app must reach the main window after the splash, and `Contents/Resources/engine/subform-engine --selfcheck` must print `"app": "ok"`.

## Windows

- Build on Windows with `build_app.bat` (Rust, Node and Python 3.13 installed). The frozen engine is `src-tauri/engine/subform-engine.exe`; the shell looks for an `engine` folder beside the executable.
- Sign with an Authenticode certificate (an OV or EV code signing certificate from a CA, or Azure Trusted Signing). Keep the certificate in the Windows certificate store or in the signing service; set the thumbprint in the environment of the build, not in `tauri.conf.json` in the repository:

  ```
  signtool sign /sha1 <thumbprint> /fd sha256 /tr http://timestamp.digicert.com /td sha256 subform.exe
  ```

- Sign the frozen engine's `.exe` and `.dll` files too, before bundling, so SmartScreen and antivirus tools see signed code throughout. Then sign the installer. An EV certificate builds SmartScreen reputation at once; an OV one builds it over time.
- Tauri reads `bundle.windows.certificateThumbprint`, `digestAlgorithm` and `timestampUrl`; pass them with `--config` at release time rather than committing them.

## Linux

The `.deb` is unsigned. To publish through an apt repository sign the repository metadata with a GPG key that stays off the repository. `packaged.rs` already looks for the engine in `../lib/subform/engine` (the `.deb` layout, beside `../Resources/engine` and `engine`), so a `.deb` finds the frozen engine without further setup. An AppImage has not been built or checked.

## Secrets rule

No certificate, `.p8` key, app-specific password, keychain profile, thumbprint of a private certificate, or token goes in the repository, in `build_app.log` (which is ignored), in a commit message, or in a HASHOUT entry. `APPLE_SIGNING_IDENTITY` names a certificate; it is not a secret, but keep it in your shell, not in a script.

## Upgrading from substrataform

The app was renamed from substrataform to subform and every name changed. The first start of the new build copies the old data across once; nothing old is moved or deleted, so the old install can be removed by hand later.

- Data folder: if the new folder does not exist and the old one does, your data (recent workspaces, identity, library, triggers, secrets index, Cogentics settings) is copied; sessions, worktrees and other runtime state are not. The old folder is `~/Substrataform`, the per-OS `substrataform` folder, or `SubstrataformData` in portable mode, and a marker `.migrated-from-substrataform.json` records where it came from. If both exist, nothing is copied and the engine log says the old one was left alone. `SUBFORM_DATA_DIR` is never migrated.
- Keychain: each stored secret (API keys, Cogentics key, MCP server headers, webhook secrets) missing under service `subform` is copied from service `substrataform` once. The old entries stay. Plugin secrets must be entered again.
- Environment: `SUBSTRATAFORM_*` names still work for this release as fallbacks (`SUBFORM_*` wins) and log a deprecation warning. Rename them before the next release.
- Window: `substrataform.*` localStorage keys are copied to `subform.*` once, before first paint. On macOS the new bundle id gives the web view a new storage area, so these may be empty.
- Desktop shell (macOS and Linux): window position and size are copied from the old bundle id's config folder when the new one is empty.

Settings that name absolute paths inside the old data folder are not rewritten.
