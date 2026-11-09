/**
 * 内部数据模型组装：把**定义层**与**状态层**合并成 UI 要的 `TaskRow` / `TaskDetail`。
 *
 * 依据 docs/02 第 7 节：
 *
 * | 字段 | 来源 | 冲突时 |
 * |---|---|---|
 * | name / brief / module / depends_on / 验收标准 / 写范围 / 验证命令 / 重要度 / 难度 / 工时 / 来源 | 定义层 | 定义层优先 |
 * | status / claimed_by / attempt_count / review_phase / review_claimed_by / merge_warning | 状态层 | 状态层优先 |
 * | blocked_downstream_count | 状态层（就绪池输出） | 状态层优先 |
 *
 * ⚠ 定义层与状态层**都**提供 `importance`：定义层可能是显式声明，状态层是引擎按下游阻塞数
 * 推导的。两者语义不同，所以 `TaskRow.importance` 与 `TaskRow.importanceDerived` 分开保留，
 * UI 必须都能显示（这一点在实现时最容易做错，测试里有对应断言）。
 */

import { collectProjectUmbrellaIds, umbrellaKeyOf, umbrellaKeysOf, umbrellaTitleOf } from './umbrellas.js'

/** 引擎的六态（docs/03 第 7.3 节）。未知状态原样保留，不猜。 */
export const TASK_STATUSES = Object.freeze(['pending', 'claimed', 'done', 'in_review', 'completed', 'cancelled'])

/** 活跃态（默认排序用的「活跃优先」集合）。 */
const ACTIVE_STATUSES = new Set(['claimed', 'done', 'in_review'])
/** 终态。 */
const TERMINAL_STATUSES = new Set(['completed', 'cancelled'])

/** 重要度的排序权重（越大越靠前）。引擎的 `config.importance` 权重若给了就用它。 */
function importanceRank(value, weights) {
  if (weights !== null && weights !== undefined && typeof weights[value] === 'number') return weights[value]
  switch (value) {
    case 'critical': return 5
    case 'high': return 3
    case 'normal': return 1
    case 'low': return 0
    default: return -1
  }
}

/** 难度的排序权重。 */
function difficultyRank(value) {
  switch (value) {
    case 'high': return 3
    case 'medium': return 2
    case 'low': return 1
    default: return 0
  }
}

/**
 * 状态层的一行（`status --all` 的 tasks[]）。
 * 依据 docs/03 第 5.2 节；可选字段出现时才有：`review_phase` / `review_claimed_by` / `revive_marker`。
 *
 * ⚠ 每个键都必须显式归一成 `值 | null`。踩过的坑：state 为 undefined 时这里返回 `{}`，
 * 而调用方直接取 `stateRow.claimedBy` 会得到 **undefined**，`JSON.stringify` 随后把整键丢掉，
 * 前端拿到一个没有该键的对象（FR-5.7 要求显示占位符而不是 undefined）。
 */
function stateRowOf(state) {
  const source = state !== null && typeof state === 'object' ? state : {}
  return {
    status: typeof source.status === 'string' ? source.status : null,
    claimedBy: typeof source.claimed_by === 'string' ? source.claimed_by : null,
    attemptCount: Number.isInteger(source.attempt_count) ? source.attempt_count : null,
    reviewPhase: typeof source.review_phase === 'string' ? source.review_phase : null,
    reviewClaimedBy: typeof source.review_claimed_by === 'string' ? source.review_claimed_by : null,
    reviveMarker: source.revive_marker ?? null
  }
}

/**
 * 组装 `TaskRow`（列表用）。字段缺失一律为 null，交给 UI 显示占位符（FR-5.7）。
 *
 * @param {object} definition 定义层索引里的一条（`index.tasks.get(id)`），可能 undefined
 * @param {object} state 状态层的一条（`status --all` 的 tasks[]），可能 undefined
 * @param {object} [extra] `{ blockedDownstream }` 来自 `pool --all`
 * @param {object} [weights] 引擎的重要度权重
 */
export function buildTaskRow(definition, state, extra = {}, weights = null) {
  const definitionRow = definition ?? {}
  const stateRow = stateRowOf(state)
  // 状态层用 `task_id`（`status --all` 的 tasks[]），`pool --all` 用 `id`；两个都认。
  const stateId = state !== null && typeof state === 'object' ? (state.task_id ?? state.id) : undefined
  const id = definitionRow.id ?? (typeof stateId === 'string' ? stateId : undefined) ?? null
  const times = extra.times ?? null
  const timeOf = (map) => (typeof id === 'string' && typeof map?.[id] === 'string' ? map[id] : null)

  return {
    id,
    name: definitionRow.name ?? (state !== null && typeof state === 'object' && typeof state.name === 'string' ? state.name : null),
    brief: definitionRow.brief ?? (state !== null && typeof state === 'object' && typeof state.brief === 'string' ? state.brief : null),
    module: definitionRow.module ?? (state !== null && typeof state === 'object' && typeof state.module === 'string' ? state.module : null),
    // ⚠ 必须归一成 `string | null`：若这里留 `undefined`，`JSON.stringify` 会**整键丢掉**
    // status，前端拿到的是一个没有该键的对象（P1 实测踩过——只有定义层、没有状态层
    // 的任务会命中）。其它字段都做了 ?? null，唯独这个字段最容易漏，FR-5.7 也要求
    // 缺字段显示占位符而不是 undefined。
    status: typeof stateRow.status === 'string' ? stateRow.status : null,
    importance: definitionRow.importance ?? null,
    /** 引擎推导的重要度（`pool --all` 里给的那份）。与显式值分开，UI 都要显示。 */
    importanceDerived: state !== null && typeof state === 'object' && typeof state.importance === 'string' ? state.importance : null,
    difficulty: definitionRow.difficulty ?? (state !== null && typeof state === 'object' && typeof state.difficulty === 'string' ? state.difficulty : null),
    claimedBy: stateRow.claimedBy,
    attemptCount: stateRow.attemptCount,
    source: definitionRow.source ?? (state !== null && typeof state === 'object' && typeof state.source === 'string' ? state.source : null),
    reviewPhase: stateRow.reviewPhase,
    reviewClaimedBy: stateRow.reviewClaimedBy,
    blockedDownstream: Number.isInteger(extra.blockedDownstream) ? extra.blockedDownstream : null,
    /**
     * 「最近动作时间」的 git 近似（FR-5.4 修订）：活跃任务取 `task/<id>` 分支的 tip 时间。
     * 引擎不提供任何时间字段，来源与口径见 `git-times.js`；取不到就是 null（排序兜底，
     * **不臆造时间**，UI 若显示则必须走占位符）。
     */
    lastActionAt: timeOf(times?.branchTimes ?? null),
    /** 「合并进主分支时间」的 git 近似：终态任务取 `Merge branch 'task/<id>'` 提交时间。 */
    mergedAt: timeOf(times?.mergeTimes ?? null),
    inDefinition: definition !== undefined && definition !== null,
    inState: state !== undefined && state !== null
  }
}

/**
 * 组装 `TaskDetail`（= TaskRow + 详情字段）。
 * @param {object} definition
 * @param {object} state
 * @param {object} index 定义层索引（取 dependents）
 * @param {object} [extra]
 */
export function buildTaskDetail(definition, state, index, extra = {}) {
  const row = buildTaskRow(definition, state, extra, index?.importanceWeights ?? null)
  const definitionRow = definition ?? {}
  const dependents = definitionRow.id !== undefined && index?.dependents instanceof Map
    ? (index.dependents.get(definitionRow.id) ?? [])
    : []

  return {
    ...row,
    acceptanceCriteria: Array.isArray(definitionRow.acceptanceCriteria) ? definitionRow.acceptanceCriteria : [],
    verifyCommand: definitionRow.verifyCommand ?? null,
    verifyTimeoutSeconds: definitionRow.verifyTimeoutSeconds ?? null,
    filesToEdit: Array.isArray(definitionRow.filesToEdit) ? definitionRow.filesToEdit : [],
    exemptFiles: Array.isArray(definitionRow.exemptFiles) ? definitionRow.exemptFiles : [],
    filesToRead: Array.isArray(definitionRow.filesToRead) ? definitionRow.filesToRead : [],
    requires: Array.isArray(definitionRow.requires) ? definitionRow.requires : [],
    reviewers: Array.isArray(definitionRow.reviewers) ? definitionRow.reviewers : [],
    requireIndependentReview: definitionRow.requireIndependentReview === true,
    estimatedHours: definitionRow.estimatedHours ?? null,
    maxAttempts: definitionRow.maxAttempts ?? null,
    deliverables: definitionRow.deliverables ?? null,
    backport: definitionRow.backport ?? null,
    additionalSources: Array.isArray(definitionRow.additionalSources) ? definitionRow.additionalSources : [],
    dependsOn: Array.isArray(definitionRow.dependsOn) ? definitionRow.dependsOn : [],
    /** 反向边：依赖本任务的任务（同 依赖图 用）。 */
    dependents,
    moduleRole: definitionRow.module !== null && definitionRow.module !== undefined && index?.modules instanceof Map
      ? (index.modules.get(definitionRow.module)?.role ?? null)
      : null
  }
}

