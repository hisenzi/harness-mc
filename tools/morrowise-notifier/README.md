# MorroWise Notifier

This is the selected JV-04 trusted Notifier implementation form: a small local app/runner with a file picker grant.

It is intentionally narrow:

- `--select-outbox` opens a file picker so Vincent can select exactly one outbox file.
- `--poll-once` reads that selected file, validates `notification.v0`, displays one macOS notification, and records delivered ids in app storage.
- `--diagnose` prints safe local metadata only.

Forbidden:

- No shell execution.
- No Node execution.
- No Git execution.
- No `$COLLAB` script execution.
- No write-back to `$COLLAB`.
- No file deletion.

Build command:

```bash
mkdir -p /private/tmp/MorroWiseNotifier.app/Contents/MacOS
cp tools/morrowise-notifier/Info.plist /private/tmp/MorroWiseNotifier.app/Contents/Info.plist
env CLANG_MODULE_CACHE_PATH=/private/tmp/clang-module-cache \
  swiftc tools/morrowise-notifier/MorroWiseNotifier.swift \
  -framework AppKit \
  -framework UserNotifications \
  -lsqlite3 \
  -o /private/tmp/MorroWiseNotifier.app/Contents/MacOS/MorroWiseNotifier
```

Run commands:

```bash
/private/tmp/MorroWiseNotifier.app/Contents/MacOS/MorroWiseNotifier --select-outbox
/private/tmp/MorroWiseNotifier.app/Contents/MacOS/MorroWiseNotifier --poll-once
/private/tmp/MorroWiseNotifier.app/Contents/MacOS/MorroWiseNotifier --diagnose
```

The app bundle is required because macOS `UserNotifications` needs a real bundle identity.

Runtime state:

`$HOME/Library/Application Support/MorroWiseNotifier/delivered.sqlite`

Do not grant Full Disk Access, Terminal access, `/bin/bash` access, or folder-wide Downloads access.
