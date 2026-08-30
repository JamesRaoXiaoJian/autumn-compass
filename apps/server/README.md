# Autumn Compass server

本服务把浏览器中的 `autumn-compass-*` 工作区记录保存到服务器 SQLite，并通过 SSE 通知其他页面重新读取服务端 canonical 数据。默认仅监听 `127.0.0.1:4174`，不会暴露到局域网。

## 启动

在仓库根目录安装依赖后：

```bash
npm run start -w @autumn-compass/server
```

SQLite 默认存放在仓库外：Linux/WSL 为 `${XDG_DATA_HOME:-$HOME/.local/share}/autumn-compass/workspace.sqlite`，Windows 为 `%LOCALAPPDATA%\autumn-compass\workspace.sqlite`。这样 Git 不会误收录简历或个人流程状态；如显式把数据库放到 `apps/server/data/`，数据库、WAL 和 SHM 文件也会被本目录的 `.gitignore` 排除。可用环境变量：

- `AUTUMN_COMPASS_API_HOST`：API 监听地址，只允许 `127.0.0.1`；兼容旧名 `AUTUMN_COMPASS_SERVER_HOST`。
- `AUTUMN_COMPASS_API_PORT`：API 监听端口，默认 `4174`；兼容旧名 `AUTUMN_COMPASS_SERVER_PORT`。
- `AUTUMN_COMPASS_DB_PATH`：数据库文件路径。
- `AUTUMN_COMPASS_SERVE_WEB=1`：同时托管 `apps/web/dist`，适合生产构建。
- `AUTUMN_COMPASS_WEB_DIST`：指定其他静态目录，并自动启用静态托管。

服务只允许监听 `127.0.0.1`。跨端访问应继续使用 VS Code 或 SSH 端口转发。

## API

所有 workspace 值保持为浏览器 `localStorage` 的原始字符串，键必须以 `autumn-compass-` 开头。写请求带稳定的 `clientId`；`baseRevision` 可选，用于乐观并发控制。revision 不一致时返回 HTTP 409，客户端应先重新 `GET /api/workspace`。

- `GET /api/health`
- `POST /api/workspace/bootstrap`：`{ "items": {...}, "clientId": "..." }`。数据库从未初始化且客户端提供至少一条记录时原子导入；空浏览器不会抢占初始化权。否则返回服务端 canonical 快照。
- `GET /api/workspace`
- `PUT /api/workspace/item`：`{ "key": "autumn-compass-...", "value": "...", "clientId": "...", "baseRevision": 1 }`
- `DELETE /api/workspace/item`：`{ "key": "autumn-compass-...", "clientId": "...", "baseRevision": 1 }`
- `PUT /api/workspace`：`{ "items": {...}, "clientId": "...", "baseRevision": 1 }`，原子全量替换。
- `GET /api/events`：SSE。监听 `ready` 与 `workspace` 命名事件；收到 `workspace` 后重新获取 canonical 快照。

限制：最多 512 条记录；单值 8 MiB；workspace 12 MiB；请求体 32 MiB（为全站备份中的 JSON 转义预留空间）。接口拒绝额外字段、非字符串值和不属于本项目的键。
