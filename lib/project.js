/**
 * 「sessionId → 项目根」 推导（FR-1）。
 *
 * 依据 docs/02 第 3.2 节与 docs/04 第 8.3 节：
 *
 * 「」「
 * 1) allowRoots 覆写（仅调试）
 * 2) workspaceRegistry.list().filter(w => w.sessionIds.includes(sessionId))[0]?.path
 * 3) 会话 header 的 cwd（DSH 保证是绝对路径）
 * 4) 都拿不到 → broken/project-root-unresolved
 * 「」「
 *
 * 关键纪律（NFR-2.1 / NFR-2.2 / AC-1.3）：
 *   - **绝不接受请求里的任何路径参数**；出现 「root」/「path」 记 warning 并忽略；
 *   - allowRoots 非空时，项目根不在其中直接拒绝（防御性收敛）。
 *
 * A-5 已由 「workspaceRegistry.readSessionHeader(id)」 关闭（M0 侦察结论）：
 * 它是 live → 内存索引 → 持久化快照的三级回退，正是这里需要的兜底入口。
 */

import { isAbsolute } from 'node:path'
import { canonicalPath, isDirectory, keyOf } from './paths.js'

/**
 * @typedef {object} ProjectResolution
 * @property {string} root 规范化后的项目根
 * @property {'allow-roots'|'workspace-registry'|'session-cwd'} source
 * @property {string|null} workspaceId
 * @property {string|null} sessionCwd
 */

/**
 * @param {object} ctx 宿主根 context
 * @param {string} sessionId
 * @param {object} config 规范化后的配置
 * @returns {Promise<ProjectResolution | { error: { reason: string, detail?: object } }>}
 */
export async function resolveProjectRoot(ctx, sessionId, config) {
  const warnings = []

  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    return { error: { reason: 'project-root-unresolved', detail: { why: 'session id is empty' } } }
  }

  // 1) 调试覆写：allowRoots 只影响「允许哪些根通过」，不改变推导顺序。
  //    但若配置了 allowRoots，且本会话推导不出根，仍走后面的兜底。
  let derived = null

  // 2) workspace 注册表
  const registry = ctx.get?.('workspaceRegistry') ?? ctx.workspaceRegistry
  if (registry !== undefined && registry !== null) {
    try {
      const workspaces = registry.list()
      for (const workspace of workspaces) {
        const sessionIds = workspace?.sessionIds
        if (Array.isArray(sessionIds) && sessionIds.includes(sessionId)) {
          const path = workspace.path ?? workspace.record?.path
          if (typeof path === 'string' && isAbsolute(path)) {
            derived = { root: canonicalPath(path), source: 'workspace-registry', workspaceId: workspace.id ?? workspace.workspaceId ?? null }
            break
          }
          warnings.push(`workspace ${String(workspace?.id)} owns this session but has no absolute path`)
        }
      }
    } catch (error) {
      warnings.push(`workspaceRegistry.list() failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    warnings.push('workspaceRegistry service is unavailable')
  }

  // 3) 会话 header 的 cwd
  let sessionCwd = null
  if (derived === null && registry !== undefined && registry !== null && typeof registry.readSessionHeader === 'function') {
    try {
      const header = await registry.readSessionHeader(sessionId)
      if (typeof header?.cwd === 'string' && isAbsolute(header.cwd)) sessionCwd = header.cwd
      else warnings.push('session header has no absolute cwd')
    } catch (error) {
      warnings.push(`readSessionHeader failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (derived === null && sessionCwd !== null) {
    derived = { root: canonicalPath(sessionCwd), source: 'session-cwd', workspaceId: null }
  }

  if (derived === null) {
    return {
      error: {
        reason: 'project-root-unresolved',
        detail: { sessionId, warnings }
      }
    }
  }

  // allowRoots 收敛（Q5：默认空 = 不限制）
  if (Array.isArray(config.allowRoots) && config.allowRoots.length > 0) {
    const allowed = config.allowRoots.map((entry) => keyOf(entry))
    if (!allowed.includes(keyOf(derived.root))) {
      return {
        error: {
          reason: 'project-root-not-allowed',
          detail: { root: derived.root, allowRoots: config.allowRoots }
        }
      }
    }
    return { ...derived, source: 'allow-roots', warnings }
  }

  return { ...derived, sessionCwd, warnings }
}

/**
 * 忽略请求里出现的一切路径参数（NFR-2.1 / AC-1.3）。
 * @param {URL} url
 * @returns {string[]} 被忽略的参数名（用于 warning 日志）
 */
export function collectIgnoredPathParams(url) {
  const ignored = []
  const forbidden = ['root', 'path', 'dir', 'project', 'projectRoot', 'cwd', 'file']
  for (const key of url.searchParams.keys()) {
    if (forbidden.includes(key)) ignored.push(key)
    else if (/root|path|cwd|dir/i.test(key)) ignored.push(key)
  }
  return [...new Set(ignored)]
}

/** 项目根必须存在且是目录，否则这次推导视为失败。 */
export function validateRoot(root) {
  if (typeof root !== 'string' || !isAbsolute(root)) {
    return { ok: false, reason: 'project-root-unresolved', detail: { why: 'not an absolute path', root } }
  }
  if (!isDirectory(root)) {
    return { ok: false, reason: 'project-root-unresolved', detail: { why: 'not a directory', root } }
  }
  return { ok: true }
}
