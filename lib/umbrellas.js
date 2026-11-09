/**
 * 伞目录（umbrella catalog）的数据层：伞键解析 + 标题来源解析（FR-14.3 / docs/09 第 4 节）。
 *
 * 伞是**来源标签**（`source` / `additional_sources` 里的 `idea:` / `roadmap:` / `debug:`），
 * 而不是定义层的独立对象。本模块只做两件事：
 *   ① 把「任务 → 伞 id 集合」算出来（`umbrellaKeyOf` / `umbrellaKeysOf`）；
 *   ② 只读地把伞的**标题**从既有台账文件里解析出来（IDEAS.md / 归档 / ROADMAP.md）。
 *
 * 三条硬纪律（docs/09 4.2）：
 *   1. 标题缺失 → `title = null`、界面退化到 slug 并显式计数，**绝不猜**；
 *   2. **绝不用 module 顶替伞**，也不从任务标题反推；
 *   3. IDEAS.md 与归档件同 slug 时取活跃层（`ideas` 优先），不合并两份正文。
 *
 * 只读：本模块只读文件，不写任何东西（FR-10 / FR-14.10）。
 */

import { createReadStream, readFileSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { ideasArchiveOf, ideasFileOf, parseIdeasMarkdown } from './ideas.js'

/** 合法的伞 kind（引擎 `source` 的三类前缀，docs/03 第 7 节）。 */
export const UMBRELLA_KINDS = Object.freeze(['idea', 'roadmap', 'debug'])

/** roadmap 台账的文件名（候选位置见 docs/09 4.2）。 */
export const ROADMAP_FILENAME = 'ROADMAP.md'

/**
 * 伞 id 的形状：`<kind>:<slug>`。
 *
 * slug 的字符集与任务 id 的 slug 段一致（小写字母/数字/连字符），保证它不会被当成
 * 路径或任务 id 使用（NFR-2.1：路由只接受 `umbrella` 参数、不接受路径）。
 */
export const UMBRELLA_ID_RE = /^(idea|roadmap|debug):([a-z0-9][a-z0-9-]*)$/

/** 归档件里 `- id:` 的裸 slug 形状（不带 kind 前缀）。 */
const BARE_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

/** 标题清洗：去掉 `YYYY-MM-DD` 日期前缀。 */
const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}\s*/

/** 标题清洗：去掉末尾的 `（id: …）` / `(id: …)` 括注（只去壳，不改写正文）。 */
const TRAILING_ID_NOTE_RE = /\s*[（(][^（()）]*id\s*[:：][^（()）]*[）)]\s*$/i

/** ROADMAP.md 里的任意 `#` 级标题。 */
const MARKDOWN_HEADING_RE = /^#{1,6}\s+(.*)$/

/**
 * 标题里的 id 括注（提取 slug 用）。
 *
 * 比「严格 （id: slug）」宽松：真实 ROADMAP.md 里既有 `（id: slug）`，
 * 也有 `（id: slug，出口 v1.6.0）` 与 `· id: slug）`（括注里还塞了说明）。
 * 只认标题行，且 `id` 前必须是词边界，避免把 `valid:` 之类误当 id。
 */
const ID_NOTE_RE = /(?:^|[^\w])id\s*[:：]\s*(?:(?:idea|roadmap|debug):)?([a-z0-9][a-z0-9-]*)/i

/** 含 id 的整个括注（从展示标题里剥掉；括注内可能还有别的说明文字）。 */
const ID_NOTE_STRIP_RE = /[（(][^（()）]*id\s*[:：][^（()）]*[）)]/gi

/** 没包在括号里、直接跟在标题末尾的 `· id: slug`。 */
const DANGLING_ID_NOTE_RE = /[\s·•|—-]*id\s*[:：]\s*(?:(?:idea|roadmap|debug):)?[a-z0-9][a-z0-9-]*[\s.。]*$/i

/** ROADMAP.md 标题的前置编号（`1.` / `1.4.6 ·` / `2、` / `3)`），版本号整段剥掉。 */
const LEADING_ORDINAL_RE = /^\d+(?:\.\d+)*\s*(?:[.、)]\s*)?(?:[·•|—-]\s*)?/

/** 小节头（IDEAS.md 与归档件共用）：`## 标题`。 */
const SECTION_RE = /^##\s+(.*)$/

