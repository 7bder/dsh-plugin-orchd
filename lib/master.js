/**
 * 定义层（「_master.json」）定位与读取。
 *
 * 依据 docs/03 第 3.3 节与 docs/02 第 4.5 节：插件只复刻**最小必要**的一小段布局逻辑，
 * 其余交给引擎自己的入口。这里只回答三件事：安装痕迹在哪、定义文件在哪、能不能解析。
 *
 * 三段路径（docs/03 第 3.2 节，参考项目三套路径必须区分）：
 *   工作区根/容器根 → 主工作树（git 仓库根）→ 运行时根（账本所在）
 * 「container」 布局下第一段与第二段不同，且 「.orchd」 可能是 junction，
 * 所以比较与缓存一律用 canonicalPath（fs.realpath 归一）。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { canonicalPath, isDirectory, isFile } from './paths.js'

/** 定义文件名（引擎的固定名）。 */
export const MASTER_FILENAME = '_master.json'
/** 布局标记文件名。 */
export const LAYOUT_FILENAME = '.layout.json'
/** 引擎入口文件名（唯一允许的调用点，docs/03 第 2 节）。 */
export const LAUNCHER_FILENAME = '__main__.py'

/** 安装痕迹候选：项目根下的 「.orchd/」（flat 与 container 都靠它）。 */
export function orchdDirOf(root) {
  return join(root, '.orchd')
}

/** 布局标记文件路径。 */
export function layoutFileOf(root) {
  return join(orchdDirOf(root), LAYOUT_FILENAME)
}

/** 引擎入口路径（调用点的 cwd = 项目根，见 docs/03 第 3.4 节）。 */
export function launcherOf(root) {
  return join(orchdDirOf(root), LAUNCHER_FILENAME)
}

/**
 * 安装痕迹判定（T6 的定稿）：项目根下存在 「.orchd」 目录即算「有痕迹」。
 * 不把 junction/符号链接排除在外——参考项目的 「.orchd」 正是指向真实目录的 junction。
 * @param {string} root
 * @returns {boolean}
 */
export function hasInstallationTrace(root) {
  return isDirectory(orchdDirOf(root))
}

/**
 * 自动探测「容器布局的主工作树」（FR-2.2 补充，用户实测驱动）。
 *
 * 场景：会话根是**容器根**，但布局标记只存在于主工作树里
 * （`<root>/main/.orchd/.layout.json`），而根自己的 `.orchd/` 可能是**空目录**
 * （引擎会在容器根建这个目录）。实测两个项目：
 *   · 参考项目：容器根也有 `.orchd/.layout.json` → 旧逻辑能识别；
 *   · 新项目：容器根 `.orchd/` 是空的、标记只在 `main/` 下 → 旧逻辑当成 flat
 *     → 找不到 `_master.json` → 面板显示「未初始化」（用户报的「识别不出来」）。
 *
 * 因此：根上没有可用安装时，**扫一层子目录**找主工作树。判据按强度排序：
 *   3 = 子目录自己的 `.layout.json` 声明 `container` 且 `main_worktree` 指向自己（自我声明，最可信）
 *   2 = 子目录 `.orchd/` 里有 `_master.json`（有定义文件）
 *   1 = 子目录 `.orchd/` 里有 `__main__.py`（有引擎但还没定义文件）
 * 同强度时优先叫 `main`，其次名字短的，最后字典序——保证结果稳定可测。
 *
 * 只扫**非隐藏**的直接子目录（隐藏目录如 `.orchd` / `.git` 不可能是主工作树）。
 *
 * @param {string} root 容器根（已 canonical 化）
 * @returns {{ worktree: string, markerPath: string, markerRead: boolean, note: string } | null}
 */
