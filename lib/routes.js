/**
 * HTTP 路由表。
 *
 * 依据 docs/02 第 6 节：
 *   - 统一包络：成功 `{ ok:true, data, meta }`，失败 `{ ok:false, error, meta }`；
 *   - HTTP 状态码：成功 200；**检测未通过也是 200 + ok:false**（「未接入 orchd」是正常
 *     业务态，不是传输错误）；宿主内部异常 500；
 *   - 路由只接受 `session` 与业务查询参数，**不接受任何路径参数**（NFR-2.1）；
 *   - `/orchd/` 前缀避开 `/api`（属 dsh-client-connection）与 `/plugins`（属客户端模块系统）。
 *
 * P1 路由：
 *   GET /orchd/api/context  四态 + 项目身份 + 诊断（P0 起）
 *   GET /orchd/api/board    状态条 + 任务列表（定义层 ∩ 状态层）
 *   GET /orchd/api/task     单任务详情（+ 审查历史，按需）
 *   GET /orchd/api/history  审查事件时间线（P2，FR-8，P2 收窄）
 *   GET /orchd/api/graph    依赖图（节点 + 边 + 环/悬空/自依赖，P2b，FR-7）
 */

import { collectIgnoredPathParams, resolveProjectRoot, validateRoot } from './project.js'
import { detect, summarizeLayout } from './detect.js'
import { cachedDefinition } from './cache.js'
import { readMasterIndexed } from './master.js'
import { buildBoard, buildGraph, buildReviewTimeline, buildTaskDetail } from './model.js'
import { isTaskId, isUnsupportedCommand } from './cli-invoke.js'
import { INSTALL_COMMAND, buildInstallPrompt, injectInstallPrompt, probeInjectSupport } from './install-entry.js'
import { IDEA_OWNER, IDEA_STATUSES, applyConvertedStatus, buildIdeaTaskIndex, classifyArchive, ideaStripStatuses, ideasArchiveOf, ideasFileOf, parseIdeasMarkdown, scanArchiveFile, summarizeIdeas } from './ideas.js'
import { ORCHD_OFFICIAL_REPO, ORCHD_MIRROR_REPO, resolveRepo } from './config.js'
import { keyOf } from './paths.js'

/**
 * 路由前缀。
 *
 * ⚠ **不要带尾斜杠**：webServer 的匹配规则是
 * 「pathname !== prefix && !pathname.startsWith(prefix + "/")」
 * （「dsh-host-webserver/lib/index.js:327-329」）。
 * 若写成 「/orchd/api/」，请求 「/orchd/api/context」 既不等于该前缀、也不以
 * 「/orchd/api//」 开头 → 永远落回 fallback handler，表现成 **404 非 JSON**。
 * （P0 实测踩过：面板首屏报「宿主返回了非 JSON 响应（HTTP 404）」。）
 */
const API_PREFIX = '/orchd/api'

/**
 * 开发期标记（P0 加，P4 移除）。
 *
 * 值是本模块的求值时刻，会随 `/orchd/api/context` 的 `devMarker` 字段回到面板底部。
 * 用途：确认运行中的宿主到底是哪一代代码——模块被重新求值它就会变，进程重启它也会变
 * （配合面板里的 pid 与 hostProbe.moduleLoadedAt 可以区分两者）。
 *
 * 注意：**宿主侧没有模块热替换可用**（Desktop 的 Electron 宿主进程没有 `--expose-internals`，
 * `dsh-hmr` 在 `config.root` 非空时直接抛错，见 dev/README-m0.md 第 3.6 节），
 * 所以这个值在 Desktop 上只会在**重启后**更新。
 */
const DEV_MARKER = new Date().toISOString()

// 本模块每次被求值都往宿主 stderr 打一行：重启后日志里出现新的一行，
// 就是「运行中的宿主已换到新代码」的直接证据（pid 也一并打出来）。
process.stderr.write(`[orchd-dev-probe] routes.js evaluated ${DEV_MARKER} pid=${process.pid}\n`)

/** 统一包络的构造器。 */
export function envelope({ ok, data, error, startedAt }) {
  const elapsedMs = Date.now() - startedAt
  return {
    ok,
    ...(ok ? { data } : { error }),
    meta: { fetchedAt: new Date().toISOString(), elapsedMs }
  }
}

/** 每请求的出站失败上下文（见 `sendJson`）。 */
const RESPONSE_FAILURES = new WeakMap()

function sendJson(res, status, body) {
  // NFR-5.1：**每条路由的失败都记录结构化日志**（阶段/原因分类/耗时）。
  // 收敛在唯一的出站口而不是散在每个 handler 里：404/405 也走这里，一处就够、不会漏。
  // 用 WeakMap 存每请求的上下文（不往平台对象上挂属性、不改 `sendJson` 的调用点；
  // 单元测试直接调 handler 时没有登记项 → 只跳过日志，不会崩）。
  if (body?.ok === false) {
    const failure = RESPONSE_FAILURES.get(res)
    failure?.logger?.warn?.(describeRouteFailure(failure.pathname, failure.method, status, body))
  }
  const text = JSON.stringify(body, null, 2)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  res.end(text)
}

/**
 * 失败日志的行格式（NFR-5.1：阶段、原因分类、耗时都要在）。
 * 单独导出是为了让测试断言**内容**，而不是断言「调用了 warn」。
 */
export function describeRouteFailure(pathname, method, status, body) {
  const error = body?.error ?? {}
  const parts = [
    `stage=route`,
    `path=${pathname ?? '?'}`,
    `method=${method ?? '?'}`,
    `status=${status}`,
    `kind=${error.kind ?? 'unknown'}`,
    `reason=${error.reason ?? 'unknown'}`,
    `elapsedMs=${body?.meta?.elapsedMs ?? 'n/a'}`
  ]
  if (error.engineCode !== undefined && error.engineCode !== null) parts.push(`engineCode=${error.engineCode}`)
  return `orchd-tasks: ${parts.join(' ')}`
}

