/**
 * dsh-desk-drop —— 宿主半边。
 *
 * 给浏览器半边开四个本地路由：
 *   GET  /dsh-desk-drop/file?p=<绝对路径>   把磁盘上的文件按字节吐出去（拖拽和下载都走它）
 *   POST /dsh-desk-drop/stash?name=<文件名> 把浏览器里的 blob 存成临时文件，回一个真路径
 *   GET  /dsh-desk-drop/stashed?id=<id>     读回上面那种临时文件
 *   POST /dsh-desk-drop/reveal              explorer /select 定位并高亮
 *   POST /dsh-desk-drop/save-as             弹系统「另存为」，另存一份
 *
 * 宿主这边什么界面都不画，全部交互在 lib/client.js 里。
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createReadStream, promises as fsp } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'

export const name = 'dsh-desk-drop'
export const inject = ['webServer']

const 前缀 = '/dsh-desk-drop'
const 插件版本 = '0.2.0'
const 暂存目录 = join(tmpdir(), 'dsh-desk-drop')
const 传入上限 = 64 * 1024 * 1024
const 暂存寿命 = 24 * 60 * 60 * 1000

const 类型表 = {
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
}

function 类型(p) {
  return 类型表[extname(p).toLowerCase()] || 'application/octet-stream'
}

/** 统一成正斜杠无关的本地路径（Windows 上把 / 掰成 \）。 */
function 正规(p) {
  if (typeof p !== 'string') return ''
  let s = p.trim()
  if (!s) return ''
  if (process.platform === 'win32') {
    s = s.replace(/\//g, '\\')
    // 末尾的反斜杠在命令行里会被当成引号转义，explorer 会认错路径
    if (s.length > 3 && s.endsWith('\\')) s = s.slice(0, -1)
  }
  return s
}

function 回(res, 体, 码) {
  if (res.writableEnded) return
  res.writeHead(码 || 200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(体))
}

/** 读一小段 JSON 请求体。 */
function 读体(req) {
  return new Promise((resolve) => {
    let 数据 = ''
    req.on('data', (块) => {
      数据 += 块
      if (数据.length > 1024 * 1024) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(数据 ? JSON.parse(数据) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

/** 读原始字节（暂存图片走这条）。 */
function 收字节(req, 限) {
  return new Promise((resolve, reject) => {
    const 块们 = []
    let 共 = 0
    req.on('data', (块) => {
      共 += 块.length
      if (共 > 限) {
        reject(new Error('文件太大'))
        req.destroy()
        return
      }
      块们.push(块)
    })
    req.on('end', () => resolve(Buffer.concat(块们)))
    req.on('error', reject)
  })
}

/** 用资源管理器定位：打开所在文件夹并把这一个文件选中（蓝色高亮）。 */
function 定位(目标) {
  return new Promise((resolve) => {
    try {
      if (process.platform !== 'win32') {
        const 程序 = process.platform === 'darwin' ? 'open' : 'xdg-open'
        const 子 = spawn(程序, ['-R', 目标], { detached: true, stdio: 'ignore' })
        子.on('error', () => resolve(false))
        子.on('spawn', () => {
           try { 子.unref() } catch {}
          resolve(true)
        })
        return
      }
      const 子 = spawn('explorer.exe', ['/select,"' + 目标 + '"'], {
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: true,
      })
      子.on('error', () => resolve(false))
      子.on('spawn', () => {
        try { 子.unref() } catch {}
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}

/** PowerShell 跑一段脚本，返回 { ok, out, err }。用 -EncodedCommand 绕开引号地狱。 */
function 跑PowerShell(脚本, 环境) {
  return new Promise((resolve) => {
    const 编码 = Buffer.from(脚本, 'utf16le').toString('base64')
    const 子 = spawn('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', 编码], {
      env: { ...process.env, ...环境 },
      windowsHide: true,
    })
    let 出 = ''
    let 错 = ''
    子.stdout.setEncoding('utf8')
    子.stderr.setEncoding('utf8')
    子.stdout.on('data', (d) => { 出 += d })
    子.stderr.on('data', (d) => { 错 += d })
    子.on('error', (e) => resolve({ ok: false, out: '', err: String(e) }))
    子.on('close', (码) => resolve({ ok: 码 === 0, out: 出.trim(), err: 错.trim() }))
  })
}

const 另存为脚本 = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$src = $env:DSH_DD_SRC
$name = $env:DSH_DD_NAME
$d = New-Object System.Windows.Forms.SaveFileDialog
$d.Title = '另存为'
$d.FileName = $name
$d.Filter = '所有文件 (*.*)|*.*'
$d.RestoreDirectory = $true
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Copy-Item -LiteralPath $src -Destination $d.FileName -Force
  Write-Output ('OK' + [char]9 + $d.FileName)
} else {
  Write-Output 'CANCEL'
}
`

/** 优先借 Electron 自己的保存对话框；拿不到就退到 PowerShell 的 WinForms 对话框。 */
async function 另存为(源) {
  const 名 = basename(源)
  try {
    const 电子 = await import('electron')
    const 对话框 = 电子.dialog || (电子.default && 电子.default.dialog)
    if (对话框 && typeof 对话框.showSaveDialog === 'function') {
      const 结果 = await 对话框.showSaveDialog({ title: '另存为', defaultPath: 名, buttonLabel: '保存' })
      if (!结果 || 结果.canceled || !结果.filePath) return { ok: false, canceled: true }
      await fsp.copyFile(源, 结果.filePath)
      return { ok: true, path: 结果.filePath }
    }
  } catch {
    /* 不在 Electron 主进程里，走下面的兜底 */
  }
  const 跑 = await 跑PowerShell(另存为脚本, { DSH_DD_SRC: 源, DSH_DD_NAME: 名 })
  if (!跑.ok) return { ok: false, error: 跑.err || '另存为失败' }
  if (跑.out.startsWith('CANCEL')) return { ok: false, canceled: true }
  if (跑.out.startsWith('OK\t')) return { ok: true, path: 跑.out.slice(3) }
  return { ok: false, error: 跑.out || 跑.err || '另存为失败' }
}

/** 顺手清掉一天前的暂存文件。 */
async function 清暂存() {
  try {
    const 列表 = await fsp.readdir(暂存目录)
    const 现在 = Date.now()
    for (const 名 of 列表) {
      const 全 = join(暂存目录, 名)
      try {
        const st = await fsp.stat(全)
        if (现在 - st.mtimeMs > 暂存寿命) await fsp.rm(全, { force: true })
      } catch {}
    }
  } catch {}
}

/** 确认路径是一个真实存在的普通文件。 */
async function 是文件(p) {
  try {
    const st = await fsp.stat(p)
    return st.isFile() ? st : null
  } catch {
    return null
  }
}

function 吐文件(res, p, st, req) {
  res.writeHead(200, {
    'content-type': 类型(p),
    'content-length': String(st.size),
    'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(basename(p))}`,
    'cache-control': 'no-store',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const 流 = createReadStream(p)
  流.on('error', () => {
    try { res.destroy() } catch {}
  })
  流.pipe(res)
}

export function apply(ctx) {
  let 心跳 = null

  const 路由 = (名, 处理) => {
    try {
      ctx.webServer.register({ kind: 'exact', path: 前缀 + 名, handler: 处理 })
    } catch (e) {
      console.error('[dsh-desk-drop] 路由注册失败 ' + 名 + '：' + String(e))
    }
  }

  // 磁盘上的真文件 → 字节
  路由('/file', async (req, res) => {
    try {
      const 址 = new URL(req.url, 'http://localhost')
      const p = 正规(址.searchParams.get('p') || '')
      if (!p) return 回(res, { error: '缺少路径' }, 400)
      const st = await 是文件(p)
      if (!st) return 回(res, { error: '文件不存在' }, 404)
      吐文件(res, p, st, req)
    } catch (e) {
      回(res, { error: String(e) }, 500)
    }
  })

  // 浏览器里的 blob → 临时文件（图片拖出去、复制路径都要有真路径）
  路由('/stash', async (req, res) => {
    if (req.method !== 'POST') return 回(res, { error: '只收 POST' }, 405)
    try {
      const 址 = new URL(req.url, 'http://localhost')
      const 原 = 址.searchParams.get('name') || 'file'
      const 名 = basename(原).replace(/[\\/:*?"<>|]/g, '_') || 'file'
      const 字节 = await 收字节(req, 传入上限)
      if (!字节.length) return 回(res, { error: '空内容' }, 400)
      await fsp.mkdir(暂存目录, { recursive: true })
      const 标识 = randomUUID().replace(/-/g, '')
      const 扩展 = extname(名)
      const 全 = join(暂存目录, 标识 + 扩展)
      await fsp.writeFile(全, 字节)
      回(res, { id: 标识, path: 全, name: 名, url: 前缀 + '/stashed?id=' + 标识 })
    } catch (e) {
      回(res, { error: String(e && e.message ? e.message : e) }, 500)
    }
  })

  // 暂存文件读回
  路由('/stashed', async (req, res) => {
    try {
      const 址 = new URL(req.url, 'http://localhost')
      const 标识 = 址.searchParams.get('id') || ''
      if (!/^[0-9a-f]{32}$/.test(标识)) return 回(res, { error: '编号不对' }, 400)
      const 列表 = await fsp.readdir(暂存目录)
      const 名 = 列表.find((n) => n.startsWith(标识))
      if (!名) return 回(res, { error: '找不到' }, 404)
      const 全 = join(暂存目录, 名)
      const st = await 是文件(全)
      if (!st) return 回(res, { error: '找不到' }, 404)
      吐文件(res, 全, st, req)
    } catch (e) {
      回(res, { error: String(e) }, 500)
    }
  })

  // 打开所在文件夹并选中
  路由('/reveal', async (req, res) => {
    const 体 = await 读体(req)
    const p = 正规(体.path || '')
    if (!p) return 回(res, { error: '缺少路径' }, 400)
    let st = null
    try {
      st = await fsp.stat(p)
    } catch {
      return 回(res, { error: '文件不存在' }, 404)
    }
    if (st.isDirectory()) {
      const 子 = spawn('explorer.exe', ['"' + p + '"'], {
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: true,
      })
      子.on('error', () => {})
      子.unref()
      return 回(res, { ok: true, mode: 'folder', path: p })
    }
    const 成 = await 定位(p)
    回(res, 成 ? { ok: true, mode: 'select', path: p } : { ok: false, error: 'explorer 起不来' })
  })

  // 另存为
  路由('/save-as', async (req, res) => {
    const 体 = await 读体(req)
    const p = 正规(体.path || '')
    if (!p) return 回(res, { error: '缺少路径' }, 400)
    const st = await 是文件(p)
    if (!st) return 回(res, { error: '文件不存在' }, 404)
    try {
      const 结果 = await 另存为(p)
      回(res, 结果)
    } catch (e) {
      回(res, { ok: false, error: String(e) }, 500)
    }
  })

  // 心跳，前端自检用
  路由('/ping', async (req, res) => {
    回(res, { ok: true, name, platform: process.platform, version: 插件版本 })
  })

  // 浏览器半边有没有真的跑起来：GET 看最后一条脚印
  路由('/hello', async (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') return 回(res, { ok: true, 心跳: 心跳 })
    const 体 = await 读体(req)
    心跳 = {
      时间: new Date().toISOString(),
      卡片: Number(体.cards) || 0,
      图片: Number(体.images) || 0,
      页面: String(体.href || '').slice(0, 200),
      版本: String(体.version || ''),
    }
    回(res, { ok: true })
  })

  清暂存()
}