/**
 * 解析一个伞键。
 *
 * ```text
 * umbrellaKeyOf('idea:orchd-panel') === { kind:'idea', slug:'orchd-panel', id:'idea:orchd-panel' }
 * umbrellaKeyOf('whatever')         === null   // 不猜、不补前缀
 * ```
 *
 * @param {unknown} value
 * @returns {{ kind: string, slug: string, id: string } | null}
 */
export function umbrellaKeyOf(value) {
  if (typeof value !== 'string') return null
  const match = UMBRELLA_ID_RE.exec(value)
  if (match === null) return null
  return { kind: match[1], slug: match[2], id: `${match[1]}:${match[2]}` }
}

/**
 * 任务上的全部伞键（`source` + `additionalSources`，去重升序）。
 *
 * 定义层索引里是驼峰 `additionalSources`，原始 JSON 里是蛇形 `additional_sources`，
 * 两者都认；非字符串项跳过（FR-14.7：缺字段不补、不猜）。
 *
 * @param {object | null | undefined} task
 * @returns {string[]} 伞 id 数组（形如 `idea:x`），没有则为空数组
 */
export function umbrellaKeysOf(task) {
  if (task === null || task === undefined || typeof task !== 'object') return []
  const keys = new Set()
  const absorb = (value) => {
    const parsed = umbrellaKeyOf(value)
    if (parsed !== null) keys.add(parsed.id)
  }
  absorb(task.source)
  const additional = task.additionalSources ?? task.additional_sources
  if (Array.isArray(additional)) {
    for (const item of additional) absorb(item)
  }
  return [...keys].sort((a, b) => a.localeCompare(b))
}

/**
 * 项目层伞 id 全集（定义层 + 状态层任务行）。
 *
 * 路由用它判断 `umbrella=` 是否「未知」：**只认项目里真实出现过的伞**，
 * 不按 slug 形状臆造（docs/09 第 2 节 `unknown-umbrella`）。
 *
 * @param {object[] | undefined} rows `buildBoard` 的 tasks（状态层行，可能没有 additionalSources）
 * @param {Map<string, object> | undefined} tasks 定义层索引的 tasks
 * @returns {Set<string>} 伞 id 集合
 */
export function collectProjectUmbrellaIds(rows, tasks) {
  const ids = new Set()
  const absorb = (task) => {
    for (const id of umbrellaKeysOf(task)) ids.add(id)
  }
  if (tasks instanceof Map) {
    for (const task of tasks.values()) absorb(task)
  }
  if (Array.isArray(rows)) {
    for (const row of rows) absorb(row)
  }
  return ids
}

/**
 * 标题清洗（只去壳）：去日期前缀、去末尾 `（id: …）` 括注、`trim()`。
 *
 * 清洗后为空串 → 视为缺失（返回 `null`），调用方必须把伞退化成 slug 并计数。
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function cleanUmbrellaTitle(raw) {
  if (typeof raw !== 'string') return null
  let title = raw.replace(/\s+$/, '')
  title = title.replace(DATE_PREFIX_RE, '')
  title = title.replace(TRAILING_ID_NOTE_RE, '')
  title = title.trim()
  return title === '' ? null : title
}

/**
 * 从 IDEAS.md 正文解析「slug → 标题」。
 *
 * 复用 `parseIdeasMarkdown`（已处理 HTML 注释块陷阱），这里只投影出标题。
 * 同一 slug 出现多次时取**首次**出现（活跃层内更接近用户最近一次整理）。
 *
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function titlesFromIdeasText(text) {
  const titles = new Map()
  let parsed
  try {
    parsed = parseIdeasMarkdown(typeof text === 'string' ? text : '')
  } catch {
    return titles
  }
  for (const entry of parsed.entries) {
    if (typeof entry.id !== 'string' || entry.id === '') continue
    const title = cleanUmbrellaTitle(entry.title)
    if (title === null) continue
    if (!titles.has(entry.id)) titles.set(entry.id, title)
  }
  return titles
}

/**
 * 从 ROADMAP.md 正文解析「slug → 标题」。
 *
 * 只认带 `（id: <slug>）` / `(id: <slug>)` 括注的任意 `#` 级标题；标题 = 去掉该括注
 * 与前置编号后的文本（docs/09 4.2）。没有括注的标题跳过，不猜归属。
 *
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function titlesFromRoadmapText(text) {
  const titles = new Map()
  const lines = String(text ?? '').split(/\r?\n/)
  for (const rawLine of lines) {
    const heading = MARKDOWN_HEADING_RE.exec(rawLine.trim())
    if (heading === null) continue
    const body = heading[1]
    const note = ID_NOTE_RE.exec(body)
    if (note === null) continue
    const slug = note[1]
    let title = body.replace(ID_NOTE_STRIP_RE, ' ')
    title = title.replace(DANGLING_ID_NOTE_RE, '')
    title = title.replace(LEADING_ORDINAL_RE, '')
    const cleaned = cleanUmbrellaTitle(title)
    if (cleaned === null) continue
    if (!titles.has(slug)) titles.set(slug, cleaned)
  }
  return titles
}

/**
 * **流式**扫描归档件的「slug → 标题」（FR-13.12 的同一纪律：不回读全文）。
 *
 * 归档件是 CRLF 且可能带 HTML 注释块；按 64 KB 块读并拼接跨块的行。
 * 只收小节头 `## 标题` + 该小节第一个 `- id: <裸 slug>`，其余正文一律不解析。
 *
 * @param {string} filePath
 * @param {(error: Error) => void} [onError]
 * @returns {Promise<{ titles: Map<string, string>, count: number, reason: string | null }>}
 */
