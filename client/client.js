/**
 * dsh-plugin-orchd · 浏览器半侧（手写 bundle，零构建链，NFR-4.1）。
 *
 * 承载形态：**右侧栏面板**（决策 D3，2026-10-15 由「左侧栏整页」变更；原因是整页会替换中栏，
 * 打开面板就看不到会话）。注册形状逐条对照：
 *   - 类型 + 正文 + 标题：dsh-client-ui-plan/lib/client.js:630-699
 *   - 正文 inject 拿 sessionId（session 作用域）：dsh-client-ui-sidebar-terminal/lib/client.js:475-483
 *   - header 工具席位（**list**，别用 single 的 corner）：dsh-client-ui-jobs/lib/client.js:610-621
 *
 * P1 范围（docs/05 第 4 节）：项目头 + 状态条 + 任务列表（筛选/搜索/排序）+ 详情 + 折叠诊断。
 * 明确的**不做**（留给 P2/P2b）：历史时间线、依赖图、i18n 完整键集、A 路径注入。
 *
 * 只 require 平台 seed 模块表里的词；不引入任何第三方依赖。
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-orchd',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    /** 面板类型 id：sidebarRightTabs.register({id}) 与正文/标题注册的 key 都用它。 */
    const TAB_ID = 'dsh-plugin-orchd'
    /** 页类型 kind（不写 patterns，按 kind 打开）。 */
    const TAB_KIND = 'orchd-tasks'
    const NS = 'orchdTasks'

    /** 列表虚拟化的行高（px）。窄栏里一行两行文字，固定高度才能做纯 CSS 虚拟化。 */
    const ROW_HEIGHT = 52
    /** 想法列表的行高（比任务多一行「在等谁」标注）。 */
    const IDEA_ROW_HEIGHT = 56
    /** 上下多渲染几行，滚动时不闪。 */
    const OVERSCAN = 6
    /** 自绘滚动条的宽度（左右各 2px 内缩 ⇒ 可见滑块 10px）。原生默认只有 5px。 */
    const SCROLLBAR_WIDTH = 14
    /**
     * 自绘滚动条滑块的**最小长度**——原生做不到这一点，这正是自绘的主要理由：
     * 805 任务 × 52px = 41,860px 内容 / 约 520px 可视 ⇒ 原生滑块只有约 6px 长（1.2%），
     * 小到几乎看不见也抓不住。这里给一个固定的可抓取下限。
     */
    const SCROLLBAR_MIN_THUMB = 72

        /**
     * i18n 单表：键 → [中文, 英文]。键名只写一遍，`zh` / `en` 由本表派生后交给 ctx.locale.register；
     * 分组注释沿用中文侧（英文侧同一分组，不再重复注释）。
     */
    const I18N = {
      panel: ['orchd 任务', 'Orchd Tasks'],
      title: ['orchd 任务', 'Orchd Tasks'],
      toggleLabel: ['orchd 任务（在右侧栏打开）', 'Orchd Tasks (opens in the right sidebar)'],
      guideHint: ['当前会话所属项目的 orchd 任务状态', 'orchd task state of the project this session belongs to'],
      retry: ['重试', 'Retry'],
      back: ['返回列表', 'Back to list'],
      jumpTo: ['跳转到任务 ', 'Jump to task '],
      copy: ['复制命令', 'Copy commands'],
      copied: ['已复制', 'Copied'],
      copyFailed: ['复制失败，请手动选择文本', 'Copy failed — select the text manually'],
      copyText: ['复制', 'Copy'],
      copyFailedShort: ['复制失败', 'Copy failed'],
      loading: ['正在读取任务数据…', 'Loading task data…'],
      noSession: ['没有会话上下文', 'No session context'],
      noSessionHint: ['先在左侧选择一个项目会话，再打开这个面板。', 'Select a project session on the left, then open this panel.'],
      project: ['项目', 'Project'],
      snapshotAt: ['更新于', 'Updated at'],
      redetect: ['重新检测', 'Re-detect'],
      detectedBy: ['项目根来源', 'Root source'],
      python: ['Python', 'Python'],
      layout: ['布局', 'Layout'],
      mainWorktree: ['主工作树', 'Main worktree'],
      masterPath: ['定义文件', 'Definition file'],
      snapshot: ['快照', 'Snapshot'],
      diagnostics: ['诊断', 'Diagnostics'],
      showDiagnostics: ['展开诊断', 'Show diagnostics'],
      hideDiagnostics: ['收起诊断', 'Hide diagnostics'],
      reason: ['失败环节', 'Failed stage'],
      detail: ['原始诊断', 'Raw diagnostics'],
      nextStep: ['建议下一步', 'Suggested next step'],
      //// 四态卡片
      stateNotInstalled: ['未接入 orchd', 'Not installed'],
      stateUninitialized: ['已安装，未初始化', 'Installed, uninitialized'],
      stateReady: ['就绪', 'Ready'],
      stateBroken: ['异常', 'Broken'],
      installTitle: ['这个项目还没有接入 orchd', 'This project has not been set up with orchd yet'],
      installHint: ['复制下面的命令，在项目根目录执行即可完成接入；也可以让 agent 帮你接入。', 'Copy the commands below and run them in the project root, or ask an agent to do it.'],
      installAgent: ['让 agent 帮我接入', 'Ask an agent to set it up'],
      installAgentHint: ['把接入指令交给当前会话的 agent，由它按 orchd 官方流程执行（插件自己不做安装）', 'Hand the setup instruction to this session\'s agent; it runs orchd\'s official flow (the plugin never installs anything)'],
      installAgentUnavailable: ['A 路径不可用（命令服务未就绪），请用上面的命令手动接入', 'The A path is unavailable (command service not ready) — use the commands above'],
      installDegradeReason: ['原因：', 'Reason: '],
      installConfirmLead: ['将要注入这条消息（确认前不会发送）：', 'This message will be injected (nothing is sent before you confirm):'],
      installConfirm: ['确认注入', 'Confirm injection'],
      installCancel: ['收起', 'Collapse'],
      installInjecting: ['注入中…', 'Injecting…'],
      installInjected: ['已注入：请在上面的会话里查看 agent 的接入过程。', 'Injected — watch the agent carry out the setup in the conversation.'],
      installFailed: ['注入失败：', 'Injection failed: '],
      initTitle: ['已安装，但还没有任务定义', 'Installed, but no task definitions yet'],
      initHint: ['引擎会把这个项目判为初始化阶段。任务定义文件是：', 'The engine treats this project as first-time initialization. Definition file:'],
      brokenTitle: ['orchd 状态异常', 'orchd state is broken'],
      brokenHint: ['面板不会把它降级成「未初始化」或空看板，下面是失败环节与原始诊断。', 'The panel never downgrades this to "uninitialized" or an empty board. Failed stage and raw diagnostics:'],
      //// 状态条（FR-4）
      sTotal: ['总数', 'Total'],
      sPending: ['待办', 'Pending'],
      sClaimed: ['已认领', 'Claimed'],
      sDone: ['待审', 'Done'],
      sInReview: ['审查中', 'In review'],
      sCompleted: ['已完成', 'Completed'],
      sCancelled: ['已取消', 'Cancelled'],
      //// 状态条即筛选器（FR-5.2 / 5.9 / 5.10）
      filterAll: ['全部', 'All'],
      filterActive: ['活跃', 'Active'],
      filterSummaryHint: ['点击筛选；再点一次回到全部', 'Click to filter; click again for all'],
      zeroHint: ['（0，仍可点击）', '(0, still clickable)'],
      emptyFilteredByStatus: ['该状态当前没有任务：', 'No tasks with this status: '],
      emptyFilteredByKeyword: ['没有匹配「{kw}」的任务', 'No tasks match "{kw}"'],
      emptyFilteredByModule: ['所选模块下没有任务', 'No tasks in the selected modules'],
      clearFiltersShort: ['清除', 'Clear'],
      //// 筛选弹层（FR-5.4 / 5.5）
      filterPanel: ['筛选', 'Filter'],
      filterModules: ['模块（可多选）', 'Modules (multi-select)'],
      filterSort: ['排序', 'Sort'],
      filterNoModules: ['这个项目只声明了一个模块', 'This project declares a single module'],
      filterClearAll: ['清除全部', 'Clear all'],
      filterBadgeHint: ['当前生效的筛选条件数', 'Active filter conditions'],
      //// 状态条与筛选控件
      summaryFromEngine: ['口径：引擎', 'Source: engine'],
      summaryFromPlugin: ['口径：插件自算', 'Source: plugin'],
      //// 列表与筛选（FR-5）
      search: ['搜索 ID / 名称…', 'Search id / name…'],
      sortBy: ['排序', 'Sort'],
      sortDefault: ['活跃优先 · 按时间', 'Active first · by time'],
      sortImportance: ['重要度', 'Importance'],
      sortDifficulty: ['难度', 'Difficulty'],
      sortModule: ['模块', 'Module'],
      sortStatus: ['状态', 'Status'],
      clearFilters: ['清除筛选', 'Clear filters'],
      countShown: ['显示', 'Showing'],
      countUnit: ['条', ''],
      noTasksInProject: ['这个项目还没有任务定义', 'This project has no task definitions'],
      noTasksAfterFilter: ['没有符合当前筛选的任务', 'No tasks match the current filters'],
      showingAll: ['（含终态任务）', '(terminal tasks included)'],
      tasksScrollLabel: ['任务列表滚动条', 'Task list scrollbar'],
      ideasScrollLabel: ['想法列表滚动条', 'Ideas list scrollbar'],
      //// 详情（FR-6）
      dAcceptance: ['验收标准', 'Acceptance criteria'],
      dVerify: ['验证命令', 'Verify command'],
      dVerifyTimeout: ['验证超时', 'Verify timeout'],
      dFilesToEdit: ['写范围', 'Files to edit'],
      dExemptFiles: ['豁免文件', 'Exempt files'],
      dDependsOn: ['依赖（上游）', 'Depends on'],
      dDependents: ['被依赖（下游）', 'Depended on by'],
      dImportance: ['重要度（显式）', 'Importance (explicit)'],
      dImportanceDerived: ['重要度（引擎推导）', 'Importance (engine-derived)'],
      dDifficulty: ['难度', 'Difficulty'],
      dModule: ['模块', 'Module'],
      dClaimedBy: ['认领人', 'Claimed by'],
      dAttempts: ['尝试次数', 'Attempts'],
      dSource: ['来源', 'Source'],
      dEstimatedHours: ['预估工时', 'Estimated hours'],
      dReviewPhase: ['审查阶段', 'Review phase'],
      dReviewers: ['审查人', 'Reviewers'],
      dIndependentReview: ['要求独立审查', 'Independent review required'],
      dRequires: ['能力标签', 'Requires'],
      dModuleRole: ['模块职责', 'Module role'],
      dBrief: ['简介', 'Brief'],
      dNoData: ['暂无', 'none'],
      dDefinitionOnly: ['这条任务只出现在定义层（状态层没有对应行）——可能尚未被引擎认领或已归档。', 'This task exists only in the definition layer.'],
      dStateOnly: ['这条任务只出现在状态层（定义层没有对应行）——可能是归档后的残留事件。', 'This task exists only in the state layer.'],
      dDownstreamCount: ['下游阻塞', 'Blocks downstream'],
      dReviewLoad: ['拉取审查意见', 'Load review history'],
      dReviewLoading: ['加载中…', 'Loading…'],
      dScrollLabel: ['任务详情滚动条', 'Task detail scrollbar'],
      ideasDetailScrollLabel: ['想法详情滚动条', 'Idea detail scrollbar'],
      //// ── 审查事件时间线（FR-8，P2 收窄）──
      reviewTitle: ['审查时间线', 'Review timeline'],
      reviewType: ['审查类型', 'Review type'],
      reviewApproved: ['通过', 'Approved'],
      reviewChanges: ['打回', 'Changes requested'],
      reviewEmpty: ['这个任务还没有审查记录', 'This task has no review records yet'],
      reviewUnavailable: ['该任务的审查时间线读取失败（列表不受影响）', 'Failed to load this task\'s review timeline (the list is unaffected)'],
      reviewUnsupported: ['引擎的只读回看命令只提供「审查提交」事件。以下事件类型引擎未提供，本面板不伪造：', 'The engine\'s read-only readback only exposes "review submitted" events. These event types are not provided by the engine and are never fabricated here:'],
      reviewUnsupportedTypes: ['认领 · 完成 · 审查认领 · 强制状态变更 · 撤回 · 修订', 'claimed · done · review claimed · forced status · retracted · amended'],
      reviewNoTime: ['—', '—'],
      mergeWarning: ['合并告警', 'Merge warning'],
      reviveMarker: ['复活标记', 'Revive marker'],
      //// ── 降级语义（FR-9.3 / 9.5）──
      staleBanner: ['引擎当前不可用，下面显示的是最后一次成功的快照（数据可能已过期）。', 'The engine is currently unavailable — showing the last successful snapshot (data may be stale).'],
      timeoutHint: ['引擎调用超时', 'Engine call timed out'],
      exportDiag: ['复制诊断快照', 'Copy diagnostics snapshot'],
      exportDiagHint: ['把检测结论、各阶段耗时与原始错误复制到剪贴板（只复制，不写文件）', 'Copy detection conclusion, stage timings and raw errors to the clipboard (copy only, never writes files)'],
      //// 空态语义（FR-9.4）
      localError: ['详情加载失败（列表不受影响）', 'Task detail failed to load (the list is unaffected)'],
      //// ── FR-13 想法看板 ──
      viewTasks: ['任务', 'Tasks'],
      viewGraph: ['依赖图', 'Graph'],
      viewIdeas: ['想法', 'Ideas'],
      ideasArchived: ['归档', 'Archived'],
      ideasArchivedUnit: ['条', ''],
      ideasArchivedHint: ['归档只计数，不加载全文；已立任务 / 已覆盖 / 人工 close 的条目都到这里了', 'Archived entries are counted only; entries that became tasks, were covered, or were closed live here'],
      ideasArchivedHistorical: ['归档保留原文，因此这里的 status 是历史值（可能仍写着 pending）', 'The archive keeps the original text, so these statuses are historical'],
      ideasEngineUnsupported: ['本项目的 orchd 引擎没有 ideas 子命令（旧版本）：下面这份列表与状态是直接读 IDEAS.md 得到的，没有引擎清单可交叉核对。升级引擎后会自动启用交叉核对。', "This project's orchd engine has no ideas subcommand (older build): the list and statuses below are read straight from IDEAS.md, with no engine ledger to cross-check. Cross-checking turns on automatically after an engine upgrade."],
      ideasBadgeHint: ['在等你裁决的想法数（论证中 + 待补充）', 'Ideas waiting on you (studying + needs info)'],
      ideasEmpty: ['这个项目的 IDEAS 里还没有条目', 'This project has no IDEAS entries yet'],
      ideasEmptyFiltered: ['该状态当前没有想法：', 'No ideas with this status: '],
      ideasEmptyKeyword: ['没有匹配「{kw}」的想法', 'No ideas match "{kw}"'],
      ideasDegraded: ['正文结构异常，仅显示标题', 'Malformed body — showing title only'],
      ideasOnlyInMarkdown: ['仅存在于 IDEAS.md（引擎清单里没有）', 'Only present in IDEAS.md (missing from the engine list)'],
      ideasOwnerUser: ['等你裁决', 'waiting on you'],
      ideasOwnerAgent: ['等 agent 拆解', 'waiting on an agent'],
      ideasOwnerNone: ['无需等待', 'no action pending'],
      ideasConverted: ['已转成的任务', 'Tasks created from this idea'],
      ideasConvertedHint: ['定义层里 source 指向这条想法的任务', 'Definition-layer tasks whose source points at this idea'],
      ideasConvertedTasks: ['个任务', 'tasks'],
      ideasStatusUnknown: ['未知状态', 'unknown status'],
      ideasArchiveLegacyDropped: ['历史已放弃（dropped）', 'historically dropped'],
      ideasUntasked: ['未立任务', 'never tasked'],
      ideasNoId: ['无法对照', 'no id'],
      ideasNotes: ['追加记录', 'Appended notes'],
      ideasExtra: ['未知字段', 'Unrecognised fields'],
      ideasDetailPath: ['详档', 'Detail doc'],
      ideasCommands: ['你可以执行的命令（id 已填好）', 'Commands you can run (id already filled in)'],
      ideasCommandsHint: ['本面板只读：不提供 propose / confirm / close 按钮，只帮你复制命令。这些命令按当前状态给出；在途任务引用期间引擎会拒绝搬走（source_live_reference）。', 'This panel is read-only: no propose / confirm / close buttons — it only copies commands. They match the current status; while in-flight tasks reference the entry the engine refuses to move it (source_live_reference).'],
      ideasCommandLegend: ['append = 往这条想法追加一条带时间戳的追记（不动原正文、不改状态，就是「追加记录」里那几行）；confirm / close = 你对这条想法的裁决（仅用户可执行；close 一律归档并留下裁决理由）。括号里的 <…> 是占位符，换成你自己要写的字。', 'append = add one timestamped note to this idea (it never touches the original body or status — these are the lines shown under "Appended notes"); confirm / close = your decision on this idea (user-only; close always archives the entry with your reason). The <…> parts are placeholders — replace them with your own text.'],
      ideasPropose: ['新建想法（引擎侧的正式通道）', 'New idea (the engine-side channel)'],
      ideasProposeHint: ['新建时还没有 id，所以标题里要自己声明一个（形如「标题（id: my-idea）」）。', 'A new idea has no id yet, so declare one in the title (e.g. "Title (id: my-idea)").'],
      iStudy: ['论证中', 'Studying'],
      iQuestioning: ['待补充', 'Needs info'],
      iPending: ['待拆解', 'Awaiting breakdown'],
      iConverted: ['已转任务', 'Turned into tasks'],
      iCovered: ['已覆盖', 'Covered'],
      //// ── FR-7 依赖图（P2b）──
      graphCounts: ['节点 {n} · 边 {e}', '{n} nodes · {e} edges'],
      graphIncludeTerminal: ['含终态任务', 'Include finished tasks'],
      graphIncludeTerminalHint: ['把已完成 / 已取消的任务也画进来（默认只画活跃任务与它们的直接邻居）', 'Also draw completed / cancelled tasks (by default only active tasks and their direct neighbours are drawn)'],
      graphBackToAll: ['返回全图', 'Back to full graph'],
      graphEmptyActive: ['当前没有活跃任务', 'No active tasks right now'],
      graphEmptyActiveHint: ['把「含终态任务」打开可以看完整依赖图（本图隐藏了 {n} 个终态任务）。', 'Turn on "Include finished tasks" to see the whole dependency graph ({n} finished tasks hidden here).'],
      graphHiddenTerminal: ['已隐藏 {n} 个终态任务', '{n} finished tasks hidden'],
      graphTruncated: ['节点太多，只画了前 {n} 个', 'Too many nodes — only the first {n} are drawn'],
      graphAnomalyTitle: ['依赖关系异常（引擎不阻止，这里如实标注）', 'Dependency anomalies (the engine does not block these; they are labelled here)'],
      graphCycle: ['循环依赖：', 'Dependency cycle: '],
      graphDangling: ['依赖了不存在的任务：', 'Depends on a missing task: '],
      graphSelf: ['任务依赖了自己：', 'Task depends on itself: '],
      graphMissing: ['（不存在）', '(missing)'],
      graphUnlayered: ['环上或被环阻塞，无法分层', 'On a cycle or blocked by one — cannot be layered'],
      graphAnomalyMore: ['…另有 {n} 个', '…+{n} more'],
      graphBlocked: ['阻塞下游', 'blocks'],
      graphFocus: ['聚焦', 'Focus'],
      graphFocusUpstream: ['上游', 'upstream'],
      graphFocusDownstream: ['下游', 'downstream'],
      graphOpenTask: ['打开详情', 'Open detail'],
      graphHint: ['点一个节点看它的上下游闭包；点「返回全图」回到活跃子图', 'Click a node to see its upstream/downstream closure; "Back to full graph" returns to the active subgraph'],
      graphScrollLabel: ['依赖图滚动条', 'Dependency graph scrollbar'],
      graphUnavailable: ['依赖图数据不可用', 'Dependency graph data unavailable'],
      graphLensLabel: ['图谱镜头', 'Graph lens'],
      graphLensChain: ['依赖链', 'Dependency chain'],
      graphLensUmbrella: ['伞包', 'Umbrellas'],
      graphLensWave: ['逻辑波次', 'Logical waves'],
      graphClassic: ['经典视图', 'Classic view'],
      graphWaveLabel: ['第 {n} 波', 'Wave {n}'],
      graphWaveUnlayered: ['未分层', 'Ungrouped'],
      graphWaveTruncated: ['共 {n} 波，显示前 {m} 波', '{n} waves total; showing first {m}'],
      graphUmbrellaCount: ['{n} 个任务', '{n} tasks'],
      graphUmbrellaMissingTitle: ['标题缺失（显示 slug）', 'Title missing (showing slug)'],
      graphUmbrellaMissingTitleCount: ['标题缺失 {n} 个', '{n} missing umbrella titles'],
      graphUmbrellaUnattributed: ['{n} 个任务没有来源伞，未参与投影', '{n} tasks have no source umbrella (not projected)'],
      graphUmbrellaCollapse: ['收起', 'Collapse'],
      graphUmbrellaExpanded: ['已展开 {n}', 'Expanded {n}'],
      graphLegendDependsOn: ['depends_on（逐条事实）', 'depends_on (per-item fact)'],
      graphLegendAggregated: ['depends_on_aggregated（伞间聚合）', 'depends_on_aggregated (umbrella aggregate)'],
      graphLegendSourcedFrom: ['sourced_from（伞 → 成员任务）', 'sourced_from (umbrella → members)'],
      graphLegendEdge: ['其它边', 'Other edges'],
      graphLegendProjectedNote: ['投影边，非逐条 depends_on 事实', 'Projected edge, not a per-item depends_on fact'],
      graphZoomGroup: ['缩放', 'Zoom'],
      graphZoomIn: ['放大', 'Zoom in'],
      graphZoomOut: ['缩小', 'Zoom out'],
      graphZoomFit: ['适配', 'Fit'],
      graphZoomReset: ['100%', '100%'],
      graphLensImportance: ['重要性', 'Importance'],
      graphLensFiles: ['文件冲突', 'File conflicts'],
      graphImportanceExplicit: ['显式', 'explicit'],
      graphImportanceDerived: ['推导', 'derived'],
      graphLegendImportance: ['显式重要度优先于推导', 'Explicit importance wins over derived'],
      graphLegendTouches: ['同文件编辑关系（投影边，非 depends_on）', 'Same-file edits (projected, not depends_on)'],
      graphFileTruncated: ['共 {n} 文件，显示前 {m}（{k} 任务）', '{n} files; showing {m} ({k} tasks)'],
      graphCriticalPath: ['关键路径 {tasks} 个任务 · 跨 {levels} 层', 'Critical path: {tasks} tasks · {levels} levels'],
      graphCriticalPathHours: ['预计 {hours} 小时', 'est. {hours} h'],
      graphCriticalPathMissing: ['{missing} 个任务无估时', '{missing} tasks without estimate'],
    }
    const pickLocale = (index) => Object.fromEntries(Object.keys(I18N).map((key) => [key, I18N[key][index]]))
    const zh = pickLocale(0)
    const en = pickLocale(1)
