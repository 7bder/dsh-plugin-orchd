/**
 * IDEAS 想法看板的数据层（FR-13）。
 *
 * 依据 docs/02 第 7.1/7.2 节与 docs/01 FR-13。三层取数：
 *   ① 清单 ← `ideas list`（白名单命令，**只返回 title / id / status** 三个字段）
 *   ② 正文 ← 直读 `<主工作树>/.orchd/IDEAS.md`（引擎 CLI 拿不到正文）
 *   ③ 归档计数 ← 流式数 `IDEAS-archive.md` 的 `## ` 行（**只计数**，全文不进默认加载路径）
 *
 * 三个必须处理的实测陷阱（参考项目 `C:\VibeCoding\orchestra` 实读）：
 *   1. **必须跳过 HTML 注释块**：文件里明写「摄入 agent 必须跳过 HTML 注释内的内容」，
 *      而注释块里恰好躺着一条格式示例条目。实测全文件 `- id:` 有 7 行，真实条目只有 6 条
 *      ——不跳注释就会凭空多出一条假条目（AC-13.5）。
 *   2. **未知字段必须原样保留**：`notes` 会以 `- notes追记 <ISO 时间戳>:` 形式多行追加，
 *      字段集合会演进，不能用白名单读取（FR-13.5）。
 *   3. **归档不能当状态分布用**：`IDEAS-archive.md` 543 KB / 372 个 `## `，其中 311 条仍写着
 *      `pending`——归档保留原文，`status` 是**历史值**（AC-13.1/13.9）。
 *
 * 状态词表（引擎 2026-10-23 调整后）：`study` / `questioning` / `pending` / `covered`。
 *   · `taskified` 已正名为 `covered`（语义：被既有任务覆盖 / 撞车并入，待归档）；
 *   · `dropped` 已从活跃台账下线（「放弃」改由 `idea close --reason` 一次离场归档）。
 * 老引擎写下的 `taskified` / `dropped` 会按未知状态走降级路径（原文进 `extra`），
 *   不静默改写、不猜测映射。
 *
 * 只读：本模块只读文件，不写任何东西（FR-10 / FR-13.8）。
 */

import { createReadStream, statSync } from 'node:fs'

const IDEAS_FILENAME = 'IDEAS.md'
const ARCHIVE_FILENAME = 'IDEAS-archive.md'

/**
 * 引擎定义的 4 个状态（不得自造）。
 *
 * `covered` 取代旧词 `taskified`：**只**表示「撞车并入已有任务，待归档」，
 * **不是**「已注册 / 已立任务」的标记（引擎 `rules/intake.md` ①）。
 * 旧的 `dropped` 已从活跃台账下线（引擎 `task-intake-exit-verb-close`）。
 */
export const IDEA_STATUSES = Object.freeze(['study', 'questioning', 'pending', 'covered'])

/**
 * 派生桶（**不是引擎状态**）：任务定义层有 `source`/`additional_sources` 指向该想法。
 *
 * 为什么必须单列：`status` 只表达摄入/裁决态。被非终态任务引用的条目按 E025
 * **必须保持 `pending`**，所以「已转任务」只能由定义层溯源推出（FR-13.3b）。
 * 它不能复用 `covered`——`covered` 是「撞车并入已有任务」，两者语义不同。
 */
export const IDEA_CONVERTED_STATUS = 'converted'

/** 统计条与行标签使用的展示桶：4 个引擎状态 + 1 个派生桶（顺序按生命周期）。 */
export const IDEA_DISPLAY_STATUSES = Object.freeze([
  'study', 'questioning', 'pending', IDEA_CONVERTED_STATUS, 'covered'
])

/**
 * 「在等谁」由展示桶派生，**不是引擎字段**（FR-13.4）。
 * 徽章数 = 等用户的那两个状态之和，不是总条目数（FR-13.2）。
 *
 * `covered` / `converted` 都已有人接手（并入既有任务 / 已拆出新任务），故为 `none`。
 */
export const IDEA_OWNER = Object.freeze({
  study: 'user',
  questioning: 'user',
  pending: 'agent',
  [IDEA_CONVERTED_STATUS]: 'none',
  covered: 'none'
})


