# Windows Chrome automation bridge

This bridge starts **Windows Google Chrome** with a separate Autumn Compass profile and a Chrome
DevTools Protocol (CDP) endpoint bound only to `127.0.0.1`. It never uses or takes over Chrome's
normal profile, opens no firewall rule, and does not expose CDP on `0.0.0.0`.

Run the app first. For a native Windows checkout, use two PowerShell 7 windows in the repository root:

```powershell
# Window 1
npm run dev:server

# Window 2
npm run dev:web
```

For a WSL checkout, run the combined stack inside WSL instead:

```bash
npm run dev
```

Then start the dedicated browser from PowerShell 7:

```powershell
.\automation\windows\chrome\Start-ChromeAutomation.ps1 `
  -AppUrl http://localhost:5173 `
  -LoadBuiltExtension
```

`-LoadBuiltExtension` expects `apps/extension/dist/manifest.json`. Run `npm run build` first. The
launcher copies that output to `%LOCALAPPDATA%\AutumnCompass\ChromeAutomation\ExtensionStaging`, so
Windows Chrome does not have to load an extension directly from a WSL UNC path.

The browser profile lives at
`%LOCALAPPDATA%\AutumnCompass\ChromeAutomation\Profile`. It is intentionally independent of the
ordinary Chrome profile. Do not point `-ProfileDirectory` at `%LOCALAPPDATA%\Google\Chrome\User
Data` (the script also rejects it), and avoid signing this automation profile into a personal Google
account. CDP has full control of this dedicated profile while the browser is running.

## Check, control, and stop

```powershell
.\automation\windows\chrome\Get-ChromeAutomationStatus.ps1
.\automation\windows\chrome\Invoke-ChromeCdp.ps1 -Action Targets
.\automation\windows\chrome\Invoke-ChromeCdp.ps1 `
  -Action Command `
  -Method Runtime.evaluate `
  -ParamsJson '{"expression":"document.title","returnByValue":true}'
.\automation\windows\chrome\Stop-ChromeAutomation.ps1
```

The stop script verifies both the dedicated profile and port before closing Chrome. It preserves the
dedicated profile. `-Force` is available only if graceful CDP shutdown fails, and still targets only
Chrome processes whose command line matches both values.

Use a different local port if needed:

```powershell
.\automation\windows\chrome\Start-ChromeAutomation.ps1 -Port 9333
.\automation\windows\chrome\Get-ChromeAutomationStatus.ps1 -Port 9333 -AsJson
```

## Calling it from WSL

Windows executables can be invoked from WSL. From the repository root:

```bash
chrome_start="$(wslpath -w "$PWD/automation/windows/chrome/Start-ChromeAutomation.ps1")"
chrome_cdp="$(wslpath -w "$PWD/automation/windows/chrome/Invoke-ChromeCdp.ps1")"
chrome_stop="$(wslpath -w "$PWD/automation/windows/chrome/Stop-ChromeAutomation.ps1")"

pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "$chrome_start" -AppUrl http://localhost:5173 -LoadBuiltExtension
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "$chrome_cdp" -Action Targets -AsJson
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "$chrome_stop"
```

If `pwsh.exe` is not on the WSL interop path, use the full Windows path to PowerShell 7, typically
`/mnt/c/Program Files/PowerShell/7/pwsh.exe`.

With Windows 11 WSL mirrored networking, WSL tools may be able to connect directly to
`http://127.0.0.1:9222`. Under the default WSL NAT mode, Windows loopback is normally not directly
reachable from Linux. Keep CDP on loopback: invoke `Invoke-ChromeCdp.ps1` through `pwsh.exe`, or run
a long-lived Playwright/Puppeteer controller with Windows Node.js. Do **not** change the debug address
to `0.0.0.0`, add a port proxy, or open a firewall rule just to make WSL attach.

For Windows Chrome to open the full stack running inside WSL, run `npm run dev` and pass
`-AppUrl http://localhost:5173`. Use WSL mirrored networking or a VS Code **Private** port forward if
Windows localhost forwarding is unavailable. Once a workspace is loaded, the page and dedicated
browser profile can contain resume data; neither Vite nor Chrome CDP may bind to `0.0.0.0`. Do not
add a LAN firewall rule or port proxy.