function findContainerWorktree(root) {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }

  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory?.() || entry.name.startsWith('.')) continue
    const sub = join(root, entry.name)
    const orchdDir = join(sub, '.orchd')
    if (!isDirectory(orchdDir)) continue

    const markerPath = join(orchdDir, LAYOUT_FILENAME)
    const masterPath = join(orchdDir, MASTER_FILENAME)
    const launcherPath = join(orchdDir, LAUNCHER_FILENAME)

    let marker = null
    try {
      marker = JSON.parse(readFileSync(markerPath, 'utf8'))
    } catch {
      marker = null
    }
    const selfDeclared = marker !== null && marker?.layout === 'container' &&
      typeof marker?.main_worktree === 'string' &&
      canonicalPath(marker.main_worktree) === canonicalPath(sub)
    // 子目录自称 flat：它是**另一个独立的 flat 项目**，不是本容器的产物，跳过
    const foreignFlat = marker !== null && marker?.layout === 'flat'

    if (selfDeclared) {
      found.push({ worktree: sub, markerPath, markerRead: true, strength: 3, name: entry.name })
    } else if (!foreignFlat && isFile(masterPath)) {
      found.push({ worktree: sub, markerPath, markerRead: false, strength: 2, name: entry.name })
    } else if (!foreignFlat && isFile(launcherPath)) {
      found.push({ worktree: sub, markerPath, markerRead: false, strength: 1, name: entry.name })
    }
  }

  if (found.length === 0) return null
  found.sort((a, b) => {
    if (b.strength !== a.strength) return b.strength - a.strength
    const aMain = a.name === 'main' ? 0 : 1
    const bMain = b.name === 'main' ? 0 : 1
    if (aMain !== bMain) return aMain - bMain
    if (a.name.length !== b.name.length) return a.name.length - b.name.length
    return a.name.localeCompare(b.name)
  })

  const best = found[0]
  return {
    worktree: best.worktree,
    markerPath: best.markerPath,
    markerRead: best.markerRead,
    note: `container main worktree auto-detected (${best.strength === 3 ? 'self-declared by its own .layout.json' : best.strength === 2 ? 'has _master.json' : 'has __main__.py'}): ${best.name}`
  }
}

/**
 * 解析布局并推导三套路径。
 *
 * 「」「
 * container → mainWorktree = json.main_worktree
 *             masterPath   = <mainWorktree>/.orchd/_master.json
 *             storeHint    = dirname(mainWorktree)/.orchd-runtime
 * flat / 缺标记 / 解析失败
 *           → mainWorktree = root
 *             masterPath   = <root>/.orchd/_master.json
 *             storeHint    = <root>/.orchd
 * 探针兜底：masterPath 不存在则试另一分支候选；都失败 → layout-unresolved
 * 「」「
 *
 * @param {string} root 项目根（可能是容器根）
 * @param {{ probeFallback?: boolean }} [options] probeFallback=false 时跳过探针兜底（纯逻辑测试用）
 * @returns {{ ok: true, kind: 'container'|'flat', mainWorktree: string, masterPath: string, storeHint: string,
 *            markerPath: string, markerRead: boolean, markerError?: string, note?: string }
 *          | { ok: false, reason: 'layout-unresolved', detail: object }}
 */
export function resolveLayout(root, options = {}) {
  const probeFallback = options.probeFallback !== false
  const rootCanonical = canonicalPath(root)
  const markerPath = layoutFileOf(rootCanonical)

  let marker
  let markerRead = false
  let markerError
  try {
    marker = JSON.parse(readFileSync(markerPath, 'utf8'))
    markerRead = true
  } catch (error) {
    markerError = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  }

  const build = (kind, worktree, extra = {}) => {
    const orchdDir = join(worktree, '.orchd')
    return {
      ok: true,
      kind,
      mainWorktree: worktree,
      masterPath: join(orchdDir, MASTER_FILENAME),
      storeHint: kind === 'container' ? join(dirname(worktree), '.orchd-runtime') : orchdDir,
      markerPath,
      markerRead,
      ...(markerError === undefined ? {} : { markerError }),
      ...extra
    }
  }

  const containerWorktree = markerRead && marker?.layout === 'container' && typeof marker?.main_worktree === 'string' && marker.main_worktree.trim() !== ''
    ? canonicalPath(marker.main_worktree)
    : null

  // 标记读出来是 container，但主工作树目录不存在：这是**布局标记与真实主工作树不一致**
  // （FR-2.2 的 layout-marker-mismatch），不能静默当成 flat 读下去。
  if (containerWorktree !== null && !isDirectory(join(containerWorktree, '.orchd'))) {
    return {
      ok: false,
      reason: 'layout-marker-mismatch',
      detail: {
        root: rootCanonical,
        markerPath,
        declaredMainWorktree: containerWorktree,
        hint: 'the layout marker declares a container layout, but the declared main worktree has no .orchd directory'
      }
    }
  }

  /** 主候选：标记说什么就用什么；标记缺失/不可解析/未知 → flat。 */
  let primary
  /** 备选候选（探针兜底用）：与主候选不同的那一分支。 */
  let alternate

  if (containerWorktree !== null) {
    primary = build('container', containerWorktree)
    alternate = build('flat', rootCanonical, { note: 'container marker present; flat candidate probed as fallback' })
  } else {
    const note = markerRead
      ? marker?.layout === 'flat'
        ? undefined
        : `layout marker has unknown layout ${JSON.stringify(marker?.layout)}; treated as flat`
      : undefined
    primary = build('flat', rootCanonical, note === undefined ? {} : { note })
    alternate = null
  }

  if (!probeFallback || isFile(primary.masterPath)) return primary

  if (alternate !== null && isFile(alternate.masterPath)) {
    return {
      ...primary,
      note:
        'the container layout marker disagrees with the real main worktree: the definition file was found at the container root instead'
    }
  }

  // ⚠ 根上**没有容器标记**（`alternate === null`）且根也没有定义文件时：
  //   再扫一层子目录找容器主工作树——这正是「容器根的 .orchd/ 是空的、标记只在 main/ 下」
  //   那种项目（用户实测识别不出来）。根上有标记时以标记为准，不在这里改判。
  if (alternate === null) {
    const auto = findContainerWorktree(rootCanonical)
    if (auto !== null) {
      return {
        ...build('container', auto.worktree, { note: auto.note }),
        markerPath: auto.markerPath,
        markerRead: auto.markerRead
      }
    }
  }

  if (alternate !== null) {
    return {
      ok: false,
      reason: 'layout-unresolved',
      detail: {
        root: rootCanonical,
        markerPath,
        markerRead,
        ...(markerError === undefined ? {} : { markerError }),
        triedMasterPaths: [primary.masterPath, alternate.masterPath]
      }
    }
  }

  return primary
}