/**
 * 组装整个看板。
 *
 * 定义层与状态层**可能不同步**（引擎的「四处真值无跨文件事务」）：以两边的并集为任务全集，
 * 并在 `orphans` 里显式报告差异，而不是静默丢掉（docs/02 第 5 节第 ⑥ 步的同一思路）。
 *
 * @param {object} args
 * @param {object} args.statusJson `status --all` 的响应
 * @param {object} args.poolJson `pool --all` 的响应（可为 undefined）
 * @param {object} args.index 定义层索引
 * @param {string} [args.masterPath]
 */
export function buildBoard({ statusJson, poolJson, index, masterPath, gitTimes }) {
  const stateRows = new Map()
  for (const task of Array.isArray(statusJson?.tasks) ? statusJson.tasks : []) {
    if (task !== null && typeof task === 'object' && typeof task.task_id === 'string') stateRows.set(task.task_id, task)
  }

  const blockedByTask = new Map()
  for (const entry of Array.isArray(poolJson?.pool) ? poolJson.pool : []) {
    if (entry !== null && typeof entry === 'object' && typeof entry.task_id === 'string') {
      if (Number.isInteger(entry.blocked_downstream_count)) blockedByTask.set(entry.task_id, entry.blocked_downstream_count)
    }
  }

  const weights = index?.importanceWeights ?? null
  const ids = new Set([...(index?.tasks?.keys() ?? []), ...stateRows.keys()])

  const rows = []
  for (const id of ids) {
    const definition = index?.tasks?.get(id)
    const state = stateRows.get(id)
    rows.push(buildTaskRow(definition, state, { blockedDownstream: blockedByTask.get(id), times: gitTimes }, weights))
  }

  sortRows(rows, 'default', weights)

  const onlyInState = rows.filter((row) => row.inDefinition !== true).map((row) => row.id)
  const onlyInDefinition = rows.filter((row) => row.inState !== true).map((row) => row.id)

  const summary = summarize(statusJson?.summary, rows)

  return {
    project: index?.project ?? { name: null, brief: null, reviewMode: null },
    schemaVersion: index?.schemaVersion ?? null,
    masterPath: masterPath ?? index?.path ?? null,
    summary,
    tasks: rows,
    modules: [...(index?.modules?.values() ?? [])],
    capabilities: {
      hasDag: (index?.tasks?.size ?? 0) > 0,
      hasBlockedCount: blockedByTask.size > 0,
      hasDefinitionLayer: (index?.tasks?.size ?? 0) > 0,
      hasStateLayer: stateRows.size > 0,
      /** 排序用的 git 时间层（FR-5.4 修订）：活跃=分支 tip 时间、终态=合并提交时间。 */
      hasActionTimes: Object.keys(gitTimes?.branchTimes ?? {}).length > 0,
      hasMergeTimes: Object.keys(gitTimes?.mergeTimes ?? {}).length > 0,
      /** git 时间层不可用时的原因（非 git 项目 / git 缺失 / 超时）；可用时为 null。 */
      gitTimesReason: gitTimes !== undefined && gitTimes !== null && gitTimes.available === false
        ? (gitTimes.reason ?? 'unavailable')
        : null
    },
    /** 两层不一致时显式报告（不静默丢数据）。 */
    orphans: { onlyInState, onlyInDefinition }
  }
}

/**
 * 状态分布计数。
 *
 * FR-4.3 要求「与引擎自己的口径一致，直接采用引擎输出的摘要，不在前端重算」——
 * 所以引擎给了 `summary` 就**原样用它**，只有引擎没给时才退回自己数（并标记来源）。
 */
export function summarize(engineSummary, rows) {
  const keys = ['total', 'active', 'pending', 'claimed', 'done', 'in_review', 'completed', 'cancelled']
  if (engineSummary !== null && engineSummary !== undefined && typeof engineSummary === 'object') {
    const out = { source: 'engine' }
    for (const key of keys) out[key] = Number.isInteger(engineSummary[key]) ? engineSummary[key] : null
    return out
  }
  const counted = { source: 'plugin', total: rows.length, active: 0, pending: 0, claimed: 0, done: 0, in_review: 0, completed: 0, cancelled: 0 }
  for (const row of rows) {
    if (typeof row.status !== 'string') continue
    if (Object.hasOwn(counted, row.status)) counted[row.status] += 1
    if (ACTIVE_STATUSES.has(row.status)) counted.active += 1
  }
  return counted
}

/**
 * 排序。默认档 = 「活跃优先 → 组内按时间」（FR-5.4 修订，2026-10-29）：
 *   · 组：活跃（claimed / done / in_review）→ 待办（pending）→ 终态（completed / cancelled）；
 *   · 活跃组内按 `lastActionAt` 由近到远（git 近似：`task/<id>` 分支 tip 时间）；
 *   · 终态组内按 `mergedAt` 由近到远（git 近似：合并进主分支的提交时间）；
 *   · 取不到时间的（未 claim 的 pending、cancelled、非 git 项目）留在本组最后，退回
 *     「重要度 → id」——**不臆造时间**。
 * 其它档位（importance / difficulty / module / status）行为不变。
 *
 * @param {object[]} rows 原地排序
 * @param {'default'|'importance'|'difficulty'|'module'|'status'} by
 * @param {object|null} weights 引擎的重要度权重
 */
export function sortRows(rows, by = 'default', weights = null) {
  const statusRank = (status) => (ACTIVE_STATUSES.has(status) ? 0 : TERMINAL_STATUSES.has(status) ? 2 : 1)
  // 时间戳只算一次（比较器会被调用 O(n log n) 次）；非法值一律折叠成 null
  const timeCache = new Map()
  const timeValue = (row) => {
    if (timeCache.has(row)) return timeCache.get(row)
    const raw = TERMINAL_STATUSES.has(row.status) ? row.mergedAt : row.lastActionAt
    const parsed = typeof raw === 'string' && raw !== '' ? Date.parse(raw) : Number.NaN
    const value = Number.isFinite(parsed) ? parsed : null
    timeCache.set(row, value)
    return value
  }
  const byTime = (a, b) => {
    const ta = timeValue(a)
    const tb = timeValue(b)
    if (ta === null && tb === null) return 0
    if (ta === null) return 1
    if (tb === null) return -1
    return tb - ta
  }
  const byImportance = (a, b) =>
    importanceRank(b.importance ?? b.importanceDerived, weights) - importanceRank(a.importance ?? a.importanceDerived, weights)
  const comparators = {
    default: (a, b) =>
      statusRank(a.status) - statusRank(b.status) ||
      byTime(a, b) ||
      byImportance(a, b) ||
      (a.id ?? '').localeCompare(b.id ?? ''),
    importance: (a, b) => importanceRank(b.importance ?? b.importanceDerived, weights) - importanceRank(a.importance ?? a.importanceDerived, weights) || (a.id ?? '').localeCompare(b.id ?? ''),
    difficulty: (a, b) => difficultyRank(b.difficulty) - difficultyRank(a.difficulty) || (a.id ?? '').localeCompare(b.id ?? ''),
    module: (a, b) => (a.module ?? '~').localeCompare(b.module ?? '~') || (a.id ?? '').localeCompare(b.id ?? ''),
    status: (a, b) => (a.status ?? '~').localeCompare(b.status ?? '~') || (a.id ?? '').localeCompare(b.id ?? '')
  }
  rows.sort(comparators[by] ?? comparators.default)
  return rows
}
/**
 * 引擎**未提供只读回看**的事件类型（FR-8.1 / AC-8.5）。
 *
 * 引擎唯一的只读历史回看命令 `review --task <id> --show` 只返回 `REVIEW_SUBMITTED`；
 * 其余事件只有直读账本（`_ledger.sqlite3`）才拿得到，而插件**不直读账本**
 * （A2 / docs/03 第 8 节）。这里显式列出，供 UI 说明「引擎未提供」——不伪造、不静默省略。
 */
export const UNSUPPORTED_HISTORY_TYPES = Object.freeze([
  'CLAIMED', 'DONE', 'REVIEW_CLAIMED', 'FORCE_STATUS', 'RETRACT', 'AMEND'
])

/**
 * 组装**审查事件时间线**（FR-8，P2 收窄）。
 *
 * 数据来源：`review --task <id> --show` → `{ task_id, comments:[{review_type, verdict, timestamp, comments}], count }`
 * （docs/03 第 5.7 节）。`timestamp` 可能为 `null` ⇒ `at` 为 `null`，UI 显示「—」
 * （FR-8.5：不得伪造时间）。`current` 补上当前状态摘要，`unsupportedTypes` 供 UI 显式说明。
 *
 * @param {object} reviewJson `review --show` 的响应（可能 undefined）
 * @param {object} stateRow `status <id>` 的 `task`（可能 undefined）
 */
