/**
 * dsh-github-dns — 宿主半
 *
 * 做三件事：
 *   1. 定时（或手动）扫描 github.com 的候选 IP，用真实 TLS 握手筛出可用的
 *   2. 把选中的 IP 写进 hosts 的专属标记块，块外一行不碰
 *   3. 写 hosts 需要管理员，所以通过一个按需计划任务落盘；插件本身不提升权限
 *
 * 数据目录：<DSH_HOME>/plugin-data/dsh-github-dns/
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { scan, isIPv4 } from './scanner.js'
import { DOMAINS, readBlock } from './hosts.js'

const execFileAsync = promisify(execFile)
const PLUGIN_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

export const name = 'dsh-github-dns'
export const inject = ['tools', 'webServer']

const ROUTE_PREFIX = '/dsh-github-dns'
const TASK_NAME = 'dsh-github-dns-apply'
const SYSTEM_ROOT = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
const HOSTS_PATH = path.join(SYSTEM_ROOT, 'System32', 'drivers', 'etc', 'hosts')

function resolveDir() {
  // 必须和 scripts/apply-hosts.ps1 用同一个目录：计划任务没有 DSH_HOME 上下文，
  // 只能按插件目录找 data/。两边不一致会表现为「计划任务没有回结果」。
  return path.join(PLUGIN_DIR, 'data')
}

const DIR = resolveDir()
const CONFIG_FILE = path.join(DIR, 'config.json')
const APPLY_FILE = path.join(DIR, 'apply.json')
const APPLY_RESULT = path.join(DIR, 'apply-result.json')
const INSTALL_RESULT = path.join(DIR, 'install-result.json')
const INSTALL_SCRIPT = path.join(PLUGIN_DIR, 'scripts', 'install-task.ps1')

let config = {
  enabled: true,
  autoApply: true,
  intervalMinutes: 10,
  domains: DOMAINS.slice(),
  currentIp: '',
  lastScan: null,
  lastApply: null,
}
let timer = null
let scanning = false
let ready = null

function messageOf(error) {
  return String(error && error.message ? error.message : error)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureDir() {
  await fs.mkdir(DIR, { recursive: true })
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

async function writeJson(file, value) {
  await ensureDir()
  await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8')
}

function decodeHosts(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return buffer.subarray(3).toString('utf8')
  }
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return buffer.subarray(2).toString('utf16le')
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    const swapped = Buffer.from(buffer.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  return buffer.toString('utf8')
}

async function readHostsIp() {
  try {
    const raw = decodeHosts(await fs.readFile(HOSTS_PATH))
    const block = readBlock(raw)
    return block ? block.ip : ''
  } catch {
    return ''
  }
}

async function loadConfig() {
  await ensureDir()
  const saved = await readJson(CONFIG_FILE, null)
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    config = {
      ...config,
      ...saved,
      domains: DOMAINS.slice(),
    }
  }
  config.currentIp = await readHostsIp()
  await writeJson(CONFIG_FILE, config)
}

async function taskExists() {
  try {
    await execFileAsync('schtasks', ['/query', '/tn', TASK_NAME], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

async function runTask() {
  try {
    await execFileAsync('schtasks', ['/run', '/tn', TASK_NAME], { windowsHide: true })
  } catch (error) {
    throw new Error('计划任务还没装好，先在面板点「安装计划任务」：' + messageOf(error))
  }
}

async function waitForResult(file, beforeAt, tries, interval) {
  for (let i = 0; i < tries; i += 1) {
    await sleep(interval)
    const row = await readJson(file, null)
    if (row && row.at && row.at !== beforeAt) return row
  }
  return null
}

function slimScan(result) {
  return {
    at: result.scannedAt,
    elapsedMs: result.elapsedMs,
    candidates: result.candidates,
    okCount: result.rows.filter((row) => row.ok).length,
    best: result.best ? { ip: result.best.ip, ms: result.best.ms, status: result.best.status } : null,
    errors: result.errors,
    rows: result.rows.slice(0, 12).map((row) => ({
      ip: row.ip,
      ok: row.ok,
      status: row.status || null,
      ms: row.ms || null,
      error: row.error || '',
      sources: row.sources || [],
    })),
  }
}

async function runScan(options = {}) {
  if (scanning) return { ok: false, error: '已经在扫描了，等这一轮结束' }
  scanning = true
  try {
    const result = await scan({ concurrency: 5, timeout: 4000 })
    config.lastScan = slimScan(result)
    config.currentIp = await readHostsIp()
    await writeJson(CONFIG_FILE, config)

    let applied = null
    if (options.apply && config.autoApply) {
      const current = result.rows.find((row) => row.ip === config.currentIp)
      const currentOk = Boolean(current && current.ok)
      if (config.currentIp && !currentOk && result.best && result.best.ip !== config.currentIp) {
        try {
          applied = await applyIp(result.best.ip)
        } catch (error) {
          applied = { ok: false, error: messageOf(error) }
        }
      }
    }

    return { ok: true, scan: config.lastScan, applied, currentIp: config.currentIp }
  } finally {
    scanning = false
  }
}

async function applyIp(ip) {
  if (!isIPv4(ip)) throw new Error('IP 格式不对：' + String(ip || ''))
  const before = await readJson(APPLY_RESULT, null)
  await writeJson(APPLY_FILE, {
    action: 'apply',
    ip,
    domains: config.domains,
    at: new Date().toISOString(),
  })
  await runTask()
  const row = await waitForResult(APPLY_RESULT, before && before.at, 16, 500)
  if (!row) throw new Error('计划任务没有回结果，检查任务是否被禁用')
  if (!row.ok) throw new Error(row.error || '写入 hosts 失败')
  config.currentIp = ip
  config.lastApply = { at: row.at, action: 'apply', ip, backup: row.backup || '' }
  await writeJson(CONFIG_FILE, config)
  return { ok: true, ip, backup: row.backup || '' }
}

async function clearBlock() {
  const before = await readJson(APPLY_RESULT, null)
  await writeJson(APPLY_FILE, {
    action: 'clear',
    domains: config.domains,
    at: new Date().toISOString(),
  })
  await runTask()
  const row = await waitForResult(APPLY_RESULT, before && before.at, 16, 500)
  if (!row) throw new Error('计划任务没有回结果，检查任务是否被禁用')
  if (!row.ok) throw new Error(row.error || '移除 hosts 块失败')
  config.currentIp = ''
  config.lastApply = { at: row.at, action: 'clear', ip: '', backup: row.backup || '' }
  await writeJson(CONFIG_FILE, config)
  return { ok: true, backup: row.backup || '' }
}

async function installTask() {
  await ensureDir()
  await fs.access(INSTALL_SCRIPT).catch(() => {
    throw new Error('找不到 scripts/install-task.ps1')
  })
  const before = await readJson(INSTALL_RESULT, null)
  const quoted = INSTALL_SCRIPT.replace(/'/g, "''")
  const taskUser = [process.env.USERDOMAIN, process.env.USERNAME].filter(Boolean).join('\\')
  const quotedUser = taskUser.replace(/'/g, "''")
  const command =
    "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','" +
    quoted +
    "','-TaskUser','" + quotedUser + "'"
  await execFileAsync('powershell', ['-NoProfile', '-Command', command], { windowsHide: true })
  const row = await waitForResult(INSTALL_RESULT, before && before.at, 60, 750)
  if (!row) {
    return { ok: false, error: '等待 UAC 授权超时。请在弹窗里点「是」，再试一次' }
  }
  if (row.ok) {
    config.installed = true
    await writeJson(CONFIG_FILE, config)
  }
  return row
}

function schedule() {
  if (timer) clearInterval(timer)
  const minutes = Math.max(2, Math.min(1440, Number(config.intervalMinutes) || 10))
  timer = setInterval(() => {
    if (!config.enabled) return
    runScan({ apply: true }).catch(() => {})
  }, minutes * 60_000)
  if (typeof timer.unref === 'function') timer.unref()
}

async function buildState() {
  const installed = await taskExists()
  if (installed !== config.installed) {
    config.installed = installed
    await writeJson(CONFIG_FILE, config)
  }
  return {
    ok: true,
    enabled: config.enabled,
    autoApply: config.autoApply,
    intervalMinutes: config.intervalMinutes,
    domains: config.domains,
    currentIp: config.currentIp,
    taskInstalled: installed,
    taskName: TASK_NAME,
    scanning,
    lastScan: config.lastScan,
    lastApply: config.lastApply,
    hostsPath: HOSTS_PATH,
  }
}

function tool(name, description, properties, required, execute) {
  const parameters = { type: 'object', properties: properties || {} }
  if (required && required.length > 0) parameters.required = required
  return {
    name,
    description,
    parameters,
    output: {
      schema: {},
      render(_args, value) {
        return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
      },
    },
    async execute(args) {
      try {
        return await execute(args || {})
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    },
  }
}

/* ------------------------------ HTTP ------------------------------ */

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 512 * 1024) {
        reject(new Error('请求体太大'))
        req.destroy()
        return
      }
      raw += chunk.toString('utf8')
    })
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

