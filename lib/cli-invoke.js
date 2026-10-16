/**
 * CLI 调用装配：把「项目根 + 已探测的 Python + 白名单参数」收敛成一次调用，
 * 并给四态检测提供一个可注入的状态层实现（P0 时刻意没接，P1 接上）。
 *
 * 分层原因（docs/02 第 4.4 节「引擎对接面收敛在单一模块内」，NFR-4.2）：
 *   - `orchd-cli.js` 只负责 spawn / env / 超时 / 错误映射 / 白名单，不认识项目；
 *   - 本模块负责「先探测 Python，再按项目根调用」，是上层唯一入口。
 */

import { detect } from './detect.js'
import { isTaskId, runOrchdCli, whitelistedCommandNames } from './orchd-cli.js'
import { probePython } from './python.js'

/**
 * 把 `runOrchdCli` 的原始结果规整成调用方统一使用的形状。
 *
 * 为什么需要它：`detect()` 期望 `{timedOut, exitCode, json}`，而路由层希望一眼看出
 * `ok/reason/engineError`。两个形状都在用，容易接错（P1 实测就接错了一次），
 * 所以收敛到这一个函数里。
 */
export function normalizeCliResult(result) {
  return {
    ok: result.outcome === 'ok',
    outcome: result.outcome,
    timedOut: result.outcome === 'timeout',
    exitCode: result.outcome === 'ok' ? 0 : (result.exitCode ?? 1),
    json: result.json,
    engineError: result.engineError,
    engineCode: result.engineError?.code ?? null,
    reason: result.outcome === 'ok' ? null : (result.reason ?? 'cli-failed'),
    elapsedMs: result.elapsedMs,
    argv: result.argv,
    stderr: result.stderr ?? null
  }
}

/**
 * 判定「**引擎没有这条命令**」（版本能力缺失），而不是「项目坏了」。
 *
 * 为什么要单独判：老版本引擎缺子命令时，argparse 直接报 usage 错、exit=2，看上去和
 * 「项目损坏」一模一样。实测（用户项目，`orchd v1.5.0-1`）：
 *   `ideas list` → exit=2、`E007 invalid_usage`、stderr `invalid choice: 'ideas'`
 * 而同一项目里 `status --all` / `pool --all` / `show` / `review --show` 全部正常
 * ——所以只能降级「想法」这一块，不能把整个面板判成 broken（用户实测反馈：
 * 想法视图显示「orchd 状态异常 / 引擎返回了失败状态」，既吓人又误导）。
 *
 * 判据取 **argparse 的原话**（`invalid choice: '<cmd>'`）——比 E007 可靠：
 * E007 是通用「参数用法错误」，别的参数错也会是 E007。
 *
 * @param {object} result `normalizeCliResult` 的产物
 * @param {string} command 子命令名，例如 `ideas`
 * @returns {boolean}
 */
export function isUnsupportedCommand(result, command) {
  if (result === null || typeof result !== 'object') return false
  if (result.ok === true) return false
  const text = [result.stderr, JSON.stringify(result.json ?? null), JSON.stringify(result.engineError ?? null)]
    .filter((part) => typeof part === 'string' && part !== '' && part !== 'null')
    .join('\n')
  if (text === '') return false
  const escaped = String(command).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // argparse：invalid choice: 'ideas' / invalid choice: "ideas"
  if (new RegExp(`invalid choice:\\s*['"]${escaped}['"]`, 'i').test(text)) return true
  // 兜底：错误体里同时出现「用法错误」与该子命令名（不同引擎版本的措辞差异）
  return /invalid_usage|usage:|unrecognized arguments/i.test(text) && new RegExp(`\\b${escaped}\\b`).test(text)
}

/**
 * 白名单拒绝的**日志行**（P4 验收：「故意调用白名单外命令会被拒绝**并记录**」）。
 *
 * 为什么非要记一笔：拒绝是**静默的安全行为**——不留痕的话，「谁在什么时候试图调用
 * `request` / `watchdog --takeover`」在运行现场根本查不到，只剩一个用户看不懂的
 * 「引擎返回了失败状态」。日志只含**命令名 + 拒绝原因**，不含任何项目内容。
 */
export function describeRejection(result) {
  const argv = Array.isArray(result?.argv) ? result.argv : []
  const command = typeof argv[0] === 'string' ? argv[0] : '(空 argv)'
  return `orchd-tasks: 拒绝非白名单调用 command=${command} reason=${result?.reason ?? 'not-whitelisted'} argv=${JSON.stringify(argv)}`
}

/**
 * 构造一组**绑定到项目根**的引擎调用函数。
 *
 * 为什么要工厂而不是直接导出函数：路由层需要能被测试注入一个假 runner
 * （否则每次路由测试都会真的 spawn Python，既慢又依赖项目状态）。
 * `runner` 默认是真实的 `runOrchdCli`，测试传自己的实现即可。
 *
 * ⚠ 每个调用点都必须带 `workDir`（= 主工作树）。container 布局下引擎拒绝以容器根为 cwd
 * （E036），所以这不是可选项——由调用方从 `detected.layout.mainWorktree` 取。
 *
 * @param {object} config 规范化后的配置
 * @param {Function} [runner] `({root, workDir, python, argv, timeoutMs, signal}) => Promise<raw result>`
 * @param {{warn?: Function}} [logger] 宿主日志器（`ctx.logger`）；被拒绝的调用会记一行（P4）
 */
export function createCliInvoker(config, runner = runOrchdCli, logger = null) {
  const timeoutMs = config.requestTimeoutMs
  const call = async (ctx, argv) => {
    const result = normalizeCliResult(await runner({
      root: ctx.root,
      workDir: ctx.workDir ?? ctx.mainWorktree,
      python: ctx.python,
      argv,
      timeoutMs,
      signal: ctx.signal
    }))
    if (result.outcome === 'rejected') (logger ?? ctx.logger ?? null)?.warn?.(describeRejection(result))
    return result
  }

  return {
    /** 状态层主来源。 */
    statusAll: (ctx) => call(ctx, ['status', '--all']),
    /** 下游阻塞数来源（FR-7.3）。 */
    poolAll: (ctx) => call(ctx, ['pool', '--all']),
    /** 单任务详情；调用方负责校验 id 形状。 */
    statusOne: (ctx, taskId) => call(ctx, ['status', taskId]),
    /** 审查意见历史（FR-8.3）。 */
    reviewShow: (ctx, taskId) => call(ctx, ['review', '--task', taskId, '--show']),
    /**
     * IDEAS 清单（FR-13）。
     * ⚠ 引擎**只返回 3 个字段**（`title` / `id` / `status`），正文必须另读 `IDEAS.md`。
     */
    ideasList: (ctx) => call(ctx, ['ideas', 'list']),
    /** 供 `detect()` 使用的形态。`detect` 会传 `workDir`（它自己从 layout 取）。 */
    detectRunner: async ({ root, python, workDir, command }) => {
      const argv = Array.isArray(command) ? command : ['status', '--all']
      const result = await call({ root, python, workDir }, argv)
      return {
        timedOut: result.timedOut,
        exitCode: result.exitCode,
        json: result.json,
        engineError: result.engineError,
        reason: result.reason,
        elapsedMs: result.elapsedMs,
        stderr: result.stderr
      }
    }
  }
}

/** 完整一次「探测 Python + 四态检测」（P1 起接上状态层）。 */
export async function detectWithStatus({ root, config, runner }) {
  const cli = createCliInvoker(config, runner)
  return detect({ root, config, runCli: cli.detectRunner })
}

export { probePython, isTaskId, whitelistedCommandNames }
