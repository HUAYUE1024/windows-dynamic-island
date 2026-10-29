<div align="center">

# Windows 灵动岛

### 灵动岛终于有了 Windows 版 —— 而且是真的会弯折背后内容的玻璃

无边框、置顶、贴在屏幕边缘的状态岛。它从 Windows 原生 API 读你的媒体、音量、电池、
网络和机器状态，用一套有单测覆盖的优先级引擎决定此刻该显示什么，再以 Apple Liquid
Glass 的五层光学栈在模块之间形变 —— 是真正的背景折射，不是加一层模糊。

**[下载 Windows 版](../../releases)** · [工作原理](#工作原理) · [从源码构建](#从源码构建)

**English** · [README.md](README.md)

![Windows](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D6?style=flat-square)
![Electron](https://img.shields.io/badge/electron-33-9FEAF9?style=flat-square&logo=electron&logoColor=white)
![.NET](https://img.shields.io/badge/.NET%20Framework-4.x-512BD4?style=flat-square&logo=dotnet&logoColor=white)
![tests](https://img.shields.io/badge/tests-40%20passing-2EA44F?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-yellow?style=flat-square)

</div>

---

## 为什么做这个

Windows 上没有一个地方能放"现在正在放什么"，而且不占你一块窗口。媒体键弹出一个覆盖层
然后消失，任务栏缩略图藏在 Alt+Tab 后面，托盘区是坟场。

它在你的屏幕顶端放了一颗活的药丸。悬停就长成一张真能操作的卡片，其余时间完全让开 ——
点击直接穿透到下面的窗口。

最难抄的部分：**玻璃会弯折它背后的桌面。** Chromium 130+ 允许 `backdrop-filter` 挂
SVG 滤镜，而 `feDisplacementMap` 位移的就是 **backdrop 本身**。所以岛后面的城市灯光、
代码编辑器、视频，是被真实地扭曲透过这层镜片的 —— Apple 那套玩法，跑在 Windows 上。

<p align="center"><img src="docs/island-collapsed.png" alt="收起态压在实际桌面上" width="720"></p>

---

## 亮点

**真折射，不是模糊。** 五层光学：磨砂、位移、色调、不透明度、镜面追光。位移图被调成
透镜式畸变（`baseFrequency` 0.004/0.006、一个八度），而不是噪点。每个参数都是实时的，
拖动时立刻看得见。

**是状态中心，不是音乐挂件。** 九个模块共用一座岛和一套优先级引擎：音乐、音量、电池、
网络、CPU/内存、系统快捷操作、专注计时、待办、剪贴板历史。谁最要紧谁占屏。

**尊重你的优先级。** 你刚碰过的模块在 10 秒内压过一切 —— 否则音乐一放，音量卡片就永远
点不到了。当前卡片压过默认模块，但永远压不过低电量和断网告警。整套引擎是纯函数，
40 个单测。

**没有反馈环的点击穿透。** 最直觉的做法 —— 监听 `pointermove` 再切换
`setIgnoreMouseEvents` —— 会永远振荡，因为状态一翻 Windows 就补发鼠标消息，消息又把
状态翻回去。这里改成主进程每 50ms 轮询光标。不转发事件，就没有环。

**两个原生探针，不是脚本。** `probe.exe` 读 SMTC 媒体（PowerShell 读不了 —— WinRT
投影读不了 `IAsyncOperation<接口>`，专辑封面从脚本根本拿不到）。`sysprobe.exe` 读
Core Audio 音量、WinRT 电池、网络连通性和机器状态。两者启动都比脚本快一个数量级。

**空闲时一点不浪费。** 镜面高光只在真有 CSS 规则读它时才重绘；指针移动被合并进一个
动画帧；矩形缓存起来靠 ResizeObserver 失效，不是每个事件重读一次。形变实测
p95 3.5ms/帧。

---

## 九个模块

| | |
|---|---|
| **音乐** | SMTC 会话 —— 封面、标题、时间轴、传输控制，拖动进度条即 seek |
| **音量** | 按设备的音量和静音，±5 步进，无级滑杆 |
| **电池** | 电量、剩余时间、低电量告警；台式机会正确显示"无电池" |
| **网络** | 适配器类型、SSID、信号；断线时降级成一张空卡 |
| **性能** | CPU、内存、进程数 |
| **快捷** | 锁屏、睡眠、截图、任务管理器、重启桌面 —— 破坏性操作两步确认 |
| **专注** | 倒计时，暂停冻结时钟，继续时接着暂停的值跑 |
| **待办** | 快速添加的清单，和设置存在一起 |
| **剪贴板** | 带搜索的历史；点一行就粘回你刚才在用的那个窗口 |

---

## 截图

**悬停药丸，长成一张能操作的卡片。** 传输控制、时间轴、顶部的模块轨 —— 每个模块都在
岛内一键可达。

<p align="center"><img src="docs/island-music.webp" alt="展开的音乐卡片" width="720"></p>

**每个玻璃参数都是实时的。** 设置窗以药丸尺寸渲染真实的光学栈，由右侧的设置驱动 ——
你拖的就是你得到的，提交之前就能看见。

<p align="center"><img src="docs/settings.png" alt="带实时玻璃预览的设置窗" width="720"></p>

---

## 安装

**下载最新的 Release** —— 解压，运行 `liquid-island.exe`。没有安装程序、不需要管理员
权限、不用装运行时。

> 三个探针二进制（`probe.exe`、`sysprobe.exe`、`paste.exe`）已经打在包里。它们用的是
> .NET Framework，每台 Windows 10/11 上都自带。

**要求：** Windows 10 或 11，以及能跑 SVG `backdrop-filter` 的 Chromium 130+
（2024 年以后的机器都行）。

---

## 从源码构建

```bash
git clone https://github.com/HUAYUE1024/windows-dynamic-island.git
cd windows-dynamic-island
npm install

npm run build:probe   # 编译三个 C# 探针 -> bin/
npm start             # 跑起来
```

探针用 Windows 自带的 .NET Framework `csc.exe` 加 SDK 的 `Windows.winmd` 编译。
不需要 Visual Studio、不需要 MSBuild、不需要 NuGet。

```bash
npm test              # 40 个单测：优先级引擎、设置校验、状态推导
npm run dist          # 打包一个可移植版本到 dist/
```

---

## 工作原理

```
                    ┌──────────────────────────────────────────┐
   SMTC  ──────────►│  probe.exe     (C#, WinRT)               │
   Core Audio ─────►│  sysprobe.exe  (C#, COM interop + WinRT) │──────┐
   foreground ─────►│  paste.exe     (C#, Win32)               │      │
                    └──────────────────────────────────────────┘      │
                                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  主进程                                                                 │
   │                                                                        │
   │  按模块各一个 timer  ──►  pickActiveModule()  ◄── 纯函数                 │
   │  50ms 光标轮询 ──► 点击穿透命中测试 ──► setIgnoreMouseEvents              │
   │  窗口几何、置顶、托盘、全局快捷键                                        │
   └──────────────────────────────────────────┬───────────────────────────────┘
                                              │  state
                                              ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  渲染进程                                                               │
   │                                                                        │
   │  VIEWS[id].body() / foot() / mount()   mount() 返回 update(next)        │
   │  所以一次轮询是就地刷新卡片，而不是重建 DOM                              │
   │                                                                        │
   │  五层玻璃：blur ─ feDisplacementMap ─ tint ─ opacity ─ specular        │
   └──────────────────────────────────────────────────────────────────────────┘
```

三个决策撑起了大部分重量：

**`mount()` 返回一个 updater。** 每次轮询都重建模块的 DOM，正是冻住标题和扔掉进行中
拖动的元凶。现在一次轮询只改动变了的节点，其余原地不动。

**优先级引擎是纯的。** `pickActiveModule(states, ctx)` 里没有 Electron 也没有 DOM，
所以排序规则 —— 粘滞压播放、播放压计时、当前压默认、告警报除粘滞外的一切 ——
是可以被测试的，而不是靠猜。

**命中矩形是断言出来的，不是假设的。** `ISLAND.hOpen` 和 CSS 的 `--island-h-open`
必须一致，否则点击穿透的矩形就差在这个差值上。启动时两边会互相量一遍，任何漂移都会被
大声记进日志。曾经 28px 的不一致把整个按钮行塞进了死区。

---

## 开发

```bash
npm test                          # 单测
node scripts/cdp.mjs eval "…"     # 通过 DevTools 协议驱动运行中的岛
```

`scripts/cdp.mjs` 通过 CDP 和真实运行中的窗口对话，交互行为就是这么验证的 ——
合成的 `.click()` 会跳过命中测试和 pointer capture，而那正是拖动 bug 住的地方。

端到端的媒体检查需要一个发布确定性 `mediaSession` 的假播放器；它的封面和音频是生成的，
不进仓库：

```bash
node test/fixtures/gen-fixtures.mjs   # -> test/fixtures/{art.png,tone.wav}
node scripts/clip-check.js            # 对真实 app 跑剪贴板往返
```

---

## 许可

[MIT](LICENSE)

内置的 Electron 和 Chromium 用它们自己的许可证；打包后的构建里见 `LICENSE` 和
`LICENSES.chromium.html`。
