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
import { resolve, normalize } from 'node:path'

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

export { existsSync }
