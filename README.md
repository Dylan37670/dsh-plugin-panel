# Plugin Panel v6.14（插件面板）

DSH 社区插件市场面板 —— 在 DeepSeek Harness Web GUI 的**侧边栏底部**提供入口，点击打开**右侧抽屉**：浏览/搜索社区插件、Skill、客户端 UI 与开发资源，支持中文翻译、收藏与已安装管理，并通过官方 `dsh plugin` 命令完成安装 / 更新 / 卸载（含确认、备份与失败回滚）。

> **版本 v0.6.14**：修复精选目录的真实在线刷新。GitHub 的 `catalog-data` 数据分支现在同时发布 `catalog.json`（全部）和 `curated.json`（精选）；右上角刷新会下载当前源的在线 JSON，网络不可用才保留随包内置目录。精选标题会显示其生成时间，便于确认刷新是否真的取得新数据。
>
> **版本 v0.6.13**：修复旧的精选缓存遮住新版内置索引的问题；旧的小型缓存不会再覆盖当前精选目录。
>
> **版本 v0.6.11**：面板自更新。抽屉底部设置区新增「面板版本」小字行——显示**当前版本 / 最新版本 / 是否需要更新**（打开抽屉时自动检查上游 GitHub 仓库的 package.json，结果缓存 10 分钟）；发现新版本时旁边出现**「更新面板」按钮**（两段式确认），走与其他插件完全相同的受保护生命周期（备份 → `dsh plugin add` → 校验 → 失败回滚）；更新成功后该行变为「已更新到 vX · **重启 GUI 后生效**」的重启提醒。
>
> **版本 v0.6.10**：重构插件生命周期。完整 GitHub topic 目录只负责“发现”，只有作者/社区登记过准确 npm 包、GitHub 子目录或包源的条目才显示安装按钮；例如 `dsh-web-ui` 会安装作者指定的 `@linxin666/dsh-web-ui-all`，不再错误安装仓库工作区根目录。安装后分别校验 Profile Bundle 或兼容的 Cordis 用户层注册，现有手动注册插件会显示“已启用（用户配置）”。用户自己的 patch 不会被面板自动删除。
>
> v0.6.9 的云端向量目录同步与常驻重建按钮继续保留。
> **v6 新增：语义向量搜索** —— 搜索框旁「语义搜索」开关：关闭 = 关键词搜索；打开 = 向量语义检索（多语言）。默认连接**硅基流动 BAAI/bge-m3**，模型 / API 地址 / Key 可在设置中修改；目录向量索引构建一次后本地缓存（`~/.dsh/plugin-panel/vectors.json`），查询按余弦相似度排序。

v6.5 改进按需翻译：仅翻译进入视口的卡片；Harness LLM 使用小批量 JSONL 输出并对缺项逐条重试；结果按原文指纹缓存，目录描述变更后会自动重新翻译；LLM 不可用或仍有缺项时，以社区插件采用的 Google gtx 方式逐条回退。客户端使用持久队列，修复请求进行中因重渲染而漏掉下一批的问题。v6.4 的向量索引并发保护及 v6.3 的全量目录、流式事件和向量兼容修复均保留。

## 语义搜索（v6）

- **开关**：搜索框右侧「语义搜索」勾选框。
- **配置**：抽屉底部设置区「嵌入模型（语义搜索）」：API Key（必填）、模型（默认 `BAAI/bge-m3`）、API 地址（默认 `https://api.siliconflow.cn/v1`），保存后生效。
- **建立索引**：开启开关后，若本地无向量索引且已配置 Key，点击「建立向量索引」——host 端分批嵌入全部目录条目（3109 条，约 32 次请求）并落盘缓存；之后查询只嵌入用户输入（1 次请求）。
- **检索**：输入关键词（中/英文均可）→ host 嵌入查询 → 与缓存向量做余弦相似度 → 返回 Top 结果；与关键词搜索一样受分类/收藏/已安装筛选约束。
- **安全**：API Key 仅在明确点击“保存嵌入设置”后写入本地 `~/.dsh/plugin-panel/state.json`，请求直达配置的 embeddings 端点（默认硅基流动），面板不记录 Key。

