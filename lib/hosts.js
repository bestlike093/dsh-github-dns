/**
 * dsh-github-dns — hosts 标记块
 *
 * 只碰自己标记块里的内容，块外原样保留。
 * 真正的落盘由 scripts/apply-hosts.ps1 在计划任务里做（需要管理员）。
 */

export const MARK_START = '# >>> dsh-github-dns >>>'
export const MARK_END = '# <<< dsh-github-dns <<<'
export const DOMAINS = ['github.com', 'www.github.com']

export function buildBlock(ip, domains = DOMAINS) {
  return [MARK_START, ...domains.map((domain) => ip + ' ' + domain), MARK_END].join('\n')
}

/** 去掉标记块，返回剩下的文本（保留原来的换行风格）。 */
export function stripBlock(text) {
  const lines = String(text || '').split(/\r?\n/)
  const out = []
  let inside = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === MARK_START) {
      inside = true
      continue
    }
    if (trimmed === MARK_END) {
      inside = false
      continue
    }
    if (!inside) out.push(line)
  }
  return out.join('\n')
}

/** 先移除旧块，再在末尾追加新块。 */
export function applyBlock(text, ip, domains = DOMAINS) {
  const base = stripBlock(text).replace(/\s+$/, '')
  return (base ? base + '\n\n' : '') + buildBlock(ip, domains) + '\n'
}

/** 读出当前标记块里的 IP；没有块时返回 null。 */
export function readBlock(text) {
  const lines = String(text || '').split(/\r?\n/)
  const domains = []
  let ip = ''
  let inside = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === MARK_START) {
      inside = true
      continue
    }
    if (trimmed === MARK_END) {
      inside = false
      continue
    }
    if (!inside || !trimmed || trimmed.startsWith('#')) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length >= 2 && /^\d+\.\d+\.\d+\.\d+$/.test(parts[0])) {
      ip = parts[0]
      domains.push(parts[1])
    }
  }
  return ip ? { ip, domains } : null
}