async function handleRoute(req, res) {
  const url = new URL(req.url || '/', 'http://localhost')
  const route = url.pathname.slice(ROUTE_PREFIX.length) || '/'
  const method = String(req.method || 'GET').toUpperCase()

  try {
    if (route === '/state' && method === 'GET') {
      sendJson(res, 200, await buildState())
      return
    }

    if (route === '/scan' && method === 'POST') {
      const result = await runScan({ apply: false })
      sendJson(res, 200, result)
      return
    }

    if (route === '/apply' && method === 'POST') {
      const body = await readBody(req)
      const ip = String(body.ip || '').trim() || (config.lastScan && config.lastScan.best && config.lastScan.best.ip)
      if (!ip) {
        sendJson(res, 400, { ok: false, error: '还没有可用 IP，先扫描一次' })
        return
      }
      const result = await applyIp(ip)
      sendJson(res, 200, result)
      return
    }

    if (route === '/clear' && method === 'POST') {
      const result = await clearBlock()
      sendJson(res, 200, result)
      return
    }

    if (route === '/config' && method === 'POST') {
      const body = await readBody(req)
      if (typeof body.enabled === 'boolean') config.enabled = body.enabled
      if (typeof body.autoApply === 'boolean') config.autoApply = body.autoApply
      if (body.intervalMinutes !== undefined) {
        const minutes = Number(body.intervalMinutes)
        if (!Number.isFinite(minutes) || minutes < 2 || minutes > 1440) {
          sendJson(res, 400, { ok: false, error: '间隔需要在 2–1440 分钟之间' })
          return
        }
        config.intervalMinutes = minutes
        schedule()
      }
      await writeJson(CONFIG_FILE, config)
      sendJson(res, 200, await buildState())
      return
    }

    if (route === '/install' && method === 'POST') {
      const result = await installTask()
      sendJson(res, result.ok ? 200 : 500, result)
      return
    }

    sendJson(res, 404, { ok: false, error: '没有这个路由' })
  } catch (error) {
    sendJson(res, 500, { ok: false, error: messageOf(error) })
  }
}

