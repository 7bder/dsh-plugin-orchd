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
export function buildBoard({ statusJson, poolJson, index, masterPath }) {
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
    rows.push(buildTaskRow(definition, state, { blockedDownstream: blockedByTask.get(id) }, weights))
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
      hasStateLayer: stateRows.size > 0
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
 * 排序。默认按「活跃优先，其次重要度」（FR-5.4）。
 * @param {object[]} rows 原地排序
 * @param {'default'|'importance'|'difficulty'|'module'|'status'} by
 */
export function sortRows(rows, by = 'default', weights = null) {
  const statusRank = (status) => (ACTIVE_STATUSES.has(status) ? 0 : TERMINAL_STATUSES.has(status) ? 2 : 1)
  const comparators = {
    default: (a, b) =>
      statusRank(a.status) - statusRank(b.status) ||
      importanceRank(b.importance ?? b.importanceDerived, weights) - importanceRank(a.importance ?? a.importanceDerived, weights) ||
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

/**
 * 组装依赖图（FR-7）。
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
 * @param {object} args
 * @param {object} args.index 定义层索引（`buildDefinitionIndex` 的结果，可能 undefined）
 * @param {object[]} args.rows `buildBoard` 的 `tasks`（TaskRow[]）
 * @param {string|null} [args.focus] 聚焦的任务 id
 * @param {number|null} [args.depth] 聚焦闭包的层数；`null` = 全闭包
 * @param {boolean} [args.includeTerminal] 是否把终态任务也画进来
 * @param {number} [args.maxNodes]
 */
export function buildGraph({ index, rows, focus = null, depth = null, includeTerminal = false, maxNodes = GRAPH_MAX_NODES }) {
  const rowById = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row !== null && typeof row === 'object' && typeof row.id === 'string' && !rowById.has(row.id)) rowById.set(row.id, row)
  }

  const definitions = index?.tasks instanceof Map ? index.tasks : new Map()

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
  if (keep.size > maxNodes) {
    const rank = (id) => (id === focus ? 0 : (relation.get(id) === 'seed' ? 1 : 2))
    const ordered = [...keep].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    const allowed = new Set(ordered.slice(0, maxNodes))
    omitted = keep.size - allowed.size
    keep = allowed
    truncated = true
  }

  const visibleEdges = edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to))

  // ── 分层：子图内 Kahn 逐层剥离。环上与「被环卡住」的节点拿不到层级（level = null）──
  const level = new Map()
  {
    const indegree = new Map()
    const adjacency = new Map()
    for (const id of keep) {
      indegree.set(id, 0)
      adjacency.set(id, [])
    }
    for (const edge of visibleEdges) {
      if (edge.from === edge.to) continue
      adjacency.get(edge.from).push(edge.to)
      indegree.set(edge.to, indegree.get(edge.to) + 1)
    }
    const queue = []
    for (const id of keep) {
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
  }

  const nodes = [...keep].sort((a, b) => a.localeCompare(b)).map((id) => {
    const row = rowById.get(id)
    const definition = definitions.get(id)
    const missing = row === undefined
    return {
      id,
      name: row?.name ?? definition?.name ?? null,
      status: row?.status ?? null,
      module: row?.module ?? definition?.module ?? null,
      importance: row?.importance ?? definition?.importance ?? null,
      importanceDerived: row?.importanceDerived ?? null,
      // FR-7.3 的下游阻塞数**必须**是引擎口径（`pool --all` 的 blocked_downstream_count，
      // 语义是「被多少 pending 下游依赖」）。引擎没给就是 null——绝不用直接边数冒充它。
      blockedDownstream: typeof row?.blockedDownstream === 'number' ? row.blockedDownstream : null,
      terminal: isTerminalStatus(row?.status),
      inDefinition: row?.inDefinition === true || (missing && definitions.has(id)),
      inState: row?.inState === true,
      /** 悬空依赖的占位节点（任务不存在，只在图上表达「这里指向了不存在的东西」）。 */
      missing,
      level: level.get(id) ?? null,
      relation: relation.get(id) ?? null
    }
  })

  const anomalies = []
  for (const id of [...selfIds].filter((value) => keep.has(value)).sort()) {
    anomalies.push({ kind: 'self', ids: [id] })
  }
  for (const id of [...danglingIds].filter((value) => keep.has(value)).sort()) {
    anomalies.push({ kind: 'dangling', ids: [id] })
  }
  // 环：只在**自环以外**的强连通分量里找（自环已经单独报成 self，不重复报）
  {
    const adjacency = new Map()
    for (const id of keep) adjacency.set(id, [])
    for (const edge of visibleEdges) {
      if (edge.from === edge.to) continue
      if (!keep.has(edge.from) || !keep.has(edge.to)) continue
      adjacency.get(edge.from).push(edge.to)
    }
    for (const component of findStronglyConnectedComponents([...keep].sort(), adjacency)) {
      anomalies.push({ kind: 'cycle', ids: component })
    }
  }
  anomalies.sort((a, b) => a.kind.localeCompare(b.kind) || (a.ids[0] ?? '').localeCompare(b.ids[0] ?? ''))

  const terminalNodes = nodes.filter((node) => node.terminal).length
  // 没画出来的终态任务数：项目里终态总数 − 图上终态节点数（截断掉的也计在内）
  const projectTerminal = [...rowById.values()].filter((row) => isTerminalStatus(row.status)).length

  return {
    focus: focusInfo,
    depth: Number.isInteger(depth) ? depth : null,
    includeTerminal: includeTerminal === true,
    nodes,
    edges: visibleEdges,
    anomalies,
    counts: {
      nodes: nodes.length,
      edges: visibleEdges.length,
      projectTasks: rowById.size,
      activeSeeds: seedIds.length,
      terminalNodes,
      hiddenTerminal: Math.max(0, projectTerminal - terminalNodes),
      /** 因节点上限被丢掉的节点数（UI 必须说明，FR-7.6）。 */
      omittedByLimit: omitted,
      anomaly: {
        cycle: anomalies.filter((item) => item.kind === 'cycle').length,
        self: anomalies.filter((item) => item.kind === 'self').length,
        dangling: anomalies.filter((item) => item.kind === 'dangling').length
      }
    },
    truncated
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