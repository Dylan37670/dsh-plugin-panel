# 给 Hermes：目录更新定时任务

请为 GitHub 仓库 `Dylan37670/dsh-plugin-panel` 配置并维护下面这一项定时任务。

## 目标

每小时更新一次 `catalog-data` 数据分支中的 `catalog.json`，供插件面板的“全部”目录下载。不要改动插件的 `main` 分支代码或版本号。

## 调度时间

- 时区：`Asia/Shanghai`（中国标准时间）。
- 每小时第 17 分钟执行一次，例如 `10:17`、`11:17`、`12:17`。
- GitHub Actions 自身还保留每天 `08:47` 和 `20:47` 的备用更新；不要删除它们，也不要在 `:47` 额外触发一次。

## 每次执行的步骤

1. 先查询仓库中工作流 `Update full catalog` 是否已有 `queued` 或 `in_progress` 的运行。
2. 若已有运行：本次跳过，不取消、不重跑，也不通知用户。
3. 若没有运行：仅触发 `main` 分支上的 `Update full catalog` 工作流（`workflow_dispatch`）。
4. 等待这次运行结束，最多 20 分钟；目录通常约 7–10 分钟完成。
5. 成功时不发消息。

可使用的命令示例（以实际 Hermes 的 GitHub 授权方式为准）：

```powershell
gh run list --repo Dylan37670/dsh-plugin-panel --workflow update-catalog.yml --limit 20
gh workflow run update-catalog.yml --repo Dylan37670/dsh-plugin-panel --ref main
```

## 失败与通知规则

- 单次失败只记录运行链接和末尾错误，不要重复触发，也不要立即打扰用户。
- 连续两次失败时，才通知用户一次；内容包括 Actions 链接、失败步骤和最后约 20 行错误。
- 连续失败期间，仍按每小时一次检查，但不要自行修改任何阈值、工作流、代码或 `catalog-data` 分支。
- 后续一次成功后，清除连续失败计数。

## 不要做的事

- 不要把 GitHub Search API 的 `total_count` / 覆盖率百分比改成发布条件。
- 不要把 `99.5%`、`99%` 或任何类似固定百分比作为失败阈值。
- 不要直接编辑或覆盖 `catalog-data/catalog.json`；只能由 `Update full catalog` 工作流发布。
- 不要取消正在运行的目录任务，不要修改 Release，不要修改插件包版本。

## 说明

GitHub Search 返回的总数会在长时间抓取期间变化，因此它只用于界面展示。目录能否发布由工作流中的这些稳定条件决定：分桶没有缺口、JSON/schema/ID 合法、且相对上一份成功目录没有超过 5% 的异常抓取缩水。插件面板的“手动刷新”只下载已经发布的 JSON，不需要也不应该重新触发 GitHub 全量爬取。