export function buildReviewTimeline(reviewJson, stateRow) {
  const comments = Array.isArray(reviewJson?.comments) ? reviewJson.comments : []
  const events = comments.map((comment) => ({
    type: 'REVIEW_SUBMITTED',
    reviewType: typeof comment?.review_type === 'string' ? comment.review_type : null,
    verdict: typeof comment?.verdict === 'string' ? comment.verdict : null,
    // ⚠ 引擎可能不给 timestamp；必须落成 null 而不是 undefined（否则 JSON 往返丢键）
    at: typeof comment?.timestamp === 'string' ? comment.timestamp : null,
    text: typeof comment?.comments === 'string' ? comment.comments : null
  }))
  const source = stateRow !== null && typeof stateRow === 'object' ? stateRow : {}
  return {
    events,
    current: {
      reviewPhase: typeof source.review_phase === 'string' ? source.review_phase : null,
      reviewClaimedBy: typeof source.review_claimed_by === 'string' ? source.review_claimed_by : null,
      mergeWarning: source.merge_warning ?? null,
      reviveMarker: source.revive_marker ?? null
    },
    unsupportedTypes: [...UNSUPPORTED_HISTORY_TYPES],
    count: Number.isInteger(reviewJson?.count) ? reviewJson.count : events.length
  }
}

// ── P2b：依赖图与阻塞链（FR-7）──────────────────────────────────────────────

/**
 * 图的节点上限（FR-7.6「必要时限制渲染节点数并在 UI 上说明」）。
 *
 * 参考项目实测 813 个任务 / 390 条边：右侧栏宽度只有整页的约 1/3，一次铺满必然不可读，
 * 所以服务端就截断并把 `truncated` 报给 UI，由 UI 显式说明（不静默少画）。
 */
export const GRAPH_MAX_NODES = 400

/** 图镜头（docs/09 第 2 节、第 10.1 节）：固定顺序，客户端按此顺序渲染切换器。 */
export const GRAPH_LENSES = Object.freeze(['chain', 'umbrella', 'wave', 'importance', 'files'])

/** 波次镜头的缺省与上限（docs/09 第 2 节）。 */
export const GRAPH_DEFAULT_MAX_WAVES = 10
export const GRAPH_MAX_WAVES_LIMIT = 50

/** 文件冲突镜头的缺省与上限（docs/09 第 10.1 节）：`minTasks` 过滤文件、`maxFiles` 限制文件节点数。 */
export const GRAPH_DEFAULT_MIN_TASKS = 2
export const GRAPH_MIN_TASKS_LIMIT = 50
export const GRAPH_DEFAULT_MAX_FILES = 30
export const GRAPH_MAX_FILES_LIMIT = 200

/** 归一化镜头值：非法值一律退回 `chain`（路由侧已做 400 校验，这里只兜底）。 */
function normalizeLens(lens) {
  return GRAPH_LENSES.includes(lens) ? lens : 'chain'
}

/**
 * 显式重要度的档位（docs/09 第 10.3 节）：critical 4 / high 3 / normal 2 / low 1。
 * 不认识的档位给 0，并**保留原文**（FR-14.7：不猜、不改写）。
 */
const IMPORTANCE_TIERS = Object.freeze({ critical: 4, high: 3, normal: 2, low: 1 })

/** 档位数值；未知值返回 0（调用方据此归入 `unknown` 桶）。 */
function importanceTierOf(value) {
  return typeof value === 'string' && Object.hasOwn(IMPORTANCE_TIERS, value) ? IMPORTANCE_TIERS[value] : 0
}

/**
 * 引擎推导 importance 的阈值（docs/03：`config.importance` 同时是权重与阈值来源）。
 * 缺省与引擎 `derive_importance` 一致：>=5 critical、>=3 high、>=1 normal、0 low。
 */
function importanceDerivedTier(blockedDownstream, weights) {
  const raw = weights !== null && typeof weights === 'object' ? weights : null
  const num = (key, fallback) => (raw !== null && Number.isInteger(raw[key]) && raw[key] >= 0 ? raw[key] : fallback)
  if (typeof blockedDownstream !== 'number') return 0
  if (blockedDownstream >= num('critical', 5)) return 4
  if (blockedDownstream >= num('high', 3)) return 3
  if (blockedDownstream >= num('normal', 1)) return 2
  return 1
}

/**
 * 子图内 Kahn 逐层剥离（FR-7.4）。环上与「被环卡住」的节点拿不到层级（`level = null`）。
 *
 * @param {string[]} nodeIds 节点 id（顺序无关，输出稳定）
 * @param {{ from: string, to: string }[]} edgeList
 * @returns {Map<string, number>} `id → 层级`（只有能剥出的节点才有值）
 */
function computeLevels(nodeIds, edgeList) {
  const level = new Map()
  const indegree = new Map()
  const adjacency = new Map()
  for (const id of nodeIds) {
    indegree.set(id, 0)
    adjacency.set(id, [])
  }
  for (const edge of edgeList) {
    if (edge.from === edge.to) continue
    if (!adjacency.has(edge.from) || !indegree.has(edge.to)) continue
    adjacency.get(edge.from).push(edge.to)
    indegree.set(edge.to, indegree.get(edge.to) + 1)
  }
  const queue = []
  for (const id of nodeIds) {
    if (indegree.get(id) === 0) {
      level.set(id, 0)
      queue.push(id)
    }
  }
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index]
    for (const next of adjacency.get(node)) {
      level.set(next, Math.max(level.get(next) ?? 0, level.get(node) + 1))
      indegree.set(next, indegree.get(next) - 1)
      if (indegree.get(next) === 0) queue.push(next)
    }
  }
  return level
}

/** 把边按 `kind` 汇总成 `edgeKinds`（docs/09 第 3 节：按 kind 升序，含 projected 标记）。 */
function summarizeEdgeKinds(edgeList) {
  const counts = new Map()
  for (const edge of edgeList) {
    const hit = counts.get(edge.kind)
    if (hit === undefined) counts.set(edge.kind, { count: 1, projected: edge.projected === true })
    else hit.count += 1
  }
  return [...counts.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((kind) => ({ kind, count: counts.get(kind).count, projected: counts.get(kind).projected }))
}

/** 链上 id 序列的字典序比较（等长多解时取最小，docs/09 §11.1）。 */
function compareIdSequences(left, right) {
  const size = Math.min(left.length, right.length)
  for (let index = 0; index < size; index += 1) {
    if (left[index] === right[index]) continue
    return left[index] < right[index] ? -1 : 1
  }
  return left.length - right.length
}

/**
 * 关键路径（docs/09 §11.1）：只取 `depends_on` 边做拓扑 DP，求最长任务链。
 *
 * - 只认 `kind === 'depends_on'` 且两端都在 `nodeIds` 里的边；自环与「拓扑排不进的环节点」
 *   整条丢弃——不猜层级、不补边、不把环上的边当迭代。
 * - `dp = 1 + max(上游 dp)`；等长多解取「链上 id 序列字典序最小」的一条，保证输出确定性。
 * - `levelCount` = 链跨层数：链是连续的 `depends_on`，边数 = 节点数 - 1，故等于 `taskCount`。
 * - `estimatedHoursOf(id)` 返回正数估时或 null；链上**全有**才求和，否则 null 并计数 missingHours。
 * - 空子图 / 无边（含只有孤立节点的情况）返回零值，客户端不渲染（`taskCount < 2`）。
 *
 * @param {Iterable<string>} nodeIds 当前子图节点 id
 * @param {{ from: string, to: string, kind?: string, projected?: boolean }[]} edgeList 当前子图边
 * @param {(id: string) => number | null} estimatedHoursOf 估时读取器
 * @returns {{ taskCount: number, levelCount: number, estimatedHours: number | null, missingHours: number }}
 */
export function computeCriticalPath(nodeIds, edgeList, estimatedHoursOf) {
  const ids = new Set(nodeIds)
  const adjacency = new Map()
  const indegree = new Map()
  for (const id of ids) {
    adjacency.set(id, [])
    indegree.set(id, 0)
  }
  for (const edge of edgeList) {
    if (edge.kind !== 'depends_on') continue
    if (edge.from === edge.to) continue
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue
    adjacency.get(edge.from).push(edge.to)
    indegree.set(edge.to, indegree.get(edge.to) + 1)
  }
  // 拓扑 DP：`best` 保存「以该节点结尾、当前已知字典序最小」的最长链 id 序列。
  const best = new Map()
  for (const id of ids) best.set(id, [id])
  const queue = []
  for (const id of [...ids].sort((a, b) => a.localeCompare(b))) {
    if (indegree.get(id) === 0) queue.push(id)
  }
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index]
    const sequence = best.get(node)
    for (const next of adjacency.get(node)) {
      const candidate = [...sequence, next]
      const current = best.get(next)
      if (candidate.length > current.length
        || (candidate.length === current.length && compareIdSequences(candidate, current) < 0)) {
        best.set(next, candidate)
      }
      indegree.set(next, indegree.get(next) - 1)
      if (indegree.get(next) === 0) queue.push(next)
    }
  }
  // 只比较拓扑处理过的节点；长度为 1 的序列（单点）不算链（docs/09 §11.1「无边 → 零值」）。
  let chain = []
  for (const id of queue) {
    const sequence = best.get(id)
    if (sequence.length < 2) continue
    if (sequence.length > chain.length
      || (sequence.length === chain.length && compareIdSequences(sequence, chain) < 0)) {
      chain = sequence
    }
  }
  if (chain.length === 0) {
    return { taskCount: 0, levelCount: 0, estimatedHours: null, missingHours: 0 }
  }
  let hours = 0
  let missingHours = 0
  for (const id of chain) {
    const value = estimatedHoursOf(id)
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) hours += value
    else missingHours += 1
  }
  return {
    taskCount: chain.length,
    levelCount: chain.length,
    estimatedHours: missingHours === 0 ? hours : null,
    missingHours
  }
}

