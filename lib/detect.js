/**
 * 四态检测（FR-2）。
 *
 * 依据 docs/02-设计方案.md 第 5 节。判定顺序（每一步的 「reason」 都机器可读，FR-2.2）：
 *
 *   ① 安装痕迹            → not_installed
 *   ② 布局 / 布局一致性     → broken/layout-unresolved | broken/layout-marker-mismatch
 *   ③ Python              → broken/python-not-found
 *   ④ 定义层 缺失          → uninitialized（或 broken/definition-archived-unsupported）
 *   ④' 定义层 损坏         → broken/master-unparsable
 *   ⑤ 状态层（一次 CLI）    → broken/cli-timeout | broken/cli-failed      ← P1 起启用
 *   ⑥ 一致性交叉检查        → broken/definition-state-mismatch            ← P1 起启用
 *   → ready
 *
 * 与文档的唯一偏差：把「布局一致性」放到了 Python 探测之前。理由是文档把
 * «布局标记与真实主工作树不一致» 列进了 「broken」 的判定集合（FR-2 表格与 AC-2.5），
 * 而 python-not-found 会抢先返回、把 AC-2.5 永久遮蔽。两者都是 broken，
 * 只是谁先被报出来；先报更具体的那一个更利于排障。
 *
 * P0 范围（docs/05 第 3.2 节）：不含 CLI 状态层调用、不含一致性交叉检查，
 * 因此本模块的 「runCli」 允许缺省；P1 传入真实封装即可启用 ⑤⑥。
 */

import { hasInstallationTrace, findArchiveCandidates, readMaster, resolveLayout } from './master.js'
import { probePython } from './python.js'

/** 机器可读的失败原因分类（FR-2.2）。 */
export const BROKEN_REASONS = Object.freeze([
  'project-root-unresolved',
  'project-root-not-allowed',
  'layout-unresolved',
  'layout-marker-mismatch',
  'python-not-found',
  'master-unparsable',
  'master-unreadable',
  'definition-archived-unsupported',
  'cli-failed',
  'cli-timeout',
  'definition-state-mismatch',
  'internal'
])

/**
 * @param {object} args
 * @param {string} args.root 项目根（已由宿主推导，绝不来自请求）
 * @param {object} args.config 规范化后的配置
 * @param {Function} [args.runCli] CLI 封装（P1 起传入；P0 缺省）
 * @returns {Promise<object>} DetectedState（形状见 docs/02 第 7 节）
 */
export async function detect({ root, config, runCli }) {
  // ① 安装痕迹
  if (!hasInstallationTrace(root)) {
    return { state: 'not_installed', root }
  }

  // ② 布局（含一致性）
  const layout = resolveLayout(root)
  if (layout.ok !== true) {
    return { state: 'broken', root, reason: layout.reason, detail: layout.detail }
  }

  // ③ Python
  const python = await probePython(config)
  if (python.error !== undefined) {
    return { state: 'broken', root, reason: 'python-not-found', detail: python.error, layout }
  }

  // ④ 定义层
  const master = readMaster(layout.masterPath)
  if (master.ok !== true) {
    // 文件不存在 → 装了但没初始化。唯一例外：定义被归档到别处（R8），
    // 那要显式报「不支持」而不是误报 uninitialized。
    if (master.reason === 'master-missing' || master.reason === 'master-unreadable') {
      const archives = findArchiveCandidates(layout)
      if (archives.length > 0) {
        return {
          state: 'broken',
          root,
          reason: 'definition-archived-unsupported',
          detail: { layout: summarizeLayout(layout), python, archives },
          layout,
          python
        }
      }
      if (master.reason === 'master-missing') return { state: 'uninitialized', root, layout, python }
      // 文件在但读不出来（权限/IO）→ 这是 broken，不是「没初始化」。
      return { state: 'broken', root, reason: 'master-unreadable', detail: master.detail, layout, python }
    }
    return {
      state: 'broken',
      root,
      reason: master.reason === 'master-unparsable' ? 'master-unparsable' : 'internal',
      detail: master.detail,
      layout,
      python
    }
  }

  // ⑤⑥ 状态层（P0 不做）
  if (typeof runCli !== 'function') {
    return {
      state: 'ready',
      root,
      layout,
      python,
      projectName: master.project.name,
      projectBrief: master.project.brief,
      schemaVersion: master.schemaVersion,
      taskCount: master.taskCount,
      summary: null,
      statusLayer: { checked: false, reason: 'not-implemented-in-p0' }
    }
  }

  // workDir = 主工作树：container 布局下引擎拒绝以容器根为 cwd（E036，见 orchd-cli.js 头注释）
  const status = await runCli({ root, python, layout, workDir: layout.mainWorktree, command: ['status', '--all'] })
  if (status.timedOut === true) {
    return { state: 'broken', root, reason: 'cli-timeout', detail: status, layout, python }
  }
  if (status.exitCode !== 0 || status.json?.error !== undefined) {
    return { state: 'broken', root, reason: 'cli-failed', detail: status, layout, python }
  }

  const engineName = status.json?.project?.name
  if (typeof engineName === 'string' && typeof master.project.name === 'string' && engineName !== master.project.name) {
    return {
      state: 'broken',
      root,
      reason: 'definition-state-mismatch',
      detail: { definition: master.project.name, engine: engineName },
      layout,
      python
    }
  }

  return {
    state: 'ready',
    root,
    layout,
    python,
    projectName: engineName ?? master.project.name,
    projectBrief: master.project.brief,
    schemaVersion: master.schemaVersion,
    taskCount: master.taskCount,
    summary: status.json?.summary ?? null,
    statusLayer: { checked: true }
  }
}

/** 只把布局里的关键字段带出去（避免把完整 marker 内容塞进响应）。 */
function summarizeLayout(layout) {
  return {
    kind: layout.kind,
    mainWorktree: layout.mainWorktree,
    masterPath: layout.masterPath,
    storeHint: layout.storeHint,
    markerPath: layout.markerPath,
    markerRead: layout.markerRead
  }
}

export { summarizeLayout }
