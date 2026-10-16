/**
 * 状态层：调用**项目自带的**引擎入口，并且**只调用白名单里的读命令**。
 *
 * 依据 docs/02 第 4.2 节与 docs/03 第 4/6 节：
 *   - 唯一调用点：`python <项目根>/.orchd/__main__.py <命令>`，cwd = 项目根；
 *   - 子进程 env：**不注入会话身份**（这是「读命令不写盘」的前提，FR-10.1）、
 *     关闭自动清理（FR-10.2）、关闭冗余留痕、禁字节码写入（守住零工作区变更，AC-10.1）；
 *   - 白名单 **fail-closed**：不在表里的一律在封装层拒绝（FR-10.3）；
 *   - 退出码 1 = stdout 含顶层 `error` → 先解析结构化错误（FR-9.2）；
 *   - 超时单独归类为 `cli-timeout`（FR-9.3）。
 *
 * 本模块**只读 stdout**，stderr 仅在失败时作为诊断附带（docs/03 第 5.1 节）。
 */

import { spawn } from 'node:child_process'
import { launcherOf } from './master.js'

/** 子进程环境：逐项登记（docs/03 第 6.3 节）。 */
export const CHILD_ENV = Object.freeze({
  /** 关闭僵尸会话自动回收（`status` 会做 prune_orphans + auto_clean）。 */
  ORCHD_AUTO_CLEAN: 'off',
  /** 关闭回收留痕的 stderr 输出，保证 stdout 干净。 */
  ORCHD_QUIET: '1',
  /** 避免中文在管道下的编码异常。 */
  PYTHONIOENCODING: 'utf-8',
  /** 不在项目内产生 `__pycache__`（插件自己的加固，非引擎要求）。 */
  PYTHONDONTWRITEBYTECODE: '1'
})

/**
 * 读命令白名单（fail-closed）。
 *
 * 每一项声明允许的参数形态；`args` 里 `:task-id` 之类的占位符由调用方按自身语义校验，
 * 这里只做「形状」匹配：固定词必须逐字相等，`<>` 表示一个自由参数。
 *
 * 刻意**不**包含（docs/03 第 4.1/4.3/9 节的理由）：
 *   - `request`：本参考项目 `config.allow_auto_claim: true`，会真的认领任务（高危）；
 *   - `watchdog --takeover` / `doctor --fix`：flag 触发的写路径；
 *   - `session current`：会写 `last_seen`；
 *   - `git` / `check`：前者是写操作的入口，后者昂贵。
 */
export const READ_WHITELIST = Object.freeze([
  { name: 'status', shapes: [[], ['--all'], ['<task-id>'], ['--text']], why: '全局快照 / 单任务卡片' },
  { name: 'show', shapes: [['<task-id>']], why: 'status <id> 的别名' },
  { name: 'pool', shapes: [[], ['--all']], why: '就绪池 / 下游阻塞数（FR-7.3）' },
  { name: 'review', shapes: [['--task', '<task-id>', '--show']], why: '审查意见历史（FR-8.3）' },
  { name: 'validate', shapes: [[], ['<path>']], why: '定义层合法性（broken 判定辅助）' },
  // `ideas` 只有 `list` 一个子命令（实测 `ideas --help`：usage: orchd ideas [-h] {list} ...），
  // 且它只读 JSON。`idea`（单数）才是写命令（propose / confirm / drop），**不在白名单**。
  { name: 'ideas', shapes: [['list']], why: 'IDEAS 清单（title/id/status，FR-13）' }
])

/** 结构性危险词：即使出现在白名单命令的额外参数里也直接拒绝。 */
const FORBIDDEN_TOKENS = new Set(['--fix', '--takeover', '--auto-claim', '--write', '--force'])

/**
 * 判断一次调用是否被允许。
 * @param {string[]} argv 已去掉 `python` 与启动器路径
 * @returns {{ ok: true } | { ok: false, reason: 'not-whitelisted'|'argument-not-allowed'|'dangerous-flag', detail: object }}
 */
export function checkWhitelist(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { ok: false, reason: 'not-whitelisted', detail: { argv } }
  }
  for (const token of argv) {
    if (typeof token === 'string' && FORBIDDEN_TOKENS.has(token)) {
      return { ok: false, reason: 'dangerous-flag', detail: { argv, token } }
    }
  }

  const entry = READ_WHITELIST.find((item) => item.name === argv[0])
  if (entry === undefined) {
    return { ok: false, reason: 'not-whitelisted', detail: { argv, allowed: READ_WHITELIST.map((item) => item.name) } }
  }

  const rest = argv.slice(1)
  const matches = entry.shapes.some((shape) => {
    if (shape.length !== rest.length) return false
    return shape.every((token, index) => {
      // `<...>` 是一个自由参数（调用方负责校验其内容，例如 task id 只允许 [a-z0-9-]）
      if (token.startsWith('<') && token.endsWith('>')) return true
      return token === rest[index]
    })
  })

  return matches
    ? { ok: true }
    : { ok: false, reason: 'argument-not-allowed', detail: { argv, allowedShapes: entry.shapes } }
}

/** task id 的形状（docs/03 第 7.1 节：`^task-[a-z0-9-]+$`，永不变名）。 */
const TASK_ID_PATTERN = /^task-[a-z0-9][a-z0-9-]*$/

export function isTaskId(value) {
  return typeof value === 'string' && TASK_ID_PATTERN.test(value)
}

/**
 * 解析 stdout 为 JSON（引擎所有命令都输出 JSON，docs/03 第 5.1 节）。
 * 失败时返回 undefined，由调用方归类。
 */
