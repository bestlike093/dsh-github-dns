# dsh-github-dns

给 DeepSeek Harness 的 GitHub 入口 IP 筛选器。

从多个 DoH 源取 `github.com` 的候选 A 记录，对每个 IP 做一次真实的 TLS 握手（SNI = `github.com`，校验证书），只把能握手、返回 2xx/3xx 的 IP 留下来。当前 hosts 里的 IP 失效时，才切换到延迟最低的可用 IP。

## 它解决什么

`github.com` 打不开，常见原因之一是 DNS 把域名解析到了一个当前线路不可达的 IP。这个插件只处理这一层：

- 多源取候选：阿里、腾讯、Cloudflare、Google 的 DoH，系统 DNS，外加一组兜底 IP
- TLS 探测：证书不匹配、握手被重置、超时，都直接淘汰
- hosts 标记块：只改自己那一段，块外一行不碰
- 定时复检：默认每 10 分钟，当前 IP 连续失败才切换，避免来回抖

> DoH 在部分网络里会被整段阻断（本机实测四个 DoH 端点全部超时）。这时候插件会自动退回系统 DNS + 兜底列表，扫描照常工作，只是候选来源少一些。

## 它不解决什么

- 443 端口整段被阻断时，筛完可能一个可用 IP 都没有，这时候需要代理或等线路恢复
- 只覆盖 `github.com` / `www.github.com`；`raw.githubusercontent.com`、`api.github.com`、`codeload.github.com` 不在默认范围内
- 不替代系统 DNS，也不改 DNS 服务器设置

## 安装

1. 把插件目录放到 DSH 的插件目录（例如 `<DSH_HOME>/plugins/dsh-github-dns`）
2. 在 DSH 插件管理里启用 `dsh-github-dns`
3. 打开设置页的「GitHub IP」，点「安装计划任务」，在 UAC 弹窗里点「是」

计划任务只做一件事：以最高权限运行 `scripts/apply-hosts.ps1`，把插件写好的 IP 落到 hosts。插件本身不提权。

## 使用

- **立即扫描**：只扫描，不改 hosts
- **应用最优**：把当前最优 IP 写进 hosts 标记块
- **恢复 hosts**：移除标记块
- **自动扫描**：按间隔复检；当前 IP 失效且找到更优 IP 时自动切换

也可以让 Agent 调用：

- `github_dns_status`
- `github_dns_scan`（`apply: true` 允许扫描后自动切换）
- `github_dns_apply`（可传具体 IP）
- `github_dns_restore`

## 数据与安全

- 数据目录：`<DSH_HOME>/plugin-data/dsh-github-dns/`
- 每次写 hosts 前都会备份到 `data/hosts.bak-<时间>.txt`
- 只操作 `# >>> dsh-github-dns >>>` 和 `# <<< dsh-github-dns <<<` 之间的内容
- 探测不发送任何凭据，只是 `HEAD /`

## 开发

```bash
node --check lib/index.js
node --check lib/scanner.js
node --check lib/hosts.js
node --check lib/client.js
```

计划任务注册脚本：`scripts/install-task.ps1`（需要管理员）。
落盘脚本：`scripts/apply-hosts.ps1`（由计划任务调用）。

## License

MIT
