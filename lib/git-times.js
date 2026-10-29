/**
 * 只读 git 时间采集：给看板的默认排序提供「最近动作时间」与「合并时间」。
 *
 * 为什么需要它（FR-5.4 修订，2026-10-29）：默认排序改为——
 *   · 活跃任务（pending / claimed / done / in_review）按「最近一次动作」由近到远；
 *   · 终态任务（completed / cancelled）按「合并进 main 的时间」由近到远。
 * 但引擎的 `status --all` 与 `status <id>` **都不返回时间字段**（只有 task_id / name /
 * status / module / attempt_count / source / claimed_by，外加可选的 review_phase /
 * revive_marker），唯一带精确时间戳的是账本事件流（`_ledger.sqlite3`），而插件按 A2
 * 不直读账本。所以这里走 git 侧的两个**近似**来源：
 *
 *   ① 活跃任务 → `task/<id>` 分支的 tip 时间。任务还在推进时分支还在（终态回收才会删
 *      分支与 worktree），tip 提交时间就是「最近一次动作」的最佳近似。
 *   ② 终态任务 → 主分支上的合并提交时间（`Merge branch 'task/<id>'`）。分支已被回收，
 *      合并提交是唯一留下的时间戳。
 *
 * 两处已知盲区（默认排序把它们兜底到本组最后，**不臆造时间**）：
 *   · 尚未 claim 的 pending：还没有 `task/<id>` 分支；
 *   · cancelled：多半从未合并，没有合并提交。squash / 直推进主分支的形态同样拿不到
 *     合并提交（不猜）。
 *
 * 只读纪律（与引擎调用面同一口径，docs/03 第 8 节）：
 *   · **只跑 `GIT_READONLY_INVOCATIONS` 里那两条固定只读命令**，参数里不含任务 id、
 *     不含任何项目数据 —— 没有命令拼接面；
 *   · 不写工作区、不动索引、不 fetch（纯本地查询）；
 *   · 子进程 env 只保留运行必需项，不注入任何身份变量。
 */

import { spawn } from 'node:child_process'

/** ① 活跃任务的 `task/*` 分支 tip 时间（`--sort=-committerdate`：第一份即最新）。 */
const BRANCH_TIP_ARGS = Object.freeze([
  'for-each-ref',
  '--sort=-committerdate',
  '--format=%(committerdate:iso-strict)%09%(refname:short)',
  'refs/heads/task'
])

/** ② 主分支上的合并提交（`-n` 上限够覆盖几百个终态任务的合并历史）。 */
const MERGE_COMMIT_ARGS = Object.freeze([
  'log',
  '--merges',
  '--format=%cI%09%s',
  '-n',
  '4000'
])

/**
 * 允许执行的 git 调用面（**唯一来源**：实现从它取参数，测试按它做静态断言）。
 * 想加新调用必须先改这里 —— 与引擎白名单同一个 fail-closed 思路。
 */
export const GIT_READONLY_INVOCATIONS = Object.freeze([
  Object.freeze({ name: 'branch-tips', args: BRANCH_TIP_ARGS }),
  Object.freeze({ name: 'merge-commits', args: MERGE_COMMIT_ARGS })
])

/** 子进程 env 白名单：git 只读查询的最小集合（PATH 必需，Windows 还要 SystemRoot）。 */
export const GIT_CHILD_ENV_KEYS = Object.freeze(['PATH', 'SystemRoot', 'SystemDrive', 'TEMP', 'TMP'])

/** 采集结果的空形态（git 不可用 / 非 git 项目 / 超时都返回它，只是 `reason` 不同）。 */
const EMPTY_TIMES = Object.freeze({ branchTimes: {}, mergeTimes: {} })

/**
 * 子进程 env：白名单式构造，绝不把宿主变量（尤其是身份类）带下去。
 * @param {Record<string, string|undefined>} [source]
 */
export function buildGitChildEnv(source = process.env) {
  const env = {}
  for (const key of GIT_CHILD_ENV_KEYS) {
    const value = source[key]
    if (typeof value === 'string' && value !== '') env[key] = value
  }
  return env
}

/**
 * `task/<id>` 或 `task/<line>/<id>` → 任务 id（多线取最后一段；id 自身不含 `/`）。
 * 非任务分支（main / feature/... ）→ null。
 * @param {string} refName
 * @returns {string|null}
 */
export function parseTaskBranchRef(refName) {
  if (typeof refName !== 'string') return null
  const match = /^task\/(.+)$/.exec(refName.trim())
  if (match === null) return null
  const segments = match[1].split('/')
  const id = segments[segments.length - 1].trim()
  return id === '' ? null : id
}

/**
 * 合并提交标题 → 任务 id。只认 `Merge branch 'task/<id>'`（可带 ` into <branch>` 尾巴）。
 * @param {string} subject
 * @returns {string|null}
 */
