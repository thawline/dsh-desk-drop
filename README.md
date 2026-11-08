# dsh-desk-drop

文件从网页客户端里出得去。

网页版的交付卡片和消息图片都只是网页里的一个 `<img>` / `<div>`，想拖到 Windows 桌面上，浏览器默认只会吐一个没名字的 `blob`。这个插件在浏览器半边接管 DOM，在宿主半边提供真文件，于是：

1. **拖拽**：交付卡片、消息里的图片都能直接拖到桌面或资源管理器，落地就是原文件（带扩展名）。
2. **三个点 / 右键菜单**（卡片最右边的 `⋯` 和卡片任意位置右键，是同一个菜单）：
   - 打开所在文件夹 —— 用 `explorer.exe /select,<路径>`，文件在资源管理器里蓝色选中
   - 复制文件路径 —— 绝对路径进剪贴板
   - 另存为 —— Electron 原生保存对话框；拿不到 Electron 就退到 PowerShell + WinForms

## 它是怎么知道路径的

交付卡片里 `.cardPreview` 的 `title` 就是官方给出的绝对路径（`resolveWorkspacePath(cwd, file.path)`），直接读 DOM，不抢官方插槽。

图片只有 `blob:` 地址，所以在 `pointerdown` 时先把字节 `POST` 给宿主存成临时文件，换回一个真路径和 `http` 地址；顺带预取字节做成 `File` 塞进 `dataTransfer.items`，拖出去比 `DownloadURL` 更稳。

## 宿主路由（前缀 `/dsh-desk-drop`）

| 路由 | 说明 |
| --- | --- |
| `GET /file?p=` | 返回磁盘上的真文件（`inline` + RFC 5987 文件名） |
| `POST /stash?name=` | 收原始字节，存临时文件，回 `{ id, path, name, url }` |
| `GET /stashed?id=` | 按 32 位 hex 编号读回暂存文件 |
| `POST /reveal` | `{ path }` → 打开文件夹并选中 |
| `POST /save-as` | `{ path }` → 另存为 |
| `GET /ping` | 宿主自检 |
| `GET/POST /hello` | 浏览器半边的心跳，用来确认它真的跑起来了 |

暂存目录：`%TEMP%\dsh-desk-drop`，超过 24 小时的自动清掉。

## 装法

只支持 Windows（`explorer.exe /select` 和 PowerShell + WinForms 是系统自带的），Node 22.13 以上。

```bash
git clone https://github.com/thawline/dsh-desk-drop
```

把 clone 下来的目录挂进 profile：

```jsonc
// <profile>/package.json
"dependencies": { "dsh-desk-drop": "link:<你 clone 下来的路径>" },
"dsh": { "profile": { "bundles": ["...", "dsh-desk-drop"] } }
```

再给 `node_modules/dsh-desk-drop` 做一个指向源码目录的 junction：

```powershell
New-Item -ItemType Junction -Path "<profile>\node_modules\dsh-desk-drop" -Target "<你 clone 下来的路径>"
```

改完宿主那半边要**重启客户端**才会重新 require；只改浏览器那半边，刷新一下页面就够。