## 功能

> **版本 v0.6.12**：独立目录 `v6.12/`（旧版本保留）。
> **v6.12–v6.14：精选目录采用预构建索引** —— `scripts/build-catalog.mjs --curated-only` 从官方 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 解析精选列表，生成 **`catalog/curated.json`**。该文件随插件发布，且由目录工作流同步到 `catalog-data`；面板“精选”目录秒级加载，手动刷新下载在线 JSON（当前随上游列表变化，不能把固定条目数当作刷新成功与否的依据）。
> **v3 架构（预构建离线索引）**：`scripts/build-catalog.mjs`（可续传、可配 token）服务端抓全 `dsh-plugin` topic 生成 **`catalog/catalog.json`** 随插件发布，面板“全部”目录秒级加载；刷新 = 下载一个文件。
>
> **覆盖完整性**：构建脚本对超过 1000 条的查询自动细分 —— 日期区间 → 单日按 `stars:` 区间 → 单星标值按 `size:` 区间，无法细分记入 `gaps` 并在 manifest 暴露覆盖率。

## 功能

- **入口**：侧边栏底部（设置上方）的 “插件面板” 按钮；窄栏（rail）态显示为图标。
- **右侧抽屉**：点击按钮打开固定右侧抽屉，点遮罩或关闭按钮收起。
- **双目录源**：搜索框下方「精选 / 全部」切换按钮，**鼠标悬停显示两者区别**：
  - **精选**：**预构建索引** `catalog/curated.json`（官方 awesome-dsh-plugin 精选列表），质量优先；启动使用内置/缓存，手动刷新从 `catalog-data/curated.json` 下载。
  - **全部**：启动先显示随包目录或本地缓存，再从 [`catalog-data`](https://github.com/Dylan37670/dsh-plugin-panel/tree/catalog-data) 数据分支下载一个 `catalog.json`；GitHub Actions 每小时更新，用户电脑不再运行全量爬虫。
- **目录缓存 + 手动刷新**：右上角刷新按钮按当前源拉取并写盘。
- **分类**：插件 / Skill / 客户端 / 开发资源（含计数）。
- **中英文关键词搜索**：标题、描述（中英）、标签、作者、仓库、npm 名均参与匹配。
- **排序（v4）**：默认 / 星标最多 / 星标最少 / 名称 A-Z / 名称 Z-A / 最新创建 / 最早创建，持久化到设置。
- **描述中文翻译**：精选条目内置人工翻译；一键切换 中文 / EN。
- **收藏管理**：星标收藏，持久化于 `~/.dsh/plugin-panel/state.json`；可筛选“只看收藏”。
- **操作记录**：默认两条、可展开最近 100 条或一键清空；保存在 `~/.dsh/plugin-panel/operations.json`，不保存命令原始输出或 API Key。
- **已安装管理**：同时读取 profile 的依赖、bundle 列表、`cordis.patch.yml` 用户层注册以及 `~/.dsh/skills`；区分已启用 Bundle、已启用（用户配置）、Skill 和仅下载依赖。
- **安装 / 更新 / 卸载（官方命令）**：调用 `dsh plugin --profile <profile> add|remove <spec>`。
  - **确认**：按钮两段式确认（再点一次才执行）。
  - **备份**：操作前把 profile 的 `package.json` / `cordis.patch.yml` / `pnpm-lock.yaml` 复制到 `~/.dsh/plugin-panel/backups/<时间戳>/`。
  - **结果校验与回滚**：退出码为 0 仍会检查真实包名、入口产物与激活状态；官方 Bundle 校验 patch 与 profile bundles，兼容型 Host 插件校验可加载的 `apply` 后写入带面板标记的用户层注册。失败自动恢复备份。GitHub/link 更新复用原 spec，卸载使用真实包名。
- **环境自检**：抽屉顶部显示 dsh CLI / pnpm 是否可用；pnpm 缺失时一键安装。
- **安全**：HTTP API 仅接受 loopback 请求；安装来源为目录中列出的官方仓库 / npm 包（不执行任意命令，只转发到官方 `dsh plugin`）。

## 云端目录构建（维护者用）

```sh
npm run build                                   # 先构建 lib
node scripts/build-catalog.mjs --reset          # 全量重建（可续传，断点续跑）
node scripts/validate-catalog.mjs catalog/catalog.json
# 可选：GITHUB_TOKEN=<token> node scripts/build-catalog.mjs   # 提速（30 次/分钟）
# 产物：catalog/catalog.json（manifest 含覆盖率）
```

`.github/workflows/update-catalog.yml` 由 Hermes 在每小时第 17 分钟触发，并在每天 08:47 / 20:47（中国时间）备用运行，也可手动触发。发布前必须满足 schema 正确、ID 唯一、`gaps=0`，且抓取数相对上一版不异常低于 95%；GitHub Search 的瞬时 `total_count` 仅供展示，不作为失败门槛。成功后只更新独立 `catalog-data` 分支中的两份 JSON。

> 安装/卸载后需要**重启 GUI** 才加载/卸载插件本体（DSH 的 bundle 机制如此）；面板自身在重启前仍可继续浏览。

## 安装

使用官方 DSH 插件命令从 GitHub 安装：

```sh
dsh plugin --profile web add github:Dylan37670/dsh-plugin-panel
```

安装或更新后重启 DSH Web GUI，侧边栏底部会出现“插件面板”。

开发者从源码构建：

```sh
# 克隆并进入仓库
git clone https://github.com/Dylan37670/dsh-plugin-panel.git
cd dsh-plugin-panel
npm install
npm run build && npm test

# 挂载本地源码
dsh plugin --profile web add .

# 验证挂载
dsh --profile web --dump-config | grep plugin-panel-market

# 重启 GUI 后，侧边栏底部出现“插件面板”入口
```

## 目录结构

```
dsh-plugin-panel/
├── package.json          # bundle 声明（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml      # profile 插入行
├── tsconfig.json
├── src/
│   ├── index.ts          # host 入口：注册 /api/plugin-panel 路由
│   ├── catalog.ts        # 目录服务：远程拉取 + 解析 + 磁盘缓存 + seed 合并
│   ├── catalog-data.ts   # 精选 seed 目录（含中文翻译）
│   ├── installed.ts      # bundles + dependencies + skills 状态检测
│   ├── state.ts          # 收藏 + 深度合并设置持久化
│   ├── operations.ts     # 本地操作记录（最多 100 条）
│   ├── lifecycle.ts      # dsh plugin 转发、结果校验、备份、回滚
│   ├── http.ts           # HTTP 路由（loopback only）
│   ├── types.ts          # 共享 JSON 类型
│   └── client/client.js  # client half（模块加载器格式，React 手写）
├── scripts/copy-client.mjs
└── tests/                # catalog / lifecycle / register 契约测试
```

## 架构

| 端 | 职责 | 通信 |
|---|---|---|
| Host | 目录缓存/刷新、安装/更新/卸载（`dsh plugin`）、备份回滚、收藏状态 | 注册 `webServer` 前缀路由 `/api/plugin-panel/*`（仅 loopback） |
| Client | 侧边栏入口 + 右侧抽屉 UI | 同源 `fetch` 到上述 HTTP API |

插槽使用：`sidebar.footer.action`（入口，`id: plugin-panel-market`）；抽屉由同一组件用固定定位渲染（与内置 Cordis 面板同款做法），不占用额外插槽。

## 测试

```sh
npm run build   # tsc + 拷贝 client bundle
npm test        # catalog 解析/合并、状态持久化、备份回滚、注册契约
```

## 真实 Harness 运行验证（v0.1.0）

在隔离的 `DSH_HOME` 下用官方命令初始化独立 profile `panel-runtime` 并挂载本插件，
启动第二个 `dsh web`（端口 3081）做端到端验证：

| 验证项 | 结果 |
|---|---|
| `dsh plugin add` 挂载 + `--dump-config` 出现 `plugin-panel-market` 行 | ✅ |
| `GET /api/plugin-panel/catalog`（seed 64 条） | ✅ |
| `POST /refresh` 拉取真实 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 列表 → 538 条、1.7s、分类正确 | ✅ |
| 目录磁盘缓存（`plugin-panel/catalog.cache.json`） | ✅ |
| `/favorite` 收藏持久化（`plugin-panel/state.json`） | ✅ |
| `/installed` 按 profile 读取 bundles + skills | ✅ |
| 安装 fixture 插件 → bundles 追加 + `/installed` 反映 | ✅ |
| 卸载 → bundles 还原 | ✅ |
| 失败安装（不存在路径）→ `rolledBack: true`，备份恢复，bundles 还原 | ✅ |
| client bundle 经 `clientModules` 由 `/plugins/@dsh-community/plugin-panel/client.js` 提供（200） | ✅ |
| `node --check` client bundle 语法 | ✅ |
| `npm run typecheck` + `npm test`（14 用例） | ✅ |

> 侧边栏入口 + 抽屉的浏览器内视觉验证需在**重启 GUI**（`dsh web`）后进行：
> 本插件已挂载进真实 web profile，重启后即可在侧边栏底部看到“插件面板”入口。

## 真实 Harness 运行验证（v0.2.0）

v2 在隔离 DSH 实例（端口 3081）与真实 web profile 双重验证：

| 验证项 | 结果 |
|---|---|
| v1 全部验证项（目录/缓存/收藏/已安装/安装卸载/回滚/client 服务） | ✅（继承） |
| pnpm 检测修复（Windows `cmd` 解析 `pnpm.cmd`）→ `/env` `pnpmFound: true` | ✅ |
| `GET /catalog?lens=curated`（538 条，命中磁盘缓存） | ✅ |
| `POST /refresh {lens:'all'}` GitHub topic 检索 → **1020 条、totalHits 3058**、20s | ✅ |
| 全部仓库分类：plugin 672 / client 198 / skill 81 / dev-resource 69 | ✅ |
| client UI 冒烟测试（真实 bundle + jsdom）：入口按钮、抽屉、搜索、5 分类 tab、设置、**精选/全部仓库切换按钮 + 悬停 data-tip** | ✅ |
| `npm run typecheck` + `npm test`（18 用例） | ✅ |

> v0.1.0 的原始验证记录见 [v1 README](../v1/dsh-plugin-panel/README.md)。

## 兼容性

社区星标前十插件与本面板的静态兼容性检查见 [COMPATIBILITY.md](COMPATIBILITY.md)。v6.10 不再把所有 topic 仓库根目录假定为可安装 Bundle；没有可靠安装目标的候选条目只提供项目链接。

## 致谢 / Credits

- 目录数据来源：[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（社区精选列表）、[dsh-market registry snapshot](https://github.com/dsh-market/dsh-market/blob/main/data/registry-snapshot.json)（准确安装目标）与 [omdsh-dev](https://github.com/omdsh-dev) 组织仓库的 README 描述。这里只读取并标注数据来源，不复制其他市场的实现代码。
- 参考了同类项目的优秀思路（未复制代码）：[dsh-market](https://github.com/dsh-market/dsh-market)（一键安装/更新/卸载、重启提示、pnpm 自检）、[dsh-store](https://github.com/huguangyu666/dsh-store)（npm+awesome 双源目录、官方命令安装）、[dsh-plugin-workshop](https://github.com/yyyyukari/dsh-plugin-workshop)（中文关键词映射、双语描述）、[dsh-plugin-manager](https://github.com/Jesse-njx/dsh-plugin-manager)（多源搜索、doctor 审计）、[dsh-webui-market-plugin](https://github.com/Sanqi-normal/dsh-webui-market-plugin)。UI 采用侧边栏入口 + 抽屉的交互形态是原创设计。
- DSH 平台机制参考：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 官方仓库与 [dsh-plugin-dev](https://github.com/omdsh-dev/dsh-plugin-dev) 开发档案。

## License

MIT（见 LICENSE）。目录条目与其描述归各自项目所有。