/**
 * 从任务定义层建「想法 id → 任务 id[]」的溯源索引（FR-13.3b / docs/03 E025）。
 *
 * 为什么必须靠定义层：**`status` 不是「是否已立任务」的标记**。引擎 `rules/intake.md` 明确：
 *   · `source: idea:<id>` 的条目在任务非终态期间**必须保持 `pending`**（E025 硬约束）；
 *   · `covered` **并非「已注册」语义**，只服务「撞车并入已有任务」。
 * 实测 `phase-workflow-engineering` 在 `IDEAS.md` 里写着 `pending`（这是**正确**的，
 * 它的 3 个任务都未终态），但定义层已有 3 个 `source: idea:phase-workflow-engineering`。
 * 只看 status 的话，这条已经立成任务的想法会被算进「活跃 / 待拆解」（用户实测发现）。
 *
 * ⚠ 引用判据必须覆盖**两个字段**：`source` **∪** `additional_sources`。
 * 引擎 `rules/intake.md` ④ 的在途引用判据就是 `source`/`additional_sources` 两者；
 * 实测参考项目有 **11 个想法 id 只出现在 `additional_sources` 里**，只查 `source` 会漏判。
 *
 * @param {Map<string, object>} tasks 定义层索引的 tasks（`index.tasks`）
 * @returns {Map<string, string[]>} 想法 id → 引用它的任务 id（去重）
 */
export function buildIdeaTaskIndex(tasks) {
  const index = new Map()
  if (!(tasks instanceof Map)) return index
  const add = (ideaId, taskId) => {
    if (typeof ideaId !== 'string') return
    const id = ideaId.trim()
    if (id === '') return
    if (!index.has(id)) index.set(id, [])
    const list = index.get(id)
    if (!list.includes(taskId)) list.push(taskId)
  }
  for (const [taskId, task] of tasks) {
    const source = task?.source
    if (typeof source === 'string' && source.startsWith('idea:')) add(source.slice('idea:'.length), taskId)
    // 定义层索引里是驼峰 `additionalSources`，原始 JSON 里是蛇形 `additional_sources`——两者都认
    const additional = task?.additionalSources ?? task?.additional_sources
    const list = Array.isArray(additional) ? additional : (typeof additional === 'string' ? [additional] : [])
    for (const item of list) {
      if (typeof item === 'string' && item.startsWith('idea:')) add(item.slice('idea:'.length), taskId)
    }
  }
  return index
}

/**
 * 把「定义层溯源」叠加到条目上，得到**展示桶**（不改写引擎的 `status`）。
 *
 * 只要这个想法 id 在任务定义层出现过，就额外标记 `converted: true` 并把
 * `displayStatus` 置为派生桶 `converted`；`status` / `rawStatus` 仍是文件里的字面值
 * （被非终态任务引用的条目按 E025 必须保持 `pending`，这不是滞后）。
 *
 * @param {object[]} entries `mergeIdeasList` 的结果
 * @param {Map<string, string[]>} ideaTaskIndex `buildIdeaTaskIndex` 的结果
 */
export function attachConvertedTasks(entries, ideaTaskIndex) {
  return entries.map((entry) => {
    const convertedTasks = typeof entry.id === 'string' ? (ideaTaskIndex.get(entry.id) ?? []) : []
    const converted = convertedTasks.length > 0
    const displayStatus = converted ? IDEA_CONVERTED_STATUS : entry.status
    return {
      ...entry,
      rawStatus: entry.rawStatus ?? entry.status,
      convertedTasks,
      converted,
      displayStatus,
      owner: displayStatus === null ? 'none' : (IDEA_OWNER[displayStatus] ?? 'none')
    }
  })
}

export function ideasFileOf(mainWorktree) {
  return `${mainWorktree}/.orchd/${IDEAS_FILENAME}`
}

export function ideasArchiveOf(mainWorktree) {
  return `${mainWorktree}/.orchd/${ARCHIVE_FILENAME}`
}

/** `## YYYY-MM-DD 标题` 的小节头。 */
const SECTION_RE = /^##\s+(.*)$/
/** 日期前缀（条目**没有独立日期字段**，日期在标题里）。 */
const DATE_RE = /^(\d{4}-\d{2}-\d{2})\s*/
/** `- key: value` 形态的字段行。key 允许中英文与驼峰（`论证` 是中文键）。 */
const FIELD_RE = /^[-*]\s+([^\s:：][^:：]*?)\s*[:：]\s*(.*)$/
/** `- notes追记 <ISO 时间戳>:` 形态（**无冒号紧跟在键名后**，键名里含时间戳）。 */
const NOTES_APPEND_RE = /^[-*]\s+(notes追记\s+\S+)\s*[:：]\s*(.*)$/