/**
 * 公共前半段：项目根推导 → 校验 → 四态检测（带缓存）。
 * 所有路由都走同一次推导，**绝不使用请求里的路径**。
 */
export async function loadContext(deps, sessionId, { refresh = false } = {}) {
  const { ctx, config, caches } = deps

  const resolution = await resolveProjectRoot(ctx, sessionId, config)
  if (resolution.error !== undefined) {
    return { ok: false, error: { kind: 'broken', reason: resolution.error.reason, message: reasonText(resolution.error.reason), details: resolution.error.detail } }
  }

  const valid = validateRoot(resolution.root)
  if (valid.ok !== true) {
    return { ok: false, error: { kind: 'broken', reason: valid.reason, message: reasonText(valid.reason), details: valid.detail } }
  }

  const detected = await caches.detect.get(keyOf(resolution.root), refresh, () =>
    detect({ root: resolution.root, config, runCli: deps.runCli })
  )

  return { ok: true, resolution, detected }
}

/** 定义层（带指纹缓存）。masterPath 缺失时返回 undefined。 */
async function loadDefinition(deps, detected) {
  const masterPath = detected?.layout?.masterPath
  if (typeof masterPath !== 'string' || !detected.layout) return undefined
  const read = await cachedDefinition(deps.caches, masterPath, readMasterIndexed)
  return read?.ok === true ? read.index : undefined
}

/** 状态层 `status --all`（5 s TTL；失败不污染缓存由 cache 保证）。 */
async function loadStatusLayer(deps, detected, refresh) {
  const root = detected.root
  return deps.caches.status.get(keyOf(root), refresh, () =>
    deps.cli.statusAll({ root, workDir: detected.layout?.mainWorktree, python: detected.python })
  )
}

/** 就绪池 `pool --all`（30 s TTL，只为 `blocked_downstream_count`）。 */
async function loadPoolLayer(deps, detected, refresh) {
  const root = detected.root
  return deps.caches.pool.get(keyOf(root), refresh, () =>
    deps.cli.poolAll({ root, workDir: detected.layout?.mainWorktree, python: detected.python })
  )
}

/** GET /orchd/api/context */
async function handleContext(deps, req, res, url) {
  const startedAt = Date.now()
  const { ctx, config, host } = deps
  const ignored = collectIgnoredPathParams(url)
  if (ignored.length > 0) {
    ctx.logger?.warn?.(`orchd-tasks: ignoring path-like query params from client: ${ignored.join(', ')}`)
  }

  const sessionId = url.searchParams.get('session') ?? ''
  if (sessionId === '') {
    sendJson(res, 400, envelope({ ok: false, startedAt, error: { kind: 'bad_request', reason: 'missing-session', message: 'query parameter `session` is required' } }))
    return
  }

  try {
    const loaded = await loadContext(deps, sessionId, { refresh: url.searchParams.get('refresh') === '1' })
    if (loaded.ok !== true) {
      sendJson(res, 200, envelope({ ok: false, startedAt, error: loaded.error }))
      return
    }

    const { resolution, detected } = loaded
    // ready 时顺带带上引擎摘要（供状态条直接采用，FR-4.3）；失败不致命。
    const engineSummary = await cachedEngineSummary(deps, detected)

    const data = {
      state: detected.state,
      root: resolution.root,
      resolvedBy: resolution.source,
      layout: detected.layout === undefined ? null : summarizeLayout(detected.layout),
      storeHint: detected.layout?.storeHint ?? null,
      masterPath: detected.layout?.masterPath ?? null,
      python: detected.python === undefined
        ? null
        : { path: detected.python.path, version: detected.python.version, source: detected.python.source },
      projectName: engineSummary?.projectName ?? detected.projectName ?? null,
      projectBrief: detected.projectBrief ?? null,
      taskCount: engineSummary?.taskCount ?? detected.taskCount ?? null,
      summary: engineSummary?.summary ?? detected.summary ?? null,
      statusLayer: detected.statusLayer ?? null,
      ...(detected.reason === undefined ? {} : { reason: detected.reason }),
      ...(detected.detail === undefined ? {} : { detail: detected.detail }),
      install: installInstructions(config),
      ignoredPathParams: ignored,
      // 开发期探针：宿主模块的求值时刻/pid/uptime。P4 应随 /orchd/api/self 一起移除。
      devMarker: DEV_MARKER,
      hostProbe: host === undefined
        ? null
        : {
            moduleLoadedAt: host.moduleLoadedAt,
            cacheModuleLoadedAt: host.cacheModuleLoadedAt ?? null,
            pid: host.pid,
            uptimeMsAtMount: host.uptimeMs,
            uptimeMsNow: Math.round(process.uptime() * 1000)
          }
    }
    sendJson(res, 200, envelope({ ok: true, startedAt, data }))
  } catch (error) {
    sendJson(res, 500, envelope({ ok: false, startedAt, error: internalError(error) }))
  }
}

/** ready 时取一次状态层摘要；其它态或调用失败都返回 undefined（不阻塞 context）。 */
async function cachedEngineSummary(deps, detected) {
  if (detected.state !== 'ready' || detected.python === undefined) return undefined
  const result = await loadStatusLayer(deps, detected, false)
  if (result?.ok !== true) return undefined
  const tasks = Array.isArray(result.json?.tasks) ? result.json.tasks : []
  return {
    projectName: typeof result.json?.project?.name === 'string' ? result.json.project.name : undefined,
    taskCount: tasks.length,
    summary: result.json?.summary ?? null
  }
}