function parseJson(text) {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    // 引擎偶尔会在 JSON 前打印提示？按 docs/03 第 5.1 节只解析 stdout，
    // 这里做一次「取第一个 { 到最后一个 }」的兜底，仍然失败就放弃。
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) return undefined
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return undefined
    }
  }
}

/**
 * 调用项目自带的引擎（唯一入口）。
 *
 * ⚠ **cwd 必须是「主工作树」，不是「项目根」**（P1 实测纠正）：
 * container 布局下项目根是容器根，引擎会直接拒绝并返回 `E036 container_root_cwd`——
 * 连读命令 `status --all` 也拒（实测见 dev/probe-engine-cwd.mjs：cwd=容器根 exit=1；
 * cwd=主工作树 exit=0）。
 * 所以 `workDir` 由调用方从 `layout.mainWorktree` 传进来；布局解析不出来时它等于项目根，
 * 这正好就是 flat 布局的情形，行为与 P0 一致。
 *
 * 启动器取同一个目录下的 `.orchd/__main__.py`。实测「主工作树 cwd + 容器根启动器（junction）」
 * 也能跑通，但那是靠 junction 的等价性，所以不采用。
 *
 * @param {object} args
 * @param {string} args.root 项目根（容器根或 flat 根）——仅用于诊断信息
 * @param {string} [args.workDir] 引擎工作目录（**必须是主工作树**）
 * @param {{path: string, args: string[]}} args.python 已探测到的解释器
 * @param {string[]} args.argv 例如 `['status', '--all']`
 * @param {number} [args.timeoutMs]
 * @param {AbortSignal} [args.signal]
 * @param {Function} [args.spawnImpl] 仅测试用：替换 `child_process.spawn`
 * @returns {Promise<object>} 见下方各 return 分支
 */
export async function runOrchdCli({ root, workDir, python, argv, timeoutMs = 20_000, signal, spawnImpl = spawn }) {
  const allowed = checkWhitelist(argv)
  if (allowed.ok !== true) {
    return {
      outcome: 'rejected',
      reason: allowed.reason,
      argv,
      detail: allowed.detail,
      // 刻意不抛错：调用方拿到结构化结果就能给出可见的 UI 反馈（FR-9.1）
      exitCode: null,
      json: undefined,
      stdout: '',
      stderr: '',
      elapsedMs: 0
    }
  }

  const cwd = typeof workDir === 'string' && workDir !== '' ? workDir : root
  const launcher = launcherOf(cwd)
  const command = python.path
  const commandArgs = [...(python.args ?? []), launcher, ...argv]

  const startedAt = Date.now()
  return await new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve({ ...value, elapsedMs: Date.now() - startedAt, argv })
    }

    let child
    try {
      child = spawnImpl(command, commandArgs, {
        // cwd 必须是主工作树（见函数头注释的 E036 说明）
        cwd,
        windowsHide: true,
        // env 是**白名单式**构造：只带出必要变量 + 我们的只读开关，
        // 绝不把宿主的 ORCHD_SESSION_ID（若存在）传下去（FR-10.1）。
        env: buildChildEnv(),
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      finish({ outcome: 'spawn-failed', exitCode: null, json: undefined, stdout: '', stderr: '', error: String(error) })
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        /* 忽略：可能已退出 */
      }
    }, Math.max(1, timeoutMs))

    const onAbort = () => {
      try {
        child.kill()
      } catch {
        /* 忽略 */
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      finish({ outcome: 'spawn-failed', exitCode: null, json: undefined, stdout, stderr, error: String(error) })
    })

    child.on('close', (code, signalName) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)

      const json = parseJson(stdout)
      const structuredError = json !== null && typeof json === 'object' && json.error !== undefined ? json.error : undefined

      if (timedOut) {
        finish({ outcome: 'timeout', reason: 'cli-timeout', exitCode: code, signal: signalName, json, stdout, stderr, timeoutMs })
        return
      }
      if (structuredError !== undefined) {
        // 退出码 1 表示 stdout 含顶层 error（docs/03 第 5.5 节）——原样保留给 UI（FR-9.2）
        finish({ outcome: 'error', reason: 'cli-failed', exitCode: code, signal: signalName, json, engineError: structuredError, stdout, stderr })
        return
      }
      if (code !== 0) {
        finish({ outcome: 'error', reason: 'cli-failed', exitCode: code, signal: signalName, json, stdout, stderr })
        return
      }
      if (json === undefined) {
        finish({ outcome: 'unparsable', reason: 'cli-unparsable', exitCode: code, json: undefined, stdout: stdout.slice(0, 2000), stderr })
        return
      }
      finish({ outcome: 'ok', exitCode: 0, json, stdout, stderr })
    })
  })
}

/**
 * 构造子进程环境。
 *
 * 导出成函数是为了在测试里直接断言「没有身份变量、只读开关都在」——
 * 这是 FR-10.1/10.2 的自动化验收点（docs/05 P1 验收 AC-10.2）。
 */
export function buildChildEnv(base = process.env) {
  const env = {}
  // 只带出运行必需的那几个：PATH（找 python 及其依赖）、SystemRoot（Windows 必需）、
  // TEMP/TMP（解释器可能需要）、HOME/USERPROFILE（少数库会读）。
  for (const key of ['PATH', 'Path', 'SystemRoot', 'windir', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL']) {
    if (base[key] !== undefined) env[key] = base[key]
  }
  for (const [key, value] of Object.entries(CHILD_ENV)) env[key] = value
  // 明确**不设置** ORCHD_HOME（不重定向运行时根）、ORCHD_SESSION_ID（不注入身份）。
  return env
}

/** 白名单命令的名字集合（供静态扫描测试断言「代码里没有白名单外的命令字面量」）。 */
export function whitelistedCommandNames() {
  return READ_WHITELIST.map((item) => item.name)
}
