/**
 * 宿主半侧入口：cordis 插件。
 *
 * 依据 docs/02 第 3.1 节：
 *   - 全部注册都走 「ctx.effect(() => disposer, label)」，保证插件禁用时零残留（FR-12.3）；
 *   - 配置非法只记 warning 并降级到默认值，**不阻止插件挂载**；
 *   - 「/orchd/」 前缀避开 「/api」 与 「/plugins」；
 *   - 请求来源校验在 desktop profile 下由外壳代做（docs/04 第 7.1 节），
 *     web profile 下 「/orchd/」 不在 「/api」 栅栏内，因此插件自己只做「不接受路径参数」的收敛。
 *
 * 注入刻意取最小集：「workspaceRegistry」 是 FR-1 的首选路径。
 * 缺它时插件仍能挂载，只是项目根推导会退化到 「project-root-unresolved」
 * （docs/02 第 3.1 节要求：配置/依赖问题不能让面板整体消失）。
 */

import { normalizeConfig } from './config.js'
import { CACHE_MODULE_LOADED_AT, createProjectCaches } from './cache.js'
import { createCliInvoker } from './cli-invoke.js'
import { API_PREFIX, loadContext, routes } from './routes.js'
import { INSTALL_COMMAND, buildInstallPrompt, buildUserMessage } from './install-entry.js'

export const name = 'dsh-plugin-orchd'
export const inject = ['webServer', 'workspaceRegistry']

/**
 * 开发期 HMR 探针的模块求值时刻。
 *
 * 它会随 「host.moduleLoadedAt」 进入 「/orchd/api/context」 的响应，从而**在面板底部可见**。
 * HMR 的模块替换会重新求值本模块 → 该值变；宿主进程没重启时 「uptime」 连续增长、「pid」 不变。
 * 三者一起看就能区分「模块热替换」与「进程重启」（见 README「迭代方式」）。
 * P4 工程化时应与 「/orchd/api/self」 一起移除，或按配置开关默认关闭。
 */
const MODULE_LOADED_AT = new Date().toISOString()

export function apply(ctx, rawConfig) {
  const { config, warnings } = normalizeConfig(rawConfig)
  for (const warning of warnings) ctx.logger?.warn?.(`orchd-tasks: config: ${warning}`)

  const caches = createProjectCaches(config)
  const cli = createCliInvoker(config, undefined, ctx.logger)
  const host = {
    moduleLoadedAt: MODULE_LOADED_AT,
    // cache.js 的求值时刻。HMR 级联重载时两个值会一起刷新；
    // 面板底部的「宿主模块」行只显示 moduleLoadedAt，这里同时回传以便分辨是哪个模块被换了。
    cacheModuleLoadedAt: CACHE_MODULE_LOADED_AT,
    pid: process.pid,
    uptimeMs: Math.round(process.uptime() * 1000)
  }
  const deps = { ctx, config, caches, cli, host }

  ctx.effect(
    () => routes(deps, (route) => ctx.webServer.register(route)),
    `orchd-tasks: prefix ${API_PREFIX}`
  )

  // ── 安装入口 A 路径的斜杠命令（P1b，FR-3.2）──────────────────────────────
  //
  // 用 **软注入** `ctx.inject(['commands'], …)`：命令服务缺失时回调不执行，插件照常加载
  // （FR-3.4 的降级语义；硬 `inject: ['commands']` 会让整个插件不激活）。
  // 这正是平台第一方插件的写法（见 dsh-plan-mode），机制细节记在 docs/04 第 9 节。
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.effect(
      () =>
        commandCtx.commands.register({
          // 品牌串在运行时就是普通字符串（profile 解析不到 @deepseek-ai/dsh-brand，无法 import）
          definitionId: 'dsh-plugin-orchd',
          name: INSTALL_COMMAND,
          description: '把「用 orchd 接入当前项目」的指令交给 agent（只注入提示词，插件自己不做安装）',
          handler: async ({ agent }) => {
            // 与 HTTP 端点**同一套守卫**：只对「未接入 orchd」的项目注入（FR-3）
            const sessionId = typeof agent?.session === 'string' ? agent.session : ''
            if (sessionId === '') {
              return { kind: 'error', text: '拿不到这个会话的身份，无法判断项目是否已接入；请用面板里的复制命令手动接入。' }
            }
            const loaded = await loadContext(deps, sessionId, { refresh: true })
            const state = loaded.ok === true ? loaded.detected.state : null
            if (state !== 'not_installed') {
              return { kind: 'error', text: `A 路径只对「未接入 orchd」的项目可用（当前状态：${String(state)}）。` }
            }
            if (typeof agent.steer !== 'function') {
              return { kind: 'error', text: '这个会话没有可注入的 agent，请改用面板里的复制命令手动接入。' }
            }
            // 注入的是**插件内常量模板**（NFR-2.4），不含任何项目文件内容
            agent.steer(buildUserMessage(buildInstallPrompt(config)))
            return { kind: 'success', text: '已把接入指令交给 agent。' }
          }
        }),
      'orchd-tasks: /orchd-install command'
    )
  })

  // 开发期自检路由：只回自己的进程/模块身份，不读项目、不调引擎（仍满足 FR-10）。
  // 用途见 MODULE_LOADED_AT 的注释。P4 工程化时应与 MODULE_LOADED_AT 一起移除，
  // 或按配置开关（例如 config.devProbe === true）默认关闭。
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/orchd/api/self',
        handler: (req, res) => {
          const body = JSON.stringify({
            ok: true,
            moduleLoadedAt: MODULE_LOADED_AT,
            processUptimeMs: Math.round(process.uptime() * 1000),
            processPid: process.pid,
            node: process.versions.node,
            at: new Date().toISOString()
          }, null, 2)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(body)
        }
      }),
    'orchd-tasks: GET /orchd/api/self (dev)'
  )

  ctx.logger?.info?.(`orchd-tasks: mounted (python=${config.pythonPath ?? 'auto'}, detectTtlMs=${config.detectTtlMs}, moduleLoadedAt=${MODULE_LOADED_AT}, cacheModuleLoadedAt=${host.cacheModuleLoadedAt}, pid=${host.pid})`)
}
