# 自托管指南

## 开发模式

```bash
npm ci
npm run dev
```

`scripts/dev-stack.sh` 同时启动 API 与 Vite。默认访问 `http://127.0.0.1:5173`，API 健康检查通过同源代理访问 `http://127.0.0.1:5173/api/health`。

根包装器面向 Linux / WSL。原生 Windows 在两个 PowerShell 7 窗口分别运行：

```powershell
npm run dev:server
npm run dev:web
```

两边继承同一个 `AUTUMN_COMPASS_API_PORT` 时，Vite 会把同源 `/api` 代理到该数据服务。macOS 可使用前台 `npm run dev`（需 Bash 与 curl），但后台启停脚本依赖 Linux 的 setsid、flock 和 `/proc`。

原生 Windows 的两个前台进程分别用 `Ctrl+C` 停止；复制原始 SQLite 前必须确认 API 窗口已经退出。macOS 使用根 `npm run dev` 时需要支持 `wait -n` 的 Bash 4.3+，否则同样使用两个终端分别启动 Server 与 Web。

后台运行：

```bash
npm run start
npm run restart
npm run stop
```

这些后台命令仅支持 Linux / WSL，并额外需要 lsof、setsid、flock 和 sha256sum。

后台 PID 和日志保存在用户状态目录，不写入仓库。启停脚本只会操作端口上属于当前项目目录的进程；若端口由其他程序占用，它会拒绝终止。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AUTUMN_COMPASS_HOST` | `127.0.0.1` | Web 监听地址，只接受回环地址 |
| `AUTUMN_COMPASS_PORT` | `5173` | Web 端口 |
| `AUTUMN_COMPASS_API_HOST` | `127.0.0.1` | API 监听地址，只接受回环地址 |
| `AUTUMN_COMPASS_API_PORT` | `4174` | API 端口 |
| `AUTUMN_COMPASS_DB_PATH` | 系统用户数据目录 | 指定 SQLite 路径 |

`.env.example` 只展示变量名，根启动脚本不会自动加载 dotenv。真实路径或远端信息应由 shell、PowerShell 或服务管理器注入。Vite 专用的本地 Logo 开关可放入被忽略的 `apps/web/.env.local`。

## SSH 端口转发

在客户端预先通过独立渠道核验 SSH 主机指纹，并写入专用 `known_hosts`。随后只转发 Web 端口：

```bash
ssh -N -p SSH_PORT \
  -o PreferredAuthentications=publickey \
  -o PasswordAuthentication=no \
  -o KbdInteractiveAuthentication=no \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/absolute/path/to/project-known-hosts \
  -o IdentitiesOnly=yes \
  -i /absolute/path/to/project-ssh-key \
  -L 5173:127.0.0.1:5173 USER@HOST
```

客户端打开 `http://127.0.0.1:5173`。不要把 Web/API 改绑到 `0.0.0.0`，不要关闭严格主机密钥校验，也不要退回密码认证。

VS Code Remote 的端口转发同样只需发布 Web 端口，并保持端口可见性为 Private。

## 每日招聘维护

Linux 可从公开示例创建用户级 service：

```bash
mkdir -p ~/.config/systemd/user
cp automation/systemd/fall-recruitment-maintenance.service.example \
  ~/.config/systemd/user/fall-recruitment-maintenance.service
cp automation/systemd/fall-recruitment-maintenance.timer \
  ~/.config/systemd/user/fall-recruitment-maintenance.timer
```

把 service 中两处 `REPOSITORY_PATH` 都替换为仓库绝对路径，然后：

```bash
systemctl --user daemon-reload
systemctl --user enable --now fall-recruitment-maintenance.timer
systemctl --user list-timers fall-recruitment-maintenance.timer
```

任务需要本机网络和有效的 Codex 登录。若 Node、npm 或 Codex 由 nvm 等用户级工具安装，请在 service 中提供可见的 `PATH`，或为包装器设置可执行的 `CODEX_BIN`。工作树不干净时包装器会跳过；成功变更留在工作区供人工审核，不自动 commit 或 push。

Windows 原生环境可使用 `automation/windows/` 中的 PowerShell 计划任务脚本。WSL 项目应使用 Linux runner，避免从 Windows 工具直接修改 WSL 文件。

## 生产静态托管

运行 `npm run build` 后，可让 Node 服务同时托管 `apps/web/dist`：

```bash
AUTUMN_COMPASS_SERVE_WEB=1 npm run start -w @autumn-compass/server
```

PowerShell 7 使用：

```powershell
npm run build
$env:AUTUMN_COMPASS_SERVE_WEB = '1'
npm run start -w @autumn-compass/server
```

此时 Node 在 API 端口同时提供 Web，默认访问 `http://127.0.0.1:4174`；SSH 隧道也应转发 4174，而不是开发态的 5173。此模式仍只绑定回环地址。若需要长期远程访问，优先使用 VPN 或 SSH 隧道，而不是公网反向代理；该应用保存明文简历 PII，并未设计为公共多租户服务。
