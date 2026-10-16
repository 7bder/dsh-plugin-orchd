/**
 * 安装入口 A 路径：把「接入 orchd」的指令注入当前会话（FR-3.2/3.3/3.5、NFR-2.4）。
 *
 * 设计要点（机制与证据见 docs/04 第 9/9.1b/9.1c 节）：
 *   - **注入完全在宿主侧**：`ctx.agents.get(sessionId)` 取 Agent → `agent.steer(用户消息)`。
 *     因此不需要「浏览器主动触发命令」（V3 不是前置条件）。
 *   - **文本是插件内常量**（NFR-2.4）：只允许拼接配置里的仓库地址与固定命令，绝不读项目文件内容。
 *   - **只有用户显式确认才会调用**：本模块只被 `POST /orchd/api/install-inject` 调用一次，
 *     任何轮询/刷新路径都不得触碰（FR-3.3/FR-3.5）。
 *   - **手写消息对象**：profile 解析不到 `@deepseek-ai/dsh-llm`（实测 MODULE_NOT_FOUND），
 *     而 `createUserMessage` 等价于 `deepFrozen({...input, role:'user', id: uuid})`，所以手写即可。
 */

import { randomUUID } from 'node:crypto'
import { ORCHD_MIRROR_REPO, ORCHD_OFFICIAL_REPO, resolveRepo } from './config.js'

/** 斜杠命令名（小写、可含 `-`，见 docs/04 第 9.1 节）。 */
export const INSTALL_COMMAND = 'orchd-install'

/**
 * 接入指令模板（**常量**，NFR-2.4）。
 * 与 C 路径展示的命令同源，避免两条路径说法不一致。
 */
export function buildInstallPrompt(config) {
  const repo = resolveRepo(config)
  const mirror = ORCHD_MIRROR_REPO
  const lines = [
    '请帮我用 orchd 接入当前项目。',
    '',
    '背景：这是用户从 DSH 的「orchd 任务」面板点击确认后注入的请求；面板本身是**只读**的，不会替你做安装。',
    '',
    '请按 orchd 官方流程执行：',
    '1) 先在当前项目根目录确认工作区状态（未提交改动要先说明，不要擅自丢弃）。',
    '2) 执行 orchd 官方安装器完成接入（三选一，按你的环境）：',
    `   git clone ${repo} orchd-core`,
    '   python orchd-core/install.py . --agent --cleanup',
    '   python .orchd/__main__.py status',
    '3) 安装完成后运行一次 `python .orchd/__main__.py status` 确认接入成功，并把关键结果（项目名、任务数）告诉我。',
    '',
    '注意事项：',
    '- 引擎命令必须在**主工作树**下执行；容器布局下在容器根执行会被引擎拒绝（E036）。',
    '- 不要跳过 orchd 自己的初始化步骤，也不要手工改 `.orchd/` 下的定义文件。'
  ]
  if (repo === ORCHD_OFFICIAL_REPO) {
    lines.push(`- 网络受限时可用镜像：${mirror}`)
  }
  return lines.join('\n')
}

/**
 * 手写用户消息（等价于 `createUserMessage`，见模块头注释）。
 * 冻结一下，避免被后续代码误改（上游实现也是 deepFreeze）。
 */
export function buildUserMessage(text) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({ kind: 'user' })
  })
}

/**
 * 探测 A 路径是否可用（**只读**，不注入）。
 *
 * 降级语义（FR-3.4）：拿不到 `agents` 服务时返回 `supported:false` + 原因，
 * 前端据此禁用按钮并说明，C 路径不受影响。
 *
 * @param {object} ctx 宿主 cordis ctx
 * @param {string} sessionId
 */
export function probeInjectSupport(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') {
    return { supported: false, reason: 'missing-session' }
  }
  const agents = typeof ctx?.get === 'function' ? ctx.get('agents') : undefined
  if (agents === undefined || typeof agents.get !== 'function') {
    return { supported: false, reason: 'agents-service-unavailable' }
  }
  const agent = agents.get(sessionId)
  if (agent === undefined || agent === null) {
    return { supported: false, reason: 'agent-not-found' }
  }
  if (typeof agent.steer !== 'function') {
    return { supported: false, reason: 'agent-cannot-steer' }
  }
  return { supported: true, reason: null }
}

/**
 * 执行注入（**只应由用户确认动作触发一次**）。
 *
 * @param {object} args
 * @param {object} args.ctx 宿主 cordis ctx
 * @param {string} args.sessionId
 * @param {string} args.text 已构建好的常量文本
 * @returns {{injected: boolean, reason: string|null, messageId?: string}}
 */
export function injectInstallPrompt({ ctx, sessionId, text }) {
  const support = probeInjectSupport(ctx, sessionId)
  if (support.supported !== true) {
    return { injected: false, reason: support.reason }
  }
  const agent = ctx.get('agents').get(sessionId)
  const message = buildUserMessage(text)
  agent.steer(message)
  return { injected: true, reason: null, messageId: message.id }
}