/** GET /orchd/api/board */
async function handleBoard(deps, req, res, url) {
  const startedAt = Date.now()
  const sessionId = url.searchParams.get('session') ?? ''
  if (sessionId === '') {
    sendJson(res, 400, envelope({ ok: false, startedAt, error: { kind: 'bad_request', reason: 'missing-session', message: 'query parameter `session` is required' } }))
    return
  }

  try {
    const refresh = url.searchParams.get('refresh') === '1'
    const loaded = await loadContext(deps, sessionId, { refresh })
    if (loaded.ok !== true) {
      sendJson(res, 200, envelope({ ok: false, startedAt, error: loaded.error }))
      return
    }

    const { detected } = loaded
    if (detected.state !== 'ready') {
      sendJson(res, 200, envelope({
        ok: false,
        startedAt,
        error: {
          kind: detected.state === 'not_installed' || detected.state === 'uninitialized' ? detected.state : 'broken',
          reason: detected.reason ?? detected.state,
          message: reasonText(detected.reason ?? detected.state),
          details: detected.detail
        }
      }))
      return
    }

    const index = await loadDefinition(deps, detected)
    const status = await loadStatusLayer(deps, detected, refresh)
    if (status?.ok !== true) {
      sendJson(res, 200, envelope({
        ok: false,
        startedAt,
        error: {
          kind: status?.timedOut === true ? 'timeout' : 'broken',
          reason: status?.reason ?? 'cli-failed',
          message: reasonText(status?.reason ?? 'cli-failed'),
          engineCode: status?.engineCode ?? null,
          details: { argv: status?.argv, exitCode: status?.exitCode, stderr: trimStderr(status?.stderr) }
        }
      }))
      return
    }

    const pool = await loadPoolLayer(deps, detected, refresh)

    const board = buildBoard({
      statusJson: status.json,
      poolJson: pool?.ok === true ? pool.json : undefined,
      index,
      masterPath: detected.layout?.masterPath
    })
    board.layers = {
      definition: index === undefined ? 'missing' : 'ok',
      state: 'ok',
      pool: pool?.ok === true ? 'ok' : (pool?.reason ?? 'not-loaded')
    }
    sendJson(res, 200, envelope({ ok: true, startedAt, data: board }))
  } catch (error) {
    sendJson(res, 500, envelope({ ok: false, startedAt, error: internalError(error) }))
  }
}

/** GET /orchd/api/task */
async function handleTask(deps, req, res, url) {
  const startedAt = Date.now()
  const sessionId = url.searchParams.get('session') ?? ''
  const taskId = url.searchParams.get('id') ?? ''
  if (sessionId === '') {
    sendJson(res, 400, envelope({ ok: false, startedAt, error: { kind: 'bad_request', reason: 'missing-session', message: 'query parameter `session` is required' } }))
    return
  }
  if (!isTaskId(taskId)) {
    sendJson(res, 400, envelope({ ok: false, startedAt, error: { kind: 'bad_request', reason: 'invalid-task-id', message: `\`id\` must match ^task-[a-z0-9-]+$, got ${JSON.stringify(taskId)}` } }))
    return
  }

  try {
    const refresh = url.searchParams.get('refresh') === '1'
    const loaded = await loadContext(deps, sessionId, { refresh })
    if (loaded.ok !== true) {
      sendJson(res, 200, envelope({ ok: false, startedAt, error: loaded.error }))
      return
    }
    const { detected } = loaded
    if (detected.state !== 'ready') {
      sendJson(res, 200, envelope({
        ok: false,
        startedAt,
        error: { kind: detected.state, reason: detected.reason ?? detected.state, message: reasonText(detected.reason ?? detected.state), details: detected.detail }
      }))
      return
    }

    const index = await loadDefinition(deps, detected)
    const definition = index?.tasks?.get(taskId)

    const detail = await deps.caches.detail.get(`${keyOf(detected.root)}|${taskId}`, refresh, async () =>
      deps.cli.statusOne({ root: detected.root, workDir: detected.layout?.mainWorktree, python: detected.python }, taskId)
    )

    // 单任务失败**不得**让整个面板进入 broken（docs/02 第 12 节末）：这里返回 ok:false，
    // 由前端在详情区显示局部错误。
    if (detail?.ok !== true) {
      if (definition === undefined) {
        sendJson(res, 200, envelope({
          ok: false,
          startedAt,
          error: {
            kind: detail?.timedOut === true ? 'timeout' : 'broken',
            reason: detail?.reason ?? 'cli-failed',
            message: reasonText(detail?.reason ?? 'cli-failed'),
            engineCode: detail?.engineCode ?? null,
            details: { argv: detail?.argv, exitCode: detail?.exitCode, stderr: trimStderr(detail?.stderr) }
          }
        }))
        return
      }
    }

    const stateRow = detail?.json?.task
    const detailModel = buildTaskDetail(definition, stateRow, index, {
      blockedDownstream: undefined
    })

    // 审查历史：只在有历史可言时才拉（避免对 800 个终态任务的每个详情都多跑一次 CLI）
    let reviewHistory
    if (url.searchParams.get('review') === '1') {
      const review = await deps.caches.review.get(`${keyOf(detected.root)}|${taskId}`, refresh, () =>
        deps.cli.reviewShow({ root: detected.root, workDir: detected.layout?.mainWorktree, python: detected.python }, taskId)
      )
      reviewHistory = review?.ok === true ? review.json : { unavailable: true, reason: review?.reason ?? 'not-loaded' }
    }

    sendJson(res, 200, envelope({
      ok: true,
      startedAt,
      data: {
        task: detailModel,
        upstream: detailModel.dependsOn,
        dependents: detailModel.dependents,
        downstreamCount: detailModel.dependents.length,
        reviewHistory: reviewHistory ?? null,
        definitionLayerAvailable: definition !== undefined,
        stateLayerResult: detail?.ok === true ? 'ok' : (detail?.reason ?? 'unknown')
      }
    }))
  } catch (error) {
    sendJson(res, 500, envelope({ ok: false, startedAt, error: internalError(error) }))
  }
}

