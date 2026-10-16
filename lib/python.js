/**
 * Python 解释器探测（NFR-3.6、AC-2.4）。
 *
 * 依据 docs/02-设计方案.md 第 4.2 节：
 *   顺序 = 配置值 → 「python」 → 「py -3」 → 「python3」；
 *   候选必须通过一次**轻量探测**（能执行且返回版本）才被采用；
 *   全部失败 → 「broken/python-not-found」。
 *
 * 实现约束：用 spawnSync + 参数数组（**不经 shell**）跑一段内联脚本，
 * 脚本内不含引号，避免 Windows 下引号被吞（实测 「python -c '...'」 里的引号会被剥掉）。
 */

import { spawnSync } from 'node:child_process'

/**
 * 探测脚本：打印 「sys.version_info」 三元组，形如 「(3, 12, 4)」。
 *
 * 设计要点（都是实测踩出来的）：
 *   1. **不含引号** —— Windows 下外层 shell 会剥掉 「-c」 参数里的引号；
 *   2. 只打印结构，不打印标签 —— 早期版本写成 「print(pythonVersion=...)」，
 *      会被 Python 解析成「关键字实参」而报错。
 * 解析用正则抓三个数字，与具体分隔符无关。
 */
const PROBE_SCRIPT = 'import sys;print(sys.version_info[:3])'

const DEFAULT_CANDIDATES = [
  { command: 'python', args: [] },
  { command: 'py', args: ['-3'] },
  { command: 'python3', args: [] }
]

const PROBE_TIMEOUT_MS = 8_000
const MINIMUM = { major: 3, minor: 11 }

/**
 * @param {object} config 规范化后的配置
 * @returns {Array<{command: string, args: string[], source: string}>} 去重后的候选
 */
export function pythonCandidates(config) {
  const list = []
  if (typeof config.pythonPath === 'string' && config.pythonPath !== '') {
    list.push({ command: config.pythonPath, args: [], source: 'config' })
  }
  for (const candidate of DEFAULT_CANDIDATES) list.push({ ...candidate, source: 'auto' })

  const seen = new Set()
  return list.filter((candidate) => {
    const key = `${candidate.command}\u0000${candidate.args.join('\u0000')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 跑一个候选解释器，返回它自报的版本信息。 */
function probeCandidate(candidate) {
  const result = spawnSync(candidate.command, [...candidate.args, '-c', PROBE_SCRIPT], {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONDONTWRITEBYTECODE: '1'
    }
  })

  if (result.error !== undefined && result.error !== null) {
    return { ok: false, reason: `spawn failed: ${result.error.message}` }
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').trim().slice(0, 400)
    return { ok: false, reason: `exit ${String(result.status)}${stderr === '' ? '' : `: ${stderr}`}` }
  }

  const stdout = String(result.stdout ?? '')
  const match = /\((\d+),\s*(\d+),\s*(\d+)/.exec(stdout)
  if (match === null) {
    return { ok: false, reason: `unexpected probe output: ${JSON.stringify(stdout.slice(0, 120))}` }
  }
  const [major, minor, micro] = [Number(match[1]), Number(match[2]), Number(match[3])]
  return { ok: true, version: `${major}.${minor}.${micro}`, major, minor, micro }
}

/**
 * 依次探测候选，返回第一个可用的解释器。
 *
 * 显式配置 「pythonPath」 时**只用它**：配置值不可用就报 「python-not-found」，
 * 不再回落到 PATH 上的 「python」。理由是 AC-2.4 要求「把启动器指向不存在的 Python
 * 时返回 broken/python-not-found」——若配置值失败后仍能回落到 「python」，
 * 这个验收条件永远触发不了，而且「我指定了解释器它却偷偷用了别的」是最危险的静默事故。
 * 未配置时按 NFR-3.6 自动探测多个候选。
 *
 * @param {object} config 规范化后的配置
 * @returns {Promise<{ path: string, version: string, source: string, args: string[] } | { error: object }>}
 */
export async function probePython(config) {
  const candidates = pythonCandidates(config)
  const explicit = typeof config.pythonPath === 'string' && config.pythonPath !== ''
  const failures = []

  for (const candidate of candidates) {
    const probed = probeCandidate(candidate)
    if (!probed.ok) {
      failures.push({ command: candidate.command, args: candidate.args, source: candidate.source, reason: probed.reason })
      if (explicit) break
      continue
    }
    if (probed.major < MINIMUM.major || (probed.major === MINIMUM.major && probed.minor < MINIMUM.minor)) {
      failures.push({
        command: candidate.command,
        args: candidate.args,
        source: candidate.source,
        reason: `version ${probed.version} is below the engine minimum ${MINIMUM.major}.${MINIMUM.minor}`
      })
      if (explicit) break
      continue
    }
    return {
      path: candidate.command,
      args: [...candidate.args],
      version: probed.version,
      source: candidate.source
    }
  }

  return { error: { reason: 'python-not-found', configured: explicit ? config.pythonPath : null, candidates: failures } }
}

/** 同步版探测：P0 的检测路径全是 async，这个仅供启动期日志使用。 */
export function describeCandidates(config) {
  return pythonCandidates(config).map((candidate) => [candidate.command, ...candidate.args].join(' '))
}
