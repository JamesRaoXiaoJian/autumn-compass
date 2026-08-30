# Windows daily maintenance

These scripts are for a native Windows checkout with Windows Git and Codex CLI. For a repository
stored inside WSL, use the Linux runner and systemd timer instead of operating the WSL files through
Windows PowerShell.

Run these commands from the repository root in PowerShell:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\automation\windows\Run-JobMaintenance.ps1 -Check
.\automation\windows\Install-ScheduledTask.ps1
```

The installer creates `Autumn Compass Recruitment Maintenance` at 03:30 local time. The task uses
the current interactive user, stores no Windows password, and runs only while that user is logged on.
Use `-DailyAt HH:mm` to select another time and `-Force` to intentionally replace an existing task.

The runner resolves the repository, Git, and Codex paths at runtime. It refuses to run unless the
current branch is exactly `main` and the worktree is clean. Validated changes remain uncommitted for
review; the runner reinforces the durable prompt with no-commit/no-push guards.

Useful commands:

```powershell
Start-ScheduledTask -TaskName 'Autumn Compass Recruitment Maintenance'
Get-ScheduledTaskInfo -TaskName 'Autumn Compass Recruitment Maintenance'
.\automation\windows\Uninstall-ScheduledTask.ps1
```