/**
 * GET /orchd/api/history —— **审查事件时间线**（FR-8，P2 收窄）。
 *
 * 数据来源仅 `review --task <id> --show`（引擎**唯一**的只读历史回看命令，docs/03 第 5.7 节），
 * 它只返回 `REVIEW_SUBMITTED`；其余事件类型（认领 / 完成 / 审查认领 / 强制状态 / 撤回 / 修订）
 * 引擎 CLI 不暴露，插件也不直读账本（A2）——由 `unsupportedTypes` 显式告知 UI，不伪造（AC-8.5）。
 *
 * 单任务失败**不得**让整个面板进入 broken（docs/02 第 12 节末）：这里返回 ok:false，
 * 由前端在详情区局部显示错误。
 */
async function handleHistory(deps, req, res, url) {
  const startedAt = Date.now()
  const sessionId = url.searchParams.get('session') ?? ''
  const taskId = url.searchParams.get('id') ?? ''
  if (sessionId === '') {
    sendJson(res, 400, envelope({ ok: false, startedAt, error: { kind: 'bad_request', reason: 'missing-session', message: 'query parameter `session` is required' } }))
    return
  }
  if (!isTaskId(taskId)) {
    sendJson(res, 400, envelope({ ok: false, startedAt, error: { kind: 'bad_request', reason: 'invalid-task-id', message: `\`id\` must match ^task-[a-z0-9-]+$, got ${JSON.stringify(taskId)}` } }))
    return
  }

  try {
    const refresh = url.searchParams.get('refresh') === '1'
    const loaded = await loadContext(deps, sessionId, { refresh })
    if (loaded.ok !== true) {
      sendJson(res, 200, envelope({ ok: false, startedAt, error: loaded.error }))
      return
    }
    const { detected } = loaded
    if (detected.state !== 'ready') {
      sendJson(res, 200, envelope({
        ok: false,
        startedAt,
        error: { kind: detected.state, reason: detected.reason ?? detected.state, message: reasonText(detected.reason ?? detected.state), details: detected.detail }
      }))
      return
    }

    const target = { root: detected.root, workDir: detected.layout?.mainWorktree, python: detected.python }
    const review = await deps.caches.review.get(`${keyOf(detected.root)}|${taskId}`, refresh, () =>
      deps.cli.reviewShow(target, taskId)
    )
    if (review?.ok !== true) {
      sendJson(res, 200, envelope({
        ok: false,
        startedAt,
        error: {
          kind: review?.timedOut === true ? 'timeout' : 'broken',
          reason: review?.reason ?? 'cli-failed',
          message: reasonText(review?.reason ?? 'cli-failed'),
          engineCode: review?.engineCode ?? null,
          details: { argv: review?.argv, exitCode: review?.exitCode, stderr: trimStderr(review?.stderr) }
        }
      }))
      return
    }

    // 当前状态摘要：与 /task 共用 detail 缓存（同一 key），命中时不额外起进程。
    // 取不到也不致命——时间线本身可用，current 落成全 null。
    const detail = await deps.caches.detail.get(`${keyOf(detected.root)}|${taskId}`, false, () =>
      deps.cli.statusOne(target, taskId)
    )
    const timeline = buildReviewTimeline(review.json, detail?.ok === true ? detail.json?.task : undefined)
    timeline.stateLayerResult = detail?.ok === true ? 'ok' : (detail?.reason ?? 'unknown')
    sendJson(res, 200, envelope({ ok: true, startedAt, data: timeline }))
  } catch (error) {
    sendJson(res, 500, envelope({ ok: false, startedAt, error: internalError(error) }))
  }
}

/**
 * GET /orchd/api/graph —— 依赖图与阻塞链（FR-7，P2b）。
 *
 * 一次请求 = 一次 `status --all` + 一次 `pool --all` + 定义层直读（都走缓存，与 `/board` 同源），
 * 图在**宿主侧**构建（环 / 悬空 / 自依赖检测都在这里做，前端只画）。
 *
 * 参数：`focus?`（聚焦任务 id）、`depth?`（聚焦闭包层数，1..20，缺省 = 全闭包）、
 * `includeTerminal=1`（把终态任务也画进来；聚焦模式下忽略，见 `buildGraph` 的说明）。
 * 依赖数据只来自定义文件（FR-7.5），阻塞数只来自 `pool --all`（AC-7.2）。
 */