/**
 * 组装依赖图（FR-7 / FR-14）。
 *
 * 边的**唯一来源是定义层的 `depends_on`**（FR-7.5：引擎的列表输出不提供依赖字段，
 * 不得在前端猜算）。节点信息与阻塞数来自看板行（`buildBoard` 的 `tasks`），
 * 所以同一份 `status`/`pool` 输出既喂列表也喂图。
 *
 * 三个子图选择模式（docs/02 第 9.2 节未细化，此处为落地口径，记入 docs/05 §12）：
 *
 * | 模式 | 条件 | 保留的节点 |
 * |---|---|---|
 * | 聚焦 | 给了 `focus` | 焦点 + 上游闭包 + 下游闭包（`depth=null` 即全闭包，FR-7.4） |
 * | 活跃子图（默认） | 无 `focus`、`includeTerminal=false` | 非终态任务 + 它们的**直接**邻居（上下游各一层） |
 * | 全图 | `includeTerminal=true` | 全部任务（超过 `maxNodes` 时按优先级截断） |
 *
 * - 聚焦模式**忽略** `includeTerminal`：闭包里断了终态上游，「上游链」就失去意义（FR-7.4 的
 *   本意是把链路看全）。要收紧规模请用 `depth=1`。
 * - 活跃子图保留直接邻居而不是只留活跃节点：活跃任务的依赖多半已经 completed，
 *   不显示这一层就等于「活跃任务凭空出现」，看不出它在等谁。
 * - 悬空依赖（`depends_on` 指向不存在的任务）会生成 `missing:true` 的**占位节点**，
 *   否则这条边没有端点、图上就表达不出来，AC-7.1 的「逐项相等」也不成立。
 *
 * 五镜头（docs/09）只是**同一基础子图**的不同投影：
 *
 * | lens | 节点 | 边 | 截断 |
 * |---|---|---|---|
 * | `chain`（缺省） | 任务（向后兼容的全集字段） | `depends_on` | `maxNodes`（现行口径） |
 * | `wave` | 任务 + `wave`/`waveRank` | `depends_on` | 先 `maxNodes`，再按 `maxWaves` 砍波次 |
 * | `umbrella` | 伞 +（展开时）成员任务 | 聚合边 / `sourced_from` | 伞节点按 `maxNodes`（count 降序） |
 * | `importance` | 与 `chain` 同字段 + `importanceRank` | `depends_on` | `maxNodes`（与 `chain` 相同） |
 * | `files` | 任务 + 文件（二部图） | `touches` | 文件按 `maxFiles`、整体按 `maxNodes` |
 *
 * ⚠ `chain` 必须与引入镜头前的输出**逐字等价**（只新增 `kind`/`difficulty`/`umbrellas`
 * 等字段，不改既有字段语义），现有测试按字符串比对边即为此。
 *
 * 返回值在镜头字段之外统一带**顶层** `criticalPath`（docs/09 §11.1）：`chain`/`wave`/
 * `importance` 给 `{ taskCount, levelCount, estimatedHours, missingHours }`，投影边镜头
 * （`umbrella`/`files`）为 `null`；它不进 `projection`（`chain` 的 `projection` 恒为 null）。
 *
 * @param {object} args
 * @param {object} args.index 定义层索引（`buildDefinitionIndex` 的结果，可能 undefined）
 * @param {object[]} args.rows `buildBoard` 的 `tasks`（TaskRow[]）
 * @param {string|null} [args.focus] 聚焦的任务 id（伞/文件镜头忽略）
 * @param {number|null} [args.depth] 聚焦闭包的层数；`null` = 全闭包（伞/文件镜头忽略）
 * @param {boolean} [args.includeTerminal] 是否把终态任务也画进来（全部镜头都生效）
 * @param {number} [args.maxNodes]
 * @param {'chain'|'umbrella'|'wave'|'importance'|'files'} [args.lens] 图镜头（缺省 `chain`）
 * @param {string|null} [args.umbrella] `umbrella` 镜头下要展开的伞 id（形如 `idea:x`）
 * @param {number} [args.maxWaves] `wave` 镜头最多画几个波次（1..50，缺省 10）
 * @param {object|null} [args.umbrellaCatalog] 伞目录（`lib/umbrellas.js` 的结果，可注入）
 * @param {number} [args.minTasks] `files` 镜头：文件至少被几个任务触碰（1..50，缺省 2）
 * @param {number} [args.maxFiles] `files` 镜头：文件节点上限（1..200，缺省 30）
 */