export function scanArchiveTitles(filePath, onError) {
  return new Promise((resolve) => {
    /** @type {Map<string, string>} */
    const titles = new Map()
    let count = 0
    let sectionTitle = null
    let sectionId = null
    let inComment = false
    let tail = ''
    let stream

    const closeSection = () => {
      if (sectionId === null) return
      const cleaned = cleanUmbrellaTitle(sectionTitle)
      // 同一 slug 只认第一次出现的小节（归档是追加写，越早越接近原始标题）
      if (cleaned !== null && !titles.has(sectionId)) titles.set(sectionId, cleaned)
      sectionId = null
    }

    const consume = (rawLine) => {
      // ⚠ 归档是 CRLF：必须先去掉行尾空白，否则行尾的 `\r` 会污染标题与 id 判定
      const line = rawLine.replace(/\s+$/, '')
      if (inComment) {
        if (line.includes('-->')) inComment = false
        return
      }
      if (line.includes('<!--')) {
        if (!line.includes('-->')) inComment = true
        return
      }
      if (line.startsWith('## ')) {
        closeSection()
        count += 1
        sectionTitle = line.slice(3).trim()
        return
      }
      if (sectionTitle === null || sectionId !== null) return
      const idMatch = /^[-*]\s+id\s*[:：]\s*(.+)$/.exec(line)
      if (idMatch === null) return
      const value = idMatch[1].trim()
      if (BARE_SLUG_RE.test(value)) sectionId = value
    }

    const done = (reason, detail) => {
      closeSection()
      resolve({ titles, count, reason, ...(detail === undefined ? {} : { detail }) })
    }

    try {
      const stat = statSync(filePath)
      if (!stat.isFile()) {
        resolve({ titles, count: 0, reason: 'not-a-file' })
        return
      }
    } catch {
      resolve({ titles, count: 0, reason: 'archive-missing' })
      return
    }
    try {
      stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 })
    } catch (error) {
      resolve({ titles, count: 0, reason: 'archive-unreadable', detail: String(error) })
      return
    }
    stream.on('data', (chunk) => {
      const text = tail + chunk
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
 * 合并三处来源的标题，得到**伞目录**。
 *
 * 合并顺序即优先级：roadmap / 归档 → IDEAS.md 活跃层（活跃层最后写入，覆盖归档同 slug）。
 * 目录形状：`{ titles: Map<umbrellaId, { title, titleSource }>, layers, paths }`。
 *
 * @param {{ ideasTitles?: Map<string,string>, archiveTitles?: Map<string,string>, roadmapTitles?: Map<string,string>, layers?: object, paths?: object }} [options]
 * @returns {{ titles: Map<string, { title: string, titleSource: string }>, layers: object, paths: object }}
 */
export function mergeUmbrellaCatalog({ ideasTitles, archiveTitles, roadmapTitles, layers = {}, paths = {} } = {}) {
  const titles = new Map()
  const put = (kind, slug, title, titleSource) => {
    if (typeof slug !== 'string' || !BARE_SLUG_RE.test(slug)) return
    if (typeof title !== 'string' || title === '') return
    titles.set(`${kind}:${slug}`, { title, titleSource })
  }
  if (roadmapTitles instanceof Map) {
    for (const [slug, title] of roadmapTitles) put('roadmap', slug, title, 'roadmap')
  }
  if (archiveTitles instanceof Map) {
    for (const [slug, title] of archiveTitles) put('idea', slug, title, 'ideas-archive')
  }
  if (ideasTitles instanceof Map) {
    for (const [slug, title] of ideasTitles) put('idea', slug, title, 'ideas')
  }
  return { titles, layers, paths }
}

/**
 * 从伞目录里取一个伞的标题（缺失返回 `null`，调用方必须退化并计数）。
 *
 * 目录可以是 `mergeUmbrellaCatalog` 的结果，也可以直接是 `Map<umbrellaId, {title,titleSource}>`
 * （测试与注入点用后者更省事）。
 *
 * @param {object | Map<string, object> | null | undefined} catalog
 * @param {string} umbrellaId
 * @returns {{ title: string | null, titleSource: string | null }}
 */
export function umbrellaTitleOf(catalog, umbrellaId) {
  if (catalog === null || catalog === undefined) return { title: null, titleSource: null }
  const table = catalog instanceof Map
    ? catalog
    : (catalog.titles instanceof Map ? catalog.titles : null)
  if (table === null) return { title: null, titleSource: null }
  const hit = table.get(umbrellaId)
  if (hit === null || hit === undefined) return { title: null, titleSource: null }
  if (typeof hit === 'string') return { title: hit === '' ? null : hit, titleSource: null }
  const title = typeof hit.title === 'string' && hit.title !== '' ? hit.title : null
  return {
    title,
    titleSource: title === null ? null : (typeof hit.titleSource === 'string' ? hit.titleSource : null)
  }
}

/** 读文本文件；失败不抛（返回 reason 供上层降级）。 */
function readTextQuiet(path) {
  try {
    return { text: readFileSync(path, 'utf8'), reason: null }
  } catch (error) {
    const code = error?.code
    if (code === 'ENOENT') return { text: '', reason: 'missing' }
    if (code === 'EISDIR') return { text: '', reason: 'missing' }
    return { text: '', reason: 'unreadable' }
  }
}

/**
 * 默认的伞目录加载器（只读）：按 docs/09 4.2 的文件候选顺序取标题。
 *
 * IDEAS.md 与归档件都在 `<mainWorktree>/.orchd/` 下；roadmap 依次尝试
 * `<mainWorktree>/ROADMAP.md` → `<dirname(mainWorktree)>/ROADMAP.md` →
 * `<mainWorktree>/.orchd/ROADMAP.md`，**命中即止**（存在即停，避免拿到别的项目的台账）。
 *
 * 路由侧可用 `deps.loadUmbrellaCatalog` 注入替身，测试不必读真实文件。
 *
 * @param {{ mainWorktree?: string }} [options]
 */
export async function loadUmbrellaCatalog({ mainWorktree } = {}) {
  if (typeof mainWorktree !== 'string' || mainWorktree === '') {
    return mergeUmbrellaCatalog({
      layers: { ideas: 'missing', archive: 'missing', roadmap: 'missing' },
      paths: { ideas: null, archive: null, roadmap: null }
    })
  }

  const ideasPath = ideasFileOf(mainWorktree)
  const archivePath = ideasArchiveOf(mainWorktree)
  const roadmapCandidates = [
    `${mainWorktree}/${ROADMAP_FILENAME}`,
    `${dirname(mainWorktree)}/${ROADMAP_FILENAME}`,
    `${mainWorktree}/.orchd/${ROADMAP_FILENAME}`
  ]

  const ideas = readTextQuiet(ideasPath)
  const archive = await scanArchiveTitles(archivePath)

  let roadmap = { text: '', reason: 'roadmap-missing', path: null }
  for (const candidate of roadmapCandidates) {
    const file = readTextQuiet(candidate)
    if (file.reason === null) {
      roadmap = { text: file.text, reason: null, path: candidate }
      break
    }
  }

  return mergeUmbrellaCatalog({
    ideasTitles: titlesFromIdeasText(ideas.text),
    archiveTitles: archive.titles,
    roadmapTitles: titlesFromRoadmapText(roadmap.text),
    layers: {
      ideas: ideas.reason === null ? 'ok' : ideas.reason,
      archive: archive.reason === null ? 'ok' : archive.reason,
      roadmap: roadmap.reason === null ? 'ok' : roadmap.reason
    },
    paths: { ideas: ideasPath, archive: archivePath, roadmap: roadmap.path }
  })
}