async function handleGraph(deps, req, res, url) {
  const startedAt = Date.now()
  const sessionId = url.searchParams.get('session') ?? ''
  const focus = url.searchParams.get('focus')
  if (sessionId === '') {
    sendJson(res, 400, envelope({ ok: false, startedAt, error: { kind: 'bad_request', reason: 'missing-session', message: 'query parameter `session` is required' } }))
    return
  }
  // focus 是「可选参数」，一旦给了就必须合法：形状不对 → 400（不拿它当路径用，NFR-2.1）
  if (focus !== null && !isTaskId(focus)) {
    sendJson(res, 400, envelope({ ok: false, startedAt, error: { kind: 'bad_request', reason: 'invalid-task-id', message: `\`focus\` must match ^task-[a-z0-9-]+$, got ${JSON.stringify(focus)}` } }))
    return
  }
  let depth = null
  const rawDepth = url.searchParams.get('depth')
  if (rawDepth !== null) {
    const parsed = Number(rawDepth)
    // 上限 20 只是防呆：真实的依赖链不会这么深，给个上限避免 `depth=1e9` 这类输入
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
      sendJson(res, 400, envelope({ ok: false, startedAt, error: { kind: 'bad_request', reason: 'invalid-depth', message: `\`depth\` must be an integer in 1..20, got ${JSON.stringify(rawDepth)}` } }))
      return
    }
    depth = parsed
  }

  try {
    const refresh = url.searchParams.get('refresh') === '1'
    const loaded = await loadContext(deps, sessionId, { refresh })
    if (loaded.ok !== true) {
      sendJson(res, 200, envelope({ ok: false, startedAt, error: loaded.error }))
      return
    }
    const { detected } = loaded
    if (detected.state !== 'ready') {
      sendJson(res, 200, envelope({
        ok: false,
        startedAt,
        error: { kind: detected.state, reason: detected.reason ?? detected.state, message: reasonText(detected.reason ?? detected.state), details: detected.detail }
      }))
      return
    }

    const index = await loadDefinition(deps, detected)
    const status = await loadStatusLayer(deps, detected, refresh)
    if (status?.ok !== true) {
      sendJson(res, 200, envelope({
        ok: false,
        startedAt,
        error: {
          kind: status?.timedOut === true ? 'timeout' : 'broken',
          reason: status?.reason ?? 'cli-failed',
          message: reasonText(status?.reason ?? 'cli-failed'),
          engineCode: status?.engineCode ?? null,
          details: { argv: status?.argv, exitCode: status?.exitCode, stderr: trimStderr(status?.stderr) }
        }
      }))
      return
    }

    const pool = await loadPoolLayer(deps, detected, refresh)
    const board = buildBoard({
      statusJson: status.json,
      poolJson: pool?.ok === true ? pool.json : undefined,
      index,
      masterPath: detected.layout?.masterPath
    })
    board.layers = {
      definition: index === undefined ? 'missing' : 'ok',
      state: 'ok',
      pool: pool?.ok === true ? 'ok' : (pool?.reason ?? 'not-loaded')
    }

    if (focus !== null && !board.tasks.some((row) => row.id === focus)) {
      sendJson(res, 400, envelope({
        ok: false,
        startedAt,
        error: { kind: 'bad_request', reason: 'unknown-focus', message: `no such task: ${focus}` }
      }))
      return
    }

    const graph = buildGraph({
      index,
      rows: board.tasks,
      focus: focus ?? null,
      depth,
      includeTerminal: url.searchParams.get('includeTerminal') === '1'
    })
    graph.project = board.project
    graph.layers = board.layers
    graph.capabilities = board.capabilities
    sendJson(res, 200, envelope({ ok: true, startedAt, data: graph }))
  } catch (error) {
    sendJson(res, 500, envelope({ ok: false, startedAt, error: internalError(error) }))
  }
}

/**
 * GET /orchd/api/ideas —— FR-13 想法看板（三层取数）。
 *
 * 数据来源（docs/03 第 6 节）：
 *   1. 引擎清单 `ideas list`（可能有 / 旧引擎可能没有 → 能力缺失降级）；
 *   2. `IDEAS.md` 活跃层（直读，唯一有正文的一层）；
 *   3. 归档件（只**扫描**计数，不解析正文，FR-13.12）。
 *
 * 只读：全程不写任何文件（FR-10 / FR-13.8）。
 */