// ── 会话身份（FR-1.1）────────────────────────────────────────────────
    //
    // 本插件全部注册都落在 **session 作用域**：sidebar.right.pane.tab（keyed/session）、
    // .title、conversation.session.header.utilities（list/session）。
    // 框架只对 session / session-maybe 作用域的条目把 binding.key（= sessionId）传给
    // inject（dsh-client-ui-renderer/lib/client.js:415-421），所以正文里
    // inject: (sessionId) => ({ sessionId }) 直接可用。
    //
    // 对照：main 是 **root 作用域**，它的 inject 拿不到 sessionId —— 早前用左侧栏整页时
    // 踩过这个坑（那时才需要 ctx.uiSession.current）。见 docs/04 第 6.2 节。

    // ── 数据层 ────────────────────────────────────────────────────────────
    /** 同源 fetch，只传 sessionId（NFR-2.1：前端不传任何路径）。 */
    async function api(path, params, signal) {
      const search = new URLSearchParams({ session: params.session })
      for (const [key, value] of Object.entries(params)) {
        if (key === 'session' || value === undefined || value === null) continue
        search.set(key, String(value))
      }
      const response = await fetch(`${path}?${search.toString()}`, { signal, headers: { accept: 'application/json' } })
      let body
      try {
        body = await response.json()
      } catch {
        throw new Error(`宿主返回了非 JSON 响应（HTTP ${response.status}）`)
      }
      if (body?.ok !== true) {
        const error = new Error(body?.error?.message ?? `请求失败（HTTP ${response.status}）`)
        error.envelope = body
        throw error
      }
      return body
    }

    // ── 主题与排版 ───────────────────────────────────────────────────────
    // 只用 DSH 设计令牌（FR-11.3：不硬编码色值，亮/暗主题都可读）。
    // 告警色（横幅 / 异常 / 审查多处复用，收成常量避免重复字面量）。
    const WARN = 'var(--dsw-alias-state-warn-primary, currentColor)'
    const TOKEN = {
      label: 'var(--dsw-alias-label-primary, inherit)',
      labelSecondary: 'var(--dsw-alias-label-secondary, inherit)',
      labelTertiary: 'var(--dsw-alias-label-tertiary, inherit)',
      border: 'var(--dsw-alias-border-l2, currentColor)',
      surface: 'var(--dsw-alias-bg-layer-1, transparent)',
      surface2: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))',
      surface3: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.16))',
      hover: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12))',
      radius: 'var(--dsw-radius-lg, 10px)',
      radiusSm: 'var(--dsw-radius-md, 6px)',
      mono: 'var(--dsw-font-markdown-code-font-family, ui-monospace, Consolas, monospace)'
    }

    /** 四态 → 语义色令牌（FR-11.4；NFR-6.3 要求同时有文字）。 */
    const STATE_TOKEN = {
      ready: 'var(--dsw-alias-state-success-primary, currentColor)',
      uninitialized: WARN,
      broken: 'var(--dsw-alias-state-error-primary, currentColor)',
      not_installed: 'var(--dsw-alias-state-business-primary, currentColor)'
    }

    /** 任务状态 → 语义色。 */
    const STATUS_TOKEN = {
      pending: 'var(--dsw-alias-label-secondary, currentColor)',
      claimed: 'var(--dsw-alias-state-business-primary, currentColor)',
      done: 'var(--dsw-alias-state-success-tertiary, currentColor)',
      in_review: WARN,
      completed: 'var(--dsw-alias-state-success-primary, currentColor)',
      cancelled: 'var(--dsw-alias-label-dimmed, currentColor)'
    }

    const styles = {
      page: { height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit', color: TOKEN.label, overflow: 'hidden' },
      head: { padding: '12px 14px 8px', flex: '0 0 auto' },
      header: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
      title: { fontSize: 15, fontWeight: 600, margin: 0 },
      sub: { color: TOKEN.labelTertiary, fontSize: 12 },
      spacer: { flex: 1 },
      button: { font: 'inherit', fontSize: 12.5, padding: '3px 9px', borderRadius: TOKEN.radiusSm, border: `1px solid ${TOKEN.border}`, background: 'transparent', color: 'inherit', cursor: 'pointer' },
      buttonActive: { background: TOKEN.hover },
      buttonDisabled: { opacity: 0.5, cursor: 'default' },
      iconButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, padding: 0, borderRadius: 999, border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' },
      // 筛选入口与状态条入口都是按钮，必须有 hover / 选中 / 键盘焦点（FR-5.10）
      filterEntry: { font: 'inherit', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 999, border: `1px solid ${TOKEN.border}`, background: 'transparent', color: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' },
      filterEntryActive: { border: `1px solid ${TOKEN.label}`, background: TOKEN.hover },
      // 状态条入口：单选语义（role=radio）。选中态**必须用描边**，不得只靠颜色深浅（FR-5.10）
      stripEntry: { font: 'inherit', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 999, border: `1px solid ${TOKEN.border}`, background: 'transparent', color: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' },
      stripEntryOn: { border: `2px solid ${TOKEN.label}`, padding: '0 7px', background: TOKEN.hover, fontWeight: 600 },
      // 0 值弱化但仍可点（FR-5.9）——用透明度而不是 disabled
      stripEntryZero: { opacity: 0.55 },
      // ── 视图切换：与状态条**拉开层级**（只用字号与颜色，不引入第二种控件形态）──
      //
      // 视图切换回答「看什么」（更高一层），状态条回答「筛什么」（更细一层）。
      // 所以：字号 13 vs 11.5、未选中走次级色（比状态条的中性色更退后）、
      // 选中用主色 + 600 字重 + 描边。宽度/内边距也相应加大，让它看起来更「重」。
      viewSwitchRow: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '0 14px 8px', flex: '0 0 auto' },
      viewEntry: { font: 'inherit', fontSize: 13, lineHeight: 1.5, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 12px', borderRadius: 999, border: `1px solid transparent`, background: 'transparent', color: TOKEN.labelSecondary, cursor: 'pointer', whiteSpace: 'nowrap' },
      viewEntryActive: { border: `1px solid ${TOKEN.label}`, background: TOKEN.hover, color: TOKEN.label, fontWeight: 600 },
      // 依赖图的工具条：节点/边计数 + 「含终态任务」开关 + 「返回全图」
      graphToolbar: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '0 14px 8px', flex: '0 0 auto' },
      // FR-14 镜头切换器 + 图例（复用 chipButton / note 皮肤，不另立一套）
      graphLensRow: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '0 14px 8px', flex: '0 0 auto' },
      graphLensActive: { background: TOKEN.hover, color: TOKEN.label, fontWeight: 600 },
      legendRow: { display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 11.5, color: TOKEN.labelSecondary },
      countValue: { fontVariantNumeric: 'tabular-nums', color: TOKEN.label, fontWeight: 600 },
      // ⚠ 弹层的定位上下文是 **控件容器**（styles.controls，position: relative），
      // 不是「筛选」按钮自己那个窄容器。踩过的坑：把 position:relative 放在按钮外层
      // 的 flex item 上，`left/right` 就相对约 60px 宽的按钮算，弹层被压成一字一行。
      popover: { position: 'absolute', zIndex: 30, top: '100%', left: 14, right: 14, marginTop: 6, padding: '10px 12px', borderRadius: TOKEN.radius, border: `1px solid ${TOKEN.border}`, background: TOKEN.surface, boxShadow: '0 6px 18px rgba(0,0,0,0.22)', maxHeight: '60vh', overflowY: 'auto', boxSizing: 'border-box' },
      popoverLabel: { fontSize: 11.5, color: TOKEN.labelTertiary, margin: '0 0 4px' },
      checkRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
      radioRow: { display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
      radioItem: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' },
      relativeRow: { display: 'inline-flex', alignItems: 'center' },
      card: { margin: '12px 14px', padding: '12px 14px', borderRadius: TOKEN.radius, border: `1px solid ${TOKEN.border}`, background: TOKEN.surface, flex: '0 0 auto' },
      cardTitle: { fontSize: 14, fontWeight: 600, margin: '0 0 6px' },
      badge: { display: 'inline-block', padding: '0 7px', borderRadius: 999, fontSize: 11.5, border: '1px solid currentColor' },
      grid: { display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '3px 10px', fontSize: 12.5 },
      key: { color: TOKEN.labelTertiary, whiteSpace: 'nowrap' },
      mono: { fontFamily: TOKEN.mono, fontSize: 12, wordBreak: 'break-word', color: TOKEN.labelSecondary },
      pre: { margin: '6px 0 0', padding: '8px 10px', borderRadius: TOKEN.radiusSm, background: TOKEN.surface3, overflow: 'auto', fontFamily: TOKEN.mono, fontSize: 12, whiteSpace: 'pre-wrap', color: TOKEN.labelSecondary, maxHeight: 180 },
      /**
       * 可复制命令专用：必须**自己换行**、不能靠横向滚动条。
       * 面板只有约 390px 宽，而命令约 90–100 字符；`pre-wrap` 只在空格处断，
       * 遇到超长 token（长 id 等）就会触发 `overflow: auto` 的横向滚动条——
       * 而平台的滚动条是 5px 半透明（当初「看不见的滚动条」那个坑）。
       * 故这里显式 `overflowWrap: anywhere`，任何长度都能断。
       */
      cmdPre: { margin: '4px 0 0', padding: '8px 10px', borderRadius: TOKEN.radiusSm, background: TOKEN.surface3, overflow: 'auto', fontFamily: TOKEN.mono, fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: TOKEN.labelSecondary, maxHeight: 180 },
      // ── 滚动区与**自绘滚动条** ─────────────────────────────────────────
      //
      // 为什么不直接用原生滚动条（两次踩坑的结论）：
      //  ① 平台全局注入 `::-webkit-scrollbar{width:var(--dsh-scrollbar-width)}` 且
      //     `body{--dsh-scrollbar-width:5px; --dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l1)}`
      //     ——5px 宽 + 最弱色阶（白 10%），在深色侧栏上等同「没有滚动条」；
      //  ② 就算重绑变量调宽到 9px，**滑块长度仍是内容比例**：虚拟列表内容 805×52=41,860px、
      //     可视区 ~520px，滑块只有约 6px 长（1.2%）。Chromium 没有「滑块最小长度」属性。
      // 所以要同时把宽度和长度做大，只能自绘：宽度固定、长度取 max(比例, 最小可抓取长度)。
      listHost: { position: 'relative', flex: '1 1 auto', minHeight: 0, display: 'flex' },
      scroll: {
        flex: '1 1 auto',
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        minHeight: 0,
        // 隐藏原生条（自绘的接管）；`scrollbar-width:none` 在 Chromium 121+ 生效
        scrollbarWidth: 'none'
      },
      scrollbarTrack: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        right: 2,
        width: SCROLLBAR_WIDTH,
        zIndex: 5
      },
      scrollbarThumb: {
        position: 'absolute',
        left: 2,
        right: 2,
        borderRadius: 999,
        background: 'var(--dsw-alias-scrollbar-bg-l2)',
        cursor: 'default',
        touchAction: 'none'
      },
      scrollbarThumbActive: { background: 'var(--dsw-alias-scrollbar-hover-l2)' },
      // 横向自绘条（只有声明 `horizontal` 的用法才渲染）：几何与纵向完全相同，只是换了轴。
      scrollbarTrackH: {
        position: 'absolute',
        left: 2,
        right: 2,
        bottom: 2,
        height: SCROLLBAR_WIDTH,
        zIndex: 5
      },
      scrollbarThumbH: {
        position: 'absolute',
        top: 2,
        bottom: 2,
        borderRadius: 999,
        background: 'var(--dsw-alias-scrollbar-bg-l2)',
        cursor: 'default',
        touchAction: 'none'
      },
      summaryStrip: { display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 14px 8px', flex: '0 0 auto' },
      chip: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 999, border: `1px solid ${TOKEN.border}`, fontSize: 11.5, whiteSpace: 'nowrap' },
      // chip 的可点版本：字号/内边距/边框与 chip 完全一致 ⇒ 同行等高。
      // 想法视图的「清除」按钮与归档 chip 同行：若用常规 button（高约 25px）会把
      // 20px 的行撑高，且按钮按筛选条件出现/消失 ⇒ 行高跳变、下方内容位移（用户实测反馈）。
      chipButton: { font: 'inherit', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', padding: '1px 7px', borderRadius: 999, border: `1px solid ${TOKEN.border}`, whiteSpace: 'nowrap', background: 'transparent', color: 'inherit', cursor: 'pointer' },
      chipDot: { width: 6, height: 6, borderRadius: 999, background: 'currentColor', display: 'inline-block' },
      // position: relative 是**弹层的定位上下文**（见 styles.popover 的注释）
      controls: { position: 'relative', display: 'flex', flexDirection: 'column', gap: 6, padding: '0 14px 8px', flex: '0 0 auto' },
      controlRow: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
      input: { font: 'inherit', fontSize: 12.5, padding: '4px 8px', borderRadius: TOKEN.radiusSm, border: `1px solid ${TOKEN.border}`, background: 'transparent', color: 'inherit', width: '100%', boxSizing: 'border-box' },
      select: { font: 'inherit', fontSize: 12.5, padding: '3px 6px', borderRadius: TOKEN.radiusSm, border: `1px solid ${TOKEN.border}`, background: TOKEN.surface2, color: 'inherit' },
      virtual: { position: 'relative', width: '100%' },
      // 右侧内边距要避开自绘滚动条（轨道 right:2 + width:12 ⇒ 占最右 14px），否则文字被滑块压住
      rowStyle: { position: 'absolute', left: 0, right: 0, height: ROW_HEIGHT, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, padding: `0 ${SCROLLBAR_WIDTH + 10}px 0 14px`, boxSizing: 'border-box', border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit' },
      rowTitle: { display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 },
      rowId: { fontFamily: TOKEN.mono, fontSize: 11, color: TOKEN.labelTertiary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '55%' },
      rowName: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 },
      rowMeta: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, color: TOKEN.labelTertiary, whiteSpace: 'nowrap', overflow: 'hidden' },
      statusTag: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, whiteSpace: 'nowrap' },
      note: { padding: '0 14px 8px', fontSize: 12, color: TOKEN.labelTertiary, flex: '0 0 auto' },
      /**
       * 行内提示（跟在按钮右侧的说明文字）：必须能**收缩 + 换行**。
       *
       * 不能直接复用 note：note 是块级提示，带 flex: 0 0 auto；它作为 controlRow 的
       * flex item 会拒绝收缩，文本按 max-content 撑出去——390px 侧栏里整句被右边界裁掉
       * （用户实测：接入卡「让 agent 帮我接入」下方那行说明）。这里显式放开收缩，
       * 允许在任意位置断行，宽度随面板大小自适应。
       */
      hint: { flex: '1 1 auto', minWidth: 0, padding: 0, fontSize: 12, color: TOKEN.labelTertiary, overflowWrap: 'anywhere' },
      // 右侧内边距避开自绘滚动条（轨道 right:2 + width:14 ⇒ 占最右 16px），否则文字被滑块压住
      detailBody: { padding: `0 ${SCROLLBAR_WIDTH + 10}px 14px 14px`, boxSizing: 'border-box' },
      /**
       * 详情页骨架：**固定条 + 只滚正文**。
       *
       * 之前整个详情（含「返回」与「拉取审查意见」按钮）都塞在滚动容器里，内容一长
       * 按钮就跟着滚出视野（用户实测反馈：「反馈列表按钮不要随内容滚动」）。
       * 现在外层是列向 flex，工具条 `flexShrink: 0` 不参与滚动，只有正文区滚。
       * 工具条是普通 flex 兄弟节点（不是 sticky 浮层），所以正文永远不会从它下面穿过，
       * 不需要额外的分隔线。
       */
      detailPage: { flex: '1 1 auto', minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column' },
      detailBar: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 6px', flexShrink: 0 },
      // 与 `scroll` 同源，但**不设 height:100%**——否则它会按父容器整高算，把固定条挤出去
      detailScroll: {
        flex: '1 1 auto',
        width: '100%',
        minHeight: 0,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        scrollbarWidth: 'none'
      },
      h4: { margin: '12px 0 4px', fontSize: 12.5, color: TOKEN.labelTertiary, fontWeight: 600 },
      ul: { margin: '2px 0 0', paddingInlineStart: 18 },
      li: { marginBottom: 2 },
      codeBlock: { margin: '4px 0 0', padding: '8px 10px', borderRadius: TOKEN.radiusSm, background: TOKEN.surface3, fontFamily: TOKEN.mono, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: TOKEN.labelSecondary },
      summaryBox: { margin: '0 14px 10px', padding: '8px 10px', borderRadius: TOKEN.radiusSm, background: TOKEN.surface2, fontSize: 12, color: TOKEN.labelSecondary }
    }

    // ── 小组件 ───────────────────────────────────────────────────────────
    function OrchdIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16
      return React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false'
      }, [
        React.createElement('circle', { key: 'a', cx: 6, cy: 6, r: 2.5 }),
        React.createElement('circle', { key: 'b', cx: 18, cy: 6, r: 2.5 }),
        React.createElement('circle', { key: 'c', cx: 12, cy: 18, r: 2.5 }),
        React.createElement('path', { key: 'd', d: 'M7.8 7.8 10.4 15.8' }),
        React.createElement('path', { key: 'e', d: 'M16.2 7.8 13.6 15.8' }),
        React.createElement('path', { key: 'f', d: 'M8.5 6h7' })
      ])
    }

    /**
     * 自绘滚动容器：**任务列表 + 两个详情页 + 依赖图共用**。
     *
     * ⚠ 这里**故意不展开复用**任务列表那套滚动样式（client 套件有断言守着「只有一处引用」），
     * 免得滚动容器出现第二份定义。
     * 纵向一律自绘（宽度/最小长度都是我们定的）；`horizontal` 打开的用法另加一条**横向**自绘条。
     *
     * 为什么横向也要自绘：图的宽度由**层内节点数**决定，全图模式下轻易超过 390px 的窄栏
     * （实测 848px）。而 `scrollbar-width:none` 会把原生横向条一并藏掉 ⇒ 只有触控板/Shift+滚轮
     * 能横移，**纯滚轮的鼠标用户和键盘用户根本够不到右侧内容**（探针 `dev/render-pane.mjs`
     * 的 pane-graph 变体实测「横向溢出 460px、原生滚动条槽位 0px」）。自绘条是唯一有形的抓手。
     */
    styles.graphScroll = {
      flex: '1 1 auto',
      width: '100%',
      height: '100%',
      overflowY: 'auto',
      overflowX: 'auto',
      overscrollBehavior: 'contain',
      minHeight: 0,
      scrollbarWidth: 'none'
    }

    function Row({ label, children }) {
      return [
        React.createElement('div', { key: 'k', style: styles.key }, label),
        React.createElement('div', { key: 'v', style: styles.mono }, children)
      ]
    }

    function Card({ title, badge, state, children }) {
      const color = STATE_TOKEN[state] ?? TOKEN.labelSecondary
      return React.createElement('section', { style: styles.card }, [
        React.createElement('h3', { key: 'h', style: styles.cardTitle }, [
          badge === undefined
            ? null
            : React.createElement('span', { key: 'b', style: { ...styles.badge, color, marginRight: 8 } }, badge),
          title
        ].filter(Boolean)),
        React.createElement('div', { key: 'c' }, children)
      ])
    }

    /**
     * 交互反馈 CSS（hover / 按下 / 焦点环）。
     *
     * 为什么**必须注入样式表**而不是写内联样式：
     *   ① 内联样式**没有伪类**，`:hover`/`:active`/`:focus-visible` 根本写不出来；
     *   ② 我们的按钮都内联写了 `background: transparent`，而**内联优先级高于任何选择器**
     *      ——所以 `:hover` 规则必须带 `!important` 才生效。
     *   这正是「鼠标放上去/点上去没有变化」的机制（用户实测反馈）。
     *
     * 注入方式抄平台自己：`dsh-client-ui-sidebar-right` 的 ExpandButton 就是
     * `<style data-plugin-css=…>` 挂到 `document.head`（见 docs/04 第 9c 节）。
     *
     * 颜色用平台**真实语义变量**（第一方插件通用做法，实测 14 处在用）：
     *   hover  → `--dsw-alias-interactive-bg-hover`
     *   按下    → `--dsw-alias-interactive-bg-active`
     * 写错变量名会**静默失效**，所以两个都带兜底色，并由探针真发鼠标事件验证。
     */
    const INTERACTION_CSS_TAG = 'dsh-plugin-orchd/interaction.css'

    function interactionCss() {
      const hover = 'var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12))'
      const active = 'var(--dsw-alias-interactive-bg-active, rgba(127, 127, 127, 0.2))'

      return [
        // 悬停：禁用态不亮（否则会让人以为能点）
        `[data-orchd-toggle]:hover,[data-orchd-panel] button:hover:not(:disabled){background-color:${hover}!important}`,
        // 按下：比悬停更深一档
        `[data-orchd-toggle]:active,[data-orchd-panel] button:active:not(:disabled){background-color:${active}!important}`,
        // 键盘可达：焦点环（鼠标点击不显示，避免视觉噪音）
        '[data-orchd-toggle]:focus-visible,[data-orchd-panel] button:focus-visible{outline:2px solid var(--dsw-alias-label-secondary, currentColor);outline-offset:1px}'
      ].join('')
    }

    /** 幂等挂载交互 CSS；返回 disposer（插件禁用时零残留，FR-12.3）。 */
    function ensureInteractionCss() {
      if (typeof document === 'undefined' || document?.head === undefined) return () => {}
      const selector = `style[data-plugin-css=${JSON.stringify(INTERACTION_CSS_TAG)}]`
      if (document.querySelector(selector) === null) {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-plugin-orchd'
        tag.dataset.pluginCss = INTERACTION_CSS_TAG
        tag.textContent = interactionCss()
        document.head.appendChild(tag)
      }
      return () => {
        document.querySelector(selector)?.remove?.()
      }
    }

    // 标题脉冲环已移除：入口按钮改为「打开 / 关闭」toggle（见 OrchdToggleButton），
    // 再点有可见反馈（面板收起），不再需要「面板本来开着 ⇒ 点了没反应」的提示。

    async function writeClipboard(text) {
      if (navigator.clipboard?.writeText !== undefined) {
        await navigator.clipboard.writeText(text)
        return
      }
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
    }

    /**
     * 复制按钮（FR-6.3 验证命令「可复制」、AC-13.4 详档路径「可复制」）。
     * 三种状态都有可见反馈（FR-9.1）：待复制 / 已复制 / 复制失败。
     */
    function CopyButton({ text, t, label }) {
      const [state, setState] = React.useState('idle')
      const text0 = label ?? t('copyText')
      const caption = state === 'done' ? t('copied') : (state === 'failed' ? t('copyFailedShort') : text0)
      return React.createElement('button', {
        type: 'button',
        'data-orchd-copy': 'true',
        'data-copy-state': state,
        style: { ...styles.button, ...(state === 'failed' ? { color: 'var(--dsw-alias-state-error-primary, currentColor)' } : {}) },
        title: state === 'failed' ? t('copyFailed') : text0,
        'aria-label': text0,
        onClick: async () => {
          try {
            await writeClipboard(String(text ?? ''))
            setState('done')
          } catch {
            setState('failed')
          }
        }
      }, caption)
    }

    function CommandBlock({ text, t }) {
      return React.createElement('div', null, [
        React.createElement('pre', { key: 'pre', style: styles.cmdPre }, text),
        React.createElement('div', { key: 'row', style: styles.controlRow }, [
          React.createElement(CopyButton, { key: 'btn', text, t, label: t('copy') })
        ])
      ])
    }

    /** 小标题行 + 右侧动作（用于「验证命令」「详档」这类需要复制入口的段落）。 */
    function SectionHead({ label, action }) {
      return React.createElement('div', { style: { ...styles.h4, display: 'flex', alignItems: 'center', gap: 8 } }, [
        React.createElement('span', { key: 'l' }, label),
        React.createElement('span', { key: 'sp', style: styles.spacer }),
        action === undefined ? null : React.createElement('span', { key: 'a' }, action)
      ].filter(Boolean))
    }

    /**
     * 状态条 = 筛选器（FR-5.2）。
     *
     * 设计要点（每一条都对应一条验收标准）：
     *  - **8 个互斥模式**：`all`（总数）/ `active`（活跃=非终态）/ 6 个具体状态；单选（radio 语义，AC-5.6/5.7）。
     *  - **再点一次回全部**（AC-5.7）：`onSelect(status === current ? 'all' : status)`。
     *  - **0 值仍可点击**（FR-5.9/AC-5.8）：用 `opacity` 弱化，**不是** `disabled`。
     *  - **计数直接采用引擎 summary**（FR-4.3），UI 不重算；`cancelled` 等缺键显示「—」。
     *  - 可点击表达（FR-5.10）：`role=radio` + `aria-checked` + `cursor:pointer` + 选中态**描边**。
     */
    function StatusStripFilter({ summary, mode, onSelect, counts, t, labels, unitKey }) {
      // `labels` 由调用方给（任务视图用 6 个任务状态，想法视图用 5 个想法状态），
      // 但两边**同一套交互模式**（FR-13.6）。
      const entries = [{ key: 'all', label: t('filterAll') }, { key: 'active', label: t('filterActive') }]
        .concat(labels.map((status) => ({ key: status, label: t(unitKey(status)) })))

      const valueOf = (key) => {
        if (key === 'all') return summary?.total ?? null
        if (key === 'active') return summary?.active ?? null
        // 计数优先取引擎 summary（FR-4.3）；引擎没给时回退到自算的 counts（插件口径）
        if (summary !== null && summary !== undefined && summary[key] !== undefined) return summary[key]
        return counts?.[key] ?? null
      }

      return React.createElement('div', {
        style: { ...styles.summaryStrip, position: 'relative' },
        role: 'radiogroup',
        'aria-label': t('sTotal'),
        title: t('filterSummaryHint'),
        'data-orchd-summary': summary?.source ?? 'plugin'
      }, [
        ...entries.map(({ key, label }) => {
          const on = mode === key
          const value = valueOf(key)
          const zero = value === 0
          return React.createElement('button', {
            key,
            type: 'button',
            role: 'radio',
            'aria-checked': on,
            'aria-label': `${label}: ${value === null || value === undefined ? '—' : String(value)}`,
            title: `${label}: ${value === null || value === undefined ? '—' : String(value)}${zero ? ' ' + t('zeroHint') : ''}`,
            'data-orchd-status-entry': key,
            'data-orchd-selected': on ? 'true' : 'false',
            style: {
              ...styles.stripEntry,
              ...(on ? styles.stripEntryOn : {}),
              // 0 值弱化但**不禁用**（FR-5.9 / AC-5.8）
              ...(zero ? styles.stripEntryZero : {}),
              color: STATUS_TOKEN[key] ?? TOKEN.labelSecondary
            },
            onClick: () => onSelect(on ? 'all' : key)
          }, [
            React.createElement('span', { key: 'd', style: styles.chipDot }),
            React.createElement('span', { key: 'l' }, `${label} `),
            React.createElement('span', { key: 'v', style: styles.countValue },
              value === null || value === undefined ? '—' : String(value))
          ])
        }),
        React.createElement('span', {
          key: 'src',
          style: { ...styles.chip, color: TOKEN.labelTertiary },
          title: summary?.source === 'engine' ? t('summaryFromEngine') : t('summaryFromPlugin')
        }, summary?.source === 'engine' ? t('summaryFromEngine') : t('summaryFromPlugin'))
      ])
    }

    /** 当前生效的模块筛选（多选，checkbox 语义）。状态是单选，两者语义不同（见 FR-5 注记）。 */
    function ModuleFilter({ modules, selected, onToggle, t }) {
      if (modules.length === 0) {
        return React.createElement('div', { style: styles.popoverLabel }, t('filterNoModules'))
      }
      return React.createElement('div', { style: styles.checkRow }, modules.map((module) =>
        React.createElement('label', { key: module, style: styles.radioItem }, [
          React.createElement('input', {
            key: 'i',
            type: 'checkbox',
            checked: selected.includes(module),
            'aria-label': module,
            onChange: () => onToggle(module)
          }),
          React.createElement('span', { key: 's' }, module)
        ])
      ))
    }

    /** 排序选择（radio 组，收进弹层——FR-5.4）。 */
    function SortFilter({ sortBy, onSelect, t }) {
      const options = [
        ['default', t('sortDefault')],
        ['importance', t('sortImportance')],
        ['difficulty', t('sortDifficulty')],
        ['module', t('sortModule')],
        ['status', t('sortStatus')]
      ]
      return React.createElement('div', { style: styles.radioRow, role: 'radiogroup', 'aria-label': t('filterSort') },
        options.map(([value, label]) =>
          React.createElement('label', { key: value, style: styles.radioItem }, [
            React.createElement('input', {
              key: 'i',
              type: 'radio',
              name: 'orchd-sort',
              checked: sortBy === value,
              'aria-label': label,
              onChange: () => onSelect(value)
            }),
            React.createElement('span', { key: 's' }, label)
          ])
        )
      )
    }

    /**
     * 筛选弹层（FR-5.5）：入口常驻可见并带「生效条件数」徽章（AC-5.9）。
     * 缺省不展开；点外部或再点入口收起。
     */
    function FilterPopover({ modules, selectedModules, onToggleModule, sortBy, onSelectSort, onClearAll, activeCount, t }) {
      const [open, setOpen] = React.useState(false)
      return React.createElement('div', { style: styles.relativeRow }, [
        React.createElement('button', {
          key: 'entry',
          type: 'button',
          'aria-expanded': open,
          'aria-label': `${t('filterPanel')}${activeCount > 0 ? ` (${activeCount})` : ''}`,
          title: t('filterBadgeHint'),
          'data-orchd-filter-entry': 'true',
          style: { ...styles.filterEntry, ...(open || activeCount > 0 ? styles.filterEntryActive : {}) },
          onClick: () => setOpen((value) => !value)
        }, [
          React.createElement('span', { key: 'g' }, '⚙'),
          React.createElement('span', { key: 'l' }, t('filterPanel')),
          activeCount > 0
            ? React.createElement('span', { key: 'b', style: { ...styles.badge, border: 'none', background: TOKEN.hover, padding: '0 5px' } }, String(activeCount))
            : null
        ].filter(Boolean)),
        open
          ? React.createElement('div', { key: 'panel', style: styles.popover, 'data-orchd-filter-panel': 'true' }, [
              React.createElement('div', { key: 'ml', style: styles.popoverLabel }, t('filterModules')),
              React.createElement(ModuleFilter, { key: 'm', modules, selected: selectedModules, onToggle: onToggleModule, t }),
              React.createElement('div', { key: 'sl', style: styles.popoverLabel }, t('filterSort')),
              React.createElement(SortFilter, { key: 's', sortBy, onSelect: onSelectSort, t }),
              React.createElement('div', { key: 'row', style: styles.controlRow }, [
                React.createElement('button', {
                  key: 'clear',
                  type: 'button',
                  style: styles.button,
                  'aria-label': t('filterClearAll'),
                  onClick: () => {
                    onClearAll()
                    setOpen(false)
                  }
                }, t('filterClearAll'))
              ])
            ])
          : null
      ].filter(Boolean))
    }

    /**
     * 自绘滚动条的几何计算（纯函数，可单测）。
     *
     * 为什么必须自绘：虚拟列表的内容高度 = 行数 × 行高（805 × 52 = **41,860px**），
     * 可视区只有 ~520px，所以**原生滚动条的滑块长度只能是约 1.2%**（≈6px）——
     * 无论把 `--dsh-scrollbar-width` 调多宽，滑块都还是一个「小点」。
     * Chromium 也没有「滑块最小长度」这种属性，所以只有自绘才能同时把宽度和长度做大。
     *
     * 长度取 `比例长度` 与 `最小可抓取长度` 的较大者；位置按 scrollTop 线性映射到可用轨道。
     */
    function computeThumb({ trackLength, contentLength, scrollTop }) {
      if (!(trackLength > 0) || !(contentLength > trackLength)) return null
      const maxScroll = contentLength - trackLength
      const ratioLength = (trackLength * trackLength) / contentLength
      const length = Math.min(trackLength, Math.max(SCROLLBAR_MIN_THUMB, Math.round(ratioLength)))
      const maxTop = Math.max(0, trackLength - length)
      const top = maxScroll <= 0 ? 0 : Math.round((Math.min(Math.max(0, scrollTop), maxScroll) / maxScroll) * maxTop)
      return { length, top, maxTop, maxScroll }
    }

    /** 拖动滑块时的反解：滑块位置 → scrollTop。 */
    function scrollTopForThumbTop(thumbTop, { trackLength, contentLength, thumbLength }) {
      const maxTop = trackLength - thumbLength
      const maxScroll = contentLength - trackLength
      if (!(maxTop > 0) || !(maxScroll > 0)) return 0
      const clamped = Math.min(Math.max(0, thumbTop), maxTop)
      return Math.round((clamped / maxTop) * maxScroll)
    }

    /**
     * 自绘滚动容器：**任务列表 + 两个详情页共用**。
     *
     * 为什么必须自绘（不是洁癖，是平台限制）：
     *   · 平台全局滚动条是 `--dsh-scrollbar-width: 5px` + `scrollbar-bg-l1`（10% 白），
     *     深色面板上几乎看不见；`scrollbar-width` 还**不可继承**，在面板里调不大；
     *   · Chromium 没有「滑块最小长度」属性——内容一长，原生滑块就缩成一个小点。
     * 所以宽度与最小长度都自己画（`SCROLLBAR_WIDTH` / `SCROLLBAR_MIN_THUMB`）。
     *
     * `children` 传**函数**时会拿到 `viewport`（`{top, height, content}`），供虚拟化列表用；
     * 传节点则按普通滚动内容渲染（详情页用）。
     *
     * @param {object} props
     * @param {string} props.label 无障碍名（role=scrollbar 的 aria-label）
     * @param {object|Function} props.children
     * @param {object} [props.scrollerRef] 调用方自己的 ref（虚拟列表要拿它 scrollTo）
     * @param {object} [props.scrollerStyle] 滚动区样式（默认 styles.scroll）
     * @param {object} [props.contentStyle] 内容容器样式
     * @param {number} [props.contentLength] 已知内容长度（虚拟列表用；否则量 scrollHeight）
     * @param {number} [props.keyStep] 方向键步长（虚拟列表传行高）
     */
    function ScrollPane({ label, children, scrollerRef, scrollerStyle, contentStyle, contentLength, keyStep, horizontal }) {
      const innerRef = React.useRef(null)
      const contentRef = React.useRef(null)
      const ref = scrollerRef ?? innerRef
      // 横向只在 `horizontal` 用法下读取（`scrollWidth` 会触发一次布局计算，列表用不上就不付成本）
      const axisX = horizontal === true
      const [viewport, setViewport] = React.useState({ top: 0, height: 0, content: 0, left: 0, width: 0, contentWidth: 0 })
      const [dragging, setDragging] = React.useState(false)
      const [draggingH, setDraggingH] = React.useState(false)

      React.useEffect(() => {
        const node = ref.current
        if (node === null) return undefined
        const read = () => setViewport({
          top: node.scrollTop,
          height: node.clientHeight,
          content: node.scrollHeight,
          left: axisX ? node.scrollLeft : 0,
          width: axisX ? node.clientWidth : 0,
          contentWidth: axisX ? node.scrollWidth : 0
        })
        read()
        node.addEventListener('scroll', read, { passive: true })
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null
        observer?.observe(node)
        // ⚠ 还要观察**内容**：详情页加载出审查历史、想法详情渲染出命令后，滚动容器自身尺寸不变，
        //   只有 scrollHeight 变——只 observe 容器则滑块长度不会更新（列表用 rows.length 当依赖同理）。
        if (contentRef.current !== null) observer?.observe(contentRef.current)
        return () => {
          node.removeEventListener('scroll', read)
          observer?.disconnect()
        }
        // 只在挂载时建立一次；内容变化靠上面那个 ResizeObserver 兜住
      }, [])

      const length = contentLength ?? viewport.content
      const thumb = computeThumb({ trackLength: viewport.height, contentLength: length, scrollTop: viewport.top })
      // 横向复用同一份几何（`computeThumb` 只跟长度有关，与轴无关）：轨道长 = 可视宽、内容长 = scrollWidth
      const thumbH = axisX ? computeThumb({ trackLength: viewport.width, contentLength: viewport.contentWidth, scrollTop: viewport.left }) : null

      const scrollTo = (value) => {
        const node = ref.current
        if (node !== null) node.scrollTop = value
      }

      const scrollToX = (value) => {
        const node = ref.current
        if (node !== null) node.scrollLeft = value
      }

      /** 拖动滑块：把指针位移换算成滚动距离。 */
      const onThumbPointerDown = (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (thumb === null) return
        const startY = event.clientY
        const startTop = thumb.top
        setDragging(true)
        const move = (moveEvent) => {
          scrollTo(scrollTopForThumbTop(startTop + (moveEvent.clientY - startY), {
            trackLength: viewport.height,
            contentLength: length,
            thumbLength: thumb.length
          }))
        }
        const up = () => {
          setDragging(false)
          event.target?.ownerDocument?.defaultView?.removeEventListener?.('pointermove', move)
          event.target?.ownerDocument?.defaultView?.removeEventListener?.('pointerup', up)
        }
        const view = event.target?.ownerDocument?.defaultView ?? null
        view?.addEventListener('pointermove', move)
        view?.addEventListener('pointerup', up)
      }

      /** 横向拖动：同一条公式，换成 clientX / scrollLeft。 */
      const onThumbHPointerDown = (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (thumbH === null) return
        const startX = event.clientX
        const startLeft = thumbH.top
        setDraggingH(true)
        const move = (moveEvent) => {
          scrollToX(scrollTopForThumbTop(startLeft + (moveEvent.clientX - startX), {
            trackLength: viewport.width,
            contentLength: viewport.contentWidth,
            thumbLength: thumbH.length
          }))
        }
        const up = () => {
          setDraggingH(false)
          event.target?.ownerDocument?.defaultView?.removeEventListener?.('pointermove', move)
          event.target?.ownerDocument?.defaultView?.removeEventListener?.('pointerup', up)
        }
        const view = event.target?.ownerDocument?.defaultView ?? null
        view?.addEventListener('pointermove', move)
        view?.addEventListener('pointerup', up)
      }

      /** 点轨道空白处：把滑块中心移到点击处。 */
      const onTrackPointerDown = (event) => {
        if (thumb === null) return
        const rect = event.currentTarget.getBoundingClientRect()
        const target = event.clientY - rect.top - thumb.length / 2
        scrollTo(scrollTopForThumbTop(target, {
          trackLength: viewport.height,
          contentLength: length,
          thumbLength: thumb.length
        }))
      }

      /** 点横向轨道空白处。 */
      const onTrackHPointerDown = (event) => {
        if (thumbH === null) return
        const rect = event.currentTarget.getBoundingClientRect()
        const target = event.clientX - rect.left - thumbH.length / 2
        scrollToX(scrollTopForThumbTop(target, {
          trackLength: viewport.width,
          contentLength: viewport.contentWidth,
          thumbLength: thumbH.length
        }))
      }

      /** 键盘：滑块可 Tab 聚焦后用方向键/翻页键滚动。 */
      const onThumbKeyDown = (event) => {
        const step = keyStep ?? Math.max(24, Math.round(viewport.height / 4))
        const page = Math.max(step, viewport.height - step)
        const map = {
          ArrowUp: viewport.top - step,
          ArrowDown: viewport.top + step,
          PageUp: viewport.top - page,
          PageDown: viewport.top + page,
          Home: 0,
          End: length
        }
        if (!Object.hasOwn(map, event.key)) return
        event.preventDefault()
        scrollTo(map[event.key])
      }

      /** 横向键盘：左右方向键 + Home / End（左右各移一屏的 1/4）。 */
      const onThumbHKeyDown = (event) => {
        const step = keyStep ?? Math.max(24, Math.round(viewport.width / 4))
        const page = Math.max(step, viewport.width - step)
        const map = {
          ArrowLeft: viewport.left - step,
          ArrowRight: viewport.left + step,
          PageUp: viewport.left - page,
          PageDown: viewport.left + page,
          Home: 0,
          End: viewport.contentWidth
        }
        if (!Object.hasOwn(map, event.key)) return
        event.preventDefault()
        scrollToX(map[event.key])
      }

      return React.createElement('div', { style: styles.listHost }, [
        React.createElement('div', {
          key: 'scroller',
          ref,
          style: scrollerStyle ?? styles.scroll,
          'data-orchd-scroller': 'true'
        },
          React.createElement('div', { key: 'content', ref: contentRef, style: contentStyle },
            typeof children === 'function' ? children(viewport) : children)
        ),
        // 自绘滚动条：一直可见（用户明确要求能看见），拖动时加深
        // 两个轴同时存在时各自让开对方（否则滑块在右下角叠成一坨）
        thumb === null
          ? null
          : React.createElement('div', {
              key: 'track',
              style: thumbH === null ? styles.scrollbarTrack : { ...styles.scrollbarTrack, bottom: SCROLLBAR_WIDTH + 4 },
              onPointerDown: onTrackPointerDown,
              'data-orchd-scrollbar': 'track'
            },
            React.createElement('div', {
              key: 'thumb',
              role: 'scrollbar',
              tabIndex: 0,
              'aria-label': label,
              'aria-orientation': 'vertical',
              'aria-valuemin': 0,
              'aria-valuemax': thumb.maxScroll,
              'aria-valuenow': viewport.top,
              'data-orchd-scrollbar': 'thumb',
              style: {
                ...styles.scrollbarThumb,
                ...(dragging ? styles.scrollbarThumbActive : {}),
                top: `${thumb.top}px`,
                height: `${thumb.length}px`
              },
              onPointerDown: onThumbPointerDown,
              onKeyDown: onThumbKeyDown
            })
          ),
        thumbH === null
          ? null
          : React.createElement('div', {
              key: 'track-x',
              // 纵向条在时给它让出位置；只有横向溢出时不白留 18px
              style: thumb === null ? styles.scrollbarTrackH : { ...styles.scrollbarTrackH, right: SCROLLBAR_WIDTH + 4 },
              onPointerDown: onTrackHPointerDown,
              'data-orchd-scrollbar': 'track-x'
            },
            React.createElement('div', {
              key: 'thumb-x',
              role: 'scrollbar',
              tabIndex: 0,
              'aria-label': label,
              'aria-orientation': 'horizontal',
              'aria-valuemin': 0,
              'aria-valuemax': thumbH.maxScroll,
              'aria-valuenow': viewport.left,
              'data-orchd-scrollbar': 'thumb-x',
              style: {
                ...styles.scrollbarThumbH,
                ...(draggingH ? styles.scrollbarThumbActive : {}),
                left: `${thumbH.top}px`,
                width: `${thumbH.length}px`
              },
              onPointerDown: onThumbHPointerDown,
              onKeyDown: onThumbHKeyDown
            })
          )
      ].filter(Boolean))
    }

    /**
     * 虚拟化列表（任务与想法共用）。
     *
     * - **纯 CSS 虚拟化**：绝对定位行 + 上下 overscan，只为可视区渲染 DOM。
     *   平台 seed 表只有 9 个模块，浏览器半侧不允许第三方依赖（NFR-4.1）。
     * - **自绘滚动条**：交给 `ScrollPane`（宽度与最小长度都由我们定，原生条已隐藏）。
     *   行右侧预留 `SCROLLBAR_WIDTH + 10` 的内边距，文字不会被滑块压住。
     *
     * @param {object} props
     * @param {Array} props.rows
     * @param {number} props.rowHeight
     * @param {(row: object, index: number, offset: number) => object} props.renderRow
     * @param {string} props.label 无障碍名（role=scrollbar 的 aria-label）
     */
    function VirtualList({ rows, rowHeight, renderRow, label }) {
      const scrollerRef = React.useRef(null)
      const total = rows.length
      const contentLength = total * rowHeight

      return React.createElement(ScrollPane, {
        label,
        scrollerRef,
        contentLength,
        keyStep: rowHeight,
        contentStyle: { ...styles.virtual, height: contentLength },
        children: (viewport) => {
          const firstName = Math.max(0, Math.floor(viewport.top / rowHeight) - OVERSCAN)
          const lastName = Math.min(total - 1, Math.ceil((viewport.top + viewport.height) / rowHeight) + OVERSCAN)
          return rows.slice(firstName, lastName + 1).map((row, index) =>
            renderRow(row, firstName + index, (firstName + index) * rowHeight)
          )
        }
      })
    }

    function TaskRowItem({ row, t, offset, onOpen }) {
      const statusColor = STATUS_TOKEN[row.status] ?? TOKEN.labelTertiary
      const meta = [
        row.module ?? null,
        row.claimedBy ?? null,
        row.attemptCount === null || row.attemptCount === undefined ? null : `${t('dAttempts')} ${row.attemptCount}`,
        row.importance ?? row.importanceDerived ?? null,
        row.blockedDownstream === null || row.blockedDownstream === undefined ? null : `↓${row.blockedDownstream}`
      ].filter(Boolean)
      return React.createElement('button', {
        type: 'button',
        style: { ...styles.rowStyle, top: offset },
        onClick: () => onOpen(row.id),
        'aria-label': `${row.id} ${row.name ?? ''}`.trim(),
        'data-orchd-row': row.id
      }, [
        React.createElement('span', { key: 'a', style: styles.rowTitle }, [
          React.createElement('span', { key: 'id', style: styles.rowId }, row.id ?? '—'),
          React.createElement('span', { key: 'name', style: styles.rowName }, row.name ?? '—')
        ]),
        React.createElement('span', { key: 'b', style: styles.rowMeta }, [
          React.createElement('span', { key: 's', style: { ...styles.statusTag, color: statusColor } }, [
            React.createElement('span', { key: 'd', style: styles.chipDot }),
            React.createElement('span', { key: 'l' }, row.status === null || row.status === undefined ? '—' : row.status)
          ]),
          React.createElement('span', { key: 'm', style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, meta.join(' · '))
        ])
      ])
    }

    // ── 筛选与排序（FR-5.2..5.5）──────────────────────────────────────────
    /**
     * 纯函数，便于单测（FR-5.2 的语义全在这里）。
     *
     * `mode` 是**单选**：
     *  - `'all'`    → 全部（含终态，FR-5.6）
     *  - `'active'` → 非终态（`状态 ∉ {completed, cancelled}`）
     *  - 具体状态    → 只留该状态
     * 模块是**多选**（空数组 = 不按模块过滤）。
     */
    function applyFilters(rows, filters, allStatuses) {
      const keyword = (filters.keyword ?? '').trim().toLowerCase()
      const modules = filters.modules ?? []
      const mode = filters.mode ?? 'all'
      const TERMINAL = ['completed', 'cancelled']
      return rows.filter((row) => {
        if (mode === 'active') {
          if (row.status === null || row.status === undefined || TERMINAL.includes(row.status)) return false
        } else if (mode !== 'all') {
          if (row.status !== mode) return false
        }
        if (modules.length > 0 && !modules.includes(row.module)) return false
        if (keyword !== '') {
          const haystack = `${row.id ?? ''}\n${row.name ?? ''}`.toLowerCase()
          if (!haystack.includes(keyword)) return false
        }
        return true
      })
    }

    /** 当前筛选下的计数（用于 0 值弱化与「活跃=各非终态之和」这类自查，AC-5.6）。 */
    function countByStatus(rows, allStatuses) {
      const counts = {}
      for (const status of allStatuses) counts[status] = 0
      for (const row of rows) {
        if (typeof row.status === 'string' && Object.hasOwn(counts, row.status)) counts[row.status] += 1
      }
      return counts
    }

    /** 默认「活跃优先 → 组内按时间」：活跃按最近动作、终态按合并时间（FR-5.4 修订）。 */    function sortRows(rows, by) {
      const rank = (value) => ({ critical: 4, high: 3, normal: 2, low: 1 })[value] ?? 0
      const diff = (value) => ({ high: 3, medium: 2, low: 1 })[value] ?? 0
      const activeFirst = (status) => (status === 'claimed' || status === 'done' || status === 'in_review' ? 0 : status === 'completed' || status === 'cancelled' ? 2 : 1)
      // 时间戳来自宿主（`lastActionAt` / `mergedAt`，git 近似；取不到为 null → 排本组最后）
      const timeOf = (row) => {
        const raw = row.status === 'completed' || row.status === 'cancelled' ? row.mergedAt : row.lastActionAt
        if (typeof raw !== 'string' || raw === '') return null
        const parsed = Date.parse(raw)
        return Number.isFinite(parsed) ? parsed : null
      }
      const byTime = (a, b) => {
        const ta = timeOf(a)
        const tb = timeOf(b)
        if (ta === null && tb === null) return 0
        if (ta === null) return 1
        if (tb === null) return -1
        return tb - ta
      }
      const copy = [...rows]
      const byId = (a, b) => String(a.id ?? '').localeCompare(String(b.id ?? ''))
      switch (by) {
        case 'importance':
          return copy.sort((a, b) => rank(b.importance ?? b.importanceDerived) - rank(a.importance ?? a.importanceDerived) || byId(a, b))
        case 'difficulty':
          return copy.sort((a, b) => diff(b.difficulty) - diff(a.difficulty) || byId(a, b))
        case 'module':
          return copy.sort((a, b) => String(a.module ?? '~').localeCompare(String(b.module ?? '~')) || byId(a, b))
        case 'status':
          return copy.sort((a, b) => String(a.status ?? '~').localeCompare(String(b.status ?? '~')) || byId(a, b))
        default:
          return copy.sort((a, b) => activeFirst(a.status) - activeFirst(b.status) || byTime(a, b) || rank(b.importance ?? b.importanceDerived) - rank(a.importance ?? a.importanceDerived) || byId(a, b))
      }
    }

    const ALL_STATUSES = ['pending', 'claimed', 'done', 'in_review', 'completed', 'cancelled']

    /** 任务状态 → i18n 键（**唯一**的状态标签来源：不再有英文状态码 chips，消除双语言同屏）。 */
    const TASK_STATUS_I18N = {
      pending: 'sPending',
      claimed: 'sClaimed',
      done: 'sDone',
      in_review: 'sInReview',
      completed: 'sCompleted',
      cancelled: 'sCancelled'
    }

    // ── 四态卡片（FR-2 / FR-3 / FR-9）────────────────────────────────────
    /**
     * A 路径：把接入指令交给 agent（FR-3.2）。
     *
     * 流程（每一步都对应一条验收标准）：
     *   ① 点「让 agent 帮我接入」→ `POST /install-entry` **只取文本**（不注入，FR-3.3）；
     *   ② 弹出确认区，展示**将要注入的全文**（FR-3.3）；
     *   ③ 用户点「确认注入」→ `POST /install-inject`（带 `confirm: true`）→ 宿主注入；
     *   ④ 命令服务不可用时按钮禁用 + 给出原因（FR-3.4），C 路径不受影响。
     *
     * ⚠ 不注入就不发第二个请求：面板的轮询/刷新路径永远不会碰到 `/install-inject`（FR-3.5）。
     */
    function InstallConfirm({ sessionId, t }) {
      const [entry, setEntry] = React.useState({ status: 'idle', supported: null, text: '', reason: null })
      const [state, setState] = React.useState('idle')

      const load = async () => {
        setState('loading')
        try {
          const response = await fetch('/orchd/api/install-entry', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session: sessionId })
          })
          const body = await response.json()
          if (body?.ok !== true) throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
          setEntry({ status: 'ready', supported: body.data.supported === true, text: body.data.text ?? '', reason: body.data.reason ?? null })
          setState('confirming')
        } catch (error) {
          setEntry({ status: 'error', supported: false, text: '', reason: null })
          setState('error')
          setEntry((previous) => ({ ...previous, message: error instanceof Error ? error.message : String(error) }))
        }
      }

      const confirm = async () => {
        setState('injecting')
        try {
          const response = await fetch('/orchd/api/install-inject', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session: sessionId, confirm: true })
          })
          const body = await response.json()
          if (body?.ok !== true) throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
          setState('done')
        } catch (error) {
          setEntry((previous) => ({ ...previous, message: error instanceof Error ? error.message : String(error) }))
          setState('error')
        }
      }

      const unsupported = entry.status === 'ready' && entry.supported === false

      const head = React.createElement('div', { key: 'row', style: { ...styles.controlRow, marginTop: 8 } }, [
        React.createElement('button', {
          key: 'a',
          type: 'button',
          'data-orchd-install-a': 'true',
          style: { ...styles.button, ...(unsupported || state === 'loading' || state === 'injecting' ? styles.buttonDisabled : {}) },
          disabled: unsupported || state === 'loading' || state === 'injecting',
          title: unsupported ? t('installAgentUnavailable') : t('installAgent'),
          'aria-label': t('installAgent'),
          onClick: () => {
            if (state === 'confirming' && entry.text !== '') return setState('idle')
            return load()
          }
        }, state === 'confirming' ? t('installCancel') : t('installAgent')),
        React.createElement('span', { key: 'n', style: styles.hint },
          unsupported ? t('installAgentUnavailable') : t('installAgentHint'))
      ])

      return React.createElement('div', null, [
        head,
        // 降级说明（FR-3.4）：给出机器可读原因对应的人话
        unsupported
          ? React.createElement('div', { key: 'why', style: { ...styles.note, padding: '4px 0 0', color: WARN } },
              `${t('installDegradeReason')}${entry.reason ?? 'unknown'}`)
          : null,
        state === 'confirming'
          ? React.createElement('div', { key: 'confirm', style: { ...styles.codeBlock, marginTop: 8 } }, [
              React.createElement('div', { key: 'lead', style: { fontWeight: 600, marginBottom: 4 } }, t('installConfirmLead')),
              React.createElement('pre', { key: 'text', style: { ...styles.codeBlock, whiteSpace: 'pre-wrap', margin: 0 } }, entry.text),
              React.createElement('div', { key: 'btns', style: { ...styles.controlRow, marginTop: 8 } }, [
                React.createElement('button', {
                  key: 'ok', type: 'button', 'data-orchd-install-confirm': 'true',
                  style: styles.button, onClick: confirm, 'aria-label': t('installConfirm')
                }, state === 'injecting' ? t('installInjecting') : t('installConfirm')),
                React.createElement('button', {
                  key: 'no', type: 'button', style: styles.button, onClick: () => setState('idle'), 'aria-label': t('installCancel')
                }, t('installCancel'))
              ])
            ])
          : null,
        state === 'done'
          ? React.createElement('div', { key: 'done', style: { ...styles.note, padding: '6px 0 0', color: 'var(--dsw-alias-state-success-primary, currentColor)' } }, t('installInjected'))
          : null,
        state === 'error'
          ? React.createElement('div', { key: 'err', style: { ...styles.note, padding: '6px 0 0', color: 'var(--dsw-alias-state-error-primary, currentColor)' } },
              `${t('installFailed')}${entry.message ?? ''}`)
          : null
      ].filter(Boolean))
    }

    function StateCard({ data, t, onRedetect, sessionId }) {
      const install = data.install ?? { copyText: '' }

      if (data.state === 'not_installed' || data.state === 'uninitialized') {
        const notInstalled = data.state === 'not_installed'
        return React.createElement(Card, {
          title: notInstalled ? t('installTitle') : t('initTitle'),
          badge: notInstalled ? t('stateNotInstalled') : t('stateUninitialized'),
          state: data.state
        }, [
          React.createElement('div', { key: 'hint' }, notInstalled ? t('installHint') : t('initHint')),
          notInstalled ? React.createElement(CommandBlock, { key: 'cmd', text: install.copyText, t }) : null,
          notInstalled && install.mirrorHint ? React.createElement('div', { key: 'mirror', style: { ...styles.note, padding: 0 } }, install.mirrorHint) : null,
          notInstalled
            ? React.createElement(InstallConfirm, { key: 'agent', sessionId, t })
            : React.createElement('div', { key: 'path', style: styles.mono }, data.masterPath ?? '—'),
          React.createElement('div', { key: 'row', style: { ...styles.controlRow, marginTop: 8 } }, [
            React.createElement('button', { key: 'r', type: 'button', style: styles.button, onClick: onRedetect, 'aria-label': t('redetect') }, t('redetect'))
          ])
        ].filter(Boolean))
      }

      // broken
      return React.createElement(Card, { title: t('brokenTitle'), badge: t('stateBroken'), state: 'broken' }, [
        React.createElement('div', { key: 'hint' }, t('brokenHint')),
        React.createElement('div', { key: 'grid', style: styles.grid }, [
          React.createElement(Row, { key: 'reason', label: t('reason') }, String(data.reason ?? '—'))
        ]),
        nextStepFor(data.reason) === undefined ? null : React.createElement(React.Fragment, { key: 'next' }, [
          React.createElement('div', { key: 'l', style: { ...styles.key, marginTop: 8 } }, t('nextStep')),
          React.createElement('pre', { key: 'v', style: styles.pre }, nextStepFor(data.reason))
        ]),
        React.createElement('div', { key: 'row', style: { ...styles.controlRow, marginTop: 8 } }, [
          React.createElement('button', { key: 'r', type: 'button', style: styles.button, onClick: onRedetect, 'aria-label': t('redetect') }, t('redetect'))
        ])
      ].filter(Boolean))
    }

    /** 失败环节 → 建议下一步（Q1：只展示命令文本，绝不代跑）。 */
    function nextStepFor(reason) {
      switch (reason) {
        case 'python-not-found':
          return '在插件配置里显式指定 pythonPath，或把 python 放回 PATH。\n验证：python -V'
        case 'layout-unresolved':
          return '检查 <项目根>/.orchd/.layout.json 里的 main_worktree 是否指向真实的主工作树。\n验证：python .orchd/__main__.py status'
        case 'layout-marker-mismatch':
          return '布局标记声明的主工作树不存在。确认项目是否被整体移动过。'
        case 'master-unparsable':
          return '定义文件损坏。用引擎自带的校验看细节（只读）：\npython .orchd/__main__.py validate'
        case 'master-unreadable':
          return '定义文件存在但读不出来，检查文件权限。'
        case 'definition-archived-unsupported':
          return '定义似已被 master-archive 归档，本版本不支持读取。'
        case 'cli-failed':
        case 'cli-timeout':
        case 'cli-unparsable':
          return '在项目根手动跑一次看引擎返回什么（只读）：\npython .orchd/__main__.py status --all'
        case 'project-root-unresolved':
        case 'project-root-not-allowed':
          return '从左侧栏选一个属于某个 Workspace 的会话再打开面板。'
        default:
          return undefined
      }
    }

    // ── 详情（FR-6）──────────────────────────────────────────────────────
    /**
     * 审查事件时间线（FR-8，**P2 收窄**）。
     *
     * 只渲染引擎只读回看命令能给的 `REVIEW_SUBMITTED` 事件 + 当前状态摘要；
     * `unsupportedTypes`（认领/完成/审查认领/强制状态/撤回/修订）必须**显式说明「引擎未提供」**，
     * 不伪造（FR-8.5 / AC-8.5）。无时间戳显示「—」，不显示错误日期。
     */
    function ReviewTimeline({ timeline, t }) {
      const events = Array.isArray(timeline?.events) ? timeline.events : []
      const current = timeline?.current ?? {}
      const unsupported = Array.isArray(timeline?.unsupportedTypes) ? timeline.unsupportedTypes : []
      const verdictLabel = (verdict) => verdict === 'APPROVED'
        ? t('reviewApproved')
        : (verdict === 'CHANGES_REQUESTED' ? t('reviewChanges') : (verdict ?? '—'))
      const verdictColor = (verdict) => verdict === 'APPROVED'
        ? 'var(--dsw-alias-state-success-primary, currentColor)'
        : (verdict === 'CHANGES_REQUESTED' ? WARN : TOKEN.labelTertiary)

      return React.createElement('section', {
        'data-orchd-review-timeline': 'true',
        style: { ...styles.card, margin: '0 0 12px' }
      }, [
        React.createElement('h4', { key: 'h', style: styles.cardTitle }, t('reviewTitle')),
        // 当前状态摘要（与时间线互补：时间线是历史事件，这里是此刻的运行时事实）
        React.createElement('div', { key: 'cur', style: styles.grid }, [
          React.createElement(Row, { key: 'p', label: t('dReviewPhase') }, current.reviewPhase ?? '—'),
          React.createElement(Row, { key: 'by', label: t('dClaimedBy') }, current.reviewClaimedBy ?? '—'),
          current.mergeWarning === null || current.mergeWarning === undefined
            ? null
            : React.createElement(Row, { key: 'mw', label: t('mergeWarning') }, JSON.stringify(current.mergeWarning)),
          current.reviveMarker === null || current.reviveMarker === undefined
            ? null
            : React.createElement(Row, { key: 'rm', label: t('reviveMarker') }, JSON.stringify(current.reviveMarker))
        ].filter(Boolean)),
        events.length === 0
          ? React.createElement('div', { key: 'empty', style: { ...styles.note, padding: '8px 0 0' }, 'data-orchd-review-empty': 'true' }, t('reviewEmpty'))
          : React.createElement('ol', { key: 'ol', style: { ...styles.ul, marginTop: 8 } }, events.map((event, index) =>
              React.createElement('li', {
                key: index,
                style: styles.li,
                'data-orchd-review-event': String(index)
              }, [
                React.createElement('div', { key: 'head', style: { ...styles.controlRow, gap: 8 } }, [
                  React.createElement('span', { key: 'v', style: { ...styles.statusTag, color: verdictColor(event.verdict) } }, [
                    React.createElement('span', { key: 'd', style: styles.chipDot }),
                    React.createElement('span', { key: 'l' }, verdictLabel(event.verdict))
                  ]),
                  event.reviewType === null
                    ? null
                    : React.createElement('span', { key: 'rt', style: { ...styles.chip, color: TOKEN.labelTertiary } }, `${t('reviewType')} ${event.reviewType}`),
                  React.createElement('span', { key: 'at', style: { color: TOKEN.labelTertiary } }, event.at ?? t('reviewNoTime'))
                ].filter(Boolean)),
                event.text === null
                  ? null
                  : React.createElement('pre', { key: 'txt', style: styles.pre }, event.text)
              ]))),
        // 引擎未提供的事件类型：显式说明，不伪造（AC-8.5）
        unsupported.length === 0
          ? null
          : React.createElement('div', {
              key: 'unsup',
              'data-orchd-review-unsupported': unsupported.join(','),
              style: { ...styles.note, padding: '8px 0 0' }
            }, [
              React.createElement('div', { key: 'a' }, t('reviewUnsupported')),
              React.createElement('div', { key: 'b', style: { color: TOKEN.labelTertiary } }, `${unsupported.join(' · ')}（${t('reviewUnsupportedTypes')}）`)
            ])
      ].filter(Boolean))
    }

    function DetailView({ sessionId, taskId, t, onBack, onOpenTask }) {
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null })
      // 审查时间线（FR-8，P2 收窄）：与单任务详情**分开懒加载**，点按钮才拉——
      // 避免对 800 个终态任务的每个详情都多跑一次 CLI。失败只影响这一块，列表不受影响。
      const [history, setHistory] = React.useState({ status: 'idle', data: null, error: null })
      const [historyTick, setHistoryTick] = React.useState(0)

      React.useEffect(() => {
        const controller = new AbortController()
        setState({ status: 'loading', data: null, error: null })
        api('/orchd/api/task', { session: sessionId, id: taskId }, controller.signal)
          .then((body) => setState({ status: 'ok', data: body.data, error: null }))
          .catch((error) => {
            if (error?.name === 'AbortError') return
            setState({ status: 'error', data: null, error })
          })
        return () => controller.abort()
      }, [sessionId, taskId])

      // `historyTick` 每次点按钮自增触发；首次为 0 时不请求（FR-8）
      React.useEffect(() => {
        if (historyTick === 0) return undefined
        const controller = new AbortController()
        setHistory((previous) => ({ ...previous, status: 'loading' }))
        api('/orchd/api/history', { session: sessionId, id: taskId, refresh: historyTick > 1 }, controller.signal)
          .then((body) => setHistory({ status: 'ok', data: body.data, error: null }))
          .catch((error) => {
            if (error?.name === 'AbortError') return
            setHistory((previous) => ({ ...previous, status: 'error', error }))
          })
        return () => controller.abort()
      }, [sessionId, taskId, historyTick])

      const loadHistory = () => {
        setHistory({ status: 'loading', data: null, error: null })
        setHistoryTick((value) => value + 1)
      }

      // 详情页骨架：固定条（返回 + 动作按钮，不随正文滚动）+ 只滚的正文区。
      // 三个分支（loading / error / 正常）共用它，保证行为一致。
      // 正文区用 `ScrollPane`：既有**可见的自绘滚动条**（原来这里只有隐藏的原生条，
      // 也就是用户说的「滚轮显示不出来」），又只滚正文不动固定条。
      const shell = (barActions, bodyChildren) => React.createElement('div', { style: styles.detailPage }, [
        React.createElement('div', { key: 'bar', style: styles.detailBar }, [
          React.createElement('button', {
            key: 'back', type: 'button', style: styles.button, onClick: onBack, 'aria-label': t('back')
          }, `← ${t('back')}`),
          React.createElement('span', { key: 'sp', style: styles.spacer }),
          ...barActions
        ].filter(Boolean)),
        React.createElement(ScrollPane, {
          key: 'pane',
          label: t('dScrollLabel'),
          scrollerStyle: styles.detailScroll,
          contentStyle: styles.detailBody,
          children: bodyChildren
        })
      ])

      if (state.status === 'loading') {
        return shell([], [React.createElement('div', { key: 'l', style: styles.note }, t('loading'))])
      }
      if (state.status === 'error') {
        return shell([], [
          React.createElement(Card, { key: 'e', title: t('localError'), badge: t('stateBroken'), state: 'broken' }, [
            React.createElement('div', { key: 'm' }, state.error?.message ?? 'unknown error'),
            React.createElement('pre', { key: 'd', style: styles.pre }, JSON.stringify(state.error?.envelope?.error ?? {}, null, 2))
          ])
        ])
      }

      const payload = state.data ?? {}
      const task = payload.task ?? {}
      // linkable = 条目是任务 id 且宿主给了跳转回调 → 渲染成可点按钮（FR-6.5 依赖跳转）
      const section = (label, values, linkable = false) => React.createElement('div', { key: label }, [
        React.createElement('h4', { key: 'h', style: styles.h4 }, label),
        Array.isArray(values) && values.length > 0
          ? React.createElement('ul', { key: 'u', style: styles.ul }, values.map((value, index) => React.createElement('li', { key: index, style: styles.li },
              linkable && typeof onOpenTask === 'function' && typeof value === 'string' && /^task-[a-z0-9-]+$/.test(value)
                ? React.createElement('button', {
                    key: 'jump', type: 'button', style: { ...styles.button, padding: '2px 8px' },
                    onClick: () => onOpenTask(value), 'aria-label': `${t('jumpTo')}${value}`,
                    'data-orchd-jump-task': value
                  }, value)
                : String(value))))
          : React.createElement('div', { key: 'e', style: styles.mono }, t('dNoData'))
      ])

      // 「拉取审查意见」按钮放进**固定条**（不随正文滚动）；加载出来的内容放在正文**最上方**，
      // 这样点完立刻可见，不必滚到底部（原实现把按钮和结果都放在正文末尾）。
      const reviewButton = React.createElement('button', {
        key: 'load',
        type: 'button',
        'data-orchd-review-load': 'true',
        style: { ...styles.button, ...(history.status === 'loading' ? styles.buttonDisabled : {}) },
        disabled: history.status === 'loading',
        onClick: loadHistory,
        'aria-label': t('dReviewLoad')
      }, history.status === 'loading' ? t('dReviewLoading') : t('dReviewLoad'))

      // 三态：idle（未拉）→ 不渲染；loading；error（局部错误 + 重试）；ok → ReviewTimeline
      const reviewSection = history.status === 'idle'
        ? null
        : (history.status === 'loading'
            ? React.createElement('div', { key: 'rev-load', style: styles.note }, t('dReviewLoading'))
            : (history.status === 'error'
                ? React.createElement(Card, { key: 'rev-err', title: t('reviewUnavailable'), badge: t('stateBroken'), state: 'broken' }, [
                    React.createElement('div', { key: 'm' }, history.error?.message ?? 'unknown error'),
                    React.createElement('div', { key: 'row', style: { ...styles.controlRow, marginTop: 8 } }, [
                      React.createElement('button', { key: 'r', type: 'button', style: styles.button, onClick: loadHistory, 'aria-label': t('retry') }, t('retry'))
                    ])
                  ])
                : React.createElement(ReviewTimeline, { key: 'rev', timeline: history.data, t })))

      return shell([reviewButton], [
        React.createElement('div', { key: 'body', style: styles.detailBody }, [
          reviewSection,
          React.createElement('div', { key: 'title', style: styles.header }, [
            React.createElement('h3', { key: 'n', style: { ...styles.title, margin: 0 } }, task.name ?? '—'),
            React.createElement('span', {
              key: 's',
              style: { ...styles.statusTag, color: STATUS_TOKEN[task.status] ?? TOKEN.labelTertiary }
            }, [React.createElement('span', { key: 'd', style: styles.chipDot }), React.createElement('span', { key: 'l' }, task.status ?? '—')])
          ]),
          React.createElement('div', { key: 'id', style: styles.mono }, task.id ?? taskId),
          task.inState === false ? React.createElement('div', { key: 'w1', style: { ...styles.note, padding: '4px 0 0' } }, t('dDefinitionOnly')) : null,
          task.inDefinition === false ? React.createElement('div', { key: 'w2', style: { ...styles.note, padding: '4px 0 0' } }, t('dStateOnly')) : null,

          React.createElement('h4', { key: 'h-brief', style: styles.h4 }, t('dBrief')),
          React.createElement('div', { key: 'brief', style: styles.mono }, task.brief ?? t('dNoData')),

          React.createElement('div', { key: 'grid', style: { ...styles.grid, marginTop: 8 } }, [
            React.createElement(Row, { key: 'mod', label: t('dModule') }, task.module ?? '—'),
            React.createElement(Row, { key: 'mr', label: t('dModuleRole') }, task.moduleRole ?? '—'),
            React.createElement(Row, { key: 'imp', label: t('dImportance') }, `${task.importance ?? '—'}`),
            React.createElement(Row, { key: 'impd', label: t('dImportanceDerived') }, `${task.importanceDerived ?? '—'}`),
            React.createElement(Row, { key: 'diff', label: t('dDifficulty') }, task.difficulty ?? '—'),
            React.createElement(Row, { key: 'hours', label: t('dEstimatedHours') }, task.estimatedHours === null || task.estimatedHours === undefined ? '—' : String(task.estimatedHours)),
            React.createElement(Row, { key: 'claim', label: t('dClaimedBy') }, task.claimedBy ?? '—'),
            React.createElement(Row, { key: 'att', label: t('dAttempts') }, task.attemptCount === null || task.attemptCount === undefined ? '—' : String(task.attemptCount)),
            React.createElement(Row, { key: 'phase', label: t('dReviewPhase') }, task.reviewPhase ?? '—'),
            React.createElement(Row, { key: 'src', label: t('dSource') }, task.source ?? '—'),
            React.createElement(Row, { key: 'ds', label: t('dDownstreamCount') }, Array.isArray(task.dependents) ? String(task.dependents.length) : '—')
          ]),

          React.createElement('h4', { key: 'h-ac', style: styles.h4 }, `${t('dAcceptance')}（${(task.acceptanceCriteria ?? []).length}）`),
          (task.acceptanceCriteria ?? []).length === 0
            ? React.createElement('div', { key: 'ac-empty', style: styles.mono }, t('dNoData'))
            : React.createElement('ol', { key: 'ac', style: styles.ul }, (task.acceptanceCriteria ?? []).map((item, index) =>
                React.createElement('li', { key: index, style: styles.li }, item))),

          // FR-6.3：验证命令要「等宽字体 + 可复制」——等宽 <pre> 之外必须有显式复制入口
          task.verifyCommand === null || task.verifyCommand === undefined ? null : React.createElement(React.Fragment, { key: 'verify' }, [
            React.createElement(SectionHead, {
              key: 'h',
              label: t('dVerify'),
              action: React.createElement(CopyButton, { key: 'c', text: task.verifyCommand, t, label: t('copyText') })
            }),
            React.createElement('pre', { key: 'v', style: styles.codeBlock }, task.verifyCommand)
          ]),
          task.verifyTimeoutSeconds === null || task.verifyTimeoutSeconds === undefined
            ? null
            : React.createElement('div', { key: 'vt', style: styles.mono }, `${t('dVerifyTimeout')}: ${task.verifyTimeoutSeconds}s`),

          React.createElement('div', { key: 'files', style: { marginTop: 4 } }, section(t('dFilesToEdit'), task.filesToEdit)),
          (task.exemptFiles ?? []).length === 0 ? null : React.createElement('div', { key: 'exempt' }, section(t('dExemptFiles'), task.exemptFiles)),
          React.createElement('div', { key: 'deps', style: { marginTop: 4 } }, section(t('dDependsOn'), task.dependsOn, true)),
          React.createElement('div', { key: 'dents' }, section(t('dDependents'), task.dependents, true)),
          (task.requires ?? []).length === 0 ? null : React.createElement('div', { key: 'req' }, section(t('dRequires'), task.requires)),
          (task.reviewers ?? []).length === 0 ? null : React.createElement('div', { key: 'rev' }, section(t('dReviewers'), task.reviewers)),
          task.requireIndependentReview === true
            ? React.createElement('div', { key: 'ind', style: styles.mono }, t('dIndependentReview'))
            : null
        ].filter(Boolean))
      ])
    }

    // ── FR-7 依赖图（P2b）──────────────────────────────────────────────────
    /**
     * 图节点的固定尺寸（自绘，没有布局库可用：平台 seed 表只有 9 个模块，NFR-4.1）。
     *
     * 布局取向是**纵向分层、层内横向排列**——右侧栏只有整页约 1/3 宽，横向铺开的图
     * 在窄栏里没法读；纵向分层天然对应「先决在上、后继在下」，也贴合依赖的方向。
     */
    const GRAPH_NODE_W = 128
    const GRAPH_NODE_H = 40
    const GRAPH_GAP_X = 12
    const GRAPH_GAP_Y = 36
    const GRAPH_PAD = 10
    const GRAPH_SEGMENT_GAP = 8 // 片间留白（§9.1）
    const GRAPH_ZOOM_MIN = 0.25 // 缩放区间（§9.2）
    const GRAPH_ZOOM_MAX = 2
    const GRAPH_ZOOM_STEP = 1.25
    const GRAPH_VIEWPORT_FALLBACK = 390 // 量不到宽时的兜底

    function graphWrapColumns(maxWidth, labelWidth) {
      if (typeof maxWidth !== 'number' || !Number.isFinite(maxWidth) || maxWidth <= 0) return null
      return Math.max(1, Math.floor((maxWidth - GRAPH_PAD * 2 - labelWidth + GRAPH_GAP_X) / (GRAPH_NODE_W + GRAPH_GAP_X)))
    }

    // 行 → 视觉行（§9.1）：不插假边，宽度按最宽片算
    function graphLayoutRows(rows, labelWidth, maxWidth) {
      const wrap = graphWrapColumns(maxWidth, labelWidth)
      const widest = rows.reduce((max, row) => Math.max(max, row?.nodes?.length ?? 0), 1)
      const visual = []
      const positions = new Map()
      let cursor = GRAPH_PAD
      let actualCols = 1
      for (const row of rows) {
        const nodes = row?.nodes ?? []
        const per = wrap ?? Math.max(1, nodes.length)
        const segments = Math.max(1, Math.ceil(nodes.length / per))
        for (let segment = 0; segment < segments; segment += 1) {
          const slice = nodes.slice(segment * per, (segment + 1) * per)
          actualCols = Math.max(actualCols, slice.length)
          visual.push({ ...row, segment, visualRow: visual.length, nodes: slice })
          slice.forEach((node, index) => positions.set(node.id, {
            x: GRAPH_PAD + labelWidth + index * (GRAPH_NODE_W + GRAPH_GAP_X), y: cursor, w: GRAPH_NODE_W, h: GRAPH_NODE_H
          }))
          cursor += GRAPH_NODE_H + GRAPH_GAP_Y + (segment < segments - 1 ? GRAPH_SEGMENT_GAP : 0)
        }
      }
      const width = GRAPH_PAD * 2 + labelWidth + actualCols * GRAPH_NODE_W + (actualCols - 1) * GRAPH_GAP_X
      return {
        rows: visual, positions, width,
        height: visual.length === 0 ? GRAPH_PAD * 2 : cursor - GRAPH_GAP_Y + GRAPH_PAD,
        columns: wrap ?? widest, wrapped: visual.length > rows.length, visualRows: visual.length, levelRows: rows.length, segmentGap: GRAPH_SEGMENT_GAP
      }
    }

    /**
     * 分层布局（纯函数）：按服务端最长依赖深度 level 分行；level===null（环上/算不出层级）排最后一行，不硬塞层级。
     * @param {object} data `/orchd/api/graph` 的 `data`
     */
    function layoutDependencyGraph(data, options) {
      const nodes = Array.isArray(data?.nodes) ? data.nodes : []
      const byLevel = new Map()
      const unlayered = []
      for (const node of nodes) {
        if (Number.isInteger(node?.level)) {
          if (!byLevel.has(node.level)) byLevel.set(node.level, [])
          byLevel.get(node.level).push(node)
        } else {
          unlayered.push(node)
        }
      }
      // §10.3：importance 队内按服务端 importanceRank 降序、同档 id 升序；缺 rank 保留原序
      const compare = (a, b) => {
        if (data?.lens !== 'importance') return String(a?.id ?? '').localeCompare(String(b?.id ?? ''))
        const ra = Number.isFinite(a?.importanceRank) ? a.importanceRank : null
        const rb = Number.isFinite(b?.importanceRank) ? b.importanceRank : null
        return ra === rb
          ? (ra === null ? 0 : String(a?.id ?? '').localeCompare(String(b?.id ?? '')))
          : (ra === null ? 1 : (rb === null ? -1 : rb - ra))
      }
      const rows = [...byLevel.keys()].sort((a, b) => a - b)
        .map((level) => ({ level, nodes: byLevel.get(level).slice().sort(compare) }))
      if (unlayered.length > 0) rows.push({ level: null, nodes: unlayered.slice().sort(compare) })

      return { ...graphLayoutRows(rows, 0, options?.maxWidth), unlayered: unlayered.length }
    }

    /** 节点主标题：名字缺失时退回 id（FR-5.7 的占位符纪律）。 */
    function graphNodeLabel(node) {
      return typeof node?.name === 'string' && node.name !== '' ? node.name : (node?.id ?? '—')
    }

    /**
     * 文本宽度（半角单位；全角/宽字符算 2）：节点框固定 128px，按字符数截断会溢出，必须按宽度折算。
     */
    function graphTextUnits(value) {
      // 全角/宽字符的码点区间（CJK 汉字、假名、谚文、全角标点等）
      return [...String(value ?? '')].reduce((units, char) =>
        units + (/[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char) ? 2 : 1), 0)
    }

    /** 节点文本截断：按宽度单位截，省略号本身占 1 单位（宁少一字也不出框）。 */
    function truncateLabel(text, maxUnits) {
      const value = String(text ?? '')
      if (graphTextUnits(value) <= maxUnits) return value
      const budget = Math.max(1, maxUnits - 1)
      let units = 0
      let out = ''
      for (const char of value) {
        const cost = graphTextUnits(char)
        if (units + cost > budget) break
        units += cost
        out += char
      }
      return `${out}…`
    }

    /** 异常 → 可渲染行（UI 与单测共用映射）；FR-7.7 要求点名具体任务 id 且可点，不是一句「存在异常」。 */
    function graphAnomalyRows(data, t) {
      const labelKey = { cycle: 'graphCycle', dangling: 'graphDangling', self: 'graphSelf' }
      return (Array.isArray(data?.anomalies) ? data.anomalies : []).map((anomaly, index) => ({
        key: `${String(anomaly?.kind)}-${index}`,
        kind: anomaly?.kind ?? null,
        ids: Array.isArray(anomaly?.ids) ? anomaly.ids : [],
        text: t(labelKey[anomaly?.kind] ?? 'graphAnomalyTitle')
      }))
    }

    // ── FR-14 图谱镜头（纯函数，直接可测；投影一律由服务端组装，这里只做渲染前整形）──
    const GRAPH_LENS_ORDER = ['chain', 'umbrella', 'wave', 'importance', 'files']
    const GRAPH_LENS_I18N = { chain: 'graphLensChain', umbrella: 'graphLensUmbrella', wave: 'graphLensWave', importance: 'graphLensImportance', files: 'graphLensFiles' }
    const GRAPH_EDGE_LEGEND_I18N = { depends_on: 'graphLegendDependsOn', depends_on_aggregated: 'graphLegendAggregated', sourced_from: 'graphLegendSourcedFrom', touches: 'graphLegendTouches' }
    const GRAPH_ANOMALY_MAX_IDS = 8 // 异常行内联的 id 上限：环可能吞掉上百个节点，全列会把图挤出首屏

    const GRAPH_WAVE_LABEL_W = 52 // 左侧「第 N 波」标签槽宽：节点从槽右侧起步，文字不叠在节点上

    /** 可用镜头：只返回服务端标 available 的项（契约 §6.1）；老服务端无 lenses → 退回只有 chain。 */
    function graphLensOptions(data) {
      if (!Array.isArray(data?.lenses)) return [{ id: 'chain', available: true, reason: null }]
      const byId = new Map()
      for (const entry of data.lenses) {
        const id = typeof entry?.id === 'string' ? entry.id : null
        // 契约外的 id 与不可用镜头都不渲染：画一个点了会 400 的按钮等于骗用户
        if (id === null || !GRAPH_LENS_ORDER.includes(id) || entry.available !== true) continue
        if (!byId.has(id)) byId.set(id, { id, available: true, reason: typeof entry.reason === 'string' ? entry.reason : null })
      }
      return GRAPH_LENS_ORDER.filter((id) => byId.has(id)).map((id) => byId.get(id))
    }

    /** 波次布局：行 = 服务端 wave、行内顺序 = waveRank（前端绝不重排）；wave 非法 / level===null → 末行「未分层」。 */
    function layoutWaveGraph(data, options) {
      const nodes = Array.isArray(data?.nodes) ? data.nodes : []
      const byWave = new Map()
      const unlayered = []
      for (const node of nodes) {
        const wave = Number.isInteger(node?.wave) ? node.wave : (Number.isInteger(node?.level) ? node.level : null)
        if (wave === null) { unlayered.push(node); continue }
        if (!byWave.has(wave)) byWave.set(wave, [])
        byWave.get(wave).push(node)
      }
      // 排序口径是契约的一部分（服务端按重要度 → 难度 → id 排好），这里只按 waveRank 稳定排序
      const rank = (list) => list
        .map((node, index) => ({ node, index, rank: Number.isInteger(node?.waveRank) ? node.waveRank : Number.MAX_SAFE_INTEGER }))
        .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
        .map((entry) => entry.node)
      const rows = [...byWave.keys()].sort((a, b) => a - b).map((wave) => ({ wave, nodes: rank(byWave.get(wave)) }))
      if (unlayered.length > 0) rows.push({ wave: null, nodes: rank(unlayered) })
      const base = graphLayoutRows(rows, GRAPH_WAVE_LABEL_W, options?.maxWidth)
      const waveLabels = base.rows.filter((row) => row.segment === 0).map((row) => ({
        key: row.wave === null ? 'unlayered' : `w${row.wave}`, wave: row.wave, x: GRAPH_PAD,
        y: base.positions.get(row.nodes[0].id).y + GRAPH_NODE_H / 2 + 4
      }))
      // 截断只透传服务端 projection.wave；缺省按实画行数兜底
      const wave = data?.projection?.wave ?? null
      const count = rows.filter((row) => row.wave !== null).length
      return {
        ...base, waveLabels, unlayered: unlayered.length, truncated: wave?.truncated === true,
        total: Number.isInteger(wave?.total) ? wave.total : count,
        shown: Number.isInteger(wave?.shown) ? wave.shown : count
      }
    }

    /** 文件冲突二部图（§10.4）：上段文件网格按 maxWidth 折列、下段任务沿用分层折行；两段间留边走廊。 */
    function layoutFilesGraph(data, options) {
      const nodes = Array.isArray(data?.nodes) ? data.nodes : []
      const files = nodes.filter((node) => node?.kind === 'file')
      const fileGrid = graphLayoutRows(files.length === 0 ? [] : [{ level: 'files', nodes: files }], 0, options?.maxWidth)
      const taskGrid = layoutDependencyGraph({ ...data, nodes: nodes.filter((node) => node?.kind !== 'file') }, options)
      // 任务段整体下移到文件段下方；文件为空时偏移 0（与 chain 布局逐项等价）
      const part = files.length === 0 ? 0 : fileGrid.height - GRAPH_PAD
      const positions = new Map(fileGrid.positions)
      for (const [id, position] of taskGrid.positions) positions.set(id, { ...position, y: position.y + part })
      return {
        rows: fileGrid.rows.concat(taskGrid.rows.map((row) => ({ ...row, visualRow: row.visualRow + fileGrid.visualRows }))),
        positions, width: Math.max(fileGrid.width, taskGrid.width), height: Math.max(fileGrid.height, taskGrid.height + part),
        columns: fileGrid.columns, wrapped: fileGrid.wrapped || taskGrid.wrapped,
        visualRows: fileGrid.visualRows + taskGrid.visualRows, levelRows: fileGrid.levelRows + taskGrid.levelRows,
        segmentGap: GRAPH_SEGMENT_GAP, unlayered: taskGrid.unlayered
      }
    }

    /** 伞标签：服务端已把 name 退化为 title ?? slug，前端不再二次判断标题；只有 name 为空才退到 slug / id。 */
    function umbrellaNodeLabel(node) {
      if (typeof node?.name === 'string' && node.name !== '') return node.name
      if (typeof node?.slug === 'string' && node.slug !== '') return node.slug
      return typeof node?.id === 'string' && node.id !== '' ? node.id : '—'
    }

    /** 图例行：优先服务端 edgeKinds（权威口径），缺省时只统计 edges 的 kind；projected 行必须标注「投影边」。 */
    function graphLegendRows(data, t) {
      const tr = typeof t === 'function' ? t : (key) => key
      let entries
      if (Array.isArray(data?.edgeKinds) && data.edgeKinds.length > 0) {
        entries = data.edgeKinds.map((entry) => ({
          kind: typeof entry?.kind === 'string' ? entry.kind : '',
          count: Number.isFinite(entry?.count) ? entry.count : 0,
          projected: entry?.projected === true
        }))
      } else {
        // 老服务端没有 edgeKinds：只按 edges 里出现的 kind 计数，不新增/不猜任何边
        const stats = new Map()
        for (const edge of Array.isArray(data?.edges) ? data.edges : []) {
          const kind = typeof edge?.kind === 'string' && edge.kind !== '' ? edge.kind : 'depends_on'
          const seen = stats.get(kind) ?? { kind, count: 0, projected: false }
          stats.set(kind, { kind, count: seen.count + 1, projected: seen.projected || edge?.projected === true })
        }
        entries = [...stats.values()]
      }
      return entries
        .filter((entry) => entry.kind !== '')
        .sort((a, b) => a.kind.localeCompare(b.kind))
        .map((entry) => ({
          kind: entry.kind,
          count: entry.count,
          projected: entry.projected,
          text: tr(GRAPH_EDGE_LEGEND_I18N[entry.kind] ?? 'graphLegendEdge'),
          note: entry.projected === true ? tr('graphLegendProjectedNote') : null,
          dash: entry.kind === 'depends_on_aggregated' ? 'dashed' : (entry.kind === 'sourced_from' ? 'dotted' : 'solid')
        }))
    }

    /** 关键路径摘要（§11.2）：三态文案与渲染共用；taskCount<2 或缺失视为无链（text=null）。 */
    function graphCriticalPathText(criticalPath, t) {
      const path = criticalPath ?? null
      if (path === null || !Number.isInteger(path.taskCount) || path.taskCount < 2) return { text: null, hours: null }
      const tr = typeof t === 'function' ? t : (key) => key
      const head = tr('graphCriticalPath')
        .replace('{tasks}', String(path.taskCount))
        .replace('{levels}', String(Number.isInteger(path.levelCount) ? path.levelCount : 0))
      const hours = Number.isFinite(path.estimatedHours) && path.estimatedHours > 0 ? path.estimatedHours : null
      if (hours !== null) return { text: `${head} · ${tr('graphCriticalPathHours').replace('{hours}', String(hours))}`, hours }
      if (Number.isInteger(path.missingHours) && path.missingHours > 0) {
        return { text: `${head} · ${tr('graphCriticalPathMissing').replace('{missing}', String(path.missingHours))}`, hours: null }
      }
      return { text: head, hours: null }
    }

    /** 语义缩放（§9.3）。 */
    function graphLabelMode(scale) {
      if (typeof scale !== 'number' || !Number.isFinite(scale)) return 'full'
      if (scale >= 0.75) return 'full'
      if (scale >= 0.45) return 'compact'
      return 'blocks'
    }

    /**
     * 依赖图视图（FR-7 / FR-14）：只做派生 + 组合；数据与投影由服务端算好，前端不猜算（FR-7.5）。
     * R20：三种镜头 + 经典视图共用同一 SVG 绘制点与布局纯函数，经典视图必然是现行渲染原样（FR-14.9）。
     */
    // 渲染别名（等价 React.createElement）
    const el = React.createElement

    // 依赖图子组件（R20：经典视图与镜头视图共用同一 SVG 绘制点与布局纯函数）

    // 镜头切换器：只列服务端标 available 的镜头，顺序由 GRAPH_LENS_ORDER 钉死
    function GraphLensSwitcher({ t, options, activeLens, onSelectLens }) {
      return el('div', {
        style: styles.graphLensRow, role: 'group', 'aria-label': t('graphLensLabel')
      }, options.map((option) => el('button', {
        key: option.id,
        type: 'button',
        'data-orchd-graph-lens': option.id,
        'aria-pressed': activeLens === option.id ? 'true' : 'false',
        style: activeLens === option.id ? { ...styles.chipButton, ...styles.graphLensActive } : styles.chipButton,
        onClick: () => onSelectLens(option.id)
      }, t(GRAPH_LENS_I18N[option.id] ?? 'graphLensChain'))))
    }

    // 工具条：节点/边计数 + 含终态任务 + 经典视图开关（开 → 强制 chain 并隐藏切换器）+ 返回全图
    function GraphToolbar({ t, counts, nodeCount, includeTerminal, onToggleTerminal, classicMode, onToggleClassic, focusId, onBackToAll }) {
      return el('div', { style: styles.graphToolbar, 'data-orchd-graph-toolbar': 'true' }, [
        el('span', { key: 'c', style: { fontSize: 11.5, color: TOKEN.labelTertiary } },
          t('graphCounts').replace('{n}', String(counts.nodes ?? nodeCount)).replace('{e}', String(counts.edges ?? 0))),
        el('span', { key: 'sp', style: styles.spacer }),
        el('label', { key: 't', style: styles.radioItem, title: t('graphIncludeTerminalHint') }, [
          el('input', {
            key: 'cb',
            type: 'checkbox',
            checked: includeTerminal === true,
            'data-orchd-graph-terminal': 'toggle',
            onChange: (event) => onToggleTerminal(event.target.checked)
          }),
          t('graphIncludeTerminal')
        ]),
        // 经典视图：开 = 强制 chain + 隐藏切换器，渲染与布局回到现行版本（FR-14.9）
        el('label', { key: 'classic', style: styles.radioItem }, [
          el('input', {
            key: 'cb',
            type: 'checkbox',
            checked: classicMode,
            'data-orchd-graph-classic': 'toggle',
            onChange: (event) => onToggleClassic(event.target.checked)
          }),
          t('graphClassic')
        ]),
        focusId === null
          ? null
          : el('button', {
              key: 'back',
              type: 'button',
              style: styles.filterEntry,
              'data-orchd-graph-back': 'true',
              onClick: onBackToAll
            }, t('graphBackToAll'))
      ].filter(Boolean))
    }

    // 横幅 + 异常提示：构造扁平节点数组（空态时父组件不渲染这一段，避免与空态文案重复）
    function graphBannerNodes({ t, counts, layout, waveProjection, umbrellaProjection, filesProjection, expandedUmbrella, anomalyRows, onFocus, onSelectUmbrella }) {
      return [
        // 隐藏了终态任务 → 说清楚（否则用户会以为图本身就是全部）
        counts.hiddenTerminal > 0
          ? el('div', {
              key: 'hidden',
              style: styles.note,
              'data-orchd-graph-hidden': String(counts.hiddenTerminal)
            }, t('graphHiddenTerminal').replace('{n}', String(counts.hiddenTerminal)))
          : null,
        counts.omittedByLimit > 0
          ? el('div', {
              key: 'limit',
              style: { ...styles.note, color: WARN },
              'data-orchd-graph-truncated': String(counts.omittedByLimit)
            }, t('graphTruncated').replace('{n}', String(counts.nodes)))
          : null,
        // FR-14.4：波次被 maxWaves 截断 → 写明「共 N 波，显示前 M 波」，不许默默少画
        waveProjection?.truncated === true ? el('div', {
          key: 'wave-truncated', style: { ...styles.note, color: WARN },
          'data-orchd-graph-wave-truncated': String(waveProjection.total)
        }, t('graphWaveTruncated').replace('{n}', String(waveProjection.total)).replace('{m}', String(waveProjection.shown))) : null,
        // §10.4：maxFiles 截断显式计数（文件/任务数都不许静默丢）
        filesProjection?.filesOmitted > 0 ? el('div', { key: 'files-truncated', style: { ...styles.note, color: WARN }, 'data-orchd-graph-files-truncated': String(filesProjection.filesOmitted) },
          t('graphFileTruncated').replace('{n}', String(filesProjection.filesTotal)).replace('{m}', String(filesProjection.filesShown)).replace('{k}', String(filesProjection.tasksShown))) : null,
        // FR-14.3：标题缺失是显式降级（显示 slug）→ 计数，不许猜标题
        umbrellaProjection?.missingTitle > 0 ? el('div', {
          key: 'umbrella-missing-title', style: { ...styles.note, color: WARN },
          'data-orchd-graph-missing-title': String(umbrellaProjection.missingTitle)
        }, t('graphUmbrellaMissingTitleCount').replace('{n}', String(umbrellaProjection.missingTitle))) : null,
        // 没有来源伞的任务不参与投影，但不许静默丢（契约 §3.3）
        umbrellaProjection?.unattributedTasks > 0 ? el('div', {
          key: 'umbrella-unattributed', style: styles.note,
          'data-orchd-graph-unattributed': String(umbrellaProjection.unattributedTasks)
        }, t('graphUmbrellaUnattributed').replace('{n}', String(umbrellaProjection.unattributedTasks))) : null,
        // 展开态可见 + 一键收起（再点伞或点这里都清空）
        expandedUmbrella !== null ? el('div', {
          key: 'umbrella-expanded', style: styles.note,
          'data-orchd-graph-umbrella-expanded': expandedUmbrella
        }, [
          `${t('graphUmbrellaExpanded').replace('{n}', expandedUmbrella)} `,
          el('button', {
            key: 'c',
            type: 'button',
            style: styles.chipButton,
            'data-orchd-graph-umbrella-collapse': 'true',
            onClick: () => onSelectUmbrella(null)
          }, t('graphUmbrellaCollapse'))
        ].filter(Boolean)) : null,
        layout.unlayered > 0
          ? el('div', { key: 'unlayered', style: styles.note, 'data-orchd-graph-unlayered': String(layout.unlayered) }, t('graphUnlayered'))
          : null,
        anomalyRows.length === 0
          ? null
          : el('div', {
              key: 'anomalies',
              style: { ...styles.note, color: WARN },
              'data-orchd-graph-anomalies': String(anomalyRows.length)
            }, [
              el('div', { key: 'h' }, t('graphAnomalyTitle')),
              ...anomalyRows.map((row) => el('div', { key: row.key, 'data-orchd-graph-anomaly': row.kind }, [
                el('span', { key: 'l' }, row.text),
                ...row.ids.slice(0, GRAPH_ANOMALY_MAX_IDS).map((id) => el('button', {
                  key: `i-${id}`,
                  type: 'button',
                  style: { ...styles.chipButton, marginRight: 4 },
                  onClick: () => onFocus(id)
                }, id)),
                row.ids.length > GRAPH_ANOMALY_MAX_IDS
                  ? el('span', { key: 'more', 'data-orchd-graph-anomaly-more': String(row.ids.length - GRAPH_ANOMALY_MAX_IDS) },
                      t('graphAnomalyMore').replace('{n}', String(row.ids.length - GRAPH_ANOMALY_MAX_IDS)))
                  : null
              ]))
            ])
      ].filter(Boolean)
    }

    // 聚焦条：说明当前闭包的上下游规模，并提供「打开详情」下钻
    function GraphFocusBar({ t, focusId, focusInfo, onOpenTask }) {
      return focusId === null ? null : el('div', {
        style: { ...styles.note, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
        'data-orchd-graph-focus': focusId
      }, [
        el('span', { key: 'id', style: { ...styles.mono, color: TOKEN.label } }, `${t('graphFocus')} ${focusId}`),
        el('span', { key: 'u' }, `${t('graphFocusUpstream')} ${focusInfo.upstream.length}`),
        el('span', { key: 'd' }, `${t('graphFocusDownstream')} ${focusInfo.downstream.length}`),
        el('button', {
          key: 'open',
          type: 'button',
          style: styles.chipButton,
          'data-orchd-graph-open': focusId,
          onClick: () => onOpenTask(focusId)
        }, t('graphOpenTask'))
      ])
    }

    // 空态：**也必须带上工具条**（提示语让用户去开「含终态任务」，开关就在工具条里）
    function GraphEmptyState({ t, counts }) {
      return el('div', { 'data-orchd-graph-empty': 'true', style: { flex: '1 1 auto', minHeight: 0 } }, [
        el('div', { key: 'n', style: styles.note }, t('graphEmptyActive')),
        el('div', { key: 'h', style: styles.note }, t('graphEmptyActiveHint').replace('{n}', String(counts.hiddenTerminal ?? 0)))
      ])
    }

    // 图例：每条画出来的线都要能解释；projected 边写明「不是逐条 depends_on 事实」（R19）
    function GraphLegend({ t, rows }) {
      if (rows.length === 0) return null
      return el('div', {
        style: { ...styles.note, display: 'flex', flexDirection: 'column', gap: 4 }
      }, rows.map((row) => el('div', {
        key: row.kind, style: styles.legendRow, 'data-orchd-graph-legend': row.kind
      }, [
        el('span', { key: 's', style: { width: 22, borderTopWidth: 2, borderTopColor: TOKEN.border, borderTopStyle: row.dash } }),
        el('span', { key: 't' }, row.text),
        row.count === null ? null : el('span', { key: 'c', style: { ...styles.mono, color: TOKEN.labelTertiary } }, `×${row.count}`),
        row.note === null ? null : el('span', { key: 'n', style: { ...styles.hint, flexBasis: '100%' } }, row.note)
      ].filter(Boolean))))
    }

    // 卡片文字（§9.3）
    function graphCardTexts(position, l1, l2, l2fill, labelMode) {
      const x = position.x + 8
      return [
        labelMode === 'blocks' ? null : el('text', { key: 'l1', x, y: position.y + 17, fontSize: 11.5, fill: TOKEN.label }, l1),
        labelMode === 'full' ? el('text', { key: 'l2', x, y: position.y + 31, fontSize: 10.5, fill: l2fill }, l2) : null
      ]
    }

    // 伞卡片：name（服务端已做 title/slug 退化）+ 任务数；missingTitle 只做显式标记，不猜标题
    function GraphUmbrellaCard({ t, node, position, expandedUmbrella, onSelectUmbrella, labelMode }) {
      const label = umbrellaNodeLabel(node)
      const umbrellaId = typeof node.umbrellaId === 'string' ? node.umbrellaId : null
      const isExpanded = umbrellaId !== null && umbrellaId === expandedUmbrella
      const subLabel = node.missingTitle === true
        ? t('graphUmbrellaMissingTitle')
        : t('graphUmbrellaCount').replace('{n}', String(Number.isInteger(node.count) ? node.count : (node.totalCount ?? 0)))
      const toggle = () => onSelectUmbrella(isExpanded ? null : umbrellaId)
      return el('g', {
        role: 'button',
        tabIndex: 0,
        style: { cursor: 'pointer' },
        'data-orchd-graph-node': node.id,
        'data-orchd-graph-umbrella': umbrellaId ?? node.id,
        'data-orchd-graph-missing-title': node.missingTitle === true ? '1' : '0',
        'aria-pressed': isExpanded ? 'true' : 'false',
        'aria-label': `${t('graphLensUmbrella')} ${node.id} ${label}`,
        onClick: toggle,
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            toggle()
          }
        }
      }, [
        el('title', { key: 't' }, `${node.id} · ${label} · ${subLabel}`),
        el('rect', {
          key: 'r',
          x: position.x, y: position.y, width: position.w, height: position.h, rx: 6, ry: 6,
          fill: isExpanded ? TOKEN.hover : TOKEN.surface2,
          stroke: node.missingTitle === true ? STATE_TOKEN.uninitialized : TOKEN.labelSecondary,
          strokeWidth: isExpanded ? 2 : 1,
          strokeDasharray: node.missingTitle === true ? '4 3' : undefined
        }),
        ...graphCardTexts(position, truncateLabel(label, 17), truncateLabel(subLabel, 19),
          node.missingTitle === true ? STATE_TOKEN.uninitialized : TOKEN.labelTertiary, labelMode)
      ])
    }

    // 任务卡片：链/波次里点节点 = 聚焦闭包；伞镜头里成员任务可点开详情（FR-6 下钻）
    function GraphTaskCard({ t, node, position, focusId, activeLens, onOpenTask, onFocus, labelMode }) {
      const color = node.missing === true ? STATE_TOKEN.broken : (STATUS_TOKEN[node.status] ?? TOKEN.labelTertiary)
      const isFocus = node.id === focusId
      const onChain = node.relation === 'upstream' || node.relation === 'downstream' || node.relation === 'both'
      const label = graphNodeLabel(node)
      // §10.3：显式重要度优先于推导；两者都没有就不画徽标（不猜档位）
      const importance = node.importance == null ? (node.importanceDerived === true ? 'derived' : null) : 'explicit'
      const blocked = node.blockedDownstream > 0 ? ` · ${t('graphBlocked')} ${node.blockedDownstream}` : ''
      return el('g', {
        role: 'button',
        tabIndex: 0,
        'data-orchd-graph-node': node.id,
        'data-orchd-graph-relation': node.relation ?? 'none',
        'aria-label': `${node.id} ${label}`,
        style: { cursor: 'pointer' },
        onClick: activeLens === 'umbrella' || activeLens === 'files' ? () => onOpenTask(node.id) : () => onFocus(node.id),
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (activeLens === 'umbrella' || activeLens === 'files') onOpenTask(node.id)
            else onFocus(node.id)
          }
        }
      }, [
        el('title', { key: 't' }, `${node.id} · ${label}${blocked}${node.missing === true ? t('graphMissing') : ''}`),
        el('rect', { key: 'r', x: position.x, y: position.y, width: position.w, height: position.h, rx: 6, ry: 6, fill: isFocus || onChain ? TOKEN.hover : TOKEN.surface2, stroke: color, strokeWidth: isFocus ? 2 : 1, strokeDasharray: node.missing === true ? '4 3' : undefined }),
        importance === null ? null : el('g', { key: 'imp', 'data-orchd-graph-importance': importance }, [
          el('rect', { key: 'b', x: position.x + position.w - 21, y: position.y + 4, width: 17, height: 11, rx: 2, fill: TOKEN.surface3, stroke: color }),
          el('text', { key: 'l', x: position.x + position.w - 12.5, y: position.y + 12, fontSize: 8, textAnchor: 'middle', fill: TOKEN.label }, t(importance === 'explicit' ? 'graphImportanceExplicit' : 'graphImportanceDerived'))
        ]),
        ...graphCardTexts(position, truncateLabel(label, 17),
          truncateLabel(node.missing === true ? t('graphMissing') : `${node.id}${blocked}`, 19), TOKEN.labelTertiary, labelMode)
      ])
    }

    // 文件卡片（§10.4）：basename + 「N 个任务」；投影顶点不是任务，不可聚焦
    function GraphFileCard({ t, node, position, labelMode }) {
      const name = node?.name || node?.path || node?.id || '—'
      const sub = t('graphUmbrellaCount').replace('{n}', String(Number.isInteger(node?.tasks) ? node.tasks : 0))
      return el('g', { 'data-orchd-graph-node': node.id, 'data-orchd-graph-file': node?.path ?? node.id }, [
        el('rect', { key: 'r', x: position.x, y: position.y, width: position.w, height: position.h, rx: 6, ry: 6, fill: TOKEN.surface3, stroke: TOKEN.labelSecondary, strokeWidth: 1, strokeDasharray: '2 2' }),
        ...graphCardTexts(position, truncateLabel(name, 17), truncateLabel(sub, 19), TOKEN.labelTertiary, labelMode)
      ])
    }

    // SVG 图层（唯一绘制点）：波次标签 / 边（线型承载边种类）/ 节点卡片；canvas 层替换的接缝
    function GraphSvgLayer({ t, data, layout, focusId, activeLens, expandedUmbrella, onOpenTask, onFocus, onSelectUmbrella, scale, labelMode }) {
      const nodes = Array.isArray(data?.nodes) ? data.nodes : []
      // 只缩放外框，viewBox 保持逻辑尺寸（§9.2/§9.3）
      const scaled = Number.isFinite(scale) && scale > 0 ? scale : 1
      const mode = labelMode === 'compact' || labelMode === 'blocks' ? labelMode : 'full'
      return el('svg', {
        width: layout.width * scaled,
        height: layout.height * scaled,
        viewBox: `0 0 ${layout.width} ${layout.height}`,
        role: 'img',
        'aria-label': t('viewGraph'),
        'data-orchd-graph': 'svg',
        style: { color: TOKEN.labelTertiary, display: 'block' }
      }, [
        el('defs', { key: 'defs' }, el('marker', {
          id: 'orchd-graph-arrow',
          markerWidth: 6,
          markerHeight: 6,
          refX: 5,
          refY: 3,
          orient: 'auto',
          markerUnits: 'strokeWidth'
        }, el('path', { d: 'M0,0 L6,3 L0,6 z', fill: 'currentColor' }))),
        // FR-14.4：每波一条标签，画在左侧槽位（节点从槽右侧起步），波次值不重排。
        ...(mode !== 'blocks' && Array.isArray(layout.waveLabels) ? layout.waveLabels : []).map((row) => el('text', {
          key: `wl-${row.key}`,
          x: row.x,
          y: row.y,
          fontSize: 11,
          fill: TOKEN.labelTertiary,
          'data-orchd-graph-wave': row.wave === null ? 'unlayered' : String(row.wave)
        }, row.wave === null ? t('graphWaveUnlayered') : t('graphWaveLabel').replace('{n}', String(row.wave)))),
        // 边：上游底边中点 → 下游顶边中点（自环画成回环）。线型承载边种类（R19）：
        // depends_on 实线 / 聚合边虚线 + weight / sourced_from 点线；投影边弱化且不带箭头（不冒充逐条事实）。
        ...(Array.isArray(data?.edges) ? data.edges : []).map((edge, index) => {
          const from = layout.positions.get(edge.from)
          const to = layout.positions.get(edge.to)
          if (from === undefined || to === undefined) return null
          const kind = typeof edge.kind === 'string' && edge.kind !== '' ? edge.kind : 'depends_on'
          const x1 = from.x + from.w / 2
          const y1 = from.y + from.h
          const x2 = to.x + to.w / 2
          const y2 = to.y
          const bend = Math.max(10, Math.abs(y2 - y1) / 2)
          // §10.4：touches 是「任务 ↔ 文件」的实线，从文件卡片右缘直线连到任务卡片左缘
          const d = kind === 'touches'
            ? `M ${from.x + from.w} ${from.y + from.h / 2} L ${to.x} ${to.y + to.h / 2}`
            : (edge.from === edge.to
              ? `M ${x1} ${y1} C ${x1 + 46} ${y1 + 26} ${x1 + 46} ${y1 - 26} ${x1 + 6} ${y1 - 6}`
              : `M ${x1} ${y1} C ${x1} ${y1 + bend} ${x2} ${y2 - bend} ${x2} ${y2}`)
          const projected = edge.projected === true
          const dashed = kind === 'depends_on_aggregated'
          const dotted = kind === 'sourced_from'
          const weight = Number.isInteger(edge.weight) ? edge.weight : null
          const path = el('path', {
            key: `e${index}`,
            d,
            fill: 'none',
            stroke: projected ? TOKEN.labelTertiary : TOKEN.border,
            strokeWidth: dashed && weight !== null && weight > 1 ? 2 : 1.2,
            strokeDasharray: dashed ? '6 4' : (dotted ? '1 4' : undefined),
            strokeLinecap: dotted ? 'round' : undefined,
            markerEnd: projected ? undefined : 'url(#orchd-graph-arrow)',
            'data-orchd-graph-edge': `${edge.from}>${edge.to}`,
            'data-orchd-graph-edge-kind': kind
          })
          // 聚合边的 weight 是「几个下游伞靠它」的计数，必须可读（否则虚线只是一条线）
          if (!dashed || weight === null || mode !== 'full') return path
          return [
            path,
            el('text', {
              key: `w${index}`,
              x: (x1 + x2) / 2,
              y: (y1 + y2) / 2,
              fontSize: 10,
              fill: TOKEN.labelTertiary,
              textAnchor: 'middle',
              'data-orchd-graph-edge-weight': String(weight)
            }, `×${weight}`)
          ]
        }),
        ...nodes.map((node) => {
          const position = layout.positions.get(node.id)
          if (position === undefined) return null
          return node.kind === 'umbrella'
            ? el(GraphUmbrellaCard, { key: `u-${node.id}`, t, node, position, expandedUmbrella, onSelectUmbrella, labelMode: mode })
            : (node.kind === 'file'
              ? el(GraphFileCard, { key: `f-${node.id}`, t, node, position, labelMode: mode })
              : el(GraphTaskCard, { key: `n-${node.id}`, t, node, position, focusId, activeLens, onOpenTask, onFocus, labelMode: mode }))
        })
      ])
    }

    // 缩放控件（§9.2）；平移仍走 ScrollPane
    function GraphZoomControls({ t, scale, onZoomOut, onZoomIn, onFit, onReset }) {
      const btn = (key, label, onClick, text) => el('button', {
        key, type: 'button', style: styles.chipButton, 'data-orchd-graph-zoom': key, 'aria-label': label, onClick
      }, text)
      return el('div', { style: styles.graphLensRow, role: 'group', 'aria-label': t('graphZoomGroup') }, [
        btn('out', t('graphZoomOut'), onZoomOut, '−'),
        el('span', { key: 'lv', style: styles.mono }, `${Math.round(scale * 100)}%`),
        btn('in', t('graphZoomIn'), onZoomIn, '+'),
        btn('fit', t('graphZoomFit'), onFit, t('graphZoomFit')),
        btn('reset', t('graphZoomReset'), onReset, t('graphZoomReset'))
      ])
    }

    /**
     * 依赖图面板：只做「派生 + 组合」。
     * - 布局/投影都在服务端或纯函数里算好，这里不重排、不重算（R20：经典视图与镜头视图共用同一组纯函数）；
     * - 经典视图恒为 chain 并隐藏切换器（FR-14.9），渲染结构不变 = 无功能回退。
     */
    function DependencyGraph({ data, t, onOpenTask, onFocus, onBackToAll, includeTerminal, onToggleTerminal, classic, onToggleClassic, onSelectLens, umbrella, onSelectUmbrella }) {
      const nodes = Array.isArray(data?.nodes) ? data.nodes : []
      const counts = data?.counts ?? {}
      const focusInfo = data?.focus ?? null
      const focusId = typeof focusInfo?.id === 'string' ? focusInfo.id : null
      // 经典视图恒为 chain（FR-14.9）；其余以服务端回显 lens 为准——投影由服务端算好，前端不重算
      const classicMode = classic === true
      const activeLens = classicMode ? 'chain' : (typeof data?.lens === 'string' ? data.lens : 'chain')
      const lensOptions = graphLensOptions(data)
      const umbrellaProjection = activeLens === 'umbrella' ? (data?.projection?.umbrella ?? null) : null
      const waveProjection = activeLens === 'wave' ? (data?.projection?.wave ?? null) : null
      const expandedUmbrella = typeof umbrellaProjection?.expanded === 'string' ? umbrellaProjection.expanded : null
      const [scale, setScale] = React.useState(1)
      const [viewportWidth, setViewportWidth] = React.useState(0)
      const scrollRef = React.useRef(null)
      // 视口宽 → 折行列数（§9.1）；卸载 disconnect
      React.useEffect(() => {
        const node = scrollRef.current
        if (node === null) return undefined
        const read = () => setViewportWidth(node.clientWidth)
        read()
        if (typeof ResizeObserver !== 'function') return undefined
        const observer = new ResizeObserver(read)
        observer.observe(node)
        return () => observer.disconnect()
      }, [])
      const viewportW = viewportWidth > 0 ? viewportWidth : GRAPH_VIEWPORT_FALLBACK
      const filesProjection = activeLens === 'files' ? (data?.projection?.files ?? null) : null
      const layout = activeLens === 'wave'
        ? layoutWaveGraph(data, { maxWidth: viewportW - 1 })
        : (activeLens === 'files' ? layoutFilesGraph(data, { maxWidth: viewportW - 1 }) : layoutDependencyGraph(data, { maxWidth: viewportW - 1 }))
      const labelMode = graphLabelMode(scale)
      // §10.5：importance 图例补「显式优先于推导」；files 图例由 edgeKinds（只有 touches）驱动
      const legendRows = activeLens === 'importance'
        ? graphLegendRows(data, t).concat({ kind: 'importance-rank', count: null, projected: false, text: t('graphLegendImportance'), note: null, dash: 'solid' })
        : (activeLens === 'umbrella' || activeLens === 'files' ? graphLegendRows(data, t) : [])
      const anomalyRows = graphAnomalyRows(data, t)
      const zoomTo = (next) => setScale(Math.min(GRAPH_ZOOM_MAX, Math.max(GRAPH_ZOOM_MIN, Math.round(next * 100) / 100)))
      const fitScale = () => zoomTo(Math.min(1, (viewportW - 20) / Math.max(1, layout.width)))

      const lensRow = classicMode || lensOptions.length <= 1 ? null : el(GraphLensSwitcher, {
        key: 'lens', t, options: lensOptions, activeLens, onSelectLens
      })
      const toolbar = el(GraphToolbar, {
        key: 'bar', t, counts, nodeCount: nodes.length, includeTerminal, onToggleTerminal, classicMode, onToggleClassic, focusId, onBackToAll
      })
      const zoomRow = el(GraphZoomControls, {
        key: 'zoom', t, scale,
        onZoomOut: () => zoomTo(scale / GRAPH_ZOOM_STEP),
        onZoomIn: () => zoomTo(scale * GRAPH_ZOOM_STEP),
        onFit: fitScale,
        onReset: () => zoomTo(1)
      })
      const banners = graphBannerNodes({ t, counts, layout, waveProjection, umbrellaProjection, filesProjection, expandedUmbrella, anomalyRows, onFocus, onSelectUmbrella })
      const critical = graphCriticalPathText(data?.criticalPath, t)
      const criticalPathRow = critical.text === null ? null : el('div', {
        key: 'critical-path', style: { ...styles.note, padding: '0 14px 8px' }, 'data-orchd-graph-critical-path': ''
      }, critical.text)
      const legend = el(GraphLegend, { key: 'legend', t, rows: legendRows })
      const focusBar = el(GraphFocusBar, { key: 'focus', t, focusId, focusInfo, onOpenTask })
      const emptyBlock = React.createElement(GraphEmptyState, { key: 'empty', t, counts })
      return el('div', {
        key: 'graph',
        style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 },
        'data-orchd-graph': 'pane',
        'data-orchd-graph-lens-active': activeLens,
        'data-orchd-graph-zoom-level': String(Math.round(scale * 100)),
        'data-orchd-graph-label-mode': labelMode
      }, [
        lensRow,
        toolbar,
        zoomRow,
        criticalPathRow,
        // 横幅只在真有图可标注时才出现（空态提示里已写了「本图隐藏了 N 个终态任务」，不必重复）
        ...(nodes.length === 0 ? [] : banners),
        legend,
        focusBar,
        nodes.length === 0
          ? emptyBlock
          : el(ScrollPane, {
              key: 'scroll',
              label: t('graphScrollLabel'),
              // 两个轴都自绘：横向必须自己画，否则 `scrollbar-width:none` 连原生条也藏掉，纯滚轮用户够不到右侧。
              scrollerRef: scrollRef,
              horizontal: true,
              scrollerStyle: styles.graphScroll,
              contentStyle: { width: layout.width * scale },
              children: el(GraphSvgLayer, { key: 'svg', t, data, layout, focusId, activeLens, expandedUmbrella, onOpenTask, onFocus, onSelectUmbrella, scale, labelMode })
            })
      ].filter(Boolean))
    }

    // ── FR-13 想法看板 ────────────────────────────────────────────────────
    /**
     * 想法展示桶顺序（4 个引擎状态 + 派生桶 `converted`）。
     * 统计条**固定**展示这些（0 值可点），这样三分区在界面上闭合：
     *   `全部 = 活跃 + 已转任务 + 已覆盖`（活跃 = 论证中 + 待补充 + 待拆解）。
     * 集合以宿主下发的 `activeStatuses` 为准，这里只是同源兜底。
     *
     * 引擎 2026-10-23 调整：`taskified` 正名为 `covered`（撞车并入已有任务、待归档），
     * `dropped` 从活跃台账下线（放弃改走 `idea close --reason`）。`converted` 是
     * **派生桶**（任务定义层 source/additional_sources 指向该想法），不是引擎状态。
     */
    const IDEA_STATUSES_UI = ['study', 'questioning', 'pending', 'converted', 'covered']

    /**
     * 想法展示桶 → i18n 键。
     *
     * ⚠ 前 4 个是**引擎定义的**（`study` / `questioning` / `pending` / `covered`），
     * 不得自造；`converted` 是本插件按定义层溯源派生的展示桶。引擎将来加了新状态时
     * 解析层会把 `status` 置 null 并保留原文，这里显示「未知状态 + 原文」，不崩、不猜。
     */
    const IDEA_STATUS_I18N = {
      study: 'iStudy',
      questioning: 'iQuestioning',
      pending: 'iPending',
      converted: 'iConverted',
      covered: 'iCovered'
    }

    /** 条目的展示桶：派生桶优先，其次才是引擎字面状态。 */
    function ideaDisplayStatus(entry) {
      if (entry === null || entry === undefined) return null
      if (typeof entry.displayStatus === 'string') return entry.displayStatus
      if (entry.converted === true) return 'converted'
      return entry.status ?? null
    }

    /** 展示桶文案；未知状态显式说「未知」，不猜、不崩。 */
    function ideaStatusText(entry, t) {
      const status = ideaDisplayStatus(entry)
      return status === null ? t('ideasStatusUnknown') : t(IDEA_STATUS_I18N[status] ?? 'ideasStatusUnknown')
    }

    /** 想法的「在等谁」文案（FR-13.4：**不得只给状态码**）。 */
    function ideaOwnerText(owner, t) {
      switch (owner) {
        case 'user': return t('ideasOwnerUser')
        case 'agent': return t('ideasOwnerAgent')
        default: return t('ideasOwnerNone')
      }
    }

    /** 「在等谁」用不同语义色：等用户最需要注意力。 */
    function ideaOwnerToken(owner) {
      switch (owner) {
        case 'user': return WARN
        case 'agent': return 'var(--dsw-alias-state-business-primary, currentColor)'
        default: return TOKEN.labelTertiary
      }
    }

    /**
     * 想法列表（FR-13.1/13.3/13.4）。
     *
     * 与任务列表用**同一套**状态条筛选组件（FR-13.6），只是标签换成想法展示桶；
     * 徽章数在调用方（视图切换）显示，这里不重复。
     */
    function IdeasBoard({ data, filters, setFilters, t, onOpen }) {
      const entries = data?.entries ?? []
      const counts = data?.counts?.byStatus ?? {}
      // 统计条固定展示全部展示桶（4 个引擎状态 + 派生桶 converted，0 值可点），
      // 以便三分区在界面上**闭合**：
      //   全部 = 活跃 + 已转任务 + 已覆盖      （活跃 = 论证中 + 待补充 + 待拆解）
      // 集合由宿主下发（`activeStatuses`），客户端只做兜底。
      const labels = Array.isArray(data?.activeStatuses) && data.activeStatuses.length > 0
        ? data.activeStatuses
        : IDEA_STATUSES_UI
      // 归档分组：与任务池对照得出（已转任务 / 历史已放弃 / 未立任务 / 无 id）
      const archived = data?.archived ?? {}
      const archivedTotal = data?.archivedCount ?? 0

      const filtered = entries.filter((entry) => {
        const mode = filters.mode
        const display = ideaDisplayStatus(entry)
        if (mode === 'active') {
          // 活跃 = 仍待处理：已转任务（converted）与已覆盖（covered）都不算
          if (display === 'converted' || display === 'covered') return false
        } else if (mode !== 'all' && display !== mode) {
          return false
        }
        if ((filters.keyword ?? '') !== '') {
          const haystack = `${entry.id ?? ''}\n${entry.title ?? ''}`.toLowerCase()
          if (!haystack.includes(filters.keyword.trim().toLowerCase())) return false
        }
        return true
      })

      const summaryForStrip = {
        total: data?.counts?.total ?? entries.length,
        // 「活跃」用宿主给的数（已扣除已转任务 / 已覆盖）；拿不到时退回本地口径
        active: typeof data?.active === 'number'
          ? data.active
          : entries.filter((entry) => !['converted', 'covered'].includes(ideaDisplayStatus(entry))).length,
        ...counts,
        source: 'engine'
      }

      const emptyText = filters.mode !== 'all'
        ? `${t('ideasEmptyFiltered')}${t(IDEA_STATUS_I18N[filters.mode] ?? 'ideasStatusUnknown')}`
        : (filters.keyword !== '' ? t('ideasEmptyKeyword').replace('{kw}', filters.keyword) : t('ideasEmpty'))

      return React.createElement(React.Fragment, null, [
        // 引擎没有 `ideas` 子命令（旧版本，实测 v1.5.0）时**显式说明**：
        // 这时列表与状态只来自 IDEAS.md 直读，没有引擎清单可交叉核对。
        // 不能装成正常，也不能报成「状态异常」——那不是项目坏了（用户实测反馈）。
        data?.unsupported === true
          ? React.createElement('div', {
              key: 'unsupported',
              'data-orchd-ideas-unsupported': String(data.unsupportedHint ?? 'true'),
              style: { ...styles.note, padding: '0 14px 8px', color: WARN }
            }, t('ideasEngineUnsupported'))
          : null,
        React.createElement(StatusStripFilter, {
          key: 'strip',
          summary: summaryForStrip,
          counts,
          mode: filters.mode,
          onSelect: (mode) => setFilters({ ...filters, mode }),
          labels,
          unitKey: (status) => IDEA_STATUS_I18N[status] ?? 'ideasStatusUnknown',
          t
        }),
        React.createElement('div', { key: 'controls', style: styles.controls }, [
          React.createElement('input', {
            key: 'search',
            type: 'search',
            value: filters.keyword,
            placeholder: t('search'),
            'aria-label': t('search'),
            style: styles.input,
            onChange: (event) => setFilters({ ...filters, keyword: event.target.value })
          }),
          React.createElement('div', { key: 'row', style: styles.controlRow }, [
            // 归档分组：**与任务池对照**得出（FR-13.7），不是归档件里的字面 status——
            // 引擎明确归档不改写 status（语义是「已消费」），按字面算会把 287 条已立任务的
            // 条目全说成「待拆解」。四项与总数闭合（含「无 id 无法对照」）。
            React.createElement('span', {
              key: 'arch',
              style: { ...styles.chip, color: TOKEN.labelTertiary },
              title: `${t('ideasArchivedHint')}。${t('ideasArchivedHistorical')}`,
              'data-orchd-archive': String(archivedTotal)
            },
              archivedTotal === 0
                ? `${t('ideasArchived')} 0 ${t('ideasArchivedUnit')}`
                : `${t('ideasArchived')} ${archivedTotal}${t('ideasArchivedUnit')}（${[
                    `${t('ideasConverted')} ${archived.converted ?? 0}`,
                    `${t('ideasArchiveLegacyDropped')} ${archived.legacyDropped ?? 0}`,
                    `${t('ideasUntasked')} ${archived.untasked ?? 0}`,
                    `${t('ideasNoId')} ${archived.noId ?? 0}`
                  ].join(' · ')}）`),
            (filters.mode !== 'all' || filters.keyword !== '')
              ? React.createElement('button', {
                  key: 'clear', type: 'button', style: styles.chipButton, 'aria-label': t('clearFilters'),
                  'data-orchd-chip-clear': 'true',
                  onClick: () => setFilters({ mode: 'all', keyword: '' })
                }, t('clearFiltersShort'))
              : null
          ].filter(Boolean))
        ]),
        React.createElement('div', { key: 'count', style: styles.note },
          `${t('countShown')} ${filtered.length} / ${entries.length} ${t('countUnit')}`),
        filtered.length === 0
          ? React.createElement('div', { key: 'empty', style: styles.note, 'data-orchd-empty': 'ideas' }, [
              React.createElement('div', { key: 't' }, emptyText),
              // 「没有想法」时才给「新建想法」命令——这是全面板**唯一**需要占位符的地方
              // （新建的条目还没有 id，标题里得自己声明一个）。FR-13.8。
              filters.mode === 'all' && (filters.keyword ?? '') === ''
                ? React.createElement('div', { key: 'propose', style: { marginTop: 8 } }, [
                    React.createElement('div', { key: 'h', style: { fontWeight: 600, marginBottom: 4 } }, t('ideasPropose')),
                    React.createElement('div', { key: 'hint', style: { marginBottom: 4 } }, t('ideasProposeHint')),
                    React.createElement(CommandBlock, {
                      key: 'cmd',
                      text: 'python .orchd/__main__.py idea propose --title "<标题>（id: my-idea）" --feasibility "<可行性论证>"',
                      t
                    })
                  ])
                : null
            ])
          : React.createElement(VirtualList, {
              key: 'list',
              rows: filtered,
              rowHeight: IDEA_ROW_HEIGHT,
              label: t('ideasScrollLabel'),
              renderRow: (entry, index, offset) => React.createElement(IdeaRowItem, {
                key: entry.id ?? String(index),
                entry,
                t,
                offset,
                onOpen
              })
            })
      ].filter(Boolean))
    }

    /** 想法行（复用任务行的虚拟化与自绘滚动条，只是内容不同）。 */
    function IdeaRowItem({ entry, t, offset, onOpen }) {
      return React.createElement('button', {
        type: 'button',
        style: { ...styles.rowStyle, top: offset, height: IDEA_ROW_HEIGHT },
        onClick: () => onOpen(entry),
        'data-orchd-idea': entry.id ?? '',
        'aria-label': `${entry.id ?? ''} ${entry.title ?? ''}`.trim()
      }, [
        React.createElement('span', { key: 't', style: styles.rowTitle }, [
          React.createElement('span', { key: 'd', style: { ...styles.rowId, maxWidth: '30%' } }, entry.date ?? '—'),
          React.createElement('span', { key: 'n', style: styles.rowName }, entry.title ?? '—')
        ]),
        React.createElement('span', { key: 'm', style: styles.rowMeta }, [
          React.createElement('span', { key: 's', style: { ...styles.statusTag, color: ideaOwnerToken(entry.owner) } }, [
            React.createElement('span', { key: 'dd', style: styles.chipDot }),
            React.createElement('span', { key: 'l' }, ideaStatusText(entry, t)),
            React.createElement('span', { key: 'o' }, ` · ${ideaOwnerText(entry.owner, t)}`)
          ]),
          // 已转任务：由定义层溯源推出（status 只表达摄入/裁决态，不表达「已立任务」），顺带给出任务数量
          (entry.convertedTasks ?? []).length === 0
            ? null
            : React.createElement('span', { key: 'conv', 'data-orchd-idea-converted': String(entry.convertedTasks.length) },
                `${entry.convertedTasks.length} ${t('ideasConvertedTasks')}`),
          entry.degraded ? React.createElement('span', { key: 'g', style: { color: WARN } }, `⚠ ${t('ideasDegraded')}`) : null,
          entry.engineTitle === null || entry.engineTitle === undefined
            ? React.createElement('span', { key: 'only', style: { color: TOKEN.labelTertiary } }, t('ideasOnlyInMarkdown'))
            : null
        ].filter(Boolean))
      ])
    }

    /**
     * 想法详情（FR-13.5）：goal / idea / 论证 / detail / notes + **未知字段原样展示**。
     * 只读：没有任何 propose / confirm / drop 按钮，只提供复制命令（FR-13.8）。
     */
    function IdeaDetail({ entry, t, onBack }) {
      if (entry === null || entry === undefined) return null
      /**
       * 一个字段段落。
       * `copyable=true` 时在标题右侧加复制按钮——AC-13.4 明确要求「详档路径**可复制**」，
       * 只把路径当纯文本展示不算满足。
       */
      const section = (label, value, key, copyable = false) => (value === null || value === undefined || value === ''
        ? null
        : React.createElement(React.Fragment, { key }, [
            copyable
              ? React.createElement(SectionHead, {
                  key: 'h',
                  label,
                  action: React.createElement(CopyButton, { key: 'c', text: value, t, label: t('copyText') })
                })
              : React.createElement('h4', { key: 'h', style: styles.h4 }, label),
            React.createElement('div', { key: 'v', style: styles.mono }, value)
          ]))
      const list = (label, values, key) => (Array.isArray(values) && values.length > 0
        ? React.createElement(React.Fragment, { key }, [
            React.createElement('h4', { key: 'h', style: styles.h4 }, label),
            React.createElement('ul', { key: 'u', style: styles.ul }, values.map((value, index) =>
              React.createElement('li', { key: index, style: styles.li }, value)))
          ])
        : null)

      const extraKeys = Object.keys(entry.extra ?? {})

      // 与任务详情**同一套骨架**：固定条（返回，不随正文滚动）+ ScrollPane 正文
      // （可见的自绘滚动条；原来这里只有隐藏的原生条，等于没有滚动条）。
      return React.createElement('div', { style: styles.detailPage }, [
        React.createElement('div', { key: 'bar', style: styles.detailBar }, [
          React.createElement('button', {
            key: 'back', type: 'button', style: styles.button, onClick: onBack, 'aria-label': t('back')
          }, `← ${t('back')}`),
          React.createElement('span', { key: 'sp', style: styles.spacer })
        ]),
        React.createElement(ScrollPane, {
          key: 'pane',
          label: t('ideasDetailScrollLabel'),
          scrollerStyle: styles.detailScroll,
          contentStyle: styles.detailBody,
          children: [
            React.createElement('div', { key: 'title', style: styles.header }, [
            React.createElement('h3', { key: 'n', style: { ...styles.title, margin: 0 } }, entry.title ?? '—'),
            React.createElement('span', {
              key: 's',
              style: { ...styles.statusTag, color: ideaOwnerToken(entry.owner) }
            }, [
              React.createElement('span', { key: 'd', style: styles.chipDot }),
              React.createElement('span', { key: 'l' }, ideaStatusText(entry, t)),
              React.createElement('span', { key: 'o' }, ` · ${ideaOwnerText(entry.owner, t)}`)
            ])
          ]),
          React.createElement('div', { key: 'id', style: styles.mono },
            `${entry.id ?? '—'}${entry.date === null ? '' : ` · ${entry.date}`}`),
          entry.degraded
            ? React.createElement('div', { key: 'degraded', style: { ...styles.note, padding: '4px 0 0' } }, `⚠ ${t('ideasDegraded')}`)
            : null,
          entry.engineTitle === null || entry.engineTitle === undefined
            ? React.createElement('div', { key: 'only', style: { ...styles.note, padding: '4px 0 0' } }, t('ideasOnlyInMarkdown'))
            : null,
          // 已转任务（AC-13.12）：定义层溯源出的任务 id 一并展示，说明这条想法去了哪
          (entry.convertedTasks ?? []).length === 0
            ? null
            : React.createElement('div', { key: 'converted' }, [
                React.createElement('h4', { key: 'h', style: styles.h4 }, `${t('ideasConverted')}（${entry.convertedTasks.length}）`),
                React.createElement(SectionHead, {
                  key: 'head',
                  label: t('ideasConvertedHint'),
                  action: React.createElement(CopyButton, { key: 'c', text: entry.convertedTasks.join('\n'), t, label: t('copyText') })
                }),
                React.createElement('ul', { key: 'u', style: styles.ul }, entry.convertedTasks.map((id) =>
                  React.createElement('li', { key: id, style: { ...styles.li, fontFamily: TOKEN.mono } }, id)))
              ]),

          section(t('dBrief'), entry.goal, 'goal'),
          section('idea', entry.idea, 'idea'),
          section('论证', entry.argument, 'argument'),
          section(t('ideasDetailPath'), entry.detail, 'detail', true),
          list(t('ideasNotes'), entry.notes, 'notes'),

          // FR-13.5：**未知字段原样展示**（字段集合会演进，不能用白名单丢掉）
          extraKeys.length === 0
            ? null
            : React.createElement('div', { key: 'extra' }, [
                React.createElement('h4', { key: 'h', style: styles.h4 }, t('ideasExtra')),
                React.createElement('div', { key: 'g', style: styles.grid }, extraKeys.flatMap((key) =>
                  React.createElement(Row, { key, label: key }, String(entry.extra[key]))))
              ]),

          // 只读：只复制命令，不提供任何写操作按钮（FR-13.8）。
          // ⚠ 命令里的 id **必须替换成该条目的真实 id**（用户实测反馈：留 `<标题>` 占位符
          // 粘过去还得手改）。而且要给**当前状态真正能跑**的命令，不能一律给 propose——
          // `idea propose` 是「新建一条想法」，对已存在的条目没有意义。
          React.createElement('h4', { key: 'h-cmd', style: styles.h4 }, t('ideasCommands')),
          React.createElement('div', { key: 'hint', style: { ...styles.note, padding: 0 } }, t('ideasCommandsHint')),
          // 用户实测提问「这条命令是干什么的？引号内是我的 idea 内容吗？」——把每条命令的
          // 语义与占位符含义写在命令上方，省得再去猜（FR-13.8b）
          React.createElement('div', { key: 'legend', style: { ...styles.note, padding: '4px 0 0' } }, t('ideasCommandLegend')),
          ...ideaCommandsFor(entry).map((command) =>
            React.createElement(CommandBlock, { key: `cmd-${command.key}`, text: command.text, t }))
        ].filter(Boolean)
        })
      ])
    }

    /**
     * 某条想法当下可执行的**仅用户**命令（FR-13.8），id 已替换好。
     *
     * 命令形态来自引擎实测（`orchd idea <c> --help`）：
     *   `append --id <id> --notes …`（按 `- id:` 精确值定位）
     *   `confirm --title <title>`、`close --title <title> --reason …`
     *   —— 后两者的 `--title` 支持「裸 slug」，而裸 slug 与 `- id:` 精确相等，故直接用 id。
     *
     * 引擎 2026-10-23 起人工离场出口统一为 `idea close --reason`（旧 drop / archive 已下线）：
     * study/questioning/pending/covered 全部走 close；`study` 另给 confirm（升 pending）。
     * 在途任务引用期间引擎会拒绝搬走（`source_live_reference`），这是引擎的守卫，不是错误。
     * 判定用**字面 status**（`converted` 的条目字面仍是 pending）。
     */
    function ideaCommandsFor(entry) {
      const id = typeof entry.id === 'string' && entry.id !== '' ? entry.id : null
      if (id === null) return []
      const commands = [{ key: 'append', text: `python .orchd/__main__.py idea append --id ${id} --notes "<追记内容>"` }]
      if (entry.status === 'study') {
        commands.push({ key: 'confirm', text: `python .orchd/__main__.py idea confirm --title ${id}` })
        commands.push({ key: 'close', text: `python .orchd/__main__.py idea close --title ${id} --reason "<裁决理由>"` })
      } else if (entry.status === 'questioning' || entry.status === 'pending' || entry.status === 'covered') {
        commands.push({ key: 'close', text: `python .orchd/__main__.py idea close --title ${id} --reason "<裁决理由>"` })
      }
      return commands
    }

    // ── 面板正文 ─────────────────────────────────────────────────────────
    function OrchdTasksPane(props) {
      const t = typeof props?.t === 'function' ? props.t : (key) => key
      const sessionId = typeof props?.sessionId === 'string' && props.sessionId !== '' ? props.sessionId : null

      const [context, setContext] = React.useState({ status: 'idle', data: null, error: null, meta: null })
      const [board, setBoard] = React.useState({ status: 'idle', data: null, error: null, meta: null })
      const [ideas, setIdeas] = React.useState({ status: 'idle', data: null, error: null, meta: null })
      const [graph, setGraph] = React.useState({ status: 'idle', data: null, error: null, meta: null })
      const [tick, setTick] = React.useState(0)
      const [openTask, setOpenTask] = React.useState(null)
      const [openIdea, setOpenIdea] = React.useState(null)
      // 视图：'list' | 'graph' | 'ideas'
      const [view, setView] = React.useState('list')
      // 依赖图的聚焦节点与「含终态」开关（FR-7.4 / 7.6）。focus 作为查询参数重新拉图，
      // 闭包由**服务端**算（前端只画，FR-7.5）。
      const [graphFocus, setGraphFocus] = React.useState(null)
      const [graphIncludeTerminal, setGraphIncludeTerminal] = React.useState(false)
      // FR-14 镜头：默认 chain（契约 §6.1）；镜头/展开伞都是请求参数，投影不缓存
      const [graphLens, setGraphLens] = React.useState('chain')
      const [graphUmbrella, setGraphUmbrella] = React.useState(null)
      const [graphClassic, setGraphClassic] = React.useState(false)
      const [showDiagnostics, setShowDiagnostics] = React.useState(false)
      // mode 是**单选**筛选模式（'all' | 'active' | 具体状态），见 applyFilters（FR-5.2）
      const [filters, setFilters] = React.useState({ keyword: '', mode: 'all', modules: [], sortBy: 'default' })
      const [ideaFilters, setIdeaFilters] = React.useState({ keyword: '', mode: 'all' })
      // 每会话记忆（FR-12.2）：视图与筛选状态按 sessionId 隔离保存，切走再切回可恢复
      const sessionMemory = React.useRef(new Map())


      // 会话切换时清掉「当前打开的任务/想法」（视图状态按会话隔离）
      React.useEffect(() => {
        setOpenTask(null)
        setOpenIdea(null)
        // 聚焦是**任务 id**，跨会话没有意义（另一个项目里根本没有这个任务，服务端会回 400）
        setGraphFocus(null)
        // 展开的伞同理（跨项目 `<kind>:<slug>` 会 400 unknown-umbrella）；镜头不跨会话记忆
        setGraphUmbrella(null)
        setGraphLens('chain')
      }, [sessionId])

      // 恢复该会话记忆的视图与筛选（无记忆 → 默认值）。FR-12.2：
      // 「切换会话时面板跟随该会话重算并各自记忆；再次打开保留上次的视图与筛选状态（每会话）」
      React.useEffect(() => {
        const remembered = sessionMemory.current.get(sessionId)
        setView(remembered?.view ?? 'list')
        setFilters(remembered?.filters ?? { keyword: '', mode: 'all', modules: [], sortBy: 'default' })
        setIdeaFilters(remembered?.ideaFilters ?? { keyword: '', mode: 'all' })
        setGraphIncludeTerminal(remembered?.graphIncludeTerminal === true)
      }, [sessionId])

      // 任何视图/筛选变化都写入当前会话的记忆槽（切走后仍在，切回可恢复）
      React.useEffect(() => {
        if (sessionId === null) return
        sessionMemory.current.set(sessionId, { view, filters, ideaFilters, graphIncludeTerminal })
      }, [sessionId, view, filters, ideaFilters, graphIncludeTerminal])

      React.useEffect(() => {
        if (sessionId === null) {
          setContext({ status: 'no-session', data: null, error: null, meta: null })
          return undefined
        }
        const controller = new AbortController()
        setContext((previous) => ({ ...previous, status: 'loading' }))
        api('/orchd/api/context', { session: sessionId, refresh: tick > 0 }, controller.signal)
          .then((body) => setContext({ status: 'ok', data: body.data, error: null, meta: body.meta }))
          .catch((error) => {
            if (error?.name === 'AbortError') return
            setContext((previous) => ({ status: 'error', data: previous.data, error, meta: error?.envelope?.meta }))
          })
        return () => controller.abort()
      }, [sessionId, tick])

      const contextState = context.data?.state
      React.useEffect(() => {
        if (sessionId === null || contextState !== 'ready') {
          setBoard({ status: 'idle', data: null, error: null, meta: null })
          return undefined
        }
        const controller = new AbortController()
        setBoard((previous) => ({ ...previous, status: 'loading' }))
        api('/orchd/api/board', { session: sessionId, refresh: tick > 0 }, controller.signal)
          .then((body) => setBoard({ status: 'ok', data: body.data, error: null, meta: body.meta }))
          .catch((error) => {
            if (error?.name === 'AbortError') return
            setBoard((previous) => ({ status: 'error', data: previous.data, error, meta: error?.envelope?.meta }))
          })
        return () => controller.abort()
      }, [sessionId, tick, contextState])

      // IDEAS 只在切到想法视图时才拉（NFR：不为默认视图付成本；归档只计数不进默认路径）
      React.useEffect(() => {
        if (sessionId === null || contextState !== 'ready' || view !== 'ideas') return undefined
        const controller = new AbortController()
        setIdeas((previous) => ({ ...previous, status: 'loading' }))
        api('/orchd/api/ideas', { session: sessionId, refresh: tick > 0 }, controller.signal)
          .then((body) => setIdeas({ status: 'ok', data: body.data, error: null, meta: body.meta }))
          .catch((error) => {
            if (error?.name === 'AbortError') return
            setIdeas((previous) => ({ status: 'error', data: previous.data, error, meta: error?.envelope?.meta }))
          })
        return () => controller.abort()
      }, [sessionId, tick, contextState, view])

      // 依赖图只在切到图视图时才拉（与 IDEAS 同理：默认视图不付成本）
      // 经典视图恒为 chain（FR-14.9）；lens 只是请求参数：服务端看到的与界面高亮同源
      const effectiveGraphLens = graphClassic === true ? 'chain' : graphLens

      React.useEffect(() => {
        if (sessionId === null || contextState !== 'ready' || view !== 'graph') return undefined
        const controller = new AbortController()
        setGraph((previous) => ({ ...previous, status: 'loading' }))
        api('/orchd/api/graph', {
          session: sessionId,
          refresh: tick > 0,
          lens: effectiveGraphLens,
          // umbrella 只在伞镜头回传（其它镜头会 400）；再点/收起 = 清空
          umbrella: effectiveGraphLens === 'umbrella' && graphUmbrella !== null ? graphUmbrella : undefined,
          // 伞/文件镜头不支持 focus（服务端 400 focus-not-supported），这里再兜一层
          focus: effectiveGraphLens === 'umbrella' || effectiveGraphLens === 'files' ? undefined : graphFocus,
          includeTerminal: graphIncludeTerminal ? '1' : undefined
        }, controller.signal)
          .then((body) => setGraph({ status: 'ok', data: body.data, error: null, meta: body.meta }))
          .catch((error) => {
            if (error?.name === 'AbortError') return
            setGraph((previous) => ({ status: 'error', data: previous.data, error, meta: error?.envelope?.meta }))
          })
        return () => controller.abort()
      }, [sessionId, tick, contextState, view, graphFocus, graphIncludeTerminal, effectiveGraphLens, graphUmbrella])

      const redetect = () => {
        setBoard({ status: 'idle', data: null, error: null, meta: null })
        setIdeas({ status: 'idle', data: null, error: null, meta: null })
        setGraph({ status: 'idle', data: null, error: null, meta: null })
        setGraphFocus(null)
        setGraphUmbrella(null)
        setTick((value) => value + 1)
      }
      const data = context.data
      const snapshotAt = board.meta?.fetchedAt ?? context.meta?.fetchedAt

      const head = React.createElement('div', { style: styles.head }, [
        React.createElement('div', { key: 'h', style: styles.header }, [
          React.createElement('h2', { key: 't', style: styles.title }, t('title')),
          data?.projectName ? React.createElement('span', { key: 'p', style: styles.sub }, data.projectName) : null,
          React.createElement('span', { key: 'sp', style: styles.spacer }),
          data?.state
            ? React.createElement('span', { key: 'b', style: { ...styles.badge, color: STATE_TOKEN[data.state] ?? TOKEN.labelSecondary } }, stateLabel(t, data.state))
            : null,
          React.createElement('button', {
            key: 'r', type: 'button', style: styles.iconButton, onClick: redetect, 'aria-label': t('redetect'), title: t('redetect')
          }, '⟳')
        ].filter(Boolean)),
        snapshotAt === undefined
          ? null
          : React.createElement('div', { key: 's', style: styles.sub }, `${t('snapshotAt')} ${formatTime(snapshotAt)}`)
      ].filter(Boolean))

      const bodyContent = (() => {
        if (sessionId === null) {
          return React.createElement(Card, { title: t('noSession') }, [React.createElement('div', { key: 'h' }, t('noSessionHint'))])
        }
        if (openTask !== null) {
          return React.createElement(DetailView, { key: `detail-${openTask}`, sessionId, taskId: openTask, t, onBack: () => setOpenTask(null), onOpenTask: setOpenTask })
        }
        if (openIdea !== null) {
          return React.createElement(IdeaDetail, { key: `idea-${openIdea.id ?? 'x'}`, entry: openIdea, t, onBack: () => setOpenIdea(null) })
        }
        if (context.status === 'error') {
          return React.createElement(Card, { title: t('brokenTitle'), badge: t('stateBroken'), state: 'broken' }, [
            React.createElement('div', { key: 'm' }, context.error?.message ?? 'unknown error'),
            isTimeoutError(context.error) ? React.createElement('div', { key: 'to', style: { ...styles.note, padding: '4px 0 0' } }, t('timeoutHint')) : null,
            React.createElement('pre', { key: 'd', style: styles.pre }, JSON.stringify(context.error?.envelope?.error ?? {}, null, 2)),
            React.createElement('div', { key: 'row', style: { ...styles.controlRow, marginTop: 8 } }, [
              React.createElement('button', { key: 'r', type: 'button', style: styles.button, onClick: redetect, 'aria-label': t('retry') }, t('retry'))
            ])
          ].filter(Boolean))
        }
        if (data === null) {
          return React.createElement('div', { style: styles.note }, t('loading'))
        }
        if (data.state !== 'ready') {
          return React.createElement(StateCard, { key: 'state', data, t, onRedetect: redetect, sessionId })
        }

        // 视图切换（FR-12.1 / FR-13.1）：想法项带「待用户裁决数」徽章（FR-13.2）
        //
        // 层级：视图切换是「看什么」（更高一层），状态条是「筛什么」（更细一层）。
        // 所以这里**只用字号与颜色**拉开层级：字更大（13 vs 11.5）、未选中用次级色、
        // 选中用主色 + 半粗 + 描边；形状仍与面板其它控件一致（不引入第二种控件形态）。
        const needsUser = ideas.data?.needsUser
        const viewSwitch = React.createElement('div', { key: 'views', style: styles.viewSwitchRow, role: 'tablist', 'aria-label': t('title') }, [
          React.createElement('button', {
            key: 'tasks',
            type: 'button',
            role: 'tab',
            'aria-selected': view === 'list',
            'data-orchd-view': 'list',
            style: { ...styles.viewEntry, ...(view === 'list' ? styles.viewEntryActive : {}) },
            onClick: () => {
              setView('list')
              setOpenIdea(null)
            }
          }, t('viewTasks')),
          React.createElement('button', {
            key: 'graph',
            type: 'button',
            role: 'tab',
            'aria-selected': view === 'graph',
            'data-orchd-view': 'graph',
            title: t('graphHint'),
            style: { ...styles.viewEntry, ...(view === 'graph' ? styles.viewEntryActive : {}) },
            onClick: () => {
              setView('graph')
              setOpenTask(null)
              setOpenIdea(null)
            }
          }, t('viewGraph')),
          React.createElement('button', {
            key: 'ideas',
            type: 'button',
            role: 'tab',
            'aria-selected': view === 'ideas',
            'data-orchd-view': 'ideas',
            title: t('ideasBadgeHint'),
            style: { ...styles.viewEntry, ...(view === 'ideas' ? styles.viewEntryActive : {}) },
            onClick: () => {
              setView('ideas')
              setOpenTask(null)
            }
          }, [
            React.createElement('span', { key: 'l' }, t('viewIdeas')),
            // 徽章 = study + questioning；**0 也要显示**（0 本身是「没有事在等你」这个有用信息）
            needsUser === undefined
              ? null
              : React.createElement('span', {
                  key: 'b',
                  'data-orchd-ideas-badge': String(needsUser),
                  style: {
                    ...styles.badge,
                    fontSize: 11,
                    border: 'none',
                    padding: '0 5px',
                    background: needsUser > 0 ? WARN : TOKEN.hover,
                    color: needsUser > 0 ? TOKEN.surface : 'inherit'
                  }
                }, String(needsUser))
          ].filter(Boolean))
        ])

        // ── 依赖图视图（FR-7）──
        if (view === 'graph') {
          if (graph.status === 'error' && graph.data === null) {
            return React.createElement(React.Fragment, null, [viewSwitch, React.createElement(Card, {
              key: 'gerr', title: t('brokenTitle'), badge: t('stateBroken'), state: 'broken'
            }, [
              React.createElement('div', { key: 'm' }, graph.error?.message ?? t('graphUnavailable')),
              isTimeoutError(graph.error) ? React.createElement('div', { key: 'to', style: { ...styles.note, padding: '4px 0 0' } }, t('timeoutHint')) : null,
              React.createElement('div', { key: 'row', style: { ...styles.controlRow, marginTop: 8 } }, [
                React.createElement('button', { key: 'r', type: 'button', style: styles.button, onClick: redetect, 'aria-label': t('retry') }, t('retry'))
              ])
            ].filter(Boolean))])
          }
          if (graph.data === null) {
            return React.createElement(React.Fragment, null, [viewSwitch, React.createElement('div', { key: 'load', style: styles.note }, t('loading'))])
          }
          // 出了错但手里还有上次的图 → 继续显示 + 说明可能过期（与列表同一纪律，FR-9.5）
          const graphStale = graph.status === 'error'
          return React.createElement(React.Fragment, null, [
            viewSwitch,
            graphStale
              ? React.createElement('div', {
                  key: 'gstale',
                  'data-orchd-graph-stale': 'true',
                  style: { ...styles.note, color: WARN }
                }, `${t('staleBanner')}${isTimeoutError(graph.error) ? ` ${t('timeoutHint')}` : ''}`)
              : null,
            React.createElement(DependencyGraph, {
              key: 'graph',
              data: graph.data,
              t,
              onOpenTask: setOpenTask,
              // 点同一个节点 = 取消聚焦（回到活跃子图），有「返回全图」按钮做同一件事
              onFocus: (id) => setGraphFocus((previous) => (previous === id ? null : id)),
              onBackToAll: () => setGraphFocus(null),
              includeTerminal: graphIncludeTerminal,
              onToggleTerminal: setGraphIncludeTerminal,
              // FR-14.9：经典视图 = 强制 chain 请求 + 现行渲染/布局原样（切换器隐藏）
              classic: graphClassic,
              onToggleClassic: (on) => { setGraphClassic(on); if (on || graphLens === 'umbrella' || graphLens === 'files') setGraphFocus(null) },
              // FR-14.6：切镜头 = 一次请求；离开伞镜头清空展开；files 不支持 focus
              onSelectLens: (id) => { setGraphLens(id); if (id !== 'umbrella') setGraphUmbrella(null); else setGraphFocus(null); if (id === 'files') setGraphFocus(null) },
              umbrella: graphUmbrella,
              onSelectUmbrella: (id) => setGraphUmbrella(typeof id === 'string' && id !== '' ? id : null)
            })
          ].filter(Boolean))
        }

        // ── 想法视图（FR-13.1）──
        if (view === 'ideas') {
          if (ideas.status === 'error') {
            return React.createElement(React.Fragment, null, [viewSwitch, React.createElement(Card, {
              key: 'ierr', title: t('brokenTitle'), badge: t('stateBroken'), state: 'broken'
            }, [
              React.createElement('div', { key: 'm' }, ideas.error?.message ?? 'unknown error'),
              React.createElement('div', { key: 'row', style: { ...styles.controlRow, marginTop: 8 } }, [
                React.createElement('button', { key: 'r', type: 'button', style: styles.button, onClick: redetect, 'aria-label': t('retry') }, t('retry'))
              ])
            ])])
          }
          if (ideas.data === null) {
            return React.createElement(React.Fragment, null, [viewSwitch, React.createElement('div', { key: 'load', style: styles.note }, t('loading'))])
          }
          return React.createElement(React.Fragment, null, [
            viewSwitch,
            React.createElement(IdeasBoard, {
              key: 'ideas',
              data: ideas.data,
              filters: ideaFilters,
              setFilters: setIdeaFilters,
              t,
              onOpen: setOpenIdea
            })
          ])
        }

        const rows = board.data?.tasks ?? []
        const modules = [...new Set(rows.map((row) => row.module).filter((value) => typeof value === 'string'))].sort()
        const filtered = sortRows(applyFilters(rows, filters, ALL_STATUSES), filters.sortBy)
        const boardError = board.status === 'error'
        // 保留上次成功快照（FR-9.5）：出错但手里有旧数据时**继续展示旧数据** + 过期横幅，
        // 而不是整块换成错误卡片（否则引擎短暂不可用就白屏，正是 FR-9.1 禁止的）。
        const boardStale = boardError && board.data !== null

        // 生效条件数 = 模块多选数 + （排序非默认时算 1 项）
        const activeCount = filters.modules.length + (filters.sortBy === 'default' ? 0 : 1)

        const toggleModule = (module) => setFilters((previous) => ({
          ...previous,
          modules: previous.modules.includes(module) ? previous.modules.filter((m) => m !== module) : [...previous.modules, module]
        }))

        // 空态必须点名当前筛选（FR-5.9 / AC-5.8）
        const emptyFiltered = React.createElement('div', { key: 'empty2', style: styles.note, 'data-orchd-empty': 'filtered' },
          filters.mode !== 'all'
            ? `${t('emptyFilteredByStatus')}${t(TASK_STATUS_I18N[filters.mode] ?? 'filterAll')}`
            : (filters.keyword !== ''
                ? t('emptyFilteredByKeyword').replace('{kw}', filters.keyword)
                : (filters.modules.length > 0 ? t('emptyFilteredByModule') : t('noTasksAfterFilter'))))

        return React.createElement(React.Fragment, null, [
          viewSwitch,
          // 引擎暂时不可用但仍有上次快照 → 保留旧数据 + 明确「可能已过期」（FR-9.5）
          boardStale
            ? React.createElement('div', {
                key: 'stale',
                'data-orchd-stale': 'true',
                style: { ...styles.note, color: WARN }
              }, `${t('staleBanner')}${isTimeoutError(board.error) ? ` ${t('timeoutHint')}` : ''}`)
            : null,
          // 没有任何快照可用时才整块报错（避免白屏）
          (boardError && !boardStale)
            ? React.createElement(Card, { key: 'berr', title: t('brokenTitle'), badge: t('stateBroken'), state: 'broken' }, [
                React.createElement('div', { key: 'm' }, board.error?.message ?? 'unknown error'),
                isTimeoutError(board.error) ? React.createElement('div', { key: 'to', style: { ...styles.note, padding: '4px 0 0' } }, t('timeoutHint')) : null,
                React.createElement('div', { key: 'row', style: { ...styles.controlRow, marginTop: 8 } }, [
                  React.createElement('button', { key: 'r', type: 'button', style: styles.button, onClick: redetect, 'aria-label': t('retry') }, t('retry'))
                ])
              ].filter(Boolean))
            : null,

          // 状态条即筛选器（FR-5.2）：8 个互斥模式、单选、再点回全部、0 值可点
          React.createElement(StatusStripFilter, {
            key: 'strip',
            summary: board.data?.summary ?? data.summary,
            counts: board.data?.counts,
            mode: filters.mode,
            onSelect: (mode) => setFilters((previous) => ({ ...previous, mode })),
            labels: ALL_STATUSES,
            unitKey: (status) => TASK_STATUS_I18N[status] ?? 'filterAll',
            t
          }),

          // 常驻行：搜索 + 视图切换占位 + 筛选弹层入口（FR-5.3/5.4/5.5）
          React.createElement('div', { key: 'controls', style: styles.controls }, [
            React.createElement('input', {
              key: 'search',
              type: 'search',
              value: filters.keyword,
              placeholder: t('search'),
              'aria-label': t('search'),
              style: styles.input,
              onChange: (event) => setFilters((previous) => ({ ...previous, keyword: event.target.value }))
            }),
            React.createElement('div', { key: 'row1', style: styles.controlRow }, [
              React.createElement(FilterPopover, {
                key: 'pop',
                modules,
                selectedModules: filters.modules,
                onToggleModule: toggleModule,
                sortBy: filters.sortBy,
                onSelectSort: (sortBy) => setFilters((previous) => ({ ...previous, sortBy })),
                onClearAll: () => setFilters({ keyword: filters.keyword, mode: 'all', modules: [], sortBy: 'default' }),
                activeCount,
                t
              }),
              (filters.mode !== 'all' || filters.keyword !== '' || filters.modules.length > 0)
                ? React.createElement('button', {
                    key: 'clear', type: 'button', style: styles.filterEntry, 'aria-label': t('clearFilters'),
                    'data-orchd-chip-clear': 'tasks',
                    onClick: () => setFilters({ keyword: '', mode: 'all', modules: [], sortBy: filters.sortBy })
                  }, t('clearFiltersShort'))
                : null
            ].filter(Boolean))
          ]),

          React.createElement('div', { key: 'count', style: styles.note },
            `${t('countShown')} ${filtered.length} / ${rows.length} ${t('countUnit')} ${t('showingAll')}`),

          // 列表 / 空态（FR-9.4：空状态语义必须区分，且点名状态）
          // 检测未通过且无快照 → 不渲染「项目没有任务」空态（错误卡片已在上文，避免两种语义同屏混淆）
          rows.length === 0
            ? (boardError && !boardStale
                ? null
                : React.createElement('div', { key: 'empty1', style: styles.note, 'data-orchd-empty': 'project' }, t('noTasksInProject')))
            : (filtered.length === 0
                ? emptyFiltered
                : React.createElement(VirtualList, {
                    key: 'list',
                    rows: filtered,
                    rowHeight: ROW_HEIGHT,
                    label: t('tasksScrollLabel'),
                    renderRow: (row, index, offset) => React.createElement(TaskRowItem, {
                      key: row.id ?? String(index),
                      row,
                      t,
                      offset,
                      onOpen: setOpenTask
                    })
                  }))
        ].filter(Boolean))
      })()

      // 诊断快照（NFR-5.2 / Q6-①）：检测结论 + 各阶段耗时 + 原始错误。
      // **只复制到剪贴板，不落盘**（保持插件零文件写入，FR-10.4）。
      const diagnosticsSnapshot = data === null
        ? null
        : JSON.stringify({
            at: new Date().toISOString(),
            context: data,
            board: board.data === null || board.data === undefined
              ? null
              : { meta: board.meta, summary: board.data.summary, layers: board.data.layers, orphans: board.data.orphans },
            boardError: board.status === 'error' ? (board.error?.envelope ?? { message: board.error?.message }) : null
          }, null, 2)

      const diagnostics = data === null
        ? null
        : React.createElement('div', { key: 'diag', style: { flex: '0 0 auto' } }, [
            React.createElement('div', { key: 'toggle', style: { ...styles.controlRow, padding: '0 14px 10px' } }, [
              React.createElement('button', {
                key: 'b', type: 'button', style: styles.button, 'aria-expanded': showDiagnostics,
                onClick: () => setShowDiagnostics((value) => !value),
                'aria-label': t(showDiagnostics ? 'hideDiagnostics' : 'showDiagnostics')
              }, `${showDiagnostics ? '▾' : '▸'} ${t('diagnostics')}`)
            ]),
            showDiagnostics
              ? React.createElement('section', { key: 'card', style: styles.card }, [
                  React.createElement('div', { key: 'grid', style: styles.grid }, [
                    React.createElement(Row, { key: 'root', label: t('project') }, data.root ?? '—'),
                    React.createElement(Row, { key: 'by', label: t('detectedBy') }, data.resolvedBy ?? '—'),
                    React.createElement(Row, { key: 'py', label: t('python') }, data.python === null || data.python === undefined ? '—' : `${data.python.path} (${data.python.version})`),
                    React.createElement(Row, { key: 'layout', label: t('layout') }, data.layout === null || data.layout === undefined ? '—' : String(data.layout.kind)),
                    React.createElement(Row, { key: 'wt', label: t('mainWorktree') }, data.layout?.mainWorktree ?? '—'),
                    React.createElement(Row, { key: 'mp', label: t('masterPath') }, data.masterPath ?? '—'),
                    board.data?.layers === undefined
                      ? null
                      : React.createElement(Row, { key: 'layers', label: 'layers' }, JSON.stringify(board.data.layers)),
                    board.data?.orphans === undefined
                      ? null
                      : React.createElement(Row, { key: 'orphans', label: 'orphans' },
                          `onlyInState=${board.data.orphans.onlyInState.length} onlyInDefinition=${board.data.orphans.onlyInDefinition.length}`),
                    data.hostProbe === null || data.hostProbe === undefined
                      ? null
                      : React.createElement(Row, { key: 'host', label: 'host' },
                          `${data.hostProbe.moduleLoadedAt} · pid ${data.hostProbe.pid} · up ${Math.round(data.hostProbe.uptimeMsNow / 1000)}s`),
                    data.devMarker === null || data.devMarker === undefined
                      ? null
                      : React.createElement(Row, { key: 'dm', label: 'devMarker' }, String(data.devMarker))
                  ].filter(Boolean)),
                  React.createElement('div', { key: 'export', style: { ...styles.controlRow, marginTop: 8 } }, [
                    React.createElement(CopyButton, { key: 'c', text: diagnosticsSnapshot, t, label: t('exportDiag') }),
                    React.createElement('span', { key: 'h', style: styles.hint }, t('exportDiagHint'))
                  ]),
                  data.detail === undefined ? null : React.createElement('pre', { key: 'detail', style: styles.pre }, JSON.stringify(data.detail, null, 2))
                ])
              : null
          ].filter(Boolean))

      return React.createElement('div', { style: styles.page, 'data-orchd-panel': TAB_ID, 'data-session-id': sessionId ?? '' }, [
        head,
        bodyContent,
        diagnostics
      ].filter(Boolean))
    }

    /** tab chip 标题（sidebar.right.pane.tab.title，keyed/session）。 */
    function OrchdTasksTitle(props) {
      const t = typeof props?.t === 'function' ? props.t : (key) => key
      return React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, [
        React.createElement(OrchdIcon, { key: 'i', size: 14 }),
        React.createElement('span', null, t('title'))
      ])
    }

    /**
     * 会话 header 的开关按钮。
     *
     * 点击 = 打开 / 关闭（面板正显示时收起右侧栏，否则打开并聚焦本面板）。
     *
     * 席位是 conversation.session.header.utilities，kind 为 list、scope 为 session。
     * 不要用 conversation.session.header.corner：那是 **single** 席位，右侧栏自带的
     * 「展开」按钮已经占着它；single 在同一优先级下只允许一个占位者，重复注册会抛错
     * （dsh-client-ui-slots/lib/index.js:170-173）。
     */
    function OrchdToggleButton(props) {
      const t = typeof props?.t === 'function' ? props.t : (key) => key
      return React.createElement('button', {
        type: 'button',
        style: styles.iconButton,
        onClick: () => {
          // 点击只是「打开 / 关闭」：面板正显示时收起，否则打开并聚焦本面板。
          try {
            props.toggle?.()
          } catch (error) {
            console.error('orchd-tasks: toggle failed', error)
          }
        },
        'aria-label': t('toggleLabel'),
        title: t('toggleLabel'),
        'data-orchd-toggle': 'true'
      }, React.createElement(OrchdIcon, { size: 16 }))
    }

    function stateLabel(t, state) {
      switch (state) {
        case 'not_installed': return t('stateNotInstalled')
        case 'uninitialized': return t('stateUninitialized')
        case 'ready': return t('stateReady')
        case 'broken': return t('stateBroken')
        default: return String(state)
      }
    }

    /** 引擎调用超时单独识别（FR-9.3）：超时给「重试」，与业务错误区分。 */
    function isTimeoutError(error) {
      return error?.envelope?.error?.kind === 'timeout'
    }

    function formatTime(iso) {
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return '—'
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    }

    /** cordis inject 写**服务名**；package.json 的 dsh.client.inject 写**包名**（加载顺序）。 */
    const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'shortcuts']

    function apply(ctx) {
      const t = ctx.locale.bind(NS)

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'orchd-tasks: locale')

      // ⓪ 交互反馈样式（hover / 按下 / 焦点环）：内联样式没有伪类，只能注入样式表。
      //    平台自己的 ExpandButton 也是这么挂的（`<style data-plugin-css=…>`）。
      ctx.effect(() => ensureInteractionCss(), 'orchd-tasks: interaction css')

      // ① 类型（静态声明）——与插件同生共死，禁用即消失（FR-12.3）
      ctx.effect(
        () => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          title: () => t('title'),
          guide: [
            {
              // registry 会用 definition.kind 覆盖条目上的 kind，所以这里不重复声明；
              // id 只要求在同一类型内唯一。
              id: 'orchd-tasks',
              order: 20,
              title: () => t('title'),
              description: () => t('guideHint'),
              icon: OrchdIcon
            }
          ]
        }),
        'orchd-tasks: sidebar type'
      )

      // ② 正文：key = 类型 id；session 作用域 → inject 能拿到 sessionId
      ctx.effect(
        () => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          locale: NS,
          inject: (sessionId) => ({ sessionId })
        }, OrchdTasksPane)),
        'orchd-tasks: pane body'
      )

      // ③ tab chip 标题
      ctx.effect(
        () => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: TAB_ID,
          locale: NS
        }, OrchdTasksTitle)),
        'orchd-tasks: pane title'
      )

      // ④ 会话 header 的开关（list 席位，多个条目可共存）。
      //    打开的是**右侧栏 tab**，不触碰中栏 → 与会话同屏（AC-12.5）。
      ctx.effect(
        () => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'orchd-tasks-toggle',
          order: 30,
          locale: NS,
          inject: () => ({
            // 点击 = 打开 / 关闭：面板正显示时收起，否则打开并聚焦本面板。
            // 用平台 sidebarRight 的真实状态（isExpanded / active），不靠本地「挂载与否」猜测。
            toggle: () => {
              const sidebar = ctx.sidebarRight
              const active = typeof sidebar?.active === 'function' ? sidebar.active() : undefined
              if (typeof sidebar?.isExpanded === 'function' && sidebar.isExpanded() && active?.kind === TAB_KIND) {
                sidebar.toggleExpanded()
              } else {
                sidebar.openTab(TAB_KIND)
              }
            }
          })
        }, OrchdToggleButton)),
        'orchd-tasks: header toggle'
      )
    }

    exports.inject = inject
    exports.apply = apply
    /**
     * 纯函数出口，**仅供单测**（运行时不使用）。
     *
     * 为什么需要：浏览器半侧是手写 bundle、没有构建链（NFR-4.1），
     * 但筛选/排序承载了 FR-5.2 的全部语义（单选、活跃聚合、0 值），
     * 必须有单测兜底。测试用 `test/client.test.mjs` 的 `vm` + 假 `window.__ModuleLoader__`
     * 加载本文件再取这个对象断言。
     */
    exports.__testables = { applyFilters, sortRows, countByStatus, TASK_STATUS_I18N, ALL_STATUSES, styles, IDEA_STATUSES_UI, IDEA_STATUS_I18N, ideaCommandsFor, ideaDisplayStatus, ideaStatusText, computeThumb, scrollTopForThumbTop, SCROLLBAR_WIDTH, SCROLLBAR_MIN_THUMB, ROW_HEIGHT, IDEA_ROW_HEIGHT, interactionCss, INTERACTION_CSS_TAG, layoutDependencyGraph, graphAnomalyRows, graphNodeLabel, truncateLabel, graphTextUnits, GRAPH_NODE_W, GRAPH_NODE_H, GRAPH_GAP_X, GRAPH_GAP_Y, graphLensOptions, layoutWaveGraph, umbrellaNodeLabel, graphLegendRows, GRAPH_LENS_ORDER, GRAPH_WAVE_LABEL_W, graphLabelMode, GRAPH_SEGMENT_GAP, GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX, GRAPH_VIEWPORT_FALLBACK, GRAPH_PAD, layoutFilesGraph, graphCriticalPathText }
    return module.exports
  }
})
