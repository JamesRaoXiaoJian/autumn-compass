# 私人同步

私人同步用于迁移应用内显式导出的 JSON，不用于同步 Git 仓库、原始 SQLite、浏览器会话或密钥。服务端只保存客户端已加密的不可变 `.age` 快照。

## 前置条件

- 客户端安装 `ssh`、`scp`、`ssh-keygen` 和 `age`；
- 为此用途创建独立 SSH 密钥，并在服务端仅配置对应公钥；
- 通过独立渠道核验服务端 ED25519 指纹；
- 在专用 `known_hosts` 中固定该主机和端口；
- 为快照创建独立 age identity / recipient。

## Linux / WSL

只在当前 shell 或被忽略的本地配置中设置真实值：

```bash
export FALL_RECRUITMENT_SYNC_REMOTE='USER@HOST'
export FALL_RECRUITMENT_SYNC_SSH_PORT='SSH_PORT'
export FALL_RECRUITMENT_SYNC_HOST_FINGERPRINT='SHA256:VERIFIED_FINGERPRINT'
export FALL_RECRUITMENT_SYNC_SSH_IDENTITY='/absolute/path/to/private-key'
export FALL_RECRUITMENT_SYNC_KNOWN_HOSTS='/absolute/path/to/project-known-hosts'
```

先检查，再上传应用导出的 JSON：

```bash
./scripts/private-sync/private-sync.sh check
./scripts/private-sync/private-sync.sh push /path/to/autumn-compass-workspace-YYYY-MM-DD.json
./scripts/private-sync/private-sync.sh pull
```

脚本拒绝密码回退、未固定的主机、错误指纹、符号链接输入、未知文件名和超限载荷。恢复后得到的仍是明文 JSON，应尽快导入应用并妥善保存或销毁。

## Windows PowerShell 7

```powershell
$env:FALL_RECRUITMENT_SYNC_REMOTE = 'USER@HOST'
$env:FALL_RECRUITMENT_SYNC_SSH_PORT = 'SSH_PORT'
$env:FALL_RECRUITMENT_SYNC_HOST_FINGERPRINT = 'SHA256:VERIFIED_FINGERPRINT'

./automation/windows/private-sync/Private-Sync.ps1 Check `
  -SshIdentity 'C:\secure\project-key' `
  -KnownHosts 'C:\secure\project-known-hosts'

./automation/windows/private-sync/Private-Sync.ps1 Push `
  'C:\private\autumn-compass-workspace-YYYY-MM-DD.json' `
  -SshIdentity 'C:\secure\project-key' `
  -KnownHosts 'C:\secure\project-known-hosts'
```

不要把这些值写进源码、PowerShell 历史共享文件、issue 或 CI 日志。服务端固定目录为 `~/.local/share/fall-recruitment-sync`，不支持从命令行扩大同步路径。