/**
 * 把 Markdown 正文解析成条目数组。
 *
 * 解析是**容错**的：任何一段正文结构不对，只把那条标 `degraded`（FR-13.11），
 * 其余条目照常渲染。
 *
 * @param {string} text IDEAS.md 全文
 * @returns {{entries: object[], skippedCommentSections: number, degraded: number}}
 */
export function parseIdeasMarkdown(text) {
  const lines = String(text).split(/\r?\n/)
  const entries = []
  let current = null
  let inComment = false
  let skippedCommentSections = 0

  const push = () => {
    if (current !== null) entries.push(finalizeEntry(current))
    current = null
  }

  for (const rawLine of lines) {
    // ① HTML 注释块：整段跳过（陷阱 1）。用「出现 <!-- 到 -->」的简单状态机，
    //    因为实测文件里注释块是独立的行（`<!--` 与 `-->` 各占一行）。
    if (!inComment && rawLine.includes('<!--')) {
      inComment = true
      // 同一行里就闭合的情况（`<!-- … -->`）
      if (rawLine.includes('-->')) inComment = false
      continue
    }
    if (inComment) {
      // 注释块里的小节头必须计数并跳过，用来断言「示例条目没被当条目」
      if (SECTION_RE.test(rawLine.trim())) skippedCommentSections += 1
      if (rawLine.includes('-->')) inComment = false
      continue
    }

    const line = rawLine.replace(/\s+$/, '')
    const sectionMatch = SECTION_RE.exec(line)
    if (sectionMatch !== null) {
      push()
      current = { title: sectionMatch[1].trim(), fields: [], notes: [], extra: {} }
      continue
    }
    if (current === null) continue // 文件头与说明文字

    if (line.trim() === '') continue // 段落内的空行不结束条目（正文可能多段）

    // ② notes 追记（多行追加）：键名里带时间戳，必须单独识别（陷阱 2）
    const notesMatch = NOTES_APPEND_RE.exec(line)
    if (notesMatch !== null) {
      current.notes.push(notesMatch[2].trim())
      continue
    }

    const fieldMatch = FIELD_RE.exec(line)
    if (fieldMatch !== null) {
      current.fields.push({ key: fieldMatch[1].trim(), value: fieldMatch[2].trim() })
      continue
    }
    // 续行：追加到上一个字段（Markdown 里长正文会折行）
    if (current.fields.length > 0) {
      const last = current.fields[current.fields.length - 1]
      last.value = `${last.value}\n${line.trim()}`
    }
  }
  push()

  return { entries, skippedCommentSections, degraded: entries.filter((entry) => entry.degraded).length }
}

/** 把「小节 + 字段列表」整形成 `IdeaEntry`。 */
function finalizeEntry(raw) {
  const extra = {}
  let id = null
  let status = null
  let goal = null
  let idea = null
  let argument = null
  let detail = null

  const take = (value) => (value === '' ? null : value)

  for (const { key, value } of raw.fields) {
    switch (key) {
      case 'id':
        id = take(value)
        break
      case 'status':
        // 引擎可能有新状态 → 不认识就置 null 并保留原文到 extra（不抛错、不臆造）
        status = IDEA_STATUSES.includes(value) ? value : null
        if (status === null) extra.status = value
        break
      case 'goal':
        goal = take(value)
        break
      case 'idea':
        idea = take(value)
        break
      case '论证':
      case 'argument':
        argument = take(value)
        break
      case 'detail':
        detail = take(value)
        break
      case 'notes':
        raw.notes.unshift(take(value) ?? '')
        break
      default:
        // 陷阱 2：未知字段**原样保留**，不能用白名单丢掉
        extra[key] = value
        break
    }
  }

  const dateMatch = DATE_RE.exec(raw.title)
  // 标题去掉日期前缀，作为展示标题
  const title = dateMatch === null ? raw.title : raw.title.slice(dateMatch[0].length).trim()
  const owner = status === null ? 'none' : IDEA_OWNER[status]

  // 降级判定（FR-13.11）：没有 id 或缺 status 就只给「标题 + id + 状态」
  const degraded = id === null || status === null

  return {
    id,
    title,
    date: dateMatch === null ? null : dateMatch[1],
    status,
    owner,
    goal,
    idea,
    argument,
    detail,
    notes: raw.notes.filter((note) => note !== ''),
    extra,
    degraded
  }
}

