/**
 * 配置规范化。
 *
 * 依据 docs/02-设计方案.md 第 11 节：配置全部经校验；**非法值记 warning 并用默认值，
 * 不阻止插件挂载**（否则面板整体消失，排障困难）。
 */

/** orchd 官方仓库（安装入口 C 路径展示用，NFR-2.4：常量，不拼接项目内容）。 */
export const ORCHD_OFFICIAL_REPO = 'https://github.com/7bder/orchd-core'
/** Gitee 镜像（网络受限时用）。 */
export const ORCHD_MIRROR_REPO = 'https://gitee.com/QQ7bder/orchd-core'

export const DEFAULTS = Object.freeze({
  pythonPath: null,
  requestTimeoutMs: 20_000,
  cacheTtlMs: 5_000,
  pollTtlMs: 30_000,
  detectTtlMs: 10_000,
  maxProjectContexts: 8,
  orchdCoreRepo: null,
  allowRoots: []
})

const POSITIVE_INTS = ['requestTimeoutMs', 'cacheTtlMs', 'pollTtlMs', 'detectTtlMs', 'maxProjectContexts']

/**
 * @param {unknown} raw 插件 config（来自 cordis.patch.yml）
 * @returns {{ config: object, warnings: string[] }} 规范化后的配置与告警
 */
export function normalizeConfig(raw) {
  const warnings = []
  const config = { ...DEFAULTS }
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  if (raw !== undefined && (raw === null || typeof raw !== 'object')) {
    warnings.push(`config must be an object, got ${typeof raw}; using defaults`)
  }

  if (Object.hasOwn(input, 'pythonPath')) {
    const value = input.pythonPath
    if (value === null || value === undefined) config.pythonPath = null
    else if (typeof value === 'string' && value.trim() !== '') config.pythonPath = value.trim()
    else warnings.push(`config.pythonPath must be a non-empty string or null, got ${JSON.stringify(value)}; using auto-detect`)
  }

  for (const key of POSITIVE_INTS) {
    if (!Object.hasOwn(input, key)) continue
    const value = input[key]
    if (Number.isInteger(value) && value > 0) config[key] = value
    else warnings.push(`config.${key} must be a positive integer, got ${JSON.stringify(value)}; using ${DEFAULTS[key]}`)
  }

  if (Object.hasOwn(input, 'orchdCoreRepo')) {
    const value = input.orchdCoreRepo
    if (value === null || value === undefined) config.orchdCoreRepo = null
    else if (typeof value === 'string' && /^https?:\/\/\S+$/.test(value.trim())) config.orchdCoreRepo = value.trim()
    else warnings.push(`config.orchdCoreRepo must be an http(s) URL or null, got ${JSON.stringify(value)}; using default`)
  }

  if (Object.hasOwn(input, 'allowRoots')) {
    const value = input.allowRoots
    if (Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim() !== '')) {
      config.allowRoots = value.map((entry) => entry.trim())
    } else {
      warnings.push('config.allowRoots must be an array of non-empty strings; using []')
    }
  }

  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(DEFAULTS, key)) warnings.push(`unknown config key ${JSON.stringify(key)} ignored`)
  }

  return { config, warnings }
}

/** 安装入口 C 路径展示的仓库地址（配置可覆写以适配私有镜像）。 */
export function resolveRepo(config) {
  return config.orchdCoreRepo ?? ORCHD_OFFICIAL_REPO
}
