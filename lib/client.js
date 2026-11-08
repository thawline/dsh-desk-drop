/**
 * dsh-desk-drop —— 浏览器半边（手写 __ModuleLoader__ bundle，无构建）。
 *
 * 干两件事：
 *   1. 把交付卡片（present 的文件）和消息里的图片做成可拖拽的，拖到桌面/资源管理器就直接落盘；
 *   2. 卡片右边加一个「⋯」，右键卡片也弹同一个菜单：
 *      「打开所在文件夹」（资源管理器里选中并高亮）/「复制文件路径」/「另存为」。
 *
 * 路径来源：交付卡片的 cardPreview 按钮 title 属性就是绝对路径（官方自己塞的）。
 * 图片是 blob:，先在 pointerdown 时把字节悄悄丢给宿主存成临时文件，换回真路径。
 */

window.__ModuleLoader__.load({
  id: 'dsh-desk-drop',
  factory: function () {
    if (window.__dshDeskDrop && window.__dshDeskDrop.__plugin) return window.__dshDeskDrop.__plugin
    window.__dshDeskDrop = { installed: true }

    var 路由 = '/dsh-desk-drop'
    var 版本 = '0.2.0'
    var 预热上限 = 8 * 1024 * 1024
    var 暂存上限 = 32 * 1024 * 1024

    var 类型表 = {
      txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
      yaml: 'text/yaml', yml: 'text/yaml', xml: 'application/xml', html: 'text/html',
      css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml', png: 'image/png',
      jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
      bmp: 'image/bmp', ico: 'image/x-icon', pdf: 'application/pdf', zip: 'application/zip',
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
    }

    // ────────────────────────────── 小工具 ──────────────────────────────

    function 底名(p) {
      if (!p) return 'file'
      var i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
      return i === -1 ? p : p.slice(i + 1)
    }

    function 扩展(名) {
      var i = (名 || '').lastIndexOf('.')
      return i > 0 ? 名.slice(i + 1).toLowerCase() : ''
    }

    function 类型(名) {
      return 类型表[扩展(名)] || 'application/octet-stream'
    }

    function 像路径(s) {
      if (typeof s !== 'string') return false
      var v = s.trim()
      if (!v || v.length > 4096) return false
      return /^[A-Za-z]:[\\/]/.test(v) || v.indexOf('\\\\') === 0 || v.charAt(0) === '/'
    }

    function 绝对址(p) {
      return location.origin + 路由 + '/file?p=' + encodeURIComponent(p)
    }

    function 发(名, 体) {
      return fetch(路由 + 名, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(体 || {}),
      }).then(function (r) { return r.json() })
    }

    function 睡(毫秒) {
      return new Promise(function (r) { setTimeout(r, 毫秒) })
    }

    // ────────────────────────────── 样式 ──────────────────────────────

    var CSS = [
      '[data-desk-drop="ready"]{cursor:grab}',
      '.dd-btn{pointer-events:auto;flex:none;display:inline-flex;align-items:center;justify-content:center;',
      '  width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;',
      '  color:var(--dsw-alias-label-tertiary,#8a8a8e);cursor:pointer;transition:background-color .12s,color .12s}',
      '.dd-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));color:var(--dsw-alias-label-primary,#222)}',
      '.dd-btn svg{width:15px;height:15px;display:block}',
      '.dd-btn[data-floating="1"]{position:absolute;right:8px;top:50%;transform:translateY(-50%);z-index:6}',
      '.dd-menu{position:fixed;z-index:2147483000;min-width:184px;padding:6px;border-radius:11px;',
      '  background:#fff;color:#1b1b1f;border:.5px solid rgba(0,0,0,.1);',
      '  box-shadow:0 10px 36px rgba(0,0,0,.16),0 2px 6px rgba(0,0,0,.06);',
      '  font:13px/1.2 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;',
      '  transform-origin:top left;animation:dd-pop .1s ease-out}',
      'body[data-ds-dark-theme] .dd-menu{background:#26262b;color:#ececf1;border-color:rgba(255,255,255,.1);',
      '  box-shadow:0 12px 40px rgba(0,0,0,.55)}',
      '@keyframes dd-pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}',
      '.dd-item{display:flex;align-items:center;gap:9px;width:100%;padding:7px 10px;border:0;border-radius:7px;',
      '  background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.dd-item:hover{background:rgba(127,127,127,.16)}',
      '.dd-item[disabled]{opacity:.38;cursor:default;background:transparent}',
      '.dd-item svg{width:14px;height:14px;flex:none;opacity:.75}',
      '.dd-sep{height:.5px;margin:4px 6px;background:rgba(127,127,127,.22)}',
      '.dd-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:2147483000;',
      '  max-width:70vw;padding:8px 14px;border-radius:9px;background:rgba(28,28,32,.92);color:#fff;',
      '  font:12.5px/1.4 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;',
      '  box-shadow:0 8px 24px rgba(0,0,0,.28);animation:dd-pop .12s ease-out;pointer-events:none}',
    ].join('\n')

    function 装样式() {
      var 旧 = document.getElementById('dsh-desk-drop')
      var s = document.createElement('style')
      s.id = 'dsh-desk-drop'
      s.textContent = CSS
      if (旧) 旧.replaceWith(s)
      else document.head.appendChild(s)
    }

    var 图标 = {
      更多: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
      文件夹: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
      复制: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6a2 2 0 0 0-2 2v7.5A2.5 2.5 0 0 0 6.5 15"/></svg>',
      另存为: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="m8 10 4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    }

    // ────────────────────────────── 提示 ──────────────────────────────

    var 提示节点 = null
    var 提示计时 = 0

    function 提示(文) {
      if (!提示节点) {
        提示节点 = document.createElement('div')
        提示节点.className = 'dd-toast'
        document.body.appendChild(提示节点)
      }
      提示节点.textContent = 文
      提示节点.style.display = 'block'
      提示节点.style.opacity = '1'
      clearTimeout(提示计时)
      提示计时 = setTimeout(function () {
        if (!提示节点) return
        提示节点.style.transition = 'opacity .25s'
        提示节点.style.opacity = '0'
        setTimeout(function () {
          if (提示节点 && 提示节点.style.opacity === '0') 提示节点.style.display = 'none'
          提示节点 && 提示节点.style.removeProperty('transition')
        }, 260)
      }, 2200)
    }

    // ────────────────────────────── 复制 ──────────────────────────────

    function 复制(文) {
      return new Promise(function (resolve) {
        function 老办法() {
          try {
            var t = document.createElement('textarea')
            t.value = 文
            t.setAttribute('readonly', '')
            t.style.position = 'fixed'
            t.style.left = '-9999px'
            document.body.appendChild(t)
            t.select()
            var 成 = document.execCommand('copy')
            t.remove()
            resolve(!!成)
          } catch (e) {
            resolve(false)
          }
        }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(文).then(function () { resolve(true) }, 老办法)
            return
          }
        } catch (e) {}
        老办法()
      })
    }

    // ────────────────────────────── 取路径 ──────────────────────────────

    function 卡片路径(卡) {
      if (卡.__ddPath) return 卡.__ddPath
      var 候选 = 卡.querySelectorAll('[title]')
      for (var i = 0; i < 候选.length; i++) {
        var v = 候选[i].getAttribute('title')
        if (像路径(v)) {
          卡.__ddPath = v.trim()
          return 卡.__ddPath
        }
      }
      return ''
    }

    // ────────────────────────────── 字节预热（拖出去更稳） ──────────────────────────────

    var 文件缓存 = {}   // 路径 → File

    function 预热卡片(卡) {
      var p = 卡片路径(卡)
      if (!p || 文件缓存[p]) return
      文件缓存[p] = null
      fetch(绝对址(p)).then(function (r) {
        if (!r.ok) throw new Error('取不到文件')
        return r.blob()
      }).then(function (b) {
        if (b.size > 预热上限) {
          文件缓存[p] = null
          return
        }
        try {
          文件缓存[p] = new File([b], 底名(p), { type: 类型(p) })
        } catch (e) {
          文件缓存[p] = null
        }
      }).catch(function () { 文件缓存[p] = null })
    }

    function 预热图(图) {
      if (!/^blob:/.test(图.src || '')) return null
      if (图.__ddStashPromise) return 图.__ddStashPromise
      var 名 = 图文件名(图)
      图.__ddStashPromise = fetch(图.src).then(function (r) { return r.blob() }).then(function (b) {
        if (b.size > 暂存上限) throw new Error('图太大')
        图.__ddBlob = b
        var 类型名 = b.type || 类型(名)
        return fetch(路由 + '/stash?name=' + encodeURIComponent(名), {
          method: 'POST',
          headers: { 'content-type': 类型名 },
          body: b,
        }).then(function (r) { return r.json() })
      }).then(function (信息) {
        if (!信息 || !信息.path) throw new Error('暂存失败')
        图.__ddStash = 信息
        return 信息
      }).catch(function () {
        图.__ddStashPromise = null
        图.__ddStash = null
        return null
      })
      return 图.__ddStashPromise
    }

    function 图文件名(图) {
      var 名 = (图.getAttribute('alt') || '').trim()
      if (!名) {
        var 框 = 图.closest('button')
        if (框) 名 = (框.getAttribute('aria-label') || 框.getAttribute('title') || '').trim()
      }
      名 = 名.replace(/[\\/:*?"<>|\n\r\t]/g, '_').slice(0, 60).trim()
      if (!名) 名 = 'image'
      if (名.indexOf('.') === -1) 名 += '.png'
      return 名
    }

    // ────────────────────────────── 拖拽 ──────────────────────────────

    function 塞拖拽数据(e, 址, 名, 路径) {
      var dt = e.dataTransfer
      if (!dt) return
      try { dt.effectAllowed = 'copyMove' } catch (err) {}
      try { dt.setData('DownloadURL', 类型(名) + ':' + 名 + ':' + 址) } catch (err) {}
      try { dt.setData('text/uri-list', 址) } catch (err) {}
      if (路径) { try { dt.setData('text/plain', 路径) } catch (err) {} }
    }

    function 拖卡片(e, 卡) {
      var p = 卡片路径(卡)
      if (!p) return
      var 名 = 底名(p)
      var 址 = 绝对址(p)
      var f = 文件缓存[p]
      if (f) {
        try {
          e.dataTransfer.items.add(f)
        } catch (err) {}
      }
      塞拖拽数据(e, 址, 名, p)
      document.documentElement.setAttribute('data-dd-dragging', '1')
    }

    function 拖图(e, 图) {
      var 信息 = 图.__ddStash
      var 名 = 信息 ? 信息.name : 图文件名(图)
      if (图.__ddBlob) {
        try {
          e.dataTransfer.items.add(new File([图.__ddBlob], 名, { type: 图.__ddBlob.type || 类型(名) }))
        } catch (err) {}
      }
      // 没来得及暂存就直接拿 blob: 地址兜一次
      var 址 = 信息 ? location.origin + 信息.url : 图.src
      塞拖拽数据(e, 址, 名, 信息 ? 信息.path : '')
      document.documentElement.setAttribute('data-dd-dragging', '1')
    }

    // ────────────────────────────── 动作 ──────────────────────────────

    function 目标路径(元) {
      return Promise.resolve(元.path || '')
    }

    function 动作定位(元) {
      目标路径(元).then(function (p) {
        if (!p) return 提示('还没拿到文件路径')
        return 发('/reveal', { path: p }).then(function (r) {
          if (r && r.ok) 提示('已在资源管理器中选中')
          else 提示('打不开所在文件夹' + (r && r.error ? '：' + r.error : ''))
        })
      }).catch(function () { 提示('打开失败') })
    }

    function 动作复制(元) {
      目标路径(元).then(function (p) {
        if (!p) return 提示('还没拿到文件路径')
        return 复制(p).then(function (成) {
          提示(成 ? '已复制文件路径' : '复制失败，路径是：' + p)
        })
      })
    }

    function 动作另存为(元) {
      提示('正在打开另存为…')
      目标路径(元).then(function (p) {
        if (!p) return 提示('还没拿到文件路径')
        return 发('/save-as', { path: p }).then(function (r) {
          if (r && r.ok) {
            提示('已另存到 ' + 底名(r.path))
            return
          }
          if (r && r.canceled) return 提示('取消了')
          提示('另存为失败' + (r && r.error ? '：' + r.error : ''))
        })
      }).catch(function () { 提示('另存为失败') })
    }

    // ────────────────────────────── 菜单 ──────────────────────────────

    var 当前菜单 = null

    function 关菜单() {
      if (!当前菜单) return
      try { 当前菜单.remove() } catch (e) {}
      当前菜单 = null
      document.removeEventListener('pointerdown', 菜单外点, true)
      document.removeEventListener('keydown', 菜单按键, true)
      window.removeEventListener('scroll', 关菜单, true)
    }

    function 菜单外点(e) {
      if (当前菜单 && !当前菜单.contains(e.target)) 关菜单()
    }

    function 菜单按键(e) {
      if (e.key === 'Escape') 关菜单()
    }

    function 开菜单(元, 横, 纵) {
      关菜单()
      var 菜单 = document.createElement('div')
      菜单.className = 'dd-menu'
      菜单.setAttribute('role', 'menu')

      var 项目 = [
        { 字: '打开所在文件夹', 图: 图标.文件夹, 做: 动作定位, 没路径: '还没拿到文件路径' },
        { 字: '复制文件路径', 图: 图标.复制, 做: 动作复制, 没路径: '还没拿到文件路径' },
        { 字: '另存为', 图: 图标.另存为, 做: 动作另存为, 没路径: '还没拿到文件路径' },
      ]

      var 有路径 = !!元.path
      项目.forEach(function (项, 序) {
        if (序 === 2) {
          var 隔 = document.createElement('div')
          隔.className = 'dd-sep'
          菜单.appendChild(隔)
        }
        var 钮 = document.createElement('button')
        钮.type = 'button'
        钮.className = 'dd-item'
        钮.setAttribute('role', 'menuitem')
        钮.innerHTML = 项.图 + '<span>' + 项.字 + '</span>'
        if (!有路径 && 序 !== 2) {
          钮.setAttribute('disabled', '')
          钮.title = 项.没路径
        }
        钮.addEventListener('click', function (e) {
          e.preventDefault()
          e.stopPropagation()
          关菜单()
          项.做(元)
        })
        菜单.appendChild(钮)
      })

      document.body.appendChild(菜单)
      当前菜单 = 菜单

      // 摆位置，别出屏幕
      var r = 菜单.getBoundingClientRect()
      var 左 = Math.min(横, window.innerWidth - r.width - 8)
      var 上 = 纵
      if (上 + r.height > window.innerHeight - 8) 上 = Math.max(8, 纵 - r.height)
      菜单.style.left = Math.max(8, 左) + 'px'
      菜单.style.top = Math.max(8, 上) + 'px'

      // 键盘和滚动马上生效；点外部要等这一下点击过去，否则刚打开就被自己关掉
      document.addEventListener('keydown', 菜单按键, true)
      window.addEventListener('scroll', 关菜单, true)
      setTimeout(function () {
        document.addEventListener('pointerdown', 菜单外点, true)
      }, 0)
    }

    // ────────────────────────────── 装饰 ──────────────────────────────

    function 找动作区(卡) {
      // 结构：div.file > button.cardPreview + span.fileIcon + div.fileBody > div.details + div.actions
      var 身 = 卡.lastElementChild
      if (!身 || 身.tagName !== 'DIV') return null
      var 末 = 身.lastElementChild
      if (!末 || 末.tagName !== 'DIV') return null
      if (末 === 身.firstElementChild) return null
      return 末
    }

    function 装饰卡片(卡) {
      if (!卡 || !卡.isConnected) return
      if (卡.querySelector('.dd-btn')) return
      var 路径 = 卡片路径(卡)
      if (!路径) return

      卡.setAttribute('draggable', 'true')
      卡.setAttribute('data-desk-drop', 'ready')

      var 钮 = document.createElement('button')
      钮.type = 'button'
      钮.className = 'dd-btn'
      钮.title = '更多操作'
      钮.setAttribute('aria-label', '更多操作')
      钮.innerHTML = 图标.更多

      卡.__ddMeta = { path: 路径 }

      钮.addEventListener('pointerdown', function (e) { e.stopPropagation() })
      钮.addEventListener('click', function (e) {
        e.preventDefault()
        e.stopPropagation()
        var r = 钮.getBoundingClientRect()
        开菜单({ path: 卡片路径(卡) || 路径 }, r.left, r.bottom + 6)
      })

      卡.addEventListener('contextmenu', function (e) {
        var p = 卡片路径(卡) || 路径
        e.preventDefault()
        e.stopPropagation()
        开菜单({ path: p }, e.clientX, e.clientY)
      })

      卡.addEventListener('pointerdown', function () { 预热卡片(卡) }, true)

      var 区 = 找动作区(卡)
      if (区) {
        区.appendChild(钮)
      } else {
        钮.setAttribute('data-floating', '1')
        卡.appendChild(钮)
      }
    }

    function 装饰图(图) {
      if (!图 || !图.isConnected) return
      if (!/^blob:/.test(图.src || '')) return
      if (图.__ddWired) return
      图.__ddWired = true
      图.setAttribute('draggable', 'true')
      try { 图.style.webkitUserDrag = 'element' } catch (e) {}

      图.addEventListener('pointerdown', function () { 预热图(图) }, true)

      图.addEventListener('contextmenu', function (e) {
        e.preventDefault()
        e.stopPropagation()
        var 元 = { path: 图.__ddStash ? 图.__ddStash.path : '' }
        if (!元.path) {
          预热图(图).then(function (信息) {
            if (信息) 开菜单({ path: 信息.path }, e.clientX, e.clientY)
            else 提示('这张图还没准备好')
          })
          return
        }
        开菜单(元, e.clientX, e.clientY)
      })
    }

    // ────────────────────────────── 事件 ──────────────────────────────

    document.addEventListener('dragstart', function (e) {
      var 卡 = e.target && e.target.closest ? e.target.closest('[data-presented-file]') : null
      if (卡) {
        拖卡片(e, 卡)
        return
      }
      var 图 = e.target && e.target.closest ? e.target.closest('img') : null
      if (图 && 图.__ddStash) 拖图(e, 图)
    }, true)

    document.addEventListener('dragend', function () {
      document.documentElement.removeAttribute('data-dd-dragging')
    }, true)

    document.addEventListener('pointerdown', function (e) {
      var 卡 = e.target && e.target.closest ? e.target.closest('[data-presented-file]') : null
      if (卡) 预热卡片(卡)
    }, true)

    // ────────────────────────────── 扫描 ──────────────────────────────

    function 扫() {
      var 卡们 = document.querySelectorAll('[data-presented-file]')
      for (var i = 0; i < 卡们.length; i++) 装饰卡片(卡们[i])
      var 图们 = document.querySelectorAll('img[src^="blob:"]')
      for (var j = 0; j < 图们.length; j++) 装饰图(图们[j])
      报心跳(卡们.length, 图们.length)
    }

    // 给宿主留个脚印：刷新页面后能确认这一半到底跑没跑起来
    var 上次心跳 = 0
    function 报心跳(卡数, 图数) {
      var 现在 = Date.now()
      if (现在 - 上次心跳 < 8000) return
      上次心跳 = 现在
      try {
        fetch(路由 + '/hello', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cards: 卡数, images: 图数, href: location.href, version: 版本 }),
        }).catch(function () {})
      } catch (e) {}
    }

    var 定时 = 0
    var 观察 = new MutationObserver(function (串) {
      var 有新增 = false
      for (var i = 0; i < 串.length; i++) {
        if (串[i].addedNodes && 串[i].addedNodes.length) { 有新增 = true; break }
      }
      if (!有新增) return
      if (定时) return
      定时 = setTimeout(function () { 定时 = 0; 扫() }, 120)
    })

    function 启() {
      装样式()
      扫()
      if (document.body) 观察.observe(document.body, { childList: true, subtree: true })
      else document.addEventListener('DOMContentLoaded', function () { 扫(); 观察.observe(document.body, { childList: true, subtree: true }) }, { once: true })
    }

    // Cordis 要求模块导出 function 或 { apply }，否则启动时抛
    // "invalid plugin, expect function or object with an apply method"。
    // 这个插件是一整块纯副作用（直接操作 DOM + 和宿主走 HTTP），
    // 没有 ctx 依赖，所以 apply 只负责在激活时把界面装起来。
    var 插件 = {
      name: 'dsh-desk-drop',
      apply: function () { 启() },
    }
    window.__dshDeskDrop.__plugin = 插件
    return 插件
  },
})