export function buildGraph({
  index,
  rows,
  focus = null,
  depth = null,
  includeTerminal = false,
  maxNodes = GRAPH_MAX_NODES,
  lens = 'chain',
  umbrella = null,
  maxWaves = GRAPH_DEFAULT_MAX_WAVES,
  umbrellaCatalog = null,
  minTasks = GRAPH_DEFAULT_MIN_TASKS,
  maxFiles = GRAPH_DEFAULT_MAX_FILES
}) {
  const lensId = normalizeLens(lens)
  const waveLimit = Number.isInteger(maxWaves) && maxWaves >= 1
    ? Math.min(maxWaves, GRAPH_MAX_WAVES_LIMIT)
    : GRAPH_DEFAULT_MAX_WAVES
  // 文件镜头：`minTasks` / `maxFiles` 归一化（路由侧已做 400 校验，这里只兜底）。
  const minTasksLimit = Number.isInteger(minTasks) && minTasks >= 1
    ? Math.min(minTasks, GRAPH_MIN_TASKS_LIMIT)
    : GRAPH_DEFAULT_MIN_TASKS
  const maxFilesLimit = Number.isInteger(maxFiles) && maxFiles >= 1
    ? Math.min(maxFiles, GRAPH_MAX_FILES_LIMIT)
    : GRAPH_DEFAULT_MAX_FILES
  // 伞/文件镜头不聚焦（docs/09 第 2 节、第 10.1 节）：吞掉 focus/depth，路由侧已对显式传参返回 400。
  if (lensId === 'umbrella' || lensId === 'files') {
    focus = null
    depth = null
  }
  const rowById = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row !== null && typeof row === 'object' && typeof row.id === 'string' && !rowById.has(row.id)) rowById.set(row.id, row)
  }

  const definitions = index?.tasks instanceof Map ? index.tasks : new Map()

  /** 任务 → 伞键（状态层行没有 `additionalSources`，必须叠加定义层，FR-14.7）。 */
  const umbrellaMemo = new Map()
  const umbrellaKeysFor = (id) => {
    const hit = umbrellaMemo.get(id)
    if (hit !== undefined) return hit
    const keys = umbrellaKeysOf(definitions.get(id) ?? rowById.get(id))
    umbrellaMemo.set(id, keys)
    return keys
  }
  /** 项目层伞 id 全集：`lenses` 可用性与 `unknown-umbrella` 判定都只看它（docs/09 3.4）。 */
  const projectUmbrellaIds = collectProjectUmbrellaIds([...rowById.values()], definitions)

  const weights = index?.importanceWeights ?? null
  /** 定义层的难度（low/medium/high），缺字段一律 null（FR-14.7：不补不猜）。 */
  const difficultyOf = (id) => {
    const raw = rowById.get(id)?.difficulty ?? definitions.get(id)?.difficulty ?? null
    return raw === 'low' || raw === 'medium' || raw === 'high' ? raw : null
  }
  /**
   * 波次内排序的第一关键字（docs/09 3.3）：显式重要度整体排在推导重要度之前，
   * 各自内部再按 important 值比较。显式 = 定义层给了 importance 且不是引擎推导的。
   */
  const importanceSortKey = (id) => {
    const row = rowById.get(id)
    const explicit = row?.importance ?? definitions.get(id)?.importance ?? null
    const derived = row?.importanceDerived ?? null
    const isExplicit = explicit !== null && derived !== true
    return { explicit: isExplicit ? 1 : 0, rank: importanceRank(isExplicit ? explicit : derived, weights) }
  }

  // ── 重要性镜头（docs/09 10.3）：显式值优先、其次推导值，再按 blockedDownstream / id ──
  // ⚠ 显式 `importance` 与推导值**分开读**（AC-14.5），推导值绝不覆盖显式值。
  const explicitImportanceOf = (id) => {
    const row = rowById.get(id)
    const value = row?.importance ?? definitions.get(id)?.importance ?? null
    return typeof value === 'string' ? value : null
  }
  /** 推导值：状态层 `importance`（引擎按下游阻塞数算出），与显式值无关。 */
  const derivedImportanceOf = (id) => {
    const value = rowById.get(id)?.importanceDerived ?? null
    return typeof value === 'string' ? value : null
  }
  const blockedDownstreamOf = (id) => {
    const value = rowById.get(id)?.blockedDownstream
    return typeof value === 'number' ? value : null
  }
  /**
   * 排序键（越大越靠前）：显式档位 → 推导档位（先取推导值，缺推导值时按
   * `blockedDownstream` 分档）→ 0（两者都没有）。`id` 由调用方做最后一级。
   */
  const importanceRankOf = (id) => {
    const explicit = explicitImportanceOf(id)
    if (explicit !== null) return importanceTierOf(explicit)
    const derived = derivedImportanceOf(id)
    if (derived !== null) return importanceTierOf(derived)
    return importanceDerivedTier(blockedDownstreamOf(id), weights)
  }
  /**
   * 显式 / 推导 / 无值三分类：2 = 显式、1 = 推导、0 = 都没有。
   * 层级排序先按这个分类（显式重要度整体优先于推导，见 docs/09 10.3 与 10.5 图例）。
   */
  const importanceClassOf = (id) => {
    if (explicitImportanceOf(id) !== null) return 2
    if (derivedImportanceOf(id) !== null || blockedDownstreamOf(id) !== null) return 1
    return 0
  }
  /**
   * 任务节点排序（重要性镜头与文件镜头的任务优先级共用）：
   * 显式分类降序 → 档位降序 → blockedDownstream 降序 → id 升序。
   */
  const compareByImportance = (a, b) => {
    const classDiff = importanceClassOf(b) - importanceClassOf(a)
    if (classDiff !== 0) return classDiff
    const rankDiff = importanceRankOf(b) - importanceRankOf(a)
    if (rankDiff !== 0) return rankDiff
    const blockedDiff = (blockedDownstreamOf(b) ?? -1) - (blockedDownstreamOf(a) ?? -1)
    if (blockedDiff !== 0) return blockedDiff
    return a.localeCompare(b)
  }

  // ── 边全集（含悬空边与自依赖边，AC-7.1 要求与定义文件逐项相等）──
  const edgeKeys = new Set()
  const edges = []
  const danglingIds = new Set()
  const selfIds = new Set()
  for (const [id, definition] of definitions) {
    const dependsOn = Array.isArray(definition?.dependsOn) ? definition.dependsOn : []
    for (const upstream of dependsOn) {
      if (typeof upstream !== 'string' || upstream === '') continue
      if (upstream === id) selfIds.add(id)
      // 「任务是否存在」的判据是看板全集（定义层 ∪ 状态层）；定义层索引只作兜底，
      // 避免调用方传入的是已过滤的行时把真实存在的上游误判成悬空。
      if (!rowById.has(upstream) && !definitions.has(upstream)) danglingIds.add(upstream)
      const key = `${upstream}\u0000${id}`
      if (edgeKeys.has(key)) continue
      edgeKeys.add(key)
      edges.push({ from: upstream, to: id })
    }
  }
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))

  /** 正向邻接（被依赖 → 依赖者）与反向邻接（依赖者 → 被依赖），闭包用。 */
  const outbound = new Map()
  const inbound = new Map()
  for (const edge of edges) {
    if (!outbound.has(edge.from)) outbound.set(edge.from, [])
    outbound.get(edge.from).push(edge.to)
    if (!inbound.has(edge.to)) inbound.set(edge.to, [])
    inbound.get(edge.to).push(edge.from)
  }

  const isTerminalStatus = (status) => typeof status === 'string' && TERMINAL_STATUSES.has(status)
  const seedIds = [...rowById.values()].filter((row) => !isTerminalStatus(row.status)).map((row) => row.id)

  /** 沿邻接表做 BFS 闭包；`limit=null` 表示不限层数。返回 `Map<id, 距离>`（种子距离 0）。 */
  const closureOf = (seedList, adjacency, limit) => {
    const seen = new Map()
    let frontier = []
    for (const seed of seedList) {
      if (!seen.has(seed)) {
        seen.set(seed, 0)
        frontier.push(seed)
      }
    }
    let distance = 0
    while (frontier.length > 0 && (limit === null || distance < limit)) {
      distance += 1
      const next = []
      for (const node of frontier) {
        for (const neighbour of adjacency.get(node) ?? []) {
          if (seen.has(neighbour)) continue
          seen.set(neighbour, distance)
          next.push(neighbour)
        }
      }
      frontier = next
    }
    return seen
  }

  let keep = new Set()
  let relation = new Map()
  let focusInfo = null

  if (focus !== null && focus !== undefined) {
    const upstream = closureOf([focus], inbound, depth)
    const downstream = closureOf([focus], outbound, depth)
    for (const id of upstream.keys()) keep.add(id)
    for (const id of downstream.keys()) keep.add(id)
    for (const id of keep) relation.set(id, 'focus')
    for (const id of upstream.keys()) if (id !== focus) relation.set(id, 'upstream')
    // 上下游闭包都命中的节点标成 both（保留「既有上游链又有下游链」这个信息）
    for (const id of downstream.keys()) if (id !== focus) relation.set(id, relation.get(id) === 'upstream' ? 'both' : 'downstream')
    focusInfo = {
      id: focus,
      depth: Number.isInteger(depth) ? depth : null,
      upstream: [...upstream.keys()].filter((id) => id !== focus).sort(),
      downstream: [...downstream.keys()].filter((id) => id !== focus).sort()
    }
  } else if (includeTerminal) {
    for (const id of rowById.keys()) keep.add(id)
    for (const id of seedIds) relation.set(id, 'seed')
  } else {
    const seeds = new Set(seedIds)
    for (const id of seeds) {
      keep.add(id)
      relation.set(id, 'seed')
    }
    // 只扩**一层**：先把邻居收齐再并入，避免在遍历里边加边扩散（那会把二三层之外的
    // 终态节点也拖进来，等于没做子图裁剪）
    const neighbours = new Set()
    for (const edge of edges) {
      if (seeds.has(edge.to) && !danglingIds.has(edge.from)) neighbours.add(edge.from)
      if (seeds.has(edge.from)) neighbours.add(edge.to)
    }
    for (const id of neighbours) {
      if (keep.has(id)) continue
      keep.add(id)
      relation.set(id, 'neighbour')
    }
  }

  // 悬空上游的占位节点：只有当它连着的下游进了子图才补进来
  for (const edge of edges) {
    if (keep.has(edge.to) && danglingIds.has(edge.from)) keep.add(edge.from)
  }

  // 截断（FR-7.6）：焦点与活跃种子优先，其次层级浅的，最后 id 字典序（结果稳定可测）
  let truncated = false
  let omitted = 0
  // 伞/文件镜头不截任务子图（截断落在伞节点/文件与整图上，docs/09 5.1 / 10.4）；
  // chain/wave/importance 维持现行口径。
  if (lensId !== 'umbrella' && lensId !== 'files' && keep.size > maxNodes) {
    const rank = (id) => (id === focus ? 0 : (relation.get(id) === 'seed' ? 1 : 2))
    const ordered = [...keep].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    const allowed = new Set(ordered.slice(0, maxNodes))
    omitted = keep.size - allowed.size
    keep = allowed
    truncated = true
  }

  /** 画出的任务边：chain/wave 一律 `depends_on`，伞视图另有聚合边与 sourced_from。 */
  const taskEdges = edges
    .filter((edge) => keep.has(edge.from) && keep.has(edge.to))
    .map((edge) => ({ from: edge.from, to: edge.to, kind: 'depends_on', projected: false }))
  const sortedIds = [...keep].sort((a, b) => a.localeCompare(b))
  /**
   * 关键路径的估时读取器（docs/09 §11.1）：定义层/状态层行都带 `estimatedHours`，
   * 只认正数——0、负数、非数字一律按「缺估时」处理，不按均值猜。
   */
  const estimatedHoursOf = (id) => {
    const value = rowById.get(id)?.estimatedHours ?? definitions.get(id)?.estimatedHours ?? null
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
  }
  const criticalPathOf = (ids, edgeList) => computeCriticalPath(ids, edgeList, estimatedHoursOf)

  /** 任务节点的通用字段：五镜头共用，避免同一份映射写多遍。 */
  const buildTaskNode = (id) => {
    const row = rowById.get(id)
    const definition = definitions.get(id)
    const missing = row === undefined
    const explicitImportance = row?.importance ?? definition?.importance ?? null
    // docs/09 10.3：图节点上的 `importanceDerived` 是**布尔**（区分显式/推导），
    // 推导出的具体档位留在 `projection.importance` 的桶里；显式值绝不被推导值覆盖。
    const hasDerived = explicitImportance === null
      && (typeof row?.importanceDerived === 'string' || typeof row?.blockedDownstream === 'number')
    return {
      id,
      kind: 'task',
      name: row?.name ?? definition?.name ?? null,
      status: row?.status ?? null,
      module: row?.module ?? definition?.module ?? null,
      importance: explicitImportance,
      importanceDerived: hasDerived,
      difficulty: difficultyOf(id),
      umbrellas: umbrellaKeysFor(id),
      // FR-7.3 的下游阻塞数**必须**是引擎口径（`pool --all` 的 blocked_downstream_count，
      // 语义是「被多少 pending 下游依赖」）。引擎没给就是 null——绝不用直接边数冒充它。
      blockedDownstream: typeof row?.blockedDownstream === 'number' ? row.blockedDownstream : null,
      terminal: isTerminalStatus(row?.status),
      inDefinition: row?.inDefinition === true || (missing && definitions.has(id)),
      inState: row?.inState === true,
      /** 悬空依赖的占位节点（任务不存在，只在图上表达「这里指向了不存在的东西」）。 */
      missing
    }
  }

  /** 三类异常（self / dangling / cycle）的同一口径：只报画出来的节点。 */
  const computeTaskAnomalies = (keptIds, keptEdges) => {
    const list = []
    for (const id of [...selfIds].filter((value) => keptIds.has(value)).sort()) {
      list.push({ kind: 'self', ids: [id] })
    }
    for (const id of [...danglingIds].filter((value) => keptIds.has(value)).sort()) {
      list.push({ kind: 'dangling', ids: [id] })
    }
    // 环：只在**自环以外**的强连通分量里找（自环已经单独报成 self，不重复报）
    const adjacency = new Map()
    for (const id of keptIds) adjacency.set(id, [])
    for (const edge of keptEdges) {
      if (edge.from === edge.to) continue
      if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue
      adjacency.get(edge.from).push(edge.to)
    }
    const nodeIds = [...keptIds].sort((a, b) => a.localeCompare(b))
    for (const component of findStronglyConnectedComponents(nodeIds, adjacency)) {
      list.push({ kind: 'cycle', ids: component })
    }
    list.sort((a, b) => a.kind.localeCompare(b.kind) || (a.ids[0] ?? '').localeCompare(b.ids[0] ?? ''))
    return list
  }

  const projectTerminal = [...rowById.values()].filter((row) => isTerminalStatus(row.status)).length

  /** `counts` 三镜头共用；伞视图不画任务时用 `hiddenTerminal` 覆盖（避免误导）。 */
  const buildCounts = (nodeList, edgeList, anomalyList, omittedByLimit, hiddenTerminal) => {
    const terminalNodes = nodeList.filter((node) => node.terminal === true).length
    return {
      nodes: nodeList.length,
      edges: edgeList.length,
      projectTasks: rowById.size,
      activeSeeds: seedIds.length,
      terminalNodes,
      hiddenTerminal: hiddenTerminal ?? Math.max(0, projectTerminal - terminalNodes),
      /** 因节点/波次上限被丢掉的节点数（UI 必须说明，FR-7.6）。 */
      omittedByLimit,
      anomaly: {
        cycle: anomalyList.filter((item) => item.kind === 'cycle').length,
        self: anomalyList.filter((item) => item.kind === 'self').length,
        dangling: anomalyList.filter((item) => item.kind === 'dangling').length
      }
    }
  }

  /**
   * 镜头可用性（docs/09 3.4，只看项目层）：重要性看是否至少一行有显式/推导重要度或
   * 下游阻塞数；文件镜头看是否至少一个任务声明了写范围（`files_to_edit`）。
   * `files_to_read` 只用于建读边，不给可用性（docs/09 10.2）。
   */
  const projectHasImportance = [...new Set([...definitions.keys(), ...rowById.keys()])]
    .some((id) => explicitImportanceOf(id) !== null
      || derivedImportanceOf(id) !== null
      || blockedDownstreamOf(id) !== null)
  const projectHasFiles = [...definitions.values()]
    .some((definition) => Array.isArray(definition?.filesToEdit) && definition.filesToEdit.length > 0)

  /** `lenses`：顺序固定为 chain / umbrella / wave / importance / files。 */
  const lenses = [
    { id: 'chain', available: true },
    projectUmbrellaIds.size > 0
      ? { id: 'umbrella', available: true }
      : { id: 'umbrella', available: false, reason: 'no-source-umbrella' },
    edges.length > 0
      ? { id: 'wave', available: true }
      : { id: 'wave', available: false, reason: 'no-dependency-edges' },
    projectHasImportance
      ? { id: 'importance', available: true }
      : { id: 'importance', available: false, reason: 'no-importance' },
    projectHasFiles
      ? { id: 'files', available: true }
      : { id: 'files', available: false, reason: 'no-files' }
  ]

  // ── 伞镜头（docs/09 5.2）：节点是伞，边由任务依赖聚合而来 ────────────────
  if (lensId === 'umbrella') {
    // 项目层挂载全集：`totalCount` 用（不受子图裁剪影响）
    const projectMembers = new Map()
    for (const id of new Set([...definitions.keys(), ...rowById.keys()])) {
      for (const umbrellaId of umbrellaKeysFor(id)) {
        if (!projectMembers.has(umbrellaId)) projectMembers.set(umbrellaId, new Set())
        projectMembers.get(umbrellaId).add(id)
      }
    }
    // 子图内挂载：`count` 与聚合边用
    const subMembers = new Map()
    let unattributedTasks = 0
    for (const id of keep) {
      const keys = umbrellaKeysFor(id)
      if (keys.length === 0) {
        unattributedTasks += 1
        continue
      }
      for (const umbrellaId of keys) {
        if (!subMembers.has(umbrellaId)) subMembers.set(umbrellaId, [])
        subMembers.get(umbrellaId).push(id)
      }
    }
    for (const ids of subMembers.values()) ids.sort((a, b) => a.localeCompare(b))
    const umbrellaNodeIdOf = (umbrellaId) => `umbrella:${umbrellaId}`

    const buildUmbrellaNode = (umbrellaId, memberIds, levelValue, relationValue) => {
      const parsed = umbrellaKeyOf(umbrellaId)
      const { title, titleSource } = umbrellaTitleOf(umbrellaCatalog, umbrellaId)
      const statusCounts = {}
      for (const memberId of memberIds) {
        const status = rowById.get(memberId)?.status
        if (typeof status !== 'string') continue
        statusCounts[status] = (statusCounts[status] ?? 0) + 1
      }
      return {
        id: umbrellaNodeIdOf(umbrellaId),
        kind: 'umbrella',
        umbrellaId,
        sourceKind: parsed === null ? null : parsed.kind,
        slug: parsed === null ? null : parsed.slug,
        /** 标题缺失一律 null；界面退化到 slug 并由 `missingTitle` 显式计数（FR-14.3）。 */
        title,
        titleSource,
        missingTitle: title === null,
        name: title ?? (parsed === null ? umbrellaId : parsed.slug),
        /** 当前子图内挂载的任务数（docs/09 3.1）。 */
        count: memberIds.length,
        /** 项目内挂载的任务数（定义层全集，不受子图裁剪影响）。 */
        totalCount: projectMembers.get(umbrellaId)?.size ?? 0,
        statusCounts,
        terminal: false,
        level: levelValue,
        relation: relationValue
      }
    }

    const requested = umbrellaKeyOf(umbrella)
    const expandedId = requested === null ? null : requested.id

    // 展开视图：一个伞 + 子图内成员任务；边是伞→成员的 sourced_from + 成员间的 depends_on。
    // 展开视图不出现聚合边（docs/09 5.2）。
    if (expandedId !== null) {
      const memberIds = (subMembers.get(expandedId) ?? []).slice().sort((a, b) => a.localeCompare(b))
      const memberSet = new Set(memberIds)
      const memberEdges = edges
        .filter((edge) => memberSet.has(edge.from) && memberSet.has(edge.to))
        .map((edge) => ({ from: edge.from, to: edge.to, kind: 'depends_on', projected: false }))
      const memberLevels = computeLevels(memberIds, memberEdges)
      const umbrellaNode = buildUmbrellaNode(expandedId, memberIds, 0, 'focus')
      const nodes = [
        umbrellaNode,
        ...memberIds.map((id) => ({
          ...buildTaskNode(id),
          level: memberLevels.get(id) ?? null,
          relation: 'member'
        }))
      ]
      const outEdges = memberIds.map((id) => ({ from: expandedId, to: id, kind: 'sourced_from', projected: true }))
      for (const edge of memberEdges) outEdges.push(edge)
      const anomalies = computeTaskAnomalies(memberSet, memberEdges)
      return {
        lens: 'umbrella',
        focus: null,
        depth: null,
        includeTerminal: includeTerminal === true,
        nodes,
        edges: outEdges,
        anomalies,
        counts: buildCounts(nodes, outEdges, anomalies, 0),
        truncated: false,
        lenses,
        edgeKinds: summarizeEdgeKinds(outEdges),
        projection: {
          lens: 'umbrella',
          umbrella: {
            total: subMembers.size,
            shown: 1,
            withTitle: umbrellaNode.missingTitle ? 0 : 1,
            missingTitle: umbrellaNode.missingTitle ? 1 : 0,
            unattributedTasks,
            expanded: expandedId,
            members: { total: memberIds.length, shown: memberIds.length }
          }
        },
        // 投影边（sourced_from）不参与关键路径（docs/09 §11.1）。
        criticalPath: null
      }
    }

    // 不展开：伞节点按 count 降序、id 升序截断到 maxNodes（docs/09 3.3 / 5.1）。
    const allUmbrellaIds = [...subMembers.keys()].sort((a, b) => a.localeCompare(b))
    let drawnIds = allUmbrellaIds
    let omittedUmbrellas = 0
    if (allUmbrellaIds.length > maxNodes) {
      const ordered = [...allUmbrellaIds].sort((a, b) => (subMembers.get(b)?.length ?? 0) - (subMembers.get(a)?.length ?? 0) || a.localeCompare(b))
      drawnIds = ordered.slice(0, maxNodes).sort((a, b) => a.localeCompare(b))
      omittedUmbrellas = subMembers.size - drawnIds.length
    }
    const drawnNodeIds = new Set(drawnIds.map(umbrellaNodeIdOf))

    // 聚合边：对子图内每条 depends_on 取两端伞集合，逐对累加权重（方向 = 上游 → 下游）。
    // 同一 (from,to) 只出一条；权重为「实际支撑这条聚合边的任务依赖数」。
    const aggregate = new Map()
    for (const edge of edges) {
      if (!keep.has(edge.from) || !keep.has(edge.to)) continue
      const upstreamKeys = umbrellaKeysFor(edge.from)
      const downstreamKeys = umbrellaKeysFor(edge.to)
      if (upstreamKeys.length === 0 || downstreamKeys.length === 0) continue
      for (const upstream of upstreamKeys) {
        for (const downstream of downstreamKeys) {
          if (upstream === downstream) continue
          const key = `${upstream}\u0000${downstream}`
          aggregate.set(key, (aggregate.get(key) ?? 0) + 1)
        }
      }
    }
    const aggregateEdges = [...aggregate.entries()]
      .map(([key, weight]) => {
        const [upstream, downstream] = key.split('\u0000')
        return {
          from: umbrellaNodeIdOf(upstream),
          to: umbrellaNodeIdOf(downstream),
          kind: 'depends_on_aggregated',
          weight,
          projected: true
        }
      })
      .filter((edge) => drawnNodeIds.has(edge.from) && drawnNodeIds.has(edge.to))
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))

    const umbrellaLevels = computeLevels([...drawnNodeIds].sort((a, b) => a.localeCompare(b)), aggregateEdges)
    const nodes = drawnIds.map((umbrellaId) => buildUmbrellaNode(
      umbrellaId,
      subMembers.get(umbrellaId) ?? [],
      umbrellaLevels.get(umbrellaNodeIdOf(umbrellaId)) ?? null,
      'seed'
    ))

    // 聚合边成环：同一 Tarjan，但 `ids` 用 umbrellaId（docs/09 5.2 的字面口径）。
    const anomalies = []
    {
      const adjacency = new Map()
      for (const nodeId of drawnNodeIds) adjacency.set(nodeId, [])
      for (const edge of aggregateEdges) adjacency.get(edge.from).push(edge.to)
      const nodeList = [...drawnNodeIds].sort((a, b) => a.localeCompare(b))
      for (const component of findStronglyConnectedComponents(nodeList, adjacency)) {
        anomalies.push({ kind: 'cycle', ids: component.map((nodeId) => nodeId.slice('umbrella:'.length)) })
      }
      anomalies.sort((a, b) => a.kind.localeCompare(b.kind) || (a.ids[0] ?? '').localeCompare(b.ids[0] ?? ''))
    }

    const withTitle = nodes.filter((node) => node.missingTitle === false).length
    return {
      lens: 'umbrella',
      focus: null,
      depth: null,
      includeTerminal: includeTerminal === true,
      nodes,
      edges: aggregateEdges,
      anomalies,
      // 伞视图不画任务：终态任务全部不在图上，`hiddenTerminal` 报 0 避免误导（用 counts.nodes 沟通规模）
      counts: buildCounts(nodes, aggregateEdges, anomalies, omittedUmbrellas, 0),
      truncated: omittedUmbrellas > 0,
      lenses,
      edgeKinds: summarizeEdgeKinds(aggregateEdges),
      projection: {
        lens: 'umbrella',
        umbrella: {
          total: subMembers.size,
          shown: nodes.length,
          withTitle,
          missingTitle: nodes.length - withTitle,
          unattributedTasks,
          expanded: null,
          members: { total: 0, shown: 0 }
        }
      },
      // 伞视图只有聚合边（depends_on_aggregated），不是真实依赖，关键路径为 null。
      criticalPath: null
    }
  }

  // ── 重要性镜头（docs/09 10.3）：基础子图与 chain 逐字等价，只在层内按重要度重排 ──
  if (lensId === 'importance') {
    const levelMap = computeLevels(sortedIds, taskEdges)
    // 层内排序：同一 level 内「显式档位 → 推导档位 → blockedDownstream → id」；
    // 层与层之间仍按 wave 升序、无层级的节点排最后（只改层内顺序，不改 level 值）。
    const order = (a, b) => {
      const left = levelMap.get(a) ?? null
      const right = levelMap.get(b) ?? null
      if (left !== right) {
        if (left === null) return 1
        if (right === null) return -1
        return left - right
      }
      return compareByImportance(a, b)
    }
    const nodes = [...sortedIds].sort(order).map((id) => ({
      ...buildTaskNode(id),
      level: levelMap.get(id) ?? null,
      relation: relation.get(id) ?? null,
      importanceRank: importanceRankOf(id)
    }))
    // 五桶之和 = total：没有可识别档位的（含两者都没有的）统一归 unknown，不猜档位。
    const buckets = { critical: 0, high: 0, normal: 0, low: 0, unknown: 0 }
    let explicitCount = 0
    let derivedCount = 0
    let noneCount = 0
    for (const node of nodes) {
      const importanceClass = importanceClassOf(node.id)
      if (importanceClass === 2) explicitCount += 1
      else if (importanceClass === 1) derivedCount += 1
      else noneCount += 1
      const value = explicitImportanceOf(node.id) ?? derivedImportanceOf(node.id)
      const bucket = typeof value === 'string' && Object.hasOwn(IMPORTANCE_TIERS, value) ? value : 'unknown'
      buckets[bucket] += 1
    }
    const anomalies = computeTaskAnomalies(keep, taskEdges)
    return {
      lens: 'importance',
      focus: focusInfo,
      depth: Number.isInteger(depth) ? depth : null,
      includeTerminal: includeTerminal === true,
      nodes,
      edges: taskEdges,
      anomalies,
      counts: buildCounts(nodes, taskEdges, anomalies, omitted),
      truncated,
      lenses,
      edgeKinds: summarizeEdgeKinds(taskEdges),
      projection: {
        lens: 'importance',
        importance: {
          total: nodes.length,
          explicit: explicitCount,
          derived: derivedCount,
          none: noneCount,
          buckets
        }
      },
      // 与 chain 同一基础子图（真实 depends_on 边），关键路径照常给值。
      criticalPath: criticalPathOf(sortedIds, taskEdges)
    }
  }

  // ── 文件冲突镜头（docs/09 10.4）：任务 × 文件二部图 ──────────────────────
  if (lensId === 'files') {
    // 文件热度按**当前基础子图**内的任务统计，保证 `tasks` 计数与画出的 `touches` 边自洽。
    const fileStats = new Map()
    const statOf = (filePath) => {
      let hit = fileStats.get(filePath)
      if (hit === undefined) {
        hit = { path: filePath, writerIds: new Set(), readerIds: new Set() }
        fileStats.set(filePath, hit)
      }
      return hit
    }
    for (const id of sortedIds) {
      const definition = definitions.get(id)
      if (definition === undefined) continue
      for (const filePath of Array.isArray(definition.filesToEdit) ? definition.filesToEdit : []) {
        if (typeof filePath === 'string' && filePath !== '') statOf(filePath).writerIds.add(id)
      }
      for (const entry of Array.isArray(definition.filesToRead) ? definition.filesToRead : []) {
        const filePath = entry !== null && typeof entry === 'object' ? entry.path : null
        if (typeof filePath === 'string' && filePath !== '') statOf(filePath).readerIds.add(id)
      }
    }
    const fileCandidates = [...fileStats.values()]
      .map((stat) => ({
        path: stat.path,
        writers: stat.writerIds.size,
        readers: stat.readerIds.size,
        tasks: new Set([...stat.writerIds, ...stat.readerIds]).size
      }))
      .filter((stat) => stat.tasks >= minTasksLimit)
      .sort((a, b) => b.tasks - a.tasks || a.path.localeCompare(b.path))
    const filesTotal = fileCandidates.length
    let shownFiles = fileCandidates.slice(0, maxFilesLimit)
    const filesOmitted = filesTotal - shownFiles.length
    // 整体 maxNodes：文件优先占位（maxFiles 已 ≤ 200），任务按重要度排序后补位。
    let omittedNodes = 0
    if (shownFiles.length > maxNodes) {
      omittedNodes += shownFiles.length - maxNodes
      shownFiles = shownFiles.slice(0, maxNodes)
    }
    const shownFilePaths = new Set(shownFiles.map((stat) => stat.path))
    const relatedTaskSet = new Set()
    for (const stat of shownFiles) {
      const raw = fileStats.get(stat.path)
      for (const id of raw.writerIds) relatedTaskSet.add(id)
      for (const id of raw.readerIds) relatedTaskSet.add(id)
    }
    const orderedTaskIds = [...relatedTaskSet].sort(compareByImportance)
    const maxTaskSlots = Math.max(0, maxNodes - shownFiles.length)
    const keptTaskIds = orderedTaskIds.slice(0, maxTaskSlots)
    omittedNodes += orderedTaskIds.length - keptTaskIds.length
    const keptTaskSet = new Set(keptTaskIds)

    // `touches` 边：同一对任务-文件既有写又有读只算写边（docs/09 10.4），不重复计。
    const touchEdges = []
    let writeEdges = 0
    let readEdges = 0
    for (const id of [...keptTaskSet].sort((a, b) => a.localeCompare(b))) {
      const definition = definitions.get(id)
      if (definition === undefined) continue
      const written = new Set()
      for (const filePath of Array.isArray(definition.filesToEdit) ? definition.filesToEdit : []) {
        if (typeof filePath !== 'string' || !shownFilePaths.has(filePath)) continue
        written.add(filePath)
        touchEdges.push({ from: id, to: `file:${filePath}`, kind: 'touches', projected: false })
        writeEdges += 1
      }
      for (const entry of Array.isArray(definition.filesToRead) ? definition.filesToRead : []) {
        const filePath = entry !== null && typeof entry === 'object' ? entry.path : null
        if (typeof filePath !== 'string' || !shownFilePaths.has(filePath) || written.has(filePath)) continue
        touchEdges.push({ from: id, to: `file:${filePath}`, kind: 'touches', projected: false })
        readEdges += 1
      }
    }
    touchEdges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))

    const baseLevels = computeLevels(sortedIds, taskEdges)
    const fileNodes = shownFiles.map((stat) => ({
      id: `file:${stat.path}`,
      kind: 'file',
      /** 定义层原文（正斜杠）；不归一、不猜（FR-14.7）。 */
      path: stat.path,
      name: stat.path.split(/[\\/]/).pop() ?? stat.path,
      writers: stat.writers,
      readers: stat.readers,
      tasks: stat.tasks,
      terminal: false,
      level: null,
      relation: null
    }))
    const taskNodes = [...keptTaskSet]
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({
        ...buildTaskNode(id),
        level: baseLevels.get(id) ?? null,
        relation: relation.get(id) ?? null
      }))
    const nodes = [...fileNodes, ...taskNodes]
    const anomalies = []
    return {
      lens: 'files',
      focus: null,
      depth: null,
      includeTerminal: includeTerminal === true,
      nodes,
      edges: touchEdges,
      anomalies,
      counts: buildCounts(nodes, touchEdges, anomalies, omittedNodes),
      truncated: omittedNodes > 0 || filesOmitted > 0,
      lenses,
      edgeKinds: summarizeEdgeKinds(touchEdges),
      projection: {
        lens: 'files',
        files: {
          filesTotal,
          filesShown: shownFiles.length,
          filesOmitted,
          tasksShown: taskNodes.length,
          minTasks: minTasksLimit,
          maxFiles: maxFilesLimit,
          writeEdges,
          readEdges
        }
      },
      // touches 是任务-文件关系边，不是任务依赖，关键路径为 null（docs/09 §11.1）。
      criticalPath: null
    }
  }

  // ── 波次镜头（docs/09 3.3）：Kahn 分层 + 同波次排序 + maxWaves 截断 ──────────
  if (lensId === 'wave') {
    const levelMap = computeLevels(sortedIds, taskEdges)
    const waveValues = [...new Set(sortedIds.map((id) => levelMap.get(id)).filter((value) => typeof value === 'number'))]
      .sort((a, b) => a - b)
    const total = waveValues.length
    const shown = Math.min(total, waveLimit)
    const allowedWaves = new Set(waveValues.slice(0, shown))
    let shownIds = sortedIds
    let omittedNodes = 0
    if (shown < total) {
      shownIds = []
      for (const id of sortedIds) {
        const value = levelMap.get(id)
        if (typeof value === 'number' && !allowedWaves.has(value)) {
          omittedNodes += 1
          continue
        }
        shownIds.push(id)
      }
    }
    const shownSet = new Set(shownIds)
    const waveEdges = taskEdges.filter((edge) => shownSet.has(edge.from) && shownSet.has(edge.to))
    const waveLevels = computeLevels(shownIds, waveEdges)

    // 同波次排序：显式重要度 → 推导重要度 → 难度（high→low）→ id（docs/09 3.3）
    const rankById = new Map()
    const groups = new Map()
    for (const id of shownIds) {
      const value = waveLevels.get(id) ?? null
      if (!groups.has(value)) groups.set(value, [])
      groups.get(value).push(id)
    }
    for (const ids of groups.values()) {
      ids.sort((a, b) => {
        const keyA = importanceSortKey(a)
        const keyB = importanceSortKey(b)
        return keyB.explicit - keyA.explicit
          || keyB.rank - keyA.rank
          || difficultyRank(difficultyOf(b)) - difficultyRank(difficultyOf(a))
          || a.localeCompare(b)
      })
      ids.forEach((id, index) => rankById.set(id, index))
    }
    const order = (a, b) => {
      const left = waveLevels.get(a) ?? null
      const right = waveLevels.get(b) ?? null
      if (left !== right) {
        if (left === null) return 1
        if (right === null) return -1
        return left - right
      }
      return (rankById.get(a) ?? 0) - (rankById.get(b) ?? 0) || a.localeCompare(b)
    }

    const nodes = [...shownIds].sort(order).map((id) => {
      const value = waveLevels.get(id) ?? null
      return {
        ...buildTaskNode(id),
        level: value,
        relation: relation.get(id) ?? null,
        wave: value,
        waveRank: value === null ? null : (rankById.get(id) ?? 0)
      }
    })
    const anomalies = computeTaskAnomalies(shownSet, waveEdges)
    return {
      lens: 'wave',
      focus: focusInfo,
      depth: Number.isInteger(depth) ? depth : null,
      includeTerminal: includeTerminal === true,
      nodes,
      edges: waveEdges,
      anomalies,
      counts: buildCounts(nodes, waveEdges, anomalies, omitted),
      truncated: truncated || omittedNodes > 0,
      lenses,
      edgeKinds: summarizeEdgeKinds(waveEdges),
      projection: {
        lens: 'wave',
        wave: { total, shown, omittedNodes, truncated: omittedNodes > 0 }
      },
      // 只按**实际画出的**波次子图算关键路径（被 maxWaves 截掉的任务不参与，docs/09 §11.1）。
      criticalPath: criticalPathOf(shownIds, waveEdges)
    }
  }

  // ── chain（缺省，向后兼容）：节点按 id 升序，边全部 depends_on ──────────────
  const levelMap = computeLevels(sortedIds, taskEdges)
  const nodes = sortedIds.map((id) => ({
    ...buildTaskNode(id),
    level: levelMap.get(id) ?? null,
    relation: relation.get(id) ?? null
  }))
  const anomalies = computeTaskAnomalies(keep, taskEdges)

  return {
    lens: 'chain',
    focus: focusInfo,
    depth: Number.isInteger(depth) ? depth : null,
    includeTerminal: includeTerminal === true,
    nodes,
    edges: taskEdges,
    anomalies,
    counts: buildCounts(nodes, taskEdges, anomalies, omitted),
    truncated,
    lenses,
    edgeKinds: summarizeEdgeKinds(taskEdges),
    projection: null,
    // chain 的 projection 保持 null（向后兼容），关键路径挂在响应顶层（docs/09 §11.1）。
    criticalPath: criticalPathOf(sortedIds, taskEdges)
  }
}