/* ------------------------------ 入口 ------------------------------ */

export function apply(ctx) {
  ready = loadConfig()
    .then(() => {
      schedule()
      setTimeout(() => {
        if (config.enabled) runScan({ apply: true }).catch(() => {})
      }, 8_000)
    })
    .catch((error) => {
      ctx.logger?.warn?.('dsh-github-dns: 读取配置失败 ' + messageOf(error))
    })

  if (ctx.webServer && typeof ctx.webServer.register === 'function') {
    const registerRoute = () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => {
          ready.finally(() => handleRoute(req, res))
        },
      })
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => registerRoute())
    } else {
      registerRoute()
    }
  } else {
    ctx.logger?.warn?.('dsh-github-dns: 宿主未提供 webServer，设置页将不可用')
  }

  if (!ctx.tools || typeof ctx.tools.register !== 'function') {
    ctx.logger?.warn?.('dsh-github-dns: 宿主未提供 tools，工具不会注册')
    return
  }

  ctx.tools.register(
    tool('github_dns_status', '查看 GitHub 入口 IP 状态：当前 hosts 里的 IP、上次扫描结果、计划任务是否已安装。', {}, [], async () => {
      await ready
      return buildState()
    })
  )

  ctx.tools.register(
    tool(
      'github_dns_scan',
      '扫描 github.com 的候选 IP，用 TLS 握手筛出可用的。默认只扫描不写 hosts；apply=true 时在当前 IP 失效的情况下自动切换到最优 IP。',
      { apply: { type: 'boolean', description: '是否允许在扫描后自动应用最优 IP' } },
      [],
      async (args) => {
        await ready
        return runScan({ apply: Boolean(args.apply) })
      }
    )
  )

  ctx.tools.register(
    tool(
      'github_dns_apply',
      '把指定 IP 写入 hosts 的 dsh-github-dns 标记块。不传 ip 时使用上次扫描的最优结果。需要先安装计划任务。',
      { ip: { type: 'string', description: '要应用的 IPv4 地址' } },
      [],
      async (args) => {
        await ready
        const ip = String(args.ip || '').trim() || (config.lastScan && config.lastScan.best && config.lastScan.best.ip)
        if (!ip) return { ok: false, error: '没有可用 IP，先扫描' }
        return applyIp(ip)
      }
    )
  )

  ctx.tools.register(
    tool('github_dns_restore', '移除 hosts 里 dsh-github-dns 的标记块，恢复系统原本的 GitHub 解析。', {}, [], async () => {
      await ready
      return clearBlock()
    })
  )
}