/**
 * 汇总计数 + 徽章数（FR-13.2）。
 *
 * `byStatus` 按**展示桶**计数：4 个引擎状态 + 派生桶 `converted`（已转任务）。
 * 已转任务的条目不会同时计入 `pending`，因此三分区闭合：
 *   `全部 = 活跃 + 已转任务 + 已覆盖`（未知状态另计，不进分区）
 *   `活跃 = 论证中 + 待补充 + 待拆解`
 * `covered` 不计入活跃：它表示「已并入既有任务，待用户 close 归档」。
 */
export function summarizeIdeas(entries) {
  const byStatus = {}
  for (const status of IDEA_DISPLAY_STATUSES) byStatus[status] = 0
  let unknown = 0
  for (const entry of entries) {
    const display = entry.displayStatus ?? (entry.converted === true ? IDEA_CONVERTED_STATUS : entry.status)
    if (display === null || display === undefined || byStatus[display] === undefined) unknown += 1
    else byStatus[display] += 1
  }
  return {
    byStatus,
    unknown,
    needsUser: byStatus.study + byStatus.questioning,
    total: entries.length,
    /** 活跃 = 尚未转成任务、也未被覆盖的条目（FR-13.6b） */
    active: byStatus.study + byStatus.questioning + byStatus.pending,
    /** 已转任务（活跃层内）—— 由定义层溯源推出，不是归档计数 */
    converted: byStatus[IDEA_CONVERTED_STATUS],
    /** 已覆盖（活跃层内）—— 撞车并入既有任务，待 close 归档 */
    covered: byStatus.covered
  }
}

/**
 * 统计条要渲染的芯片状态集合（FR-13.6）。
 *
 * 固定为**全部展示桶**（0 值可点，FR-5.9），因为统计条必须能完整表达三分区：
 *   `全部 = 活跃 + 已转任务 + 已覆盖`，其中 `活跃 = 论证中 + 待补充 + 待拆解`。
 * 早先试过「只显示实际出现过的状态」以避免恒 0 芯片，但那会让分区在界面上不闭合
 * （例如 已覆盖 缺失时看不出 0 是「没有」还是「没显示」）——用户要求分区自洽，故固定。
 */
export function ideaStripStatuses() {
  return [...IDEA_DISPLAY_STATUSES]
}

/**
 * **流式**扫描归档文件（FR-13.12：全文不进内存、不解析条目正文）。
 *
 * 一次遍历得到三样东西：
 *   - `count`：小节数（`## ` 行）；
 *   - `idCount` / `noIdCount`：有 / 无 `- id:` 的小节数（协议要求 `id` 必填，
 *     实测参考项目有 20 条存量缺 id，必须**显式计数**而不是静默丢弃）；
 *   - `ids`：小节里的 `- id:` 值（用于与任务池对照，见 `classifyArchive`）；
 *   - `byStatus`：`- status:` 的**字面**计数 —— ⚠ 这是历史值（归档保留原文，
 *     引擎明确「不改写 status」，语义是「已消费」），只作诊断，**不得当作分组依据**。
 *
 * 按 64 KB 块读并拼接跨块的行；543 KB / 373 条实测 ~5–10 ms。
 *
 * @param {string} filePath
 * @param {(err: Error) => void} [onError]
 * @returns {Promise<{count: number, ids: string[], noIdCount: number, byStatus: Record<string, number>, reason: string|null}>}
 */
