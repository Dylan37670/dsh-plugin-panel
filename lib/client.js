/*
 * Plugin Panel — client half.
 *
 * Hand-written bundle in the DSH client module format:
 *   window.__ModuleLoader__.load({ id, factory(require) })
 *
 * The loader's `require` resolves the platform seed words ("react",
 * "react/jsx-runtime", …) and registered client packages. Only `react` is
 * used here; every bit of UI is plain React.createElement + an injected
 * <style> tag, mirroring the pattern shipped client packages use.
 *
 * Surfaces:
 *  - `sidebar.footer.action` (id `plugin-panel-market`): the sidebar entry.
 *  - The right-side drawer is rendered by the same entry with a fixed overlay
 *    (the same approach the shipped Cordis panel uses), so no extra slot is
 *    needed and the drawer never blocks the shell underneath.
 *
 * All data flows through the host HTTP API at /api/plugin-panel/*.
 */
window.__ModuleLoader__.load({
  id: "@dsh-community/plugin-panel",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");

    // ── styles ────────────────────────────────────────────────────────────
    var css = [
      ".pp-drawer{position:fixed;top:0;right:0;bottom:0;width:480px;max-width:94vw;z-index:120;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#ffffff);border-left:1px solid var(--dsw-alias-border-l1,#e5e7eb);box-shadow:-8px 0 32px rgba(0,0,0,.18);font-family:inherit;color:var(--dsw-alias-label-primary,#1f2328);--pp-scroll:var(--dsh-scrollbar-thumb,var(--dsw-alias-scrollbar-bg-l2,#d0d5dd))}",
      ".pp-backdrop{position:fixed;inset:0;z-index:119;background:rgba(0,0,0,.28)}",
      ".pp-header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#eceff3);flex:none}",
      ".pp-header h1{font-size:15px;font-weight:600;margin:0;flex:none}",
      ".pp-cached{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a919b);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".pp-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer;flex:none}",
      ".pp-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover,#f0f2f5)}",
      ".pp-iconbtn:disabled,.pp-srcbtn:disabled{opacity:.5;cursor:not-allowed}",
      ".pp-env{display:flex;align-items:center;gap:6px;padding:6px 14px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a919b);border-bottom:1px solid var(--dsw-alias-border-l2,#eceff3);flex:none;flex-wrap:wrap}",
      ".pp-env-bad{color:var(--dsw-alias-state-error-primary,#d03050)}",
      ".pp-env button{font-size:11px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-base,#fff);border-radius:6px;padding:2px 8px;cursor:pointer}",
      ".pp-search{padding:10px 14px 4px;flex:none}",
      ".pp-search input{width:100%;box-sizing:border-box;height:34px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-base,#fff);padding:0 12px;font-size:13px;color:inherit;outline:none}",
      ".pp-search input:focus{border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}",
      ".pp-searchrow{display:flex;align-items:center;gap:8px;padding:10px 14px 4px;flex:none}",
      ".pp-searchrow input[type=search]{flex:1;min-width:0;box-sizing:border-box;height:34px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-base,#fff);padding:0 12px;font-size:13px;color:inherit;outline:none}",
      ".pp-searchrow input[type=search]:focus{border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}",
      ".pp-sem{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer;flex:none;white-space:nowrap}",
      ".pp-sem input{accent-color:var(--dsw-alias-state-business-primary,#4d6bfe)}",
      ".pp-sembar{display:flex;align-items:center;gap:8px;padding:0 14px 6px;flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a919b);flex-wrap:wrap}",
      ".pp-sembtn{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-base,#fff);border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;color:var(--dsw-alias-label-secondary,#4b5563)}",
      ".pp-sembtn[data-busy]{color:var(--dsw-alias-state-business-primary,#4d6bfe)}",
      ".pp-tabs{display:flex;gap:6px;padding:8px 14px 4px;flex:none;flex-wrap:wrap}",
      ".pp-tab{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:transparent;border-radius:999px;padding:4px 12px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-secondary,#4b5563)}",
      ".pp-tab[data-on]{background:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:transparent;color:#fff}",
      ".pp-filters{display:flex;align-items:center;gap:10px;padding:6px 14px 8px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563);flex-wrap:wrap}",
      ".pp-srcrow{display:flex;align-items:center;gap:8px;padding:0 14px 6px;flex:none;flex-wrap:wrap}",
      ".pp-srcbtn{position:relative;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:transparent;border-radius:8px;padding:4px 12px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-secondary,#4b5563)}",
      ".pp-srcbtn[data-on]{background:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:transparent;color:#fff}",
      ".pp-srcbtn:hover::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 8px);left:0;z-index:300;width:270px;background:#1f2328;color:#f5f6f8;font-size:12px;line-height:18px;font-weight:400;padding:9px 11px;border-radius:8px;border:1px solid rgba(255,255,255,.14);box-shadow:0 6px 22px rgba(0,0,0,.4);pointer-events:none;white-space:normal;text-align:left}",
      ".pp-srccount{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a919b)}",
      ".pp-srccount[data-busy]{color:var(--dsw-alias-state-business-primary,#4d6bfe)}",
      ".pp-fetchall{color:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}",
      ".pp-fetchall:hover{background:var(--dsw-alias-state-business-primary,#4d6bfe);color:#fff}",
      ".pp-sortrow{display:flex;align-items:center;gap:8px;padding:0 14px 6px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563)}",
      ".pp-sortrow select{height:26px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-base,#fff);font-size:12px;color:inherit;max-width:200px}",
      ".pp-filters label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}",
      ".pp-filters .pp-spacer{flex:1}",
      ".pp-langbtn{border:none;background:transparent;cursor:pointer;font-size:12px;color:var(--dsw-alias-state-business-primary,#4d6bfe)}",
      ".pp-body{flex:1;min-height:0;overflow-y:auto;padding:4px 14px 12px}",
      ".pp-note{color:var(--dsw-alias-label-tertiary,#8a919b);font-size:12px;padding:18px 4px;text-align:center}",
      ".pp-card{border:1px solid var(--dsw-alias-border-l2,#eceff3);border-radius:12px;padding:10px 12px;margin-top:8px}",
      ".pp-card-head{display:flex;align-items:flex-start;gap:8px}",
      ".pp-card-title{font-size:13px;font-weight:600;flex:1;min-width:0;line-height:18px}",
      ".pp-card-title a{color:inherit;text-decoration:none}",
      ".pp-card-title a:hover{text-decoration:underline}",
      ".pp-badges{display:inline-flex;gap:4px;flex:none;align-items:center}",
      ".pp-cat{font-size:10px;border-radius:4px;padding:1px 6px;background:var(--dsw-alias-interactive-bg-hover,#f0f2f5);color:var(--dsw-alias-label-secondary,#4b5563)}",
      ".pp-stars{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a919b)}",
      ".pp-fav{border:none;background:none;cursor:pointer;font-size:15px;line-height:1;padding:2px;color:var(--dsw-alias-label-tertiary,#8a919b)}",
      ".pp-fav[data-on]{color:#f5a623}",
      ".pp-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#4b5563);margin:6px 0 0}",
      ".pp-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}",
      ".pp-tag{font-size:10px;border-radius:4px;padding:1px 6px;background:var(--dsw-alias-interactive-bg-hover,#f0f2f5);color:var(--dsw-alias-label-tertiary,#8a919b)}",
      ".pp-actions{display:flex;gap:6px;margin-top:8px;align-items:center}",
      ".pp-act{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-base,#fff);border-radius:8px;padding:3px 10px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-secondary,#4b5563)}",
      ".pp-act:hover{background:var(--dsw-alias-interactive-bg-hover,#f0f2f5)}",
      ".pp-act[data-primary]{background:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:transparent;color:#fff}",
      ".pp-act[data-danger]{color:var(--dsw-alias-state-error-primary,#d03050)}",
      ".pp-act[data-armed]{outline:2px solid var(--dsw-alias-state-error-primary,#d03050);outline-offset:1px}",
      ".pp-openlink{display:inline-flex;align-items:center;gap:4px;text-decoration:none;color:var(--dsw-alias-state-business-primary,#4d6bfe)}",
      ".pp-installed{font-size:11px;color:var(--dsw-alias-state-success-primary,#1a7f37);margin-left:auto}",
      ".pp-ops{border-top:1px solid var(--dsw-alias-border-l2,#eceff3);padding:8px 14px;flex:none;max-height:140px;overflow-y:auto;font-size:11px;color:var(--dsw-alias-label-secondary,#4b5563)}",
      ".pp-ops-head{display:flex;align-items:center;margin-bottom:4px}",
      ".pp-ops h3{margin:0;flex:1;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a919b)}",
      ".pp-ops-btn{border:0;background:transparent;color:inherit;cursor:pointer;padding:1px 5px;font-size:13px}",
      ".pp-ops[data-expanded]{max-height:280px}",
      ".pp-op{display:flex;gap:6px;align-items:baseline;padding:2px 0}",
      ".pp-op[data-state=ok]{color:var(--dsw-alias-state-success-primary,#1a7f37)}",
      ".pp-op[data-state=error]{color:var(--dsw-alias-state-error-primary,#d03050)}",
      ".pp-op-detail{color:var(--dsw-alias-label-tertiary,#8a919b);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".pp-settings{border-top:1px solid var(--dsw-alias-border-l2,#eceff3);padding:10px 14px;flex:none;display:flex;flex-direction:column;gap:6px;font-size:12px}",
      ".pp-settings-row{display:flex;gap:6px;align-items:center}",
      ".pp-settings-row input{flex:1;min-width:0;box-sizing:border-box;height:28px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);padding:0 8px;font-size:12px;background:var(--dsw-alias-bg-base,#fff);color:inherit}",
      ".pp-settings-row select{height:28px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-base,#fff);font-size:12px;color:inherit}",
      ".pp-save{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);padding:2px 10px;font-size:12px;cursor:pointer}",
      ".pp-railbtn{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;border:none;background:transparent;cursor:pointer;color:var(--dsw-alias-label-primary,#1f2328)}",
      ".pp-railbtn:hover{background:var(--dsw-alias-interactive-bg-hover,#f0f2f5)}",
      ".pp-railbtn[data-on]{background:var(--dsw-alias-interactive-bg-hover-solid,#e6e9ee)}",
      ".pp-footbtn{display:inline-flex;align-items:center;width:100%;height:49px;gap:8px;padding:0 8px 0 6px;border:none;background:none;border-radius:12px;cursor:pointer;color:var(--dsw-alias-label-primary,#1f2328);font-size:14px;font-family:inherit}",
      ".pp-footbtn:hover{background:var(--dsw-alias-interactive-bg-hover-solid,#e6e9ee)}",
      ".pp-footbtn[data-on]{background:var(--dsw-alias-interactive-bg-hover,#eef0f4)}",
      ".pp-label{flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".pp-count{font-size:12px;color:var(--dsw-alias-label-tertiary,#8a919b);flex:none;font-variant-numeric:tabular-nums}"
    ].join("");
    var cssId = "@dsh-community/plugin-panel/panel.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(cssId) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "@dsh-community/plugin-panel";
      tag.dataset.pluginCss = cssId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ── locale dictionaries ──────────────────────────────────────────────
    var NS = "pluginPanel";
    var zh = {
      "panel.title": "插件面板",
      "panel.subtitle": "社区插件市场",
      "panel.cachedAt": "目录更新于 {time}",
      "panel.noCache": "内置目录（尚未联网刷新）",
      "panel.indexBuiltAt": "预构建索引 · {time}",
      "src.curated": "精选",
      "src.all": "全部",
      "src.curatedTip": "社区人工维护、逐个验证可安装的精选插件（约 550 个），质量优先。",
      "src.allTip": "从每小时自动更新的云端 JSON 读取 GitHub dsh-plugin 全量目录；刷新不会在你的电脑上爬取数千个仓库。",
      "src.fetchAll": "获取全部",
      "src.fetchAllHint": "已显示 {shown} / {total}，点击获取完整列表（约 1-5 分钟）",
      "src.totalAll": "GitHub topic「dsh-plugin」共 {total} 个仓库，当前显示 {shown} 条",
      "src.totalCurated": "精选目录共 {n} 条",
      "src.fetchingAll": "正在获取全部仓库目录…",
      "src.fetchingCurated": "正在获取精选目录…",
      "src.busy": "获取中…",
      "src.refreshTimeout": "目录刷新超时，已保留当前目录，请稍后重试",
      "panel.refresh": "刷新目录",
      "panel.close": "关闭",
      "search.placeholder": "搜索插件 / 技能 / 客户端 / 资源（中英文）…",
      "search.semantic": "语义搜索",
      "sem.notBuilt": "向量索引未建立",
      "sem.build": "建立向量索引",
      "sem.rebuild": "重新建立索引",
      "sem.building": "正在建立索引…",
      "sem.noKey": "未配置 API Key（在设置中填写）",
      "sem.searching": "语义搜索中…",
      "sem.status": "{model} · {count} 条向量",
      "sem.stale": "向量索引已过期：{reason}",
      "sem.error": "语义搜索失败：{message}",
      "sem.hint": "按语义匹配（多语言），需要嵌入模型 API Key",
      "tab.all": "全部",
      "tab.plugin": "插件",
      "tab.skill": "Skill",
      "tab.client": "客户端",
      "tab.dev-resource": "开发资源",
      "filter.favorites": "只看收藏",
      "filter.installed": "只看已安装",
      "sort.label": "排序",
      "sort.default": "默认",
      "sort.starsDesc": "星标最多",
      "sort.starsAsc": "星标最少",
      "sort.nameAsc": "名称 A-Z",
      "sort.nameDesc": "名称 Z-A",
      "sort.createdDesc": "最新创建",
      "sort.createdAsc": "最早创建",
      "desc.zh": "中文",
      "desc.en": "EN",
      "entry.installed": "已安装",
      "entry.install": "安装",
      "entry.unverified": "安装方式待验证",
      "entry.manualEnabled": "已启用（用户配置）",
      "entry.update": "更新",
      "entry.uninstall": "卸载",
      "entry.cleanup": "清理依赖",
      "entry.inactive": "仅下载，未加入 Profile",
      "entry.confirmInstall": "确认安装？",
      "entry.confirmUpdate": "确认更新？",
      "entry.confirmUninstall": "确认卸载？",
      "entry.confirmCleanup": "确认清理？",
      "entry.favorite": "收藏",
      "entry.unfavorite": "取消收藏",
      "entry.open": "打开网页",
      "src.translating": "翻译中…",
      "src.translatePartial": "部分条目暂未译出，滚动或切换语言会重试",
      "env.dshOk": "dsh CLI ✓",
      "env.dshMissing": "未找到 dsh CLI",
      "env.pnpmOk": "pnpm ✓",
      "env.pnpmMissing": "缺少 pnpm（dsh plugin 需要）",
      "env.fixPnpm": "自动安装 pnpm",
      "env.fixing": "安装中…",
      "ops.title": "操作记录",
      "ops.running": "进行中",
      "ops.ok": "成功",
      "ops.error": "失败",
      "ops.expand": "展开",
      "ops.collapse": "收起",
      "ops.clear": "清空全部操作记录",
      "settings.title": "设置",
      "settings.profile": "目标 Profile",
      "settings.remoteUrl": "远程目录 URL（留空 = 社区安装注册表）",
      "settings.embedding": "嵌入模型（语义搜索）",
      "settings.apiKey": "API Key",
      "settings.model": "模型",
      "settings.baseUrl": "API 地址",
      "settings.saveEmb": "保存嵌入设置",
      "settings.save": "保存",
      "settings.saved": "已保存",
      "settings.saveFailed": "保存失败：{message}",
      "empty.noResult": "没有匹配的条目",
      "empty.noCatalog": "目录为空，点右上角刷新",
      "loading": "读取中…",
      "error.load": "读取失败：{message}",
      "restart.hint": "安装/卸载后需重启 GUI 生效。"
    };
    var en = {
      "panel.title": "Plugin Panel",
      "panel.subtitle": "Community plugin market",
      "panel.cachedAt": "Catalog updated {time}",
      "panel.noCache": "Built-in catalog (no live refresh yet)",
      "panel.indexBuiltAt": "Prebuilt index · {time}",
      "src.curated": "Curated",
      "src.all": "All",
      "src.curatedTip": "Community-maintained, install-verified curated plugins (~550), quality first.",
      "src.allTip": "Every repo tagged dsh-plugin on GitHub (3000+, including experimental/unfinished projects). The GitHub search API caps one query at 1000; the top 1000 by stars show first — click “Fetch all” for the complete list (~1–5 min).",
      "src.fetchAll": "Fetch all",
      "src.fetchAllHint": "Showing {shown}/{total} — click to fetch the complete list (~1–5 min)",
      "src.totalAll": "GitHub topic “dsh-plugin”: {total} repos, showing {shown}",
      "src.totalCurated": "Curated catalog: {n} entries",
      "src.fetchingAll": "Fetching all-repos catalog…",
      "src.fetchingCurated": "Fetching curated catalog…",
      "src.busy": "Fetching…",
      "src.refreshTimeout": "Catalog refresh timed out. The current catalog was kept; please try again later.",
      "panel.refresh": "Refresh catalog",
      "panel.close": "Close",
      "search.placeholder": "Search plugins / skills / clients / resources (CN/EN)…",
      "search.semantic": "Semantic",
      "sem.notBuilt": "Vector index not built",
      "sem.build": "Build vector index",
      "sem.rebuild": "Rebuild vector index",
      "sem.building": "Building index…",
      "sem.noKey": "API key missing (fill it in Settings)",
      "sem.searching": "Searching semantically…",
      "sem.status": "{model} · {count} vectors",
      "sem.stale": "Vector index is stale: {reason}",
      "sem.error": "Semantic search failed: {message}",
      "sem.hint": "Semantic (multilingual) matching; needs an embedding API key",
      "tab.all": "All",
      "tab.plugin": "Plugins",
      "tab.skill": "Skills",
      "tab.client": "Clients",
      "tab.dev-resource": "Dev Resources",
      "filter.favorites": "Favorites only",
      "filter.installed": "Installed only",
      "sort.label": "Sort",
      "sort.default": "Default",
      "sort.starsDesc": "Most stars",
      "sort.starsAsc": "Fewest stars",
      "sort.nameAsc": "Name A-Z",
      "sort.nameDesc": "Name Z-A",
      "sort.createdDesc": "Newest",
      "sort.createdAsc": "Oldest",
      "desc.zh": "中文",
      "desc.en": "EN",
      "entry.installed": "Installed",
      "entry.install": "Install",
      "entry.unverified": "Install method unverified",
      "entry.manualEnabled": "Enabled (user config)",
      "entry.update": "Update",
      "entry.uninstall": "Uninstall",
      "entry.cleanup": "Clean dependency",
      "entry.inactive": "Downloaded only; not in profile",
      "entry.confirmInstall": "Confirm install?",
      "entry.confirmUpdate": "Confirm update?",
      "entry.confirmUninstall": "Confirm uninstall?",
      "entry.confirmCleanup": "Confirm cleanup?",
      "entry.favorite": "Favorite",
      "entry.unfavorite": "Unfavorite",
      "entry.open": "Open",
      "src.translating": "Translating…",
      "src.translatePartial": "Some entries could not be translated; scroll or toggle language to retry",
      "env.dshOk": "dsh CLI ✓",
      "env.dshMissing": "dsh CLI not found",
      "env.pnpmOk": "pnpm ✓",
      "env.pnpmMissing": "pnpm missing (required by dsh plugin)",
      "env.fixPnpm": "Install pnpm",
      "env.fixing": "Installing…",
      "ops.title": "Operations",
      "ops.running": "running",
      "ops.ok": "ok",
      "ops.error": "failed",
      "ops.expand": "Expand",
      "ops.collapse": "Collapse",
      "ops.clear": "Clear all operation history",
      "settings.title": "Settings",
      "settings.profile": "Target profile",
      "settings.remoteUrl": "Remote catalog URL (empty = community install registry)",
      "settings.embedding": "Embedding model (semantic search)",
      "settings.apiKey": "API key",
      "settings.model": "Model",
      "settings.baseUrl": "API base URL",
      "settings.saveEmb": "Save embedding settings",
      "settings.save": "Save",
      "settings.saved": "Saved",
      "settings.saveFailed": "Save failed: {message}",
      "empty.noResult": "No matching entries",
      "empty.noCatalog": "Catalog is empty — refresh from the header",
      "loading": "Loading…",
      "error.load": "Load failed: {message}",
      "restart.hint": "Installs/uninstalls take effect after a GUI restart."
    };

    // ── tiny helpers ──────────────────────────────────────────────────────
    function fmtTime(iso) {
      if (!iso) return "";
      var d = new Date(iso);
      var pad = function (n) { return n < 10 ? "0" + n : String(n); };
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }
    // v5.4: GitHub-style star formatting (1.2k / 3.4k / 1.1M).
    function githubStars(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
      if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
      return String(n);
    }
    function el(type, props) {
      var children = Array.prototype.slice.call(arguments, 2);
      return React.createElement.apply(React, [type, props].concat(children));
    }
    function api(path, method, body, timeoutMs) {
      var init = { method: method || "GET", headers: { "content-type": "application/json" } };
      if (body !== undefined) init.body = JSON.stringify(body);
      var controller = timeoutMs && typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
      if (controller) init.signal = controller.signal;
      return fetch("/api/plugin-panel" + path, init).then(function (res) {
        return res.json().catch(function () { return { ok: false, message: "invalid response" }; });
      }).then(function (value) {
        if (timer) clearTimeout(timer);
        return value;
      }, function (error) {
        if (timer) clearTimeout(timer);
        throw error;
      });
    }

    // ── small icon set (inline SVG) ───────────────────────────────────────
    function IconStore(props) {
      return el("svg", { width: props.size || 16, height: props.size || 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true },
        el("path", { d: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" }));
    }
    function IconRefresh(props) {
      return el("svg", { width: props.size || 16, height: props.size || 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true },
        el("path", { d: "M21 12a9 9 0 1 1-3-6.7M21 3v6h-6" }));
    }
    function IconClose(props) {
      return el("svg", { width: props.size || 16, height: props.size || 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true },
        el("path", { d: "M6 6l12 12M18 6L6 18" }));
    }
    function IconStar(props) {
      return el("svg", { width: props.size || 16, height: props.size || 16, viewBox: "0 0 24 24", fill: props.filled ? "currentColor" : "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true },
        el("path", { d: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3L5.8 21 7 14.2l-5-4.9 6.9-1z" }));
    }
    function IconChevron(props) {
      return el("svg", { width: props.size || 16, height: props.size || 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true },
        el("path", { d: "M9 6l6 6-6 6" }));
    }
    function IconLink(props) {
      return el("svg", { width: props.size || 14, height: props.size || 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": true },
        el("path", { d: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" }));
    }

    // ── entry card ────────────────────────────────────────────────────────
    function EntryCard(props) {
      var entry = props.entry;
      var t = props.t;
      var showZh = props.showZh;
      var installed = props.installed;
      var favorite = props.favorite;
      var busy = props.busy;
      var confirm = props.confirm; // {action, id} | null
      var onAction = props.onAction;
      var onFavorite = props.onFavorite;
      var translations = props.translations || {}; // v5: on-demand LLM zh
      var cardRef = React.useRef(null);

      // Translate only cards entering the viewport. Mounting the 3000+ item
      // "All" list must not immediately issue thousands of requests.
      React.useEffect(function () {
        if (!showZh || !props.onTranslate || !entry.description || entry.descriptionZh || translations[entry.id]) return;
        var node = cardRef.current;
        if (!node || typeof IntersectionObserver === "undefined") {
          props.onTranslate(entry);
          return;
        }
        var observer = new IntersectionObserver(function (records) {
          if (records.some(function (record) { return record.isIntersecting; })) {
            props.onTranslate(entry);
            observer.disconnect();
          }
        }, { rootMargin: "240px 0px" });
        observer.observe(node);
        return function () { observer.disconnect(); };
      }, [showZh, entry.id, entry.descriptionZh, translations[entry.id], props.onTranslate]);

      // v5: on-demand translations override built-in zh when present.
      var tr = showZh ? translations[entry.id] : undefined;
      var title = showZh ? (tr ? tr.titleZh : entry.titleZh || entry.title) : entry.title;
      var desc = showZh ? (tr ? tr.descriptionZh : entry.descriptionZh || entry.description) : entry.description;
      var catLabel = t("tab." + entry.category);

      var actions = [];
      if (installed && installed.enabled === false) {
        actions.push({ key: "cleanup", label: t("entry.cleanup"), danger: true, action: "cleanup" });
      } else if (installed) {
        actions.push({ key: "update", label: t("entry.update"), primary: true, action: "update" });
        if (installed.activation !== "manual" || installed.panelManaged) {
          actions.push({ key: "uninstall", label: t("entry.uninstall"), danger: true, action: "uninstall" });
        }
      } else {
        actions.push(entry.installVerified
          ? { key: "install", label: t("entry.install"), primary: true, action: "install" }
          : { key: "unverified", label: t("entry.unverified"), action: "install", disabled: true });
      }

      return el("div", { className: "pp-card", ref: cardRef },
        el("div", { className: "pp-card-head" },
          el("div", { className: "pp-card-title" },
            entry.repo
              ? el("a", { href: entry.repo, target: "_blank", rel: "noreferrer" }, title)
              : title
          ),
          el("div", { className: "pp-badges" },
            el("span", { className: "pp-cat" }, catLabel),
            typeof entry.stars === "number"
              ? el("span", { className: "pp-stars", title: String(entry.stars) + " stars" }, "\u2605 " + githubStars(entry.stars))
              : null,
            el("button", {
              type: "button",
              className: "pp-fav",
              "data-on": favorite || undefined,
              "aria-label": favorite ? t("entry.unfavorite") : t("entry.favorite"),
              onClick: function () { onFavorite(entry); }
            }, el(IconStar, { size: 15, filled: favorite }))
          )
        ),
        el("p", { className: "pp-desc" }, desc),
        entry.tags && entry.tags.length > 0
          ? el("div", { className: "pp-tags" }, entry.tags.slice(0, 8).map(function (tag) {
              return el("span", { className: "pp-tag", key: tag }, tag);
            }))
          : null,
        el("div", { className: "pp-actions" },
          el("a", {
            key: "open",
            className: "pp-act pp-openlink",
            href: entry.repo || (entry.npm ? "https://www.npmjs.com/package/" + entry.npm : "#"),
            target: "_blank",
            rel: "noreferrer",
            title: t("entry.open")
          }, el(IconLink, { size: 13 }), " ", t("entry.open")),
          actions.map(function (action) {
            var armed = confirm && confirm.action === action.action && confirm.id === entry.id;
            var label = armed ? t("entry.confirm" + action.action.charAt(0).toUpperCase() + action.action.slice(1)) : action.label;
            return el("button", {
              key: action.key,
              type: "button",
              className: "pp-act" + (action.primary ? " pp-act-primary" : "") + (action.danger ? " pp-act-danger" : "") + (armed ? " pp-act-armed" : ""),
              "data-primary": action.primary || undefined,
              "data-danger": action.danger || undefined,
              "data-armed": armed || undefined,
              disabled: busy || action.disabled,
              onClick: function () { onAction(entry, action.action); }
            }, label);
          }),
          installed ? el("span", { className: "pp-installed" }, installed.enabled === false
            ? (installed.issue || t("entry.inactive"))
            : (installed.activation === "manual" ? (installed.issue || t("entry.manualEnabled")) : t("entry.installed"))) : null
        )
      );
    }

    // ── the panel application ─────────────────────────────────────────────
    function PluginPanelApp(props) {
      var wide = props.wide !== false;
      var t = props.t;

      var useState = React.useState;
      var useEffect = React.useEffect;
      var useRef = React.useRef;
      var useCallback = React.useCallback;

      var openState = useState(false);
      var open = openState[0];
      var setOpen = openState[1];

      var catalogState = useState({ entries: [], source: "seed", fetchedAt: undefined });
      var catalog = catalogState[0];
      var setCatalog = catalogState[1];

      var stateState = useState({ favorites: [], settings: { profile: "web", remoteCatalogUrl: "", descriptionLang: "auto", catalogSource: "curated", sort: "default" } });
      var panelState = stateState[0];
      var setPanelState = stateState[1];

      var installedState = useState([]);
      var installed = installedState[0];
      var setInstalled = installedState[1];

      var envState = useState({ dshFound: true, pnpmFound: true });
      var env = envState[0];
      var setEnv = envState[1];

      var opsState = useState([]);
      var ops = opsState[0];
      var setOps = opsState[1];
      var opsExpandedState = useState(false);
      var opsExpanded = opsExpandedState[0];
      var setOpsExpanded = opsExpandedState[1];

      var queryState = useState("");
      var query = queryState[0];
      var setQuery = queryState[1];

      var catState = useState("all");
      var cat = catState[0];
      var setCat = catState[1];

      var favOnlyState = useState(false);
      var favOnly = favOnlyState[0];
      var setFavOnly = favOnlyState[1];

      var instOnlyState = useState(false);
      var instOnly = instOnlyState[0];
      var setInstOnly = instOnlyState[1];

      var zhState = useState(false);
      var showZh = zhState[0];
      var setShowZh = zhState[1];

      var confirmState = useState(null);
      var confirm = confirmState[0];
      var setConfirm = confirmState[1];

      var busySetState = useState({});
      var busySet = busySetState[0];
      var setBusySet = busySetState[1];

      var urlDraftState = useState("");
      var urlDraft = urlDraftState[0];
      var setUrlDraft = urlDraftState[1];

      // v6: semantic (embedding) search.
      var semanticOnState = useState(false);
      var semanticOn = semanticOnState[0];
      var setSemanticOn = semanticOnState[1];
      var embStatusState = useState({ built: false, count: 0, model: "", provider: "", keySet: false });
      var embStatus = embStatusState[0];
      var setEmbStatus = embStatusState[1];
      var semanticResultsState = useState(null); // null = not searching
      var semanticResults = semanticResultsState[0];
      var setSemanticResults = semanticResultsState[1];
      var semanticLoadingState = useState(false);
      var semanticLoading = semanticLoadingState[0];
      var setSemanticLoading = semanticLoadingState[1];
      var semanticErrorState = useState("");
      var semanticError = semanticErrorState[0];
      var setSemanticError = semanticErrorState[1];
      var buildingIndexState = useState(false);
      var buildingIndex = buildingIndexState[0];
      var setBuildingIndex = buildingIndexState[1];
      var embKeyDraftState = useState("");
      var embKeyDraft = embKeyDraftState[0];
      var setEmbKeyDraft = embKeyDraftState[1];
      var embModelDraftState = useState("");
      var embModelDraft = embModelDraftState[0];
      var setEmbModelDraft = embModelDraftState[1];
      var embUrlDraftState = useState("");
      var embUrlDraft = embUrlDraftState[0];
      var setEmbUrlDraft = embUrlDraftState[1];

      var savedFlashState = useState(false);
      var savedFlash = savedFlashState[0];
      var setSavedFlash = savedFlashState[1];
      var saveErrorState = useState("");
      var saveError = saveErrorState[0];
      var setSaveError = saveErrorState[1];

      // v5: on-demand Chinese translations for the all-repos lens.
      var translationsState = useState({});
      var translations = translationsState[0];
      var setTranslations = translationsState[1];

      var mounted = useRef(true);
      useEffect(function () {
        mounted.current = true;
        return function () { mounted.current = false; };
      }, []);

      var pushOp = useCallback(function (label) {
        var op = { id: String(Date.now()) + Math.random().toString(36).slice(2, 6), label: label, state: "running", startedAt: Date.now() };
        setOps(function (prev) { return [op].concat(prev).slice(0, 100); });
        api("/operations", "POST", { operation: op }).catch(function () {});
        return op.id;
      }, []);

      var finishOp = useCallback(function (id, state, detail) {
        setOps(function (prev) {
          return prev.map(function (op) {
            if (op.id !== id) return op;
            var done = { ...op, state: state, detail: detail || op.detail, finishedAt: Date.now() };
            api("/operations", "POST", { operation: done }).catch(function () {});
            return done;
          });
        });
      }, []);

      function clearOperations() {
        api("/operations/clear", "POST", {}).then(function (res) { if (res.ok) setOps([]); }).catch(function () {});
      }

      var loadAll = useCallback(function (lensArg) {
        var l = lensArg || lensRef.current || "curated";
        api("/catalog?lens=" + encodeURIComponent(l)).then(function (res) {
          if (res.ok) setCatalog({ entries: res.entries, source: res.source, fetchedAt: res.fetchedAt, generatedAt: res.generatedAt, lens: res.lens, totalHits: res.totalHits, fetchedCount: res.fetchedCount, coveragePct: res.coveragePct, cacheAgeMs: res.cacheAgeMs });
        }).catch(function (e) { console.error("[plugin-panel] catalog load failed", e); });
        api("/state").then(function (res) {
          if (res.ok) {
            setPanelState(res.state);
            setUrlDraft(res.state.settings.remoteCatalogUrl || "");
          }
        }).catch(function () {});
        api("/installed").then(function (res) {
          if (res.ok) setInstalled(res.installed || []);
        }).catch(function () {});
        api("/env").then(function (res) {
          if (res.ok) setEnv(res);
        }).catch(function () {});
        api("/operations").then(function (res) {
          if (res.ok) setOps((res.operations || []).slice(0, 100));
        }).catch(function () {});
      }, []);

      // Active catalog lens (persisted in panel state, default curated).
      var lens = (panelState.settings && panelState.settings.catalogSource) || "curated";
      var lensRef = useRef(lens);
      lensRef.current = lens;

      // Which lenses already have live (non-seed) data; used to auto-fetch on
      // the first switch to a lens that has no cache yet.
      var loadedLenses = useRef({ curated: false, all: false });

      var fetchingState = useState(null);
      var fetching = fetchingState[0];
      var setFetching = fetchingState[1];
      var fetchingRef = useRef(null);

      var loadAll = useCallback(function (lensArg) {
        var l = lensArg || lensRef.current || "curated";
        api("/catalog?lens=" + encodeURIComponent(l)).then(function (res) {
          if (res.ok) {
            setCatalog({ entries: res.entries, source: res.source, fetchedAt: res.fetchedAt, generatedAt: res.generatedAt, lens: res.lens, totalHits: res.totalHits, fetchedCount: res.fetchedCount, coveragePct: res.coveragePct, cacheAgeMs: res.cacheAgeMs });
            if (res.source !== "seed") loadedLenses.current[l] = true;
            if (l === "all") refreshEmbStatus();
          }
        }).catch(function (e) { console.error("[plugin-panel] catalog load failed", e); });
        api("/state").then(function (res) {
          if (res.ok) {
            setPanelState(res.state);
            setUrlDraft(res.state.settings.remoteCatalogUrl || "");
          }
        }).catch(function () {});
        api("/installed").then(function (res) {
          if (res.ok) setInstalled(res.installed || []);
        }).catch(function () {});
        api("/env").then(function (res) {
          if (res.ok) setEnv(res);
        }).catch(function () {});
        api("/operations").then(function (res) {
          if (res.ok) setOps((res.operations || []).slice(0, 100));
        }).catch(function () {});
      }, []);

      useEffect(function () {
        loadAll(lens);
      }, [loadAll, lens]);

      /** Fetch a lens from its remote source (manual refresh or auto-fetch). */
      function refreshLens(l, _unused, opLabel) {
        if (fetchingRef.current !== null) return;
        var opId = pushOp(opLabel || t(l === "all" ? "src.fetchingAll" : "src.fetchingCurated"));
        fetchingRef.current = l;
        setFetching(l);
        api("/refresh", "POST", { remoteCatalogUrl: urlDraft, lens: l }, 120000).then(function (res) {
          if (res.ok) {
            setCatalog({ entries: res.entries, source: res.source, fetchedAt: res.fetchedAt, generatedAt: res.generatedAt, lens: res.lens, totalHits: res.totalHits, fetchedCount: res.fetchedCount, coveragePct: res.coveragePct });
            loadedLenses.current[l] = true;
            finishOp(opId, "ok", res.note);
          } else {
            finishOp(opId, "error", res.message);
          }
          loadAll(l);
        }).catch(function (e) {
          finishOp(opId, "error", e && e.name === "AbortError" ? t("src.refreshTimeout") : String(e));
        }).then(function () {
          fetchingRef.current = null;
          if (mounted.current) setFetching(null);
        });
      }

      var backgroundCatalogChecked = useRef(false);
      useEffect(function () {
        if (lens !== "all" || catalog.lens !== "all" || catalog.entries.length === 0 || backgroundCatalogChecked.current) return;
        if (catalog.cacheAgeMs === null || catalog.cacheAgeMs === undefined || catalog.cacheAgeMs > 3600000) {
          backgroundCatalogChecked.current = true;
          refreshLens("all", false, t("panel.refresh"));
        }
      }, [lens, catalog.lens, catalog.cacheAgeMs, catalog.entries.length]);

      function setLens(next) {
        if (next === lens) return;
        setPanelState(function (prev) {
          return { ...prev, settings: { ...prev.settings, catalogSource: next } };
        });
        api("/settings", "POST", { settings: { catalogSource: next } }).catch(function () {});
        if (loadedLenses.current[next]) {
          loadAll(next);
        } else {
          refreshLens(next); // first visit to this lens: fetch it automatically
        }
      }

      // Names installed in the target profile, keyed by package name.
      var installedNames = {};
      installed.forEach(function (item) {
        installedNames[item.name] = item;
      });

      function entryInstalled(e) {
        if (!e.install) return false;
        if (installedNames[e.install]) return installedNames[e.install];
        if (e.npm && installedNames[e.npm]) return installedNames[e.npm];
        if (e.repo) {
          var base = e.repo.split("#")[0].replace(/\/$/, "").split("/").pop();
          for (var key in installedNames) {
            if (key.split("/").pop() === base) return installedNames[key];
          }
        }
        return false;
      }

      var counts = { all: catalog.entries.length, plugin: 0, skill: 0, client: 0, "dev-resource": 0 };
      catalog.entries.forEach(function (e) { counts[e.category] = (counts[e.category] || 0) + 1; });

      var q = query.trim().toLowerCase();
      var visible = catalog.entries.filter(function (e) {
        if (cat !== "all" && e.category !== cat) return false;
        if (favOnly && panelState.favorites.indexOf(e.id) === -1) return false;
        if (instOnly && !entryInstalled(e)) return false;
        if (q) {
          var hay = [e.title, e.titleZh || "", e.description, e.descriptionZh || "", e.id, e.npm || "", (e.tags || []).join(" "), e.author || ""].join(" ").toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      });

      // Sort options (v4): applied after filtering.
      var sort = (panelState.settings && panelState.settings.sort) || "default";
      var sortedVisible = visible.slice();
      switch (sort) {
        case "stars-desc":
          sortedVisible.sort(function (a, b) { return (b.stars || 0) - (a.stars || 0); });
          break;
        case "stars-asc":
          sortedVisible.sort(function (a, b) { return (a.stars || 0) - (b.stars || 0); });
          break;
        case "name-asc":
          sortedVisible.sort(function (a, b) { return (a.titleZh && showZh ? a.titleZh : a.title).localeCompare(b.titleZh && showZh ? b.titleZh : b.title, "zh"); });
          break;
        case "name-desc":
          sortedVisible.sort(function (a, b) { return (b.titleZh && showZh ? b.titleZh : b.title).localeCompare(a.titleZh && showZh ? a.titleZh : a.title, "zh"); });
          break;
        case "created-desc":
          sortedVisible.sort(function (a, b) { return String(b.createdAt || "").localeCompare(String(a.createdAt || "")); });
          break;
        case "created-asc":
          sortedVisible.sort(function (a, b) { return String(a.createdAt || "").localeCompare(String(b.createdAt || "")); });
          break;
        default:
          break;
      }

      function setSort(next) {
        if (next === sort) return;
        setPanelState(function (prev) {
          return { ...prev, settings: { ...prev.settings, sort: next } };
        });
        api("/settings", "POST", { settings: { sort: next } }).catch(function () {});
      }

      function refresh() {
        // Header refresh is intentionally lightweight. On the all-repos lens
        // it reads the bundled index (or downloads a configured remote index)
        // instead of starting the expensive adaptive GitHub crawl.
        refreshLens(lens, false, t("panel.refresh"));
      }

      // v6.5: viewport cards feed a single durable queue. Re-renders during an
      // in-flight request can no longer discard the next translation batch.
      var translateBusy = useRef(false);
      var translateQueue = useRef({});
      var translateAttempts = useRef({});
      var translateWakeState = useState(0);
      var translateWake = translateWakeState[0];
      var setTranslateWake = translateWakeState[1];
      var translatingState = useState(false);
      var translatingNow = translatingState[0];
      var setTranslatingNow = translatingState[1];
      var translatePartialState = useState(false);
      var translatePartial = translatePartialState[0];
      var setTranslatePartial = translatePartialState[1];

      function enqueueTranslation(entry) {
        if (!entry || !entry.description || entry.descriptionZh || translations[entry.id]) return;
        translateQueue.current[entry.id] = { id: entry.id, title: entry.title, description: entry.description };
        setTranslateWake(function (value) { return value + 1; });
      }

      useEffect(function () {
        if (!showZh || translateBusy.current) return;
        var ids = Object.keys(translateQueue.current).filter(function (id) {
          return !translations[id] && (translateAttempts.current[id] || 0) < 3;
        }).slice(0, 20);
        if (ids.length === 0) return;
        var batch = ids.map(function (id) {
          var item = translateQueue.current[id];
          delete translateQueue.current[id];
          return item;
        });
        translateBusy.current = true;
        setTranslatingNow(true);
        api("/translate", "POST", { items: batch }).then(function (res) {
          var returned = {};
          var next = {};
          if (res.ok && Array.isArray(res.results)) {
            res.results.forEach(function (r) {
              if (!r || !r.id || !r.descriptionZh) return;
              returned[r.id] = true;
              next[r.id] = { titleZh: r.titleZh, descriptionZh: r.descriptionZh };
            });
          }
          if (Object.keys(next).length > 0) {
            setTranslations(function (prev) { return { ...prev, ...next }; });
          }
          batch.forEach(function (item) {
            if (returned[item.id]) {
              delete translateAttempts.current[item.id];
              return;
            }
            var attempts = (translateAttempts.current[item.id] || 0) + 1;
            translateAttempts.current[item.id] = attempts;
            if (attempts < 3) translateQueue.current[item.id] = item;
            else setTranslatePartial(true);
          });
        }).catch(function () {
          batch.forEach(function (item) {
            var attempts = (translateAttempts.current[item.id] || 0) + 1;
            translateAttempts.current[item.id] = attempts;
            if (attempts < 3) translateQueue.current[item.id] = item;
            else setTranslatePartial(true);
          });
        }).then(function () {
          translateBusy.current = false;
          setTranslatingNow(false);
          setTranslateWake(function (value) { return value + 1; });
        });
      }, [showZh, translateWake, translations]);

      useEffect(function () {
        if (!showZh) {
          translateAttempts.current = {};
          setTranslatePartial(false);
        }
      }, [showZh]);

      // ── v6: semantic (embedding) search ──────────────────────────────────
      function refreshEmbStatus() {
        api("/embedding/status").then(function (res) {
          if (res.ok) setEmbStatus(res);
        }).catch(function () {});
      }

      function embeddingDraft(enabled) {
        return {
          enabled: enabled,
          provider: "硅基流动",
          baseUrl: embUrlDraft.trim(),
          model: embModelDraft.trim() || "BAAI/bge-m3",
          apiKey: embKeyDraft.trim()
        };
      }

      // Persist the exact drafts before build/search. This closes the 600 ms
      // auto-save race when a user pastes a key and immediately clicks Build.
      function persistEmbeddingConfig(enabled) {
        return api("/settings", "POST", { settings: { embedding: embeddingDraft(enabled) } }).then(function (res) {
          if (!res.ok) throw new Error(res.message || "save failed");
          setPanelState(res.state);
          return res.state;
        });
      }
      // Sync the config drafts from panel state when the drawer opens/updates.
      useEffect(function () {
        var emb = panelState.settings && panelState.settings.embedding;
        if (emb) {
          setSemanticOn(emb.enabled === true);
          setEmbKeyDraft(emb.apiKey || "");
          setEmbModelDraft(emb.model || "BAAI/bge-m3");
          setEmbUrlDraft(emb.baseUrl || "https://api.siliconflow.cn/v1");
          refreshEmbStatus();
        }
      }, [panelState.settings]);

      function saveEmbConfig() {
        setSaveError("");
        persistEmbeddingConfig(semanticOn).then(function () {
            setSavedFlash(true);
            setTimeout(function () { if (mounted.current) setSavedFlash(false); }, 1500);
            refreshEmbStatus();
        }).catch(function (e) { setSaveError(String(e)); });
      }

      function toggleSemantic(next) {
        setSemanticOn(next);
        if (!next) setSemanticResults(null);
      }

      function buildVectorIndex() {
        if (buildingIndex || embStatus.building) return; // never start a second build
        var opId = pushOp(t("sem.build"));
        setBuildingIndex(true);
        setSemanticError("");
        api("/embedding/build", "POST", {}).then(function (res) {
          finishOp(opId, res.ok ? "ok" : "error", res.already ? (res.message || t("sem.building")) : (res.ok ? (t("sem.status", { model: res.model, count: String(res.count) })) : res.message));
          if (!res.ok) setSemanticError(res.message || "unknown error");
          refreshEmbStatus();
        }).catch(function (e) {
          finishOp(opId, "error", String(e));
          setSemanticError(String(e));
        }).then(function () {
          setBuildingIndex(false);
        });
      }

      // Debounced semantic search on query change.
      var semTimer = useRef(null);
      useEffect(function () {
        if (!semanticOn) {
          setSemanticResults(null);
          return;
        }
        var q = query.trim();
        if (!q) {
          setSemanticResults(null);
          return;
        }
        if (semTimer.current) clearTimeout(semTimer.current);
        semTimer.current = setTimeout(function () {
          setSemanticLoading(true);
          setSemanticError("");
          api("/search-semantic", "POST", { query: q, limit: 80 }).then(function (res) {
            if (res.ok) setSemanticResults(res.results || []);
            else setSemanticError(res.message || "unknown error");
          }).catch(function (e) { setSemanticError(String(e)); }).then(function () {
            setSemanticLoading(false);
          });
        }, 450);
      }, [semanticOn, query]);

      // Semantic results respect the same filters as the normal list.
      // v6.2: the "key not configured" hint derives from the locally saved
      // state (via /state), not from the status endpoint — so it never wrongly
      // claims the key is missing when the endpoint is unavailable.
      var embCfg = (panelState.settings && panelState.settings.embedding) || {};
      var keyConfigured = !!(embCfg.apiKey && embCfg.apiKey.trim());

      var semanticFiltered = semanticResults;
      if (semanticFiltered) {
        semanticFiltered = semanticFiltered.filter(function (e) {
          if (cat !== "all" && e.category !== cat) return false;
          if (favOnly && panelState.favorites.indexOf(e.id) === -1) return false;
          if (instOnly && !entryInstalled(e)) return false;
          return true;
        });
      }

      function toggleFavorite(entry) {
        api("/favorite", "POST", { id: entry.id }).then(function (res) {
          if (res.ok) {
            setPanelState(function (prev) { return { ...prev, favorites: res.favorites }; });
          }
        }).catch(function () {});
      }

      // v5.2: auto-cancel an armed confirm after 3s so a stray click never
      // leaves a button stuck in "confirm?" state.
      var confirmTimer = useRef(null);
      function armConfirm(action, id) {
        setConfirm({ action: action, id: id });
        if (confirmTimer.current) clearTimeout(confirmTimer.current);
        confirmTimer.current = setTimeout(function () {
          setConfirm(null);
          confirmTimer.current = null;
        }, 3000);
      }

      function runLifecycle(entry, action) {
        if (confirm && confirm.action === action && confirm.id === entry.id) {
          if (confirmTimer.current) clearTimeout(confirmTimer.current);
          confirmTimer.current = null;
          setConfirm(null);
        } else {
          armConfirm(action, entry.id);
          return;
        }
        var label = entry.title + " · " + action;
        var opId = pushOp(label);
        setBusySet(function (prev) { return { ...prev, [entry.id]: true }; });
        var item = entryInstalled(entry);
        var spec = entry.install;
        var body = action === "install" ? { spec: spec, label: entry.title, verified: entry.installVerified === true } :
                   action === "update" ? { name: item && item.packageName, spec: item && item.spec, manual: item && item.activation === "manual" } :
                   { name: item && item.packageName, manual: item && item.activation === "manual", panelManaged: item && item.panelManaged === true };
        var endpoint = action === "cleanup" ? "/cleanup-dependency" : "/" + action;
        api(endpoint, "POST", body).then(function (res) {
          finishOp(opId, res.ok ? "ok" : "error", res.message || "");
          if (res.ok) loadAll();
        }).catch(function (e) {
          finishOp(opId, "error", String(e));
        }).then(function () {
          setBusySet(function (prev) { var next = { ...prev }; delete next[entry.id]; return next; });
        });
      }

      function saveSettings() {
        setSaveError("");
        api("/settings", "POST", { settings: { remoteCatalogUrl: urlDraft, profile: panelState.settings.profile } }).then(function (res) {
          if (res.ok) {
            setPanelState(res.state);
            setSavedFlash(true);
            setTimeout(function () { if (mounted.current) setSavedFlash(false); }, 1500);
          } else setSaveError(res.message || "save failed");
        }).catch(function (e) { setSaveError(String(e)); });
      }

      function fixPnpm() {
        var opId = pushOp(t("env.fixPnpm"));
        api("/fix-pnpm", "POST", {}).then(function (res) {
          finishOp(opId, res.ok ? "ok" : "error", res.message);
          loadAll();
        }).catch(function (e) { finishOp(opId, "error", String(e)); });
      }

      var refreshBusy = fetching !== null;

      // Drawer content
      var drawer = null;
      if (open) {
        drawer = el(React.Fragment, null,
          el("div", { className: "pp-backdrop", onClick: function () { setOpen(false); } }),
          el("aside", { className: "pp-drawer", role: "dialog", "aria-label": t("panel.title") },
            el("div", { className: "pp-header" },
              el("h1", null, t("panel.title")),
              el("span", { className: "pp-cached" },
                catalog.fetchedAt
                  ? (catalog.lens === "all" ? t("panel.indexBuiltAt", { time: fmtTime(catalog.generatedAt || catalog.fetchedAt) }) : t("panel.cachedAt", { time: fmtTime(catalog.fetchedAt) }))
                  : t("panel.noCache")
              ),
              el("button", { type: "button", className: "pp-iconbtn", "aria-label": t("panel.refresh"), disabled: refreshBusy, onClick: refresh },
                el(IconRefresh, { size: 16 })),
              el("button", { type: "button", className: "pp-iconbtn", "aria-label": t("panel.close"), onClick: function () { setOpen(false); } },
                el(IconClose, { size: 16 }))
            ),
            el("div", { className: "pp-env" },
              el("span", { className: env.dshFound ? undefined : "pp-env-bad" }, env.dshFound ? t("env.dshOk") : t("env.dshMissing")),
              el("span", { className: env.pnpmFound ? undefined : "pp-env-bad" }, env.pnpmFound ? t("env.pnpmOk") : t("env.pnpmMissing")),
              !env.pnpmFound && el("button", { type: "button", onClick: fixPnpm }, t("env.fixPnpm"))
            ),
            el("div", { className: "pp-searchrow" },
              el("input", {
                type: "search",
                placeholder: "\u641c\u7d22",
                value: query,
                onChange: function (e) { setQuery(e.target.value); }
              }),
              el("label", { className: "pp-sem", title: t("sem.hint") },
                el("input", { type: "checkbox", checked: semanticOn, onChange: function (e) { toggleSemantic(e.target.checked); } }),
                t("search.semantic")
              )
            ),
            semanticOn
              ? el("div", { className: "pp-sembar" },
                  !keyConfigured
                    ? el("span", null, t("sem.noKey"))
                    : (embStatus.stale
                        ? el("span", null, t("sem.stale", { reason: embStatus.staleReason || t("sem.notBuilt") }))
                        : (embStatus.built
                            ? el("span", null, t("sem.status", { model: embStatus.model || embCfg.model, count: String(embStatus.count) }))
                            : el("span", null, t("sem.notBuilt")))),
                  el("button", {
                    type: "button",
                    className: "pp-sembtn",
                    "data-busy": buildingIndex || embStatus.building || undefined,
                    disabled: !keyConfigured || buildingIndex || embStatus.building,
                    onClick: buildVectorIndex
                  }, buildingIndex || embStatus.building ? t("sem.building") : (embStatus.built || embStatus.stale ? t("sem.rebuild") : t("sem.build"))),
                  semanticLoading ? el("span", null, t("sem.searching")) : null,
                  semanticError ? el("span", { className: "pp-env-bad" }, t("sem.error", { message: semanticError })) : null
                )
              : null,
            el("div", { className: "pp-srcrow" },
              el("button", {
                type: "button",
                className: "pp-srcbtn",
                "data-on": lens === "curated" || undefined,
                "data-tip": t("src.curatedTip"),
                disabled: refreshBusy,
                onClick: function () { setLens("curated"); }
              }, t("src.curated")),
              el("button", {
                type: "button",
                className: "pp-srcbtn",
                "data-on": lens === "all" || undefined,
                "data-tip": t("src.allTip"),
                disabled: refreshBusy,
                onClick: function () { setLens("all"); }
              }, t("src.all")),
              el("span", { className: "pp-srccount", "data-busy": fetching === lens || undefined },
                fetching === lens
                  ? t("src.busy")
                  : (lens === "all"
                      ? t("src.totalAll", { total: String(catalog.totalHits ?? catalog.entries.length), shown: String(catalog.entries.length) })
                      : t("src.totalCurated", { n: String(catalog.entries.length) }))),
              lens === "all" && catalog.coveragePct != null
                ? el("span", { className: "pp-srccount" }, " · " + Number(catalog.coveragePct).toFixed(2) + "% · " + fmtTime(catalog.generatedAt))
                : null
            ),
            el("div", { className: "pp-sortrow" },
              el("span", null, "\u6392\u5e8f"),
              el("select", {
                value: sort,
                onChange: function (e) { setSort(e.target.value); }
              },
                [["default", "\u9ed8\u8ba4"], ["stars-desc", "\u661f\u6807\u6700\u591a"], ["stars-asc", "\u661f\u6807\u6700\u5c11"], ["name-asc", "\u540d\u79f0 A-Z"], ["name-desc", "\u540d\u79f0 Z-A"], ["created-desc", "\u6700\u65b0\u521b\u5efa"], ["created-asc", "\u6700\u65e9\u521b\u5efa"]].map(function (pair) {
                  return el("option", { key: pair[0], value: pair[0] }, pair[1]);
                })
              )
            ),
            el("div", { className: "pp-tabs" },
              ["all", "plugin", "skill", "client", "dev-resource"].map(function (key) {
                return el("button", {
                  key: key,
                  type: "button",
                  className: "pp-tab",
                  "data-on": cat === key || undefined,
                  onClick: function () { setCat(key); }
                }, t("tab." + key) + " " + counts[key]);
              })
            ),
            el("div", { className: "pp-filters" },
              el("label", null,
                el("input", { type: "checkbox", checked: favOnly, onChange: function (e) { setFavOnly(e.target.checked); } }),
                t("filter.favorites")
              ),
              el("label", null,
                el("input", { type: "checkbox", checked: instOnly, onChange: function (e) { setInstOnly(e.target.checked); } }),
                t("filter.installed")
              ),
              el("span", { className: "pp-spacer" }),
              showZh && translatingNow ? el("span", { className: "pp-srccount" }, t("src.translating")) : null,
              showZh && translatePartial && !translatingNow ? el("span", { className: "pp-srccount", title: t("src.translatePartial") }, "⚠") : null,
              el("button", { type: "button", className: "pp-langbtn", onClick: function () { setShowZh(!showZh); } },
                showZh ? t("desc.en") : t("desc.zh"))
            ),
            el("div", { className: "pp-body" },
              fetching === lens && catalog.lens !== lens
                ? el("div", { className: "pp-note" }, lens === "all" ? t("src.fetchingAll") : t("src.fetchingCurated"))
                : (semanticOn && query.trim() && semanticResults !== null
                  ? (semanticLoading && (!semanticFiltered || semanticFiltered.length === 0)
                      ? el("div", { className: "pp-note" }, t("sem.searching"))
                      : (semanticFiltered && semanticFiltered.length > 0
                          ? semanticFiltered.map(function (entry) {
                              return el(EntryCard, {
                                key: entry.id,
                                entry: entry,
                                t: t,
                                showZh: showZh,
                                translations: translations,
                                onTranslate: enqueueTranslation,
                                installed: entryInstalled(entry),
                                favorite: panelState.favorites.indexOf(entry.id) !== -1,
                                busy: !!busySet[entry.id],
                                confirm: confirm,
                                onAction: runLifecycle,
                                onFavorite: toggleFavorite
                              });
                            })
                          : el("div", { className: "pp-note" }, t("empty.noResult"))))
                  : (sortedVisible.length === 0
                    ? el("div", { className: "pp-note" }, catalog.entries.length === 0 ? t("empty.noCatalog") : t("empty.noResult"))
                    : sortedVisible.map(function (entry) {
                      return el(EntryCard, {
                        key: entry.id,
                        entry: entry,
                        t: t,
                        showZh: showZh,
                        translations: translations,
                        onTranslate: enqueueTranslation,
                        installed: entryInstalled(entry),
                        favorite: panelState.favorites.indexOf(entry.id) !== -1,
                        busy: !!busySet[entry.id],
                        confirm: confirm,
                        onAction: runLifecycle,
                        onFavorite: toggleFavorite
                      });
                    })
                  )
                )
            ),
            el("div", { className: "pp-ops", "data-expanded": opsExpanded || undefined },
              el("div", { className: "pp-ops-head" },
                el("h3", null, t("ops.title")),
                el("button", { type: "button", className: "pp-ops-btn", title: opsExpanded ? t("ops.collapse") : t("ops.expand"), onClick: function () { setOpsExpanded(!opsExpanded); } }, opsExpanded ? "⌃" : "⌄"),
                el("button", { type: "button", className: "pp-ops-btn", title: t("ops.clear"), onClick: clearOperations }, "×")
              ),
              ops.length === 0
                ? el("div", { className: "pp-op" }, "—")
                : ops.slice(0, opsExpanded ? 100 : 2).map(function (op) {
                    return el("div", { className: "pp-op", key: op.id, "data-state": op.state },
                      el("span", null, "[" + t("ops." + op.state) + "]"),
                      el("span", null, op.label),
                      el("span", { className: "pp-op-detail" }, fmtTime(new Date(op.startedAt).toISOString()) + (op.finishedAt ? " → " + fmtTime(new Date(op.finishedAt).toISOString()) : "")),
                      op.detail ? el("span", { className: "pp-op-detail" }, op.detail) : null
                    );
                  })
            ),
            el("div", { className: "pp-settings" },
              el("div", { className: "pp-settings-row" },
                el("span", null, t("settings.profile")),
                el("select", {
                  value: panelState.settings.profile,
                  onChange: function (e) {
                    setPanelState(function (prev) { return { ...prev, settings: { ...prev.settings, profile: e.target.value } }; });
                  }
                },
                  el("option", { value: "web" }, "web"),
                  el("option", { value: "headless" }, "headless")
                ),
                el("button", { type: "button", className: "pp-save", onClick: saveSettings },
                  savedFlash ? t("settings.saved") : t("settings.save"))
              ),
              el("div", { className: "pp-settings-row" },
                el("input", {
                  placeholder: t("settings.remoteUrl"),
                  value: urlDraft,
                  onChange: function (e) { setUrlDraft(e.target.value); }
                })
              ),
              el("div", { className: "pp-settings-row", style: { fontWeight: 600 } },
                t("settings.embedding")),
              el("div", { className: "pp-settings-row" },
                el("input", {
                  type: "password",
                  placeholder: t("settings.apiKey"),
                  value: embKeyDraft,
                  onChange: function (e) { setEmbKeyDraft(e.target.value); }
                })
              ),
              el("div", { className: "pp-settings-row" },
                el("input", {
                  placeholder: t("settings.model"),
                  value: embModelDraft,
                  onChange: function (e) { setEmbModelDraft(e.target.value); }
                }),
                el("input", {
                  placeholder: t("settings.baseUrl"),
                  value: embUrlDraft,
                  onChange: function (e) { setEmbUrlDraft(e.target.value); }
                }),
                el("button", { type: "button", className: "pp-save", onClick: saveEmbConfig },
                  savedFlash ? t("settings.saved") : t("settings.saveEmb"))
              ),
              el("div", { className: "pp-settings-row", style: { color: "var(--dsw-alias-label-tertiary,#8a919b)" } },
                saveError ? t("settings.saveFailed", { message: saveError }) : t("restart.hint"))
            )
          )
        );
      }

      // Sidebar entry button
      var count = panelState.favorites.length;
      var content;
      if (wide) {
        content = el("button", {
          type: "button",
          className: "pp-footbtn",
          "data-on": open || undefined,
          "aria-expanded": open,
          onClick: function () { setOpen(!open); }
        },
          el(IconStore, { size: 16 }),
          el("span", { className: "pp-label" }, t("panel.title")),
          count > 0 ? el("span", { className: "pp-count" }, String(count)) : null
        );
      } else {
        content = el("button", {
          type: "button",
          className: "pp-railbtn",
          "data-on": open || undefined,
          "aria-label": t("panel.title"),
          "aria-expanded": open,
          onClick: function () { setOpen(!open); }
        },
          el(IconStore, { size: 16 })
        );
      }

      return el(React.Fragment, null, content, drawer);
    }

    // ── plugin entry ──────────────────────────────────────────────────────
    var inject = ["slots", "locale"];

    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "plugin-panel: dictionaries");

      ctx.effect(function () {
        return ctx.slots.inject("sidebar.footer.action", function () {
          return ctx.slots.register({
            name: "sidebar.footer.action",
            id: "plugin-panel-market",
            locale: NS
          }, PluginPanelApp);
        });
      }, "plugin-panel: sidebar entry");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
