# 本地数据与隐私

## 什么保存在哪里

| 数据 | 默认位置 | 是否进入 Git |
| --- | --- | --- |
| 公开招聘种子与代码 | 仓库 | 是 |
| 岗位状态、删除记录、面试、笔记、简历文档 | 本地 SQLite | 否 |
| Web 完整备份 | 用户选择的 JSON 文件 | 否；明文敏感文件 |
| 插件资料 | `chrome.storage.local` | 否 |
| 插件导出 | 用户选择的 JSON 文件 | 否；明文敏感文件 |
| 公司 Logo 本地覆盖 | `apps/web/public/company-logos/` | 默认否 |
| 加密跨设备快照 | 固定私人同步目录中的 `.age` 文件 | 否 |

默认数据库位置：

- Linux / WSL：`${XDG_DATA_HOME:-$HOME/.local/share}/autumn-compass/workspace.sqlite`
- Windows：`%LOCALAPPDATA%\autumn-compass\workspace.sqlite`

可以用 `AUTUMN_COMPASS_DB_PATH` 指定已有数据库：

```bash
AUTUMN_COMPASS_DB_PATH=/absolute/path/to/workspace.sqlite npm run dev
```

数据服务启动时设置私有 umask；默认数据目录和数据库文件使用当前系统账号的受限权限。自定义路径仍应放在仅本人可读的目录，并配合全盘加密。

## 保留本地资料、公开源码

把私人目录加入 `.gitignore` 并从 Git 索引移除，只会停止版本跟踪，不会删除工作区中的实际文件。`git rm --cached` 与普通 `git rm` 不同：前者保留磁盘文件。可以用以下命令验证某个本地文件仍存在且已被忽略：

应用生成的 `*-resume.json`、`*-resume.md`、`autumn-compass-workspace-*.json` 和 `autumn-compass-profile*.json` 都属于明文私人导出，根目录忽略规则和公开树检查会共同阻止它们进入发布快照。

```bash
test -f PATH_TO_LOCAL_FILE
git check-ignore -v PATH_TO_LOCAL_FILE
```

开源发布前运行：

```bash
npm run check:public
```

该检查保护当前公开树，但不能清除旧提交；历史处理见 [开源发布清单](OPEN_SOURCE_RELEASE.md)。

## 备份与恢复

首选应用内的“全站备份 / 恢复全站”：

1. 在简历资料库导出 canonical workspace JSON。
2. 把 JSON 视为明文简历资料，不上传到代码仓库或普通网盘。
3. 在目标服务启动后，通过“恢复全站”选择该文件。
4. 恢复是带 revision 检查的原子替换；若期间有其他修改，应用会拒绝覆盖。

如果必须复制原始 SQLite，请先完全停止 API，并把数据库、可能存在的 `-wal` 与 `-shm` 作为同一组处理。不要在服务运行时复制，也不要通过 Git 同步。

## 加密跨设备同步

`scripts/private-sync/private-sync.sh` 与 `automation/windows/private-sync/Private-Sync.ps1` 只接受规定命名的 Web/插件 JSON 导出。客户端先用独立的 `age` 收件人加密，再通过只允许公钥认证、严格校验主机指纹的 SSH 连接上传不可变快照。

真实远端、端口、指纹、私钥路径和 age identity 必须来自进程环境或本机忽略配置，不能写入仓库。详细配置见 [私人同步](PRIVATE_SYNC.md)。

## 截图与日志

公开截图应使用隔离临时数据库或虚构数据。不要公开浏览器控制台、服务器日志、数据库投影或真实招聘页截图，除非逐项确认其中没有姓名、邮箱、电话、内推参数、会议入口和私人备注。
