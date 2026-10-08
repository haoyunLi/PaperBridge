# Real NSIS lifecycle check (opt-in)

Run after `npm run dist` completes. This is excluded from `npm test`; it temporarily installs the real Windows package for the current user.

```powershell
node tests/installer-e2e.cjs --preflight
$env:PAPERBRIDGE_INSTALLER_E2E = '1'
node tests/installer-e2e.cjs
Remove-Item Env:\PAPERBRIDGE_INSTALLER_E2E
```

The preflight is read-only. Every invocation checks HKCU/HKLM, both registry views, application installation keys, uninstall records, desktop/start-menu shortcuts, running PaperBridge processes, and the updater cache. Any existing installation or conflicting state is a refusal; the script never removes it to make the test pass.

The script copies the built installer into a fresh `test-artifacts/i-*` directory and records its SHA-256. It installs under that directory, opens the installed executable, creates a practice paper with a highlight and note through the UI, closes the app, reinstalls the exact same installer, and verifies restored UI/data. It then uninstalls and confirms the saved paper/settings remain. The app workspace, Chromium profile, and managed-tools directory are isolated under the fixture. Results remain in `report.json` alongside the saved data.

Fixtures use a compact `test-artifacts/i-*` name. Before mutation, the test combines that install path with every file under `release/win-unpacked` and refuses a longest path of 260 characters or more. This mirrors the traditional Win32 path boundary used by electron-builder's NSIS atomic update removal. The production installer keeps electron-builder's safe default directory and does not expose a custom directory page.

This validates **same-version reinstallation**, not a cross-version update, rollback, interrupted installation, or preservation of an existing user's default profile. Those need separate scenarios.

## Safety boundaries

- Installation directories must be fresh absolute paths under this checkout's `test-artifacts`. Symbolic links/junction ancestors and single quotes/newlines are refused. The installer and copied uninstaller must be regular executable files inside that verified fixture.
- Before reinstalling or uninstalling, registry locations, uninstall commands, shortcuts, and processes are checked again. Only this invocation's installation may exist.
- NSIS necessarily creates per-user registration/shortcuts plus `%LOCALAPPDATA%\paperbridge-windows-updater\installer.exe`. The test refuses a pre-existing cache and only removes its newly created cache after uninstall, when the contents and installer hash still match. It does not recursively delete arbitrary directories or edit registry entries directly.
- Installer/uninstaller use PowerShell `Start-Process -WindowStyle Hidden`; `/S` prevents interactive installer windows. No `--force-run` or `--delete-app-data` is passed.
- On failure, cleanup invokes only the verified fixture uninstaller. A changed/foreign registration makes cleanup refuse and records the remaining fixture path. Inspect that report before any manual recovery; do not delete unrelated installations or data.

## Parameter references

[NSIS command-line documentation](https://nsis.sourceforge.io/Docs/Chapter3.html#installerusage) specifies `/S`, absolute `/D=` as the final unquoted parameter, and final unquoted `_?=` to run an uninstaller against a known installation directory without its temporary copy. [electron-builder NSIS documentation](https://www.electron.build/nsis/) describes assisted per-user installers. Its [assisted installer template](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/templates/nsis/assistedInstaller.nsh) handles `/currentuser`; this handling was also reviewed in the local installed templates. The script checks the project configuration assumptions before running.