/**
 * 读取并解析定义文件（只读）。
 * @param {string} masterPath
 * @returns {{ ok: true, path: string, bytes: number, schemaVersion: unknown, project: object, taskCount: number, raw: object }
 *          | { ok: false, reason: 'master-unreadable'|'master-unparsable', detail: object }}
 */
export function readMaster(masterPath) {
  let text
  try {
    text = readFileSync(masterPath, 'utf8')
  } catch (error) {
    const code = error !== null && typeof error === 'object' ? error.code : undefined
    return {
      ok: false,
      reason: code === 'ENOENT' ? 'master-missing' : 'master-unreadable',
      detail: { path: masterPath, code: code ?? null, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
    }
  }

  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      reason: 'master-unparsable',
      detail: {
        path: masterPath,
        bytes: Buffer.byteLength(text, 'utf8'),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'master-unparsable', detail: { path: masterPath, error: 'top level is not an object' } }
  }

  const tasks = Array.isArray(raw.tasks) ? raw.tasks : []
  const project = raw.project !== null && typeof raw.project === 'object' ? raw.project : {}

  return {
    ok: true,
    path: masterPath,
    bytes: Buffer.byteLength(text, 'utf8'),
    schemaVersion: raw.schema_version ?? null,
    project: { name: project.name ?? null, brief: project.brief ?? null },
    taskCount: tasks.length,
    raw
  }
}

/**
 * 定义归档候选扫描（R8 / FR-2 的 「broken/definition-archived-unsupported」）。
 *
 * 背景：引擎支持把终态任务定义归档到外部文件；若将来启用，「masterPath」 缺失
 * 并不代表「未初始化」。P0 只探测已知位置的候选是否存在于同一目录，
 * 存在则显式报 broken 而不是误报 uninitialized。
 *
 * @param {string} layout resolveLayout 的结果
 * @returns {string[]} 命中的归档候选路径
 */
export function findArchiveCandidates(layout) {
  const dir = dirname(layout.masterPath)
  const hits = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return hits
  }
  for (const entry of entries) {
    if (entry === MASTER_FILENAME) continue
    if (/^_master.*\.json$/i.test(entry) || /^_master.*\.archive$/i.test(entry)) {
      const full = join(dir, entry)
      if (isFile(full)) hits.push(full)
    }
  }
  return hits
}

// ── P1：定义层索引 ────────────────────────────────────────────────────────

/**
 * 把 `readMaster` 的原始对象整理成上层要用的索引（A2：定义层是慢变、不变量多的那一层）。
 *
 * 字段语义见 docs/03 第 7.1 节。这里**不做完整 JSON Schema 校验**（技术债 T3：避免引入依赖），
 * 只做结构断言 + 缺字段保留为「不存在」，交给 UI 显示占位符（FR-5.7）。
 *
 * @param {object} raw 已解析的 `_master.json`
 * @returns {object} 索引
 */