export function parseMergeSubject(subject) {
  if (typeof subject !== 'string') return null
  const match = /Merge branch 'task\/([^']+)'/.exec(subject)
  if (match === null) return null
  const segments = match[1].split('/')
  const id = segments[segments.length - 1].trim()
  return id === '' ? null : id
}

/** ISO 时间的最小形状校验（`iso-strict` / `%cI` 都是 `<date>T<time>` 开头）。 */
function looksLikeIso(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
}

/** 按第一个制表符切开 `--format` 的两列（时间 + 后续列）。 */
function splitColumns(line) {
  // 双保险：`%x09` 这种写法在部分 git/环境上会被**原样带出**成字面量 `%09`
  // （2026-10-29 实测踩到：GIT 2.56 + execFileSync 走 argv 时），先归一成真分隔符，
  // 免得整个时间层静默变空。
  const text = line.trim().replace(/%0?9/g, '\t')
  if (text === '') return null
  const index = text.indexOf('\t')
  if (index < 0) return null
  const when = text.slice(0, index).trim()
  const rest = text.slice(index + 1).trim()
  if (rest === '' || !looksLikeIso(when)) return null
  return { when, rest }
}

/**
 * 跑一条 git 只读命令。失败/超时都**不抛错**（排序降级即可，不能因为 git 坏了让面板挂）。
 * @param {readonly string[]} args
 * @param {{ cwd: string, timeoutMs: number, spawnImpl: Function }} options
 */
export function runGitReadonly(args, { cwd, timeoutMs = 8000, spawnImpl = spawn }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawnImpl('git', [...args], {
        cwd,
        windowsHide: true,
        env: buildGitChildEnv(),
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      resolve({ ok: false, reason: 'git-spawn-failed', stdout: '', stderr: String(error) })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        /* 忽略：可能已退出 */
      }
    }, Math.max(1, timeoutMs))

    // 刻意**不**设 setEncoding：按 Buffer 收集后统一 utf8 解码，
    // 免得子进程（git）输出编码受宿主 locale 影响（中文提交信息会乱码）。
    const chunks = []
    const errChunks = []
    child.stdout.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))))
    child.stderr.on('data', (chunk) => errChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))))

    child.on('error', (error) => {
      finish({ ok: false, reason: 'git-spawn-failed', stdout: '', stderr: String(error) })
    })

    child.on('close', (code) => {
      stdout = Buffer.concat(chunks).toString('utf8')
      stderr = Buffer.concat(errChunks).toString('utf8')
      if (timedOut) {
        finish({ ok: false, reason: 'git-timeout', stdout, stderr })
        return
      }
      if (code !== 0) {
        // 非 git 仓库在这里表现得最典型（exit 128 + "not a git repository"）
        finish({ ok: false, reason: 'git-failed', code, stdout, stderr })
        return
      }
      finish({ ok: true, reason: null, code: 0, stdout, stderr })
    })
  })
}

/**
 * 采集 git 时间层。
 *
 * @param {object} options
 * @param {string} options.worktree 主工作树（git 仓库根）
 * @param {number} [options.timeoutMs]
 * @param {Function} [options.spawnImpl] 仅供测试注入
 * @returns {Promise<{ available: boolean, reason: string|null, branchTimes: Record<string,string>, mergeTimes: Record<string,string> }>}
 */
export async function collectGitTimes({ worktree, timeoutMs = 8000, spawnImpl = spawn } = {}) {
  if (typeof worktree !== 'string' || worktree === '') {
    return { available: false, reason: 'no-worktree', ...EMPTY_TIMES }
  }

  const [branch, merge] = await Promise.all([
    runGitReadonly(BRANCH_TIP_ARGS, { cwd: worktree, timeoutMs, spawnImpl }),
    runGitReadonly(MERGE_COMMIT_ARGS, { cwd: worktree, timeoutMs, spawnImpl })
  ])

  if (branch.ok !== true && merge.ok !== true) {
    return { available: false, reason: branch.reason ?? merge.reason ?? 'git-failed', ...EMPTY_TIMES }
  }

  const branchTimes = {}
  if (branch.ok === true) {
    for (const line of branch.stdout.split('\n')) {
      const columns = splitColumns(line)
      if (columns === null) continue
      const id = parseTaskBranchRef(columns.rest)
      // 已按 committerdate 倒序：同一任务分支只留第一次出现（= 最新）
      if (id !== null && branchTimes[id] === undefined) branchTimes[id] = columns.when
    }
  }

  const mergeTimes = {}
  if (merge.ok === true) {
    for (const line of merge.stdout.split('\n')) {
      const columns = splitColumns(line)
      if (columns === null) continue
      const id = parseMergeSubject(columns.rest)
      // `log` 也是新→旧：同一任务只留最近一次合并
      if (id !== null && mergeTimes[id] === undefined) mergeTimes[id] = columns.when
    }
  }

  return { available: true, reason: null, branchTimes, mergeTimes }
}
