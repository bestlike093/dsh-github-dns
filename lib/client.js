/* dsh-github-dns — 设置页卡片
 *
 * 显示当前 hosts IP、上次扫描结果和候选列表；
 * 所有动作都通过 /dsh-github-dns/* 回到宿主半，卡片本身不读写文件。
 */

window.__ModuleLoader__.load({
  id: 'dsh-github-dns',
  factory: (require) => {
    const react = require('react')
    const h = react.createElement
    const { useState, useEffect, useCallback } = react

    const PACKAGE_ID = 'dsh-github-dns'
    const API = '/dsh-github-dns'

    const CSS = `
.gdn-card { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 20px; color: var(--dsh-text-primary, #2c2430); font-size: 13px; line-height: 1.6; }
.gdn-hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 14px 16px; border-radius: 16px;
  background: radial-gradient(120% 140% at 0% 0%, rgba(255,206,226,.55), transparent 55%), linear-gradient(135deg, rgba(255,246,250,.96), rgba(255,255,255,.92));
  border: 1px solid rgba(224,112,158,.22); box-shadow: 0 8px 24px rgba(224,112,158,.08); }
.gdn-hero h3 { margin: 0 0 3px; font-size: 15px; font-weight: 650; letter-spacing: .2px; }
.gdn-hero p { margin: 0; font-size: 12px; color: var(--dsh-text-secondary, #7c6b76); }
.gdn-badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; background: rgba(224,112,158,.12); color: #b04a78; flex-shrink: 0; }
.gdn-badge.off { background: rgba(120,120,120,.12); color: #7c6b76; }
.gdn-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.gdn-btn { appearance: none; border: 1px solid rgba(224,112,158,.28); background: rgba(255,246,250,.9); color: #a8436f; border-radius: 10px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; transition: .15s ease; }
.gdn-btn:hover:not(:disabled) { background: rgba(255,232,242,.95); border-color: rgba(224,112,158,.45); }
.gdn-btn.primary { background: linear-gradient(135deg, #e0709e, #d65d8c); border-color: transparent; color: #fff; }
.gdn-btn:disabled { opacity: .5; cursor: default; }
.gdn-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.gdn-tile { padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,.7); border: 1px solid rgba(0,0,0,.06); }
.gdn-tile b { display: block; font-size: 15px; font-weight: 650; margin-top: 2px; }
.gdn-tile span { font-size: 11px; color: var(--dsh-text-secondary, #7c6b76); }
.gdn-table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
.gdn-table th { text-align: left; font-weight: 600; color: #8a7783; padding: 6px 8px; border-bottom: 1px solid rgba(0,0,0,.08); }
.gdn-table td { padding: 6px 8px; border-bottom: 1px solid rgba(0,0,0,.05); word-break: break-all; overflow-wrap: anywhere; }
.gdn-table th:nth-child(1) { width: 32%; }
.gdn-table th:nth-child(2) { width: 26%; }
.gdn-table th:nth-child(3) { width: 16%; }
.gdn-table th:nth-child(4) { width: 26%; }
.gdn-ok { color: #2e9e6b; font-weight: 600; }
.gdn-bad { color: #c04a4a; }
.gdn-muted { color: #9a8a93; font-size: 11px; }
.gdn-msg { font-size: 12px; padding: 8px 12px; border-radius: 10px; background: rgba(224,112,158,.08); color: #a8436f; }
.gdn-msg.err { background: rgba(192,74,74,.09); color: #a33; }
.gdn-help { font-size: 11px; color: #9a8a93; margin: 0; }
`

    function useStyle() {
      useEffect(() => {
        const id = 'gdn-style'
        if (document.getElementById(id)) return
        const el = document.createElement('style')
        el.id = id
        el.textContent = CSS
        document.head.appendChild(el)
      }, [])
    }

    function shortError(text) {
      if (!text) return '不可用'
      const raw = String(text)
      if (/timeout/i.test(raw)) return '超时'
      if (/EPROTO|WRONG_VERSION_NUMBER|SSL|TLS/i.test(raw)) return '握手失败'
      const line = raw.replace(/\s+/g, ' ').trim()
      return line.length > 14 ? line.slice(0, 14) + '…' : line
    }

    function timeText(ts) {
      if (!ts) return '—'
      try {
        return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
      } catch {
        return '—'
      }
    }

    function Section() {
      useStyle()
      const [state, setState] = useState(null)
      const [busy, setBusy] = useState('')
      const [message, setMessage] = useState(null)

      const load = useCallback(async () => {
        try {
          const response = await fetch(API + '/state', { cache: 'no-store' })
          setState(await response.json())
        } catch (error) {
          setMessage({ kind: 'err', text: '读不到状态：' + String(error && error.message ? error.message : error) })
        }
      }, [])

      useEffect(() => {
        load()
        const timer = setInterval(load, 6000)
        return () => clearInterval(timer)
      }, [load])

      const post = useCallback(async (path, body) => {
        setBusy(path)
        setMessage(null)
        try {
          const response = await fetch(API + path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body || {}),
          })
          const row = await response.json()
          if (!row || row.ok === false) {
            setMessage({ kind: 'err', text: (row && row.error) || '操作没有成功' })
          } else if (path === '/install') {
            setMessage({ kind: 'ok', text: '计划任务已安装，之后切换 IP 会静默完成' })
          } else if (path === '/clear') {
            setMessage({ kind: 'ok', text: '已移除 hosts 里的标记块，备份留在 data 目录' })
          } else if (path === '/apply') {
            setMessage({ kind: 'ok', text: '已写入 hosts：' + (row.ip || '') })
          } else if (path === '/scan') {
            const scan = row.scan || {}
            setMessage({ kind: 'ok', text: '扫描完成：' + (scan.candidates || 0) + ' 个候选，' + (scan.okCount || 0) + ' 个可用' })
          }
          await load()
        } catch (error) {
          setMessage({ kind: 'err', text: '请求失败：' + String(error && error.message ? error.message : error) })
        } finally {
          setBusy('')
        }
      }, [load])

      const saveConfig = useCallback(async (patch) => {
        setBusy('config')
        try {
          await fetch(API + '/config', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
          })
          await load()
        } finally {
          setBusy('')
        }
      }, [load])

      if (!state) {
        return h('div', { className: 'gdn-card' }, h('p', { className: 'gdn-help' }, '正在读取状态…'))
      }

      const scan = state.lastScan || {}
      const rows = scan.rows || []
      const best = scan.best || null
      const installed = Boolean(state.taskInstalled)

      return h('div', { className: 'gdn-card' },
        h('div', { className: 'gdn-hero' },
          h('div', null,
            h('h3', null, 'GitHub 入口 IP'),
            h('p', null, '多源 DoH 取候选，TLS 握手验证，只在当前 IP 失效时替换 hosts。')
          ),
          h('span', { className: 'gdn-badge' + (state.enabled ? '' : ' off') }, installed ? (state.enabled ? '自动运行' : '已暂停') : '未安装任务')
        ),

        h('div', { className: 'gdn-grid' },
          h('div', { className: 'gdn-tile' }, h('span', null, '当前 hosts IP'), h('b', null, state.currentIp || '未接管')),
          h('div', { className: 'gdn-tile' }, h('span', null, '上次扫描'), h('b', null, timeText(scan.at))),
          h('div', { className: 'gdn-tile' }, h('span', null, '可用 / 候选'), h('b', null, (scan.okCount || 0) + ' / ' + (scan.candidates || 0))),
          h('div', { className: 'gdn-tile' }, h('span', null, '最优延迟'), h('b', null, best && best.ms ? best.ms + ' ms' : '—'))
        ),

        h('div', { className: 'gdn-row' },
          h('button', { type: 'button', className: 'gdn-btn primary', disabled: Boolean(busy) || state.scanning, onClick: () => post('/scan') },
            busy === '/scan' ? '扫描中…' : '立即扫描'),
          h('button', { type: 'button', className: 'gdn-btn', disabled: Boolean(busy) || !best, onClick: () => post('/apply', { ip: best && best.ip }) },
            busy === '/apply' ? '写入中…' : '应用最优'),
          h('button', { type: 'button', className: 'gdn-btn', disabled: Boolean(busy) || !state.currentIp, onClick: () => post('/clear') },
            '恢复 hosts'),
          h('button', { type: 'button', className: 'gdn-btn', disabled: Boolean(busy) || installed, onClick: () => post('/install') },
            installed ? '任务已安装' : '安装计划任务')
        ),

        message ? h('div', { className: 'gdn-msg' + (message.kind === 'err' ? ' err' : '') }, message.text) : null,

        h('div', { className: 'gdn-row' },
          h('label', { className: 'gdn-help' },
            h('input', {
              type: 'checkbox',
              checked: Boolean(state.enabled),
              disabled: busy === 'config',
              onChange: (event) => saveConfig({ enabled: event.target.checked }),
            }),
            ' 自动扫描'
          ),
          h('label', { className: 'gdn-help' },
            '间隔 ',
            h('input', {
              type: 'number',
              min: 2,
              max: 1440,
              value: state.intervalMinutes || 10,
              style: { width: '64px', margin: '0 4px' },
              disabled: busy === 'config',
              onChange: (event) => {
                const minutes = Number(event.target.value)
                if (Number.isFinite(minutes) && minutes >= 2 && minutes <= 1440) saveConfig({ intervalMinutes: minutes })
              },
            }),
            ' 分钟'
          )
        ),

        rows.length > 0
          ? h('table', { className: 'gdn-table' },
              h('thead', null,
                h('tr', null,
                  h('th', null, 'IP'),
                  h('th', null, '状态'),
                  h('th', null, '延迟'),
                  h('th', null, '来源')
                )
              ),
              h('tbody', null,
                rows.map((row) => h('tr', { key: row.ip },
                  h('td', null, row.ip),
                  h('td', { className: row.ok ? 'gdn-ok' : 'gdn-bad', title: row.error || '' }, row.ok ? '可用' : shortError(row.error)),
                  h('td', null, row.ms ? row.ms + ' ms' : '—'),
                  h('td', { className: 'gdn-muted' }, (row.sources || []).join(' / '))
                ))
              )
            )
          : h('p', { className: 'gdn-help' }, '还没有扫描记录。点「立即扫描」看看哪些 IP 现在能握手。'),

        h('p', { className: 'gdn-help' },
          installed
            ? '写 hosts 由计划任务以最高权限完成，插件本身不提权。hosts 里只会多出一个带标记的块。'
            : '第一次使用需要点「安装计划任务」，会弹一次 UAC。之后所有切换都静默完成。'
        )
      )
    }

    function apply(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') return
      try {
        ctx.slots.inject('settings.section', () => {
          try {
            return ctx.slots.register(
              {
                name: 'settings.section',
                id: PACKAGE_ID,
                order: 35,
                label: () => 'GitHub IP',
              },
              Section
            )
          } catch (error) {
            console.warn('[dsh-github-dns] 设置页槽位注册失败', error)
            return () => {}
          }
        })
      } catch (error) {
        console.warn('[dsh-github-dns] 设置页槽位注入失败', error)
      }
    }

    return { apply, inject: ['slots', 'theme'] }
  },
})