export function scanArchiveFile(filePath, onError) {
  return new Promise((resolve) => {
    let count = 0
    let noIdCount = 0
    /** @type {string[]} */
    const ids = []
    /** @type {Record<string, number>} */
    const byStatus = {}
    /** @type {Record<string, string>} 小节 id → 该小节字面 status（判定「历史已放弃」要用） */
    const statusById = {}
    /** 当前小节的 id / 首个 status（小节只有第一个 `- id:` / `- status:` 算数） */
    let sectionId = null
    let sectionStatus = null
    let tail = ''
    let stream

    /** 收尾当前小节：结算「缺 id」计数并登记 id → status。 */
    const closeSection = () => {
      if (count === 0) return
      if (sectionId === null) noIdCount += 1
      else if (sectionStatus !== null) statusById[sectionId] = sectionStatus
    }

    const consume = (rawLine) => {
      // ⚠ 归档是 CRLF：必须先去掉行尾空白，否则 `(.+)$` 里的 `.` 匹配不到 `\r`
      //   （`.` 和 `$` 都不认 `\r`），每一行都会被判成「没有 id」（实测踩过两次）。
      const line = rawLine.replace(/\s+$/, '')
      if (line.startsWith('## ')) {
        closeSection()
        count += 1
        sectionId = null
        sectionStatus = null
        return
      }
      if (count === 0) return
      if (sectionId === null) {
        const idMatch = /^[-*]\s+id\s*[:：]\s*(.+)$/.exec(line)
        if (idMatch !== null) {
          const value = idMatch[1].trim()
          if (value !== '') {
            sectionId = value
            ids.push(value)
          }
        }
      }
      const statusMatch = /^[-*]\s+status\s*[:：]\s*(\S+)/.exec(line)
      if (statusMatch !== null) {
        const value = statusMatch[1]
        byStatus[value] = (byStatus[value] ?? 0) + 1
        if (sectionStatus === null) sectionStatus = value
      }
    }

    const done = (reason, detail) => {
      closeSection()
      resolve({ count, ids, noIdCount, byStatus, statusById, reason, ...(detail === undefined ? {} : { detail }) })
    }

    try {
      const stat = statSync(filePath)
      if (!stat.isFile()) {
        resolve({ count: 0, ids, noIdCount: 0, byStatus, reason: 'not-a-file' })
        return
      }
    } catch {
      resolve({ count: 0, ids, noIdCount: 0, byStatus, reason: 'archive-missing' })
      return
    }
    try {
      stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 })
    } catch (error) {
      resolve({ count: 0, ids, noIdCount: 0, byStatus, reason: 'archive-unreadable', detail: String(error) })
      return
    }
    stream.on('data', (chunk) => {
      const text = tail + chunk
      // 保留最后一行（可能被截断），下次拼接
      const lastBreak = text.lastIndexOf('\n')
      const complete = lastBreak >= 0 ? text.slice(0, lastBreak + 1) : ''
      tail = lastBreak >= 0 ? text.slice(lastBreak + 1) : text
      for (const line of complete.split('\n')) consume(line)
    })
    stream.on('error', (error) => {
      onError?.(error)
      done('archive-unreadable', String(error))
    })
    stream.on('end', () => done(null))
  })
}

/**
 * 归档分组：**与任务池对照**判定「已转任务」（用户定的口径 / FR-13.7）。
 *
 * 为什么不能按归档件里的字面 `- status:` 分组：引擎明确归档**不改写** status
 * （`rules/intake.md`：归档语义是「已消费」而非某个状态值），实测 312/373 条仍写着
 * `pending`——按字面分组会把它们全算成「没立任务」，而其中 287 条在任务池里有引用。
 *
 * 分组（互斥，合计 = `count`）：
 *   已转任务   converted       任务池（`source` ∪ `additional_sources`）引用了该 id
 *   历史已放弃 legacyDropped   未被引用，且字面 status = dropped（**旧词表遗留数据**）
 *   未立任务   untasked        未被引用（人工 `idea close` 裁决离场，含 covered/pending/study）
 *   无法对照   noId            小节缺 `- id:`，无从判断（实测存量 20 条）
 *
 * ⚠ `dropped` 已从引擎词表下线，分组里的 `legacyDropped` 只统计**入档历史值**，
 * 不代表当前状态机还有这个状态。
 *
 * @param {{count: number, ids: string[], noIdCount: number, statusById?: Record<string, string>}} scan `scanArchiveFile` 的结果
 * @param {Map<string, string[]>} ideaTaskIndex `buildIdeaTaskIndex` 的结果
 * @param {Record<string, string>} [statusByIdOverride] 覆盖 scan 里的 id → 字面 status（测试用）
 */
export function classifyArchive(scan, ideaTaskIndex, statusByIdOverride) {
  // 「历史已放弃」要按**归档件自己的**字面 status 判（不能拿 IDEAS.md 的状态表来查，那是活跃层文件）
  const statusById = statusByIdOverride ?? scan.statusById ?? {}
  let converted = 0
  let legacyDropped = 0
  let untasked = 0
  for (const id of scan.ids ?? []) {
    if (ideaTaskIndex instanceof Map && ideaTaskIndex.has(id)) {
      converted += 1
      continue
    }
    if (statusById[id] === 'dropped') legacyDropped += 1
    else untasked += 1
  }
  const noId = Math.max(0, scan.count - (scan.ids?.length ?? 0))
  return {
    total: scan.count,
    converted,
    legacyDropped,
    untasked,
    noId: Math.max(noId, scan.noIdCount ?? 0)
  }
}

export { IDEAS_FILENAME, ARCHIVE_FILENAME }