async function handleIdeas(deps, req, res, url) {
  const startedAt = Date.now()
  const sessionId = url.searchParams.get('session') ?? ''
  if (sessionId === '') {
    sendJson(res, 400, envelope({ ok: false, startedAt, error: { kind: 'bad_request', reason: 'missing-session', message: 'query parameter `session` is required' } }))
    return
  }

  try {
    const refresh = url.searchParams.get('refresh') === '1'
    const loaded = await loadContext(deps, sessionId, { refresh })
    if (loaded.ok !== true) {
      sendJson(res, 200, envelope({ ok: false, startedAt, error: loaded.error }))
      return
    }
    const { detected } = loaded
    if (detected.state !== 'ready') {
      sendJson(res, 200, envelope({
        ok: false,
        startedAt,
        error: { kind: detected.state, reason: detected.reason ?? detected.state, message: reasonText(detected.reason ?? detected.state), details: detected.detail }
      }))
      return
    }

    // 清单：引擎只给 title / id / status
    const list = await deps.caches.ideas.get(keyOf(detected.root), refresh, () =>
      deps.cli.ideasList({ root: detected.root, workDir: detected.layout?.mainWorktree, python: detected.python })
    )
    // 引擎**没有 `ideas` 子命令**（旧版本，实测 v1.5.0：argparse `invalid choice: 'ideas'`，
    // exit=2，E007）⇒ 这不是项目坏了，而是**能力缺失**：优雅降级成「只读 IDEAS.md + 归档」，
    // 并把这件事显式告诉界面。否则用户看到的是「orchd 状态异常 / 引擎返回了失败状态」，
    // 既吓人又误导（用户实测反馈）。
    const ideasUnsupported = list?.ok !== true && isUnsupportedCommand(list, 'ideas')
    if (list?.ok !== true && !ideasUnsupported) {
      sendJson(res, 200, envelope({
        ok: false,
        startedAt,
        error: {
          kind: list?.timedOut === true ? 'timeout' : 'broken',
          reason: list?.reason ?? 'cli-failed',
          message: reasonText(list?.reason ?? 'cli-failed'),
          engineCode: list?.engineCode ?? null,
          details: { argv: list?.argv, exitCode: list?.exitCode, stderr: trimStderr(list?.stderr) }
        }
      }))
      return
    }

    const mainWorktree = detected.layout?.mainWorktree
    const ideasPath = ideasFileOf(mainWorktree)
    const archivePath = ideasArchiveOf(mainWorktree)

    // 正文 + 归档**流式扫描**：按文件指纹/文件大小缓存；归档只扫 `## `/`- id:`/`- status:`
    // 三行，不解析正文、不把全文留在内存（FR-13.12）
    const filesKey = `${keyOf(detected.root)}|ideas`
    const files = await deps.caches.ideasFiles.get(filesKey, refresh, async () => {
      const markdown = await readTextFile(ideasPath)
      const archive = await scanArchiveFile(archivePath)
      return { markdown, archive }
    })

    const parsed = parseIdeasMarkdown(files.markdown.text ?? '')
    // ⚠ `status` 不是「是否已立任务」的标记（引擎 rules/intake.md：在途条目按 E025
    // 必须保持 pending，`taskified` 只服务撞车并入）。所以用定义层做「已转任务」判定，
    // 覆盖字面上的 pending（FR-13.3b / docs/03 E025 溯源）。
    const definition = await loadDefinition(deps, detected)
    // 引用判据 = `source` ∪ `additional_sources`（引擎 rules ④ 同判据）
    const ideaTaskIndex = buildIdeaTaskIndex(definition?.tasks)
    // 引擎不支持 `ideas` 时没有清单可合并，只读 Markdown（`mergeIdeasList(null, …)` 就是这条路，
    // 条目会带上「仅存在于 IDEAS.md」的标记，界面本来就会这么显示）
    const engineList = ideasUnsupported ? null : list.json
    const entries = applyConvertedStatus(mergeIdeasList(engineList, parsed.entries), ideaTaskIndex)
    const summary = summarizeIdeas(entries)
    // 归档分组：**与任务池对照**（用户口径 / FR-13.7）。
    // 不按归档件里的字面 status 分组——引擎明确归档不改写 status（语义是「已消费」），
    // 实测 312/373 条仍写着 pending，其中 287 条在任务池里有引用。
    // 「已丢弃」用扫描时收下的归档件自身 status（`statusById`），不能用 IDEAS.md 的状态表。
    const archived = classifyArchive(files.archive, ideaTaskIndex)
    // ⚠ 两个集合必须各自取「本层」的 id：曾误用合并后的 entries 当作引擎清单，
    // 导致只存在于 Markdown 的条目也被算成「引擎也有」，mismatches 恒为空。
    const listIds = new Set(
      (Array.isArray(list.json?.ideas) ? list.json.ideas : [])
        .map((idea) => idea?.id)
        .filter((id) => typeof id === 'string')
    )
    const markdownIds = new Set(parsed.entries.map((entry) => entry.id).filter((id) => typeof id === 'string'))

    sendJson(res, 200, envelope({
      ok: true,
      startedAt,
      data: {
        entries,
        counts: { byStatus: summary.byStatus, unknown: summary.unknown, total: summary.total },
        needsUser: summary.needsUser,
        /**
         * 引擎没有 `ideas` 子命令（旧版本）时为 true：此时列表与状态**只来自 IDEAS.md**，
         * 没有引擎清单可交叉核对。界面必须显式说明，不能装成正常。
         */
        unsupported: ideasUnsupported,
        unsupportedHint: ideasUnsupported ? 'engine-ideas-command-missing' : null,
        /**
         * 活跃层的**三分区**（用户口径）：
         *   `total = active + converted + dropped`
         * 其中 `active = 论证中 + 待补充 + 待拆解`，converted/dropped 都算离队。
         */
        active: summary.active,
        /** 活跃层内已转任务的条数（由任务池引用推出，不是归档计数） */
        converted: summary.converted,
        /** 活跃层内已丢弃（离队） */
        dropped: summary.dropped,
        archivedCount: files.archive.count,
        /**
         * 归档分组（FR-13.7）：**与任务池对照**判定「已转任务」，不按归档件里的字面 status。
         *   taskified  任务池（source ∪ additional_sources）引用了该 id
         *   dropped    未被引用且字面 status = dropped
         *   untasked   未被引用（人工裁决「已消费」离场）
         *   noId       小节缺 `- id:`，无从对照（存量数据问题，显式计数不静默丢）
         * `byLiteralStatus` 仅作诊断：引擎明确归档不改写 status，不是分组依据。
         */
        archived: { ...archived, byLiteralStatus: files.archive.byStatus ?? {} },
        // 统计条要渲染的芯片状态集合：固定 5 个想法状态，保证三分区在界面上闭合（FR-13.6）
        activeStatuses: ideaStripStatuses(),
        layers: {
          list: ideasUnsupported ? 'unsupported' : 'ok',
          markdown: files.markdown.reason === null ? 'ok' : files.markdown.reason,
          archive: files.archive.reason === null ? 'ok' : files.archive.reason
        },
        // 两层不一致时显式报告（与任务看板的 orphans 同一思路）：不清洗、不丢弃
        mismatches: {
          onlyInEngine: [...listIds].filter((id) => !markdownIds.has(id)),
          onlyInMarkdown: [...markdownIds].filter((id) => !listIds.has(id))
        },
        paths: { ideas: ideasPath, archive: archivePath },
        commentSectionsSkipped: parsed.skippedCommentSections,
        degraded: parsed.degraded
      }
    }))
  } catch (error) {
    sendJson(res, 500, envelope({ ok: false, startedAt, error: internalError(error) }))
  }
}

/**
 * 合并两层：
 *  - 引擎清单是**权威的存在性与状态**（`status` 以引擎为准，FR-13.3）；
 *  - Markdown 提供正文（`goal`/`idea`/`论证`/`detail`/`notes`/未知字段）。
 * 任一层缺失该条时，另一层的信息仍然保留（不丢数据）。
 */