/**
 * 强连通分量（Tarjan，迭代式实现）。
 *
 * 813 个任务的全图递归深度可能上千，所以不用递归写法（Node 默认栈在极端深链上会爆）。
 * 只返回「大小 > 1」的分量——大小 1 的分量里只有自环才是异常，而自环已由调用方单独报成 `self`。
 *
 * @param {string[]} nodeIds 已排序的节点 id（保证输出稳定）
 * @param {Map<string, string[]>} adjacency
 * @returns {string[][]} 每个分量内按 id 升序
 */
function findStronglyConnectedComponents(nodeIds, adjacency) {
  const index = new Map()
  const low = new Map()
  const onStack = new Set()
  const stack = []
  const components = []
  let counter = 0

  for (const start of nodeIds) {
    if (index.has(start)) continue
    const work = [[start, 0]]
    while (work.length > 0) {
      const frame = work[work.length - 1]
      const node = frame[0]
      if (frame[1] === 0) {
        index.set(node, counter)
        low.set(node, counter)
        counter += 1
        stack.push(node)
        onStack.add(node)
      }
      const neighbours = adjacency.get(node) ?? []
      let descended = false
      while (frame[1] < neighbours.length) {
        const next = neighbours[frame[1]]
        frame[1] += 1
        if (!index.has(next)) {
          work.push([next, 0])
          descended = true
          break
        }
        if (onStack.has(next)) low.set(node, Math.min(low.get(node), index.get(next)))
      }
      if (descended) continue

      if (low.get(node) === index.get(node)) {
        const component = []
        let member
        do {
          member = stack.pop()
          onStack.delete(member)
          component.push(member)
        } while (member !== node)
        if (component.length > 1) components.push(component.sort())
      }
      work.pop()
      if (work.length > 0) {
        const parent = work[work.length - 1][0]
        low.set(parent, Math.min(low.get(parent), low.get(node)))
      }
    }
  }

  return components.sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''))
}