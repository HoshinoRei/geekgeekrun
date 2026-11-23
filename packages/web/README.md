# @geekgeekrun/web — 网页控制台

将桌面版（Electron）的自动化核心放在容器里运行，用浏览器代替桌面窗口，实现
Docker 部署 + 网页控制。

## 组成

| 目录 | 作用 |
| --- | --- |
| `server/` | 常驻 Web 服务：静态页面、HTTP/SSE IPC 桥、DB 代理、任务进程管理、登录会话、浏览器视图（截图 + 点击/输入转发） |
| `src/` | 构建期源码：worker 入口、Electron/daemon 桩、DB worker、LLM 辅助模块 |
| `web-dist/` | esbuild 产物（构建生成，勿提交）：`*-worker.mjs`、`db-worker.cjs`、`llm-bridge.cjs` |

浏览器侧代码在 `packages/ui/src/renderer/src/web/`：

- `install-electron.ts`：在 `window.electron` 不存在时安装 IPC 兼容层
- `ipc.ts`：`invoke`/`send`/`on` → HTTP + SSE
- `intercept.ts`：把桌面版的「弹出窗口」类 IPC 调用改为页内对话框
- `modal.ts` / `login-modal.ts` / `site-viewer.ts` / `prompt-editor.ts`：各类对话框

桌面版 worker（`packages/ui/src/main/flow/**`）通过 esbuild 打桩后直接复用：
`electron`、daemon 连接、浏览器助手、GTag 等在 `src/stubs/` 中替换，业务代码零分叉。

## 本地开发

```sh
# 依赖
pnpm install

# sqlite 原生模块需要按当前 Node ABI 编译
(cd node_modules/better-sqlite3 && npm run install)

# 构建 worker 包 + 网页渲染层
pnpm web:build

# 启动（默认 http://127.0.0.1:3210）
pnpm web:start
```

浏览器连接由 `packages/utils/puppeteer/browser-connection.mjs` 统一处理：

- 设置 `GEEKGEEKRUN_BROWSER_URL` 或 `GEEKGEEKRUN_BROWSER_WS_ENDPOINT` 时，通过 CDP 连接外部浏览器
- 未设置外部地址时，启动本地 Chrome（桌面版 / 本地开发；`GEEKGEEKRUN_HEADLESS` 控制有头/无头）
- Docker 部署始终由 compose 设置外部地址，镜像不包含浏览器

远程模式下停止任务只会关闭自动化创建的标签页并断开 CDP，不会关闭外部浏览器。

常用环境变量见仓库根 README 的 Docker 章节；本地调试可用：

- `PORT` / `HOST`：监听地址
- `PUPPETEER_EXECUTABLE_PATH`：指定本机 Chrome/Chromium
- `GEEKGEEKRUN_HEADLESS=0`：改为有头模式（需图形环境）
- `GEEKGEEKRUN_PUPPETEER_ARGS`：追加 Chromium 参数
- `GEEKGEEKRUN_DEBUG_SHUTDOWN=1`：输出浏览器/登录会话关闭过程日志

## 运行数据

与桌面版一致，位于 `~/.geekgeekrun`（容器内为 `/data/.geekgeekrun`）：

- `config/`：`boss.json`、`llm.json`、`resumes.json` 等
- `storage/`：`boss-cookies.json`、`public.db`、提示词模板