function mergeIdeasList(listJson, markdownEntries) {
  const byId = new Map()
  for (const entry of markdownEntries) if (typeof entry.id === 'string') byId.set(entry.id, entry)
  const engineIdeas = Array.isArray(listJson?.ideas) ? listJson.ideas : []
  const merged = []
  const used = new Set()

  for (const idea of engineIdeas) {
    const id = typeof idea?.id === 'string' ? idea.id : null
    const detail = id === null ? undefined : byId.get(id)
    if (id !== null) used.add(id)
    const status = IDEA_STATUSES.includes(idea?.status) ? idea.status : (detail?.status ?? null)
    merged.push({
      ...(detail ?? { id, title: typeof idea?.title === 'string' ? idea.title : null, date: null, goal: null, idea: null, argument: null, detail: null, notes: [], extra: {}, degraded: true }),
      id,
      // 引擎的 status 优先（权威运行时事实）；引擎不认识时退回定义层
      status,
      owner: status === null ? 'none' : IDEA_OWNER[status],
      // 引擎标题里带日期与 id 后缀，Markdown 标题更干净；两者都保留
      engineTitle: typeof idea?.title === 'string' ? idea.title : null
    })
  }
  // 只在 Markdown 里出现的条目照常展示（引擎清单可能不完整）
  for (const entry of markdownEntries) {
    if (entry.id !== null && used.has(entry.id)) continue
    merged.push({ ...entry, engineTitle: null })
  }
  return merged
}

/** 读文本文件，失败不抛（返回 reason 供 UI 显示）。 */
async function readTextFile(path) {
  try {
    const { readFile } = await import('node:fs/promises')
    const text = await readFile(path, 'utf8')
    return { text, reason: null }
  } catch (error) {
    const code = error?.code
    if (code === 'ENOENT') return { text: '', reason: 'ideas-missing' }
    return { text: '', reason: 'ideas-unreadable', detail: String(error) }
  }
}

/**
 * POST /orchd/api/install-entry —— 返回**将要注入的文本**供确认，本身不注入（FR-3.3）。
 * 只读：不碰 agents、不注入、不调引擎。
 */
async function handleInstallEntry(deps, req, res) {
  const startedAt = Date.now()
  const body = await readJsonBody(req)
  const sessionId = typeof body?.session === 'string' ? body.session : ''
  if (sessionId === '') {
    sendJson(res, 400, envelope({ ok: false, startedAt, error: { kind: 'bad_request', reason: 'missing-session', message: 'body field `session` is required' } }))
    return
  }
  try {
    const text = buildInstallPrompt(deps.config)
    // A 路径只在「未接入」时有意义（FR-3）
    const loaded = await loadContext(deps, sessionId, { refresh: false })
    const state = loaded.ok === true ? loaded.detected.state : null
    const support = probeInjectSupport(deps.ctx, sessionId)
    const applicable = state === 'not_installed'
    sendJson(res, 200, envelope({
      ok: true,
      startedAt,
      data: {
        supported: support.supported === true && applicable,
        reason: support.supported === false ? support.reason : (applicable ? null : `state-is-${String(state)}`),
        applicable,
        state,
        command: INSTALL_COMMAND,
        text
      }
    }))
  } catch (error) {
    sendJson(res, 500, envelope({ ok: false, startedAt, error: internalError(error) }))
  }
}

/**
 * POST /orchd/api/install-inject —— 执行注入（FR-3.2）。
 *
 * ⚠ 本端点**只能由用户的显式确认动作触发**：`/context`、`/board`、`/ideas` 等任何轮询/刷新
 * 路径都不得调用它（FR-3.3/FR-3.5）。注入的是**插件内常量模板**（NFR-2.4），
 * 且插件自身不执行 `git clone` / `install.py`（AC-3.2）。
 */
async function handleInstallInject(deps, req, res) {
  const startedAt = Date.now()
  const body = await readJsonBody(req)
  const sessionId = typeof body?.session === 'string' ? body.session : ''
  if (sessionId === '') {
    sendJson(res, 400, envelope({ ok: false, startedAt, error: { kind: 'bad_request', reason: 'missing-session', message: 'body field `session` is required' } }))
    return
  }
  // 防御：只有用户确认时前端才带 confirm=true（避免被轮询误触发）
  if (body?.confirm !== true) {
    sendJson(res, 400, envelope({ ok: false, startedAt, error: { kind: 'bad_request', reason: 'confirm-required', message: 'injection requires explicit `confirm: true`' } }))
    return
  }
  try {
    const loaded = await loadContext(deps, sessionId, { refresh: false })
    const state = loaded.ok === true ? loaded.detected.state : null
    if (state !== 'not_installed') {
      sendJson(res, 200, envelope({
        ok: false,
        startedAt,
        error: {
          kind: 'bad_request',
          reason: 'install-entry-not-applicable',
          message: `install entry only applies to not_installed projects (current state: ${String(state)})`
        }
      }))
      return
    }
    const text = buildInstallPrompt(deps.config)
    const result = injectInstallPrompt({ ctx: deps.ctx, sessionId, text })
    if (result.injected !== true) {
      sendJson(res, 200, envelope({
        ok: false,
        startedAt,
        error: {
          kind: 'bad_request',
          reason: result.reason ?? 'injection-unavailable',
          message: reasonText(result.reason ?? 'injection-unavailable')
        }
      }))
      return
    }
    sendJson(res, 200, envelope({ ok: true, startedAt, data: { injected: true, messageId: result.messageId, text } }))
  } catch (error) {
    sendJson(res, 500, envelope({ ok: false, startedAt, error: internalError(error) }))
  }
}

/** 读 JSON body（失败返回 null，不抛）。 */
function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        resolve(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null)
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : null)
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

function internalError(error) {
  return {
    kind: 'internal',
    reason: 'internal',
    message: error instanceof Error ? error.message : String(error),
    details: { stack: error instanceof Error ? error.stack ?? null : null }
  }
}

/** stderr 只取尾部若干字符，避免把宿主响应撑大。 */
function trimStderr(text) {
  if (typeof text !== 'string' || text === '') return null
  const limit = 2000
  return text.length <= limit ? text : `…${text.slice(text.length - limit)}`
}

/**
 * C 路径的安装说明（FR-3.1 / NFR-2.4）。
 * 文本是插件内**常量**，只允许拼接配置里的仓库地址，不得拼接任何项目文件内容。
 */
