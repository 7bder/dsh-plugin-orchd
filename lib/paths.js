/**
 * 路径归一化小工具。
 *
 * 依据 docs/02-设计方案.md 第 3.2 / 4.5 节：
 *   - 路径一律 realpath 归一后再作为缓存键，避免同一项目出现两个 context；
 *   - Windows 大小写不敏感，比较时统一大小写。
 * 参考项目 「C:\VibeCoding\orchestra」 的 「.orchd」 是指向真实目录的 junction，
 * 所以 realpath 是硬要求（docs/05 第 3.5 节「四态判定的路径推导在 junction 下失效」）。
 */

import { realpathSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve, normalize } from 'node:path'

/**
 * realpath 归一；失败时退回 resolve + normalize（路径不存在也要能算出稳定键）。
 * @param {string} input
 * @returns {string}
 */
export function canonicalPath(input) {
  const resolved = normalize(resolve(input))
  try {
    return normalize(realpathSync.native ? realpathSync.native(resolved) : realpathSync(resolved))
  } catch {
    return resolved
  }
}

/** 比较两个路径是否指向同一位置（Windows 大小写不敏感）。 */
export function samePath(a, b) {
  if (a === undefined || b === undefined || a === null || b === null) return false
  return keyOf(a) === keyOf(b)
}

/** 缓存键：canonicalPath + 平台相关大小写折叠。 */
export function keyOf(input) {
  const canonical = canonicalPath(input)
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

/** 是否存在且是目录（不抛错）。 */
export function isDirectory(input) {
  try {
    return statSync(input).isDirectory()
  } catch {
    return false
  }
}

/** 是否存在且是文件（不抛错）。 */
export function isFile(input) {
  try {
    return statSync(input).isFile()
  } catch {
    return false
  }
}

/**
 * 引擎运行时根（账本/检查点所在目录）解析，`docs/09` §12.1 的固定顺序：
 *   `ORCHD_HOME` → 容器布局 `dirname(mainWorktree)/.orchd-runtime`
 *   → flat `<root>/.orchd-runtime` → `<root>/.orchd`。
 *
 * 只做目录存在性判断（`fs.stat` 元数据），**不读目录内容**；顺序靠前的候选
 * 不存在就回退到下一个，全部不存在返回 `null`（由调用方把 `status` 组件记成缺失）。
 *
 * @param {{ root?: string|null, layout?: object|null, env?: object|null }} [options]
 * @returns {string|null} 归一后的运行时根（不存在时 null）
 */
export function runtimeRootOf(options = {}) {
  const root = typeof options.root === 'string' && options.root !== '' ? options.root : null
  const layout = options.layout ?? null
  const env = options.env ?? process.env
  const override = typeof env?.ORCHD_HOME === 'string' && env.ORCHD_HOME.trim() !== '' ? env.ORCHD_HOME.trim() : null
  const mainWorktree = typeof layout?.mainWorktree === 'string' && layout.mainWorktree !== '' ? layout.mainWorktree : null

  const candidates = []
  if (override !== null) candidates.push(override)
  if (mainWorktree !== null) candidates.push(join(dirname(mainWorktree), '.orchd-runtime'))
  if (root !== null) {
    candidates.push(join(root, '.orchd-runtime'))
    candidates.push(join(root, '.orchd'))
  }

  const seen = new Set()
  for (const candidate of candidates) {
    const key = keyOf(candidate)
    if (seen.has(key)) continue
    seen.add(key)
    if (isDirectory(candidate)) return canonicalPath(candidate)
  }
  return null
}

export { existsSync }
