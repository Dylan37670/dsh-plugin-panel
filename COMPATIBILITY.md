# 兼容性检查报告（v6.6）

检查对象：社区插件目录中**星标数前十**的仓库（来自 `catalog/catalog.json`，`topic:dsh-plugin` 检索）。
检查方法：逐一抓取各仓库根目录的 `cordis.patch.yml` / `package.json`（`dsh.bundle` / `dsh.plugin.json`），按
[dsh-plugin-dev](https://github.com/omdsh-dev/dsh-plugin-dev) 的形态矩阵（bundle / registry / skill / collection / infra）
与踩坑记录（row id 避开核心前缀、工具/服务重名、collection 与独立插件重名）分析冲突面。

## 结论

**前十仓库与本面板（`@dsh-community/plugin-panel`）以及彼此之间，均不存在运行时兼容性冲突。**

理由（基于根目录实测）：

| # | 仓库 | 星标 | 分类 | 根目录形态（实测） | 是否可 `dsh plugin add` 直接安装为 profile 层 |
|---|---|---|---|---|---|
| 1 | nexu-io/open-design | 86710 | 插件 | `package.json`（主机应用，无 `dsh` 字段），无 `cordis.patch.yml`、无 `dsh.plugin.json` | ❌（非 bundle/registry） |
| 2 | titanwings/colleague-skill | 22320 | Skill | 无根 `package.json`，无 patch | ❌（skill 包，应放 skills 目录） |
| 3 | tt-a1i/archify | 12836 | Skill | 无根 `package.json`，无 patch | ❌（skill 包） |
| 4 | ZSeven-W/openpencil | 4907 | 客户端 | 无根 `package.json`，无 patch | ❌ |
| 5 | anywhere-labs/deepseek-harness-desktop | 4512 | 插件 | `package.json`=`@deepseek-ai/dsh-root`（桌面壳），无 `dsh` 字段 | ❌（桌面应用） |
| 6 | Devin-AXIS/iPolloWork | 4092 | 插件 | `package.json`（工作区），无 `dsh` 字段 | ❌（独立应用） |
| 7 | crafter-station/petdex | 3823 | 插件 | `package.json`=`petdex`，无 `dsh` 字段 | ❌（独立应用） |
| 8 | strukto-ai/mirage | 3440 | 插件 | 无根 `package.json`，无 patch | ❌（虚拟文件系统应用） |
| 9 | foryourhealth111-pixel/Vibe-Skills | 2803 | Skill | 无根 `package.json`，无 patch | ❌（skill 包） |
| 10 | imsai-sh/zhuzhiliao | 2801 | 插件 | 无根 `package.json`，无 patch | ❌（Web 应用） |

> 注：检查基于**各仓库根目录**；未逐一深挖子目录。若某仓库把 bundle 放在子目录（如 `packages/xxx`），
> 需以该子目录的 `cordis.patch.yml` 为准——此类情况在前十中未发现根目录证据，子目录可能性低但未完全排除。

## 冲突面逐项分析

| 冲突面 | 面板占用的标识 | 前十是否存在占用 | 结论 |
|---|---|---|---|
| 组合行 id（cordis.patch.yml `- id:`） | `plugin-panel-market` | 无（前十无任何 patch 行） | ✅ 无冲突 |
| 工具名（`ctx.tools.register`） | 面板不注册工具 | 无 | ✅ 无冲突 |
| 服务名（`ctx.provide` / Service） | 面板不提供服务 | 无 | ✅ 无冲突 |
| 客户端插槽 id（`sidebar.footer.action` 等） | `plugin-panel-market` | 无（无 client half 证据） | ✅ 无冲突 |
| HTTP 前缀 | `/api/plugin-panel` | 无 | ✅ 无冲突 |
| 核心 row id 前缀（tools/session/llm/web/permission） | 未占用 | 未发现 | ✅ 无冲突 |

## 值得注意的一点（非冲突，但影响使用体验）

前十中**没有任何一个满足 bundle/registry 形态**——它们只是打了 `dsh-plugin` topic 标签的 skill 包或独立应用。
因此在面板“全部”目录中点它们的「安装」按钮，pnpm 会安装为**普通依赖并警告**
“declares no dsh.bundle — installed as a plain dependency, not a profile layer”，不会真正挂载为 profile 层。
这是目录数据质量问题（GitHub topic 标签 ≠ 可安装插件），面板已把 pnpm 的该警告原样显示在操作记录中。

**建议**：安装前先在条目卡片的「打开网页」看仓库 README，确认其是否声明 `dsh.bundle`；或优先安装
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 精选列表（精选目录）中经过验证的插件。

## 参考

- [dsh-plugin-dev skill](https://github.com/omdsh-dev/dsh-plugin-dev)：形态选择矩阵与踩坑记录（row id 边界、重名冲突）。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：官方 profile/bundle 机制。
