# Security policy

## Supported version

安全修复面向 `main` 的最新版本。

## Reporting a vulnerability

请使用仓库的 GitHub Security Advisory 私下报告漏洞。不要在公开 issue 中粘贴工作区导出、简历、SSH 配置、浏览器会话或可用凭据。报告中只保留复现所需的最小匿名信息。

## Security model

- Web 与数据 API 默认且强制绑定 `127.0.0.1`；跨设备访问应转发 Web 端口，不直接暴露 API。
- SQLite 是明文私有数据，应放在仓库外并依赖操作系统磁盘加密与访问控制。
- Chrome 扩展使用 `activeTab` 临时权限，仅在用户点击后注入；它不会自动提交申请。
- 浏览器缓存不是权威数据源。已初始化的服务器 SQLite 快照优先于旧缓存，空浏览器不能静默覆盖服务器。
- 私人同步要求 SSH 公钥认证、严格主机指纹校验和客户端侧 `age` 加密。

更多边界见 [数据与隐私](docs/DATA_PRIVACY.md)。