export function buildDefinitionIndex(raw) {
  const tasks = new Map()
  const moduleById = new Map()
  const dependents = new Map()

  for (const entry of Array.isArray(raw?.modules) ? raw.modules : []) {
    if (entry !== null && typeof entry === 'object' && typeof entry.id === 'string') {
      moduleById.set(entry.id, {
        id: entry.id,
        name: typeof entry.name === 'string' ? entry.name : null,
        role: typeof entry.role === 'string' ? entry.role : null
      })
    }
  }

  const rows = Array.isArray(raw?.tasks) ? raw.tasks : []
  for (const task of rows) {
    if (task === null || typeof task !== 'object') continue
    if (typeof task.id !== 'string') continue
    const id = task.id
    const dependsOn = Array.isArray(task.depends_on)
      ? task.depends_on.filter((value) => typeof value === 'string' && value !== '')
      : []

    tasks.set(id, {
      id,
      name: typeof task.name === 'string' ? task.name : null,
      brief: typeof task.brief === 'string' ? task.brief : null,
      module: typeof task.module === 'string' ? task.module : null,
      // 定义层的重要度可能是**显式声明**；状态层那份是引擎按下游阻塞数**推导**的，
      // 两者语义不同，UI 必须分开显示（docs/02 第 7 节末）。
      importance: typeof task.importance === 'string' ? task.importance : null,
      difficulty: typeof task.difficulty === 'string' ? task.difficulty : null,
      dependsOn,
      requires: Array.isArray(task.requires) ? task.requires.filter((v) => typeof v === 'string') : [],
      source: typeof task.source === 'string' ? task.source : null,
      additionalSources: Array.isArray(task.additional_sources) ? task.additional_sources : [],
      acceptanceCriteria: Array.isArray(task.acceptance_criteria)
        ? task.acceptance_criteria.filter((v) => typeof v === 'string')
        : [],
      verifyCommand: typeof task.verify_command === 'string' ? task.verify_command : null,
      verifyTimeoutSeconds: Number.isInteger(task.verify_timeout_seconds) ? task.verify_timeout_seconds : null,
      filesToEdit: Array.isArray(task.files_to_edit) ? task.files_to_edit.filter((v) => typeof v === 'string') : [],
      exemptFiles: Array.isArray(task.exempt_files) ? task.exempt_files.filter((v) => typeof v === 'string') : [],
      filesToRead: Array.isArray(task.files_to_read)
        ? task.files_to_read
            .filter((v) => v !== null && typeof v === 'object' && typeof v.path === 'string')
            .map((v) => ({
              path: v.path,
              priority: typeof v.priority === 'string' ? v.priority : null,
              hint: typeof v.hint === 'string' ? v.hint : null
            }))
        : [],
      reviewers: Array.isArray(task.reviewers) ? task.reviewers.filter((v) => typeof v === 'string') : [],
      requireIndependentReview: task.require_independent_review === true,
      estimatedHours: typeof task.estimated_hours === 'number' ? task.estimated_hours : null,
      maxAttempts: Number.isInteger(task.max_attempts) ? task.max_attempts : null,
      deliverables: task.deliverables ?? null,
      backport: task.backport ?? null
    })

    for (const upstream of dependsOn) {
      if (!dependents.has(upstream)) dependents.set(upstream, [])
      dependents.get(upstream).push(id)
    }
  }

  // ⚠ 不能用 `raw?.project !== null` 这种写法：raw 为 null 时 `raw?.project` 是 undefined，
  // `undefined !== null` 成立，然后 `raw.project` 就抛 TypeError（模型测试抓到的真 bug）。
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const project = source.project !== null && typeof source.project === 'object' ? source.project : {}
  const config = source.config !== null && typeof source.config === 'object' ? source.config : {}

  return {
    path: undefined, // 由读取处填
    schemaVersion: source.schema_version ?? null,
    project: {
      name: typeof project.name === 'string' ? project.name : null,
      brief: typeof project.brief === 'string' ? project.brief : null,
      reviewMode: typeof project.review_mode === 'string' ? project.review_mode : null
    },
    /** 引擎的导入权重（形如 `{critical:5, high:3, normal:1}`），用于解释「推导重要度」。 */
    importanceWeights: config.importance !== null && typeof config.importance === 'object' ? config.importance : null,
    modules: moduleById,
    tasks,
    /** taskId → 依赖它的任务 id 列表（反向边，FR-6.5 / FR-7.4 用）。 */
    dependents,
    taskCount: tasks.size
  }
}

/**
 * 读取 + 建索引（一步到位）。返回值与 `readMaster` 同构，成功时多一个 `index`。
 * @param {string} masterPath
 */
export function readMasterIndexed(masterPath) {
  const read = readMaster(masterPath)
  if (read.ok !== true) return read
  const index = buildDefinitionIndex(read.raw)
  index.path = masterPath
  return { ...read, index }
}
