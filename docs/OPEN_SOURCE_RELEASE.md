# 开源发布清单

## 重要：当前树干净不等于历史干净

如果仓库过去提交过简历、论文、联系方式、内推参数或私人主机配置，普通的“删除文件并提交”只会从最新版本移除它们，旧 commit 仍可下载。此类仓库不应直接切换为 Public。

最稳妥的方案是：保留原仓库为 Private，并从已经净化的 `HEAD` 创建一个没有旧历史的新公开仓库。

## 发布前检查

```bash
npm ci
npm run verify
git status --short
```

确认：

- `npm run check:public` 通过；
- 截图来自临时数据库；
- Git 状态干净；
- 没有 SQLite、JSON 导出、简历、论文、密钥或私人同步配置；
- 扩展没有 `<all_urls>`、持久 content script 或自动提交行为；
- 公司 Logo 和其他第三方资产有明确再分发许可，否则不发布。

## 创建干净历史

以下流程只导出当前 commit 的跟踪文件，不复制 `.git` 历史或 ignored 本地资料：

```bash
PUBLIC_DIR="$(mktemp -d)"
git archive --format=tar HEAD | tar -xf - -C "$PUBLIC_DIR"
cd "$PUBLIC_DIR"
git init -b main
git add .
npm ci
npm run verify
git commit -m "chore: initial open-source release"
git remote add origin NEW_PUBLIC_REPOSITORY
git push -u origin main
```

建议使用与私人仓库不同的新远端。提交前可把本仓库 Git 身份配置为 GitHub 的 noreply 地址，避免公开 commit 元数据泄露私人邮箱。

不要在没有备份和明确评估的情况下重写现有私人远端历史。即使强制推送删除了可见分支，托管缓存、fork、旧 pull request 或其他引用仍可能保留对象；已经暴露过的凭据应直接轮换，而不是只依赖历史清理。

## 发布后

- 启用 GitHub private vulnerability reporting、Dependabot 和 secret scanning；
- 检查仓库首页截图、Release assets、Actions 日志和贡献模板；
- 用全新 clone 再运行 `npm ci && npm run verify`；
- 只把公开仓库用于代码协作，真实求职状态仍保存在本机 SQLite 或客户端加密快照中。
