/**
 * TTL 缓存 + single-flight。
 *
 * 依据 docs/02 第 8 节：
 *   - 检测结果 TTL = detectTtlMs（默认 10 s），`refresh=1` 强制重探；
 *   - 状态层（`status --all`）TTL = cacheTtlMs（默认 5 s）——主要成本项；
 *   - 就绪池（`pool --all`）TTL = pollTtlMs（默认 30 s）——变化慢；
 *   - 定义层按「文件路径 + mtimeMs + size」做键，文件未变则永久复用；
 *   - 同一缓存键上的并发请求**合并为一次实际调用**（NFR-1.4）；
 *   - **失败不污染缓存**；按项目根 LRU，上限 maxProjectContexts。
 *
 * 实现是通用的 `createTtlCache(options)`；detect / status / pool / definition 各持一份实例，
 * 互不干扰（这样「探测 TTL」与「状态 TTL」可以独立调）。
 */

import { statSync } from 'node:fs'
import { keyOf } from './paths.js'

/** 本模块被求值的时刻 —— 开发期探针（见 lib/index.js 的 MODULE_LOADED_AT）。 */
export const CACHE_MODULE_LOADED_AT = new Date().toISOString()

/**
 * 通用 TTL 缓存 + single-flight + LRU。
 * @param {{ ttlMs: number, maxEntries?: number, now?: () => number }} options
 */
export function createTtlCache(options) {
  const now = options.now ?? (() => Date.now())
  const ttlMs = Math.max(0, options.ttlMs)
  const limit = Math.max(1, options.maxEntries ?? 8)

  /** @type {Map<string, { at: number, value: unknown }>} */
  const entries = new Map()
  /** @type {Map<string, Promise<unknown>>} */
  const inflight = new Map()

  function evict() {
    while (entries.size > limit) {
      const oldest = entries.keys().next()
      if (oldest.done === true) return
      entries.delete(oldest.value)
    }
  }

  /**
   * @param {string} key
   * @param {boolean} refresh 为 true 时跳过命中，强制重新计算
   * @param {() => Promise<unknown>} compute
   */
  async function get(key, refresh, compute) {
    if (refresh !== true) {
      const hit = entries.get(key)
      if (hit !== undefined && now() - hit.at < ttlMs) {
        entries.delete(key)
        entries.set(key, hit)
        return hit.value
      }
    }

    const pending = inflight.get(key)
    if (pending !== undefined) return pending

    const promise = (async () => {
      const value = await compute()
      if (value !== undefined && value !== null) {
        entries.set(key, { at: now(), value })
        evict()
      }
      return value
    })()

    inflight.set(key, promise)
    try {
      return await promise
    } finally {
      inflight.delete(key)
    }
  }

  return {
    get,
    clear: () => {
      entries.clear()
      inflight.clear()
    },
    size: () => entries.size,
    inflightSize: () => inflight.size,
    /** 仅测试用：直接塞一个值 */
    set: (key, value) => {
      entries.set(key, { at: now(), value })
      evict()
    }
  }
}

/**
 * 项目级缓存集合。key 一律经 `keyOf` 归一（realpath + 大小写折叠），
 * 避免同一项目出现两个 context（docs/02 第 3.2 节）。
 */
export function createProjectCaches(config) {
  const limit = Math.max(1, config.maxProjectContexts)
  return {
    detect: createTtlCache({ ttlMs: config.detectTtlMs, maxEntries: limit }),
    status: createTtlCache({ ttlMs: config.cacheTtlMs, maxEntries: limit }),
    pool: createTtlCache({ ttlMs: config.pollTtlMs, maxEntries: limit }),
    detail: createTtlCache({ ttlMs: config.detectTtlMs, maxEntries: limit * 4 }),
    review: createTtlCache({ ttlMs: 60_000, maxEntries: limit * 4 }),
    /** IDEAS 清单（`ideas list`）：变化慢，用 pollTtlMs（FR-13）。 */
    ideas: createTtlCache({ ttlMs: config.pollTtlMs, maxEntries: limit }),
    /** IDEAS 正文与归档计数：按文件指纹缓存（FR-13.12：归档不进默认加载路径）。 */
    ideasFiles: createTtlCache({ ttlMs: config.pollTtlMs, maxEntries: limit * 2 }),
    /** 定义层：TTL 视为无限，靠文件指纹失效（见 `definitionFingerprint`）。 */
    definition: createTtlCache({ ttlMs: Number.POSITIVE_INFINITY, maxEntries: limit })
  }
}

/**
 * 定义层缓存键 = 文件路径 + mtimeMs + size。
 * 文件被改写时指纹变化、自动失效；否则永久复用解析结果（2.3 MB 量级，Node 侧数十毫秒）。
 * @param {string} masterPath
 */
export function definitionFingerprint(masterPath) {
  try {
    const stat = statSync(masterPath)
    return `${keyOf(masterPath)}|${stat.mtimeMs}|${stat.size}`
  } catch {
    return `${keyOf(masterPath)}|missing`
  }
}

/**
 * 定义层读取（带指纹缓存）。
 * @param {object} caches `createProjectCaches` 的结果
 * @param {string} masterPath
 * @param {(path: string) => object} read 实际读取函数（通常是 `readMasterIndexed`）
 */
export async function cachedDefinition(caches, masterPath, read) {
  const key = definitionFingerprint(masterPath)
  return caches.definition.get(key, false, async () => read(masterPath))
}

/**
 * P0 兼容层：`detect` 缓存单独用（P0 的路由只用到它）。
 * @param {{ detectTtlMs: number, maxProjectContexts: number, now?: () => number }} options
 */
export function createCache(options) {
  const detectCache = createTtlCache({ ttlMs: options.detectTtlMs, maxEntries: options.maxProjectContexts, now: options.now })
  return {
    detect: async (root, refresh, detector) => detectCache.get(keyOf(root), refresh, detector),
    clear: () => detectCache.clear(),
    size: () => detectCache.size(),
    inflightSize: () => detectCache.inflightSize(),
    loadedAt: CACHE_MODULE_LOADED_AT
  }
}

export { keyOf }