export function installInstructions(config) {
  const repo = resolveRepo(config)
  const mirror = ORCHD_MIRROR_REPO
  return {
    repo,
    mirror,
    officialRepo: ORCHD_OFFICIAL_REPO,
    steps: [
      `git clone ${repo} orchd-core`,
      'python orchd-core/install.py . --agent --cleanup',
      'python .orchd/__main__.py status'
    ],
    copyText: [
      `git clone ${repo} orchd-core`,
      'python orchd-core/install.py . --agent --cleanup',
      'python .orchd/__main__.py status'
    ].join('\n'),
    mirrorHint: repo === ORCHD_OFFICIAL_REPO ? `网络受限时可用镜像：${mirror}` : null
  }
}

/** 人类可读的失败原因文案（FR-9.1：任何失败都要有可见反馈）。 */
export function reasonText(reason) {
  const table = {
    'project-root-unresolved': '无法从当前会话推导出项目根目录。',
    'project-root-not-allowed': '推导出的项目根不在 allowRoots 白名单内。',
    'layout-unresolved': '无法定位 orchd 的布局（.layout.json 与真实工作树不一致）。',
    'layout-marker-mismatch': '布局标记声明的主工作树不存在，与磁盘实际情况不一致。',
    'python-not-found': '找不到可用的 Python 解释器（引擎要求 >= 3.11）。',
    'master-unparsable': '任务定义文件 _master.json 存在但不是合法 JSON。',
    'master-unreadable': '任务定义文件存在但无法读取。',
    'definition-archived-unsupported': '任务定义似乎已被归档到外部文件，本版本不支持读取。',
    'cli-failed': 'orchd 引擎返回了失败状态。',
    'cli-timeout': 'orchd 引擎调用超时。',
    'cli-unparsable': 'orchd 引擎的输出不是可解析的 JSON。',
    'definition-state-mismatch': '定义层与状态层的项目标识不一致。',
    'not_installed': '这个项目还没有接入 orchd。',
    'uninitialized': '已安装 orchd，但还没有任务定义。',
    'unknown-route': '未知的插件路由。',
    'method-not-allowed': '面板是只读的，只接受 GET。',
    'missing-session': '缺少 session 参数。',
    'invalid-task-id': '任务 id 形状不合法。',
    'confirm-required': '注入需要显式确认（confirm: true）。',
    'agents-service-unavailable': '平台没有提供 agents 服务，A 路径不可用；请用下面的命令手动接入。',
    'agent-not-found': '找不到这个会话对应的 agent，A 路径不可用；请用下面的命令手动接入。',
    'agent-cannot-steer': '这个会话的 agent 不支持注入，A 路径不可用；请用下面的命令手动接入。',
    'install-entry-not-applicable': 'A 路径只对「未接入 orchd」的项目可用。',
    'injection-unavailable': '注入不可用，请用下面的命令手动接入。',
    internal: '插件内部错误。'
  }
  return table[reason] ?? `未知失败原因：${reason}`
}

/**
 * `/orchd/api/` 前缀内只认这些**精确路径 + 方法**，其余 404（fail-closed）；
 * 路径存在但方法不对 → 405。
 *
 * 只有两条 POST 路由，都是安装入口 A 路径（FR-3）：一条**只取文本**、一条**执行注入**。
 * 其余全部是 GET 只读（FR-10）。
 */
const ROUTES = new Map([
  ['/orchd/api/context', { method: 'GET', handler: handleContext }],
  ['/orchd/api/board', { method: 'GET', handler: handleBoard }],
  ['/orchd/api/task', { method: 'GET', handler: handleTask }],
  ['/orchd/api/graph', { method: 'GET', handler: handleGraph }],
  ['/orchd/api/history', { method: 'GET', handler: handleHistory }],
  ['/orchd/api/ideas', { method: 'GET', handler: handleIdeas }],
  ['/orchd/api/install-entry', { method: 'POST', handler: handleInstallEntry }],
  ['/orchd/api/install-inject', { method: 'POST', handler: handleInstallInject }]
])

/**
 * 生成该插件要注册的路由表。
 * @param {object} deps { ctx, config, caches, runCli, host }
 * @param {(route: object) => (() => void)} register 注册函数（便于测试注入）
 */
export function routes(deps, register) {
  const disposers = []
  disposers.push(register({ kind: 'prefix', path: API_PREFIX, handler: (req, res) => handleApiPrefix(deps, req, res) }))
  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch (error) {
        deps.ctx.logger?.warn?.(`orchd-tasks: route disposer failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}

async function handleApiPrefix(deps, req, res) {
  const url = new URL(req.url ?? '/', 'http://orchd.invalid')
  // 登记本请求的日志上下文：失败的响应由 `sendJson` 统一记录（NFR-5.1）
  RESPONSE_FAILURES.set(res, { logger: deps.ctx?.logger ?? null, pathname: url.pathname, method: req.method })
  const route = ROUTES.get(url.pathname)
  if (route === undefined) {
    sendJson(res, 404, envelope({
      ok: false,
      startedAt: Date.now(),
      error: { kind: 'bad_request', reason: 'unknown-route', message: `unknown orchd api path ${url.pathname}` }
    }))
    return
  }
  if (req.method !== route.method) {
    sendJson(res, 405, envelope({
      ok: false,
      startedAt: Date.now(),
      error: {
        kind: 'bad_request',
        reason: 'method-not-allowed',
        message: `${req.method} is not allowed on ${url.pathname} (expected ${route.method})`
      }
    }))
    return
  }
  await route.handler(deps, req, res, url)
}

export { API_PREFIX, handleContext, handleBoard, handleTask, handleGraph, handleHistory, handleIdeas, handleInstallEntry, handleInstallInject, ROUTES }
