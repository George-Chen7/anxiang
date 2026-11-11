# 安响

安响是一个面向独居老人的居家意外风险发现与社区处置概念项目。项目先聚焦疑似跌倒、异常长时间静止：通过非影像化活动信号发现值得核实的异常，再把事件交给社区网格员联系、核实和记录结果。

当前仓库包含产品方案和两套可运行入口：一套是合并自 `demo1` 的本地完整系统（Python 服务端 + SQLite），另一套是用于 WorkBuddy 静态托管的云端静态版（WorkBuddy 云数据库 + 前端演示登录）；旧纯静态原型保留为存档。**两套运行入口都使用虚构社区与演示告警，没有连接真实传感器、真实住户或生产后端；本地完整系统的数据存本机 SQLite，云端静态版的演示数据存 WorkBuddy 云数据库。** 页面所展示的风险等级也只是演示规则，不代表经过验证的安全判断或医疗诊断。

## 三套入口

| 入口 | 启动方式 | 用途 |
| --- | --- | --- |
| [`web/index.html`](web/index.html)（本地完整系统） | 双击 [`web/start.bat`](web/start.bat)，需 Python 3 | 服务端登录、SQLite 持久化、管理员事件模拟器、网格员处置闭环、处置记录 |
| [`web/welcome-static.html`](web/welcome-static.html)（WorkBuddy 云端欢迎页） | WorkBuddy 静态托管；本地可用 `python web/serve.py` 预览 | 三维欢迎页，进入 `static.html` 的登录与工作台；**推荐线上发布入口** |
| [`web/static.html`](web/static.html)（WorkBuddy 云端静态版） | WorkBuddy 静态托管；本地可用 `python web/serve.py` 预览 | 云端数据库、演示登录、角色区分、管理员新增事件、网格员处置、住户身份卡片；也可作为直接入口 |
| [`web/static-legacy.html`](web/static-legacy.html)（旧静态原型） | 静态托管直接打开 | 无登录、无持久化的三维社区与告警演示存档 |

本地完整系统：双击 `web/start.bat`（或执行 `cd web && python server.py`），服务监听 `127.0.0.1:8765`–`8775`，自动打开欢迎页 `welcome.html`，点“进入登录”后进入 `login.html`。演示账号、数据库表与 API 见 [完整系统说明](docs/完整系统说明.md)。首次启动会在 `web/` 下自动创建 `anxiang.db`，该文件已加入 `.gitignore`。

WorkBuddy 云端静态版：`web/serve.py` / `web/serve.js` 只提供静态文件并默认打开 `static.html`（直接进入登录页）；`welcome-static.html` 是云端欢迎页，点“进入登录”后进入 `static.html`。两者都没有 `/api/*`，页面通过 `cloud-config.js` 和 WorkBuddy Cloud SDK 直接访问云数据库，需要网络。登录为前端演示账号，不是真实身份验证。它提供三维社区视图、楼栋及楼层定位、告警列表、事件详情、身份卡片，以及管理员新增事件和网格员处置；浏览器需支持 WebGL。Three.js、欢迎页和住户卡片构建产物已包含在仓库中。

旧静态原型由 `web/static-legacy.html` + `web/static-app.js` 组成，不需要登录或数据库，保留用于纯静态演示。三个入口共用 `web/vendor/` 和 `web/profile-card/`。

住户卡片是独立的 React/Vite 子应用，主页面通过 iframe 加载 `web/profile-card/dist/index.html`。修改卡片源码后，在 `web/profile-card` 中执行 `npm ci` 和 `npm run build`，并将源码及更新后的 `dist/` 一起提交。

## WorkBuddy 发布与同步

线上地址：[安响社区守护](https://anxiang-community.app.workbuddy.host/web/welcome-static.html)（当前线上仍是上一次发布的旧版本，**尚未同步本次改动**）。现有 WorkBuddy 应用 ID 为 `wbapp_hTMKOcvWyv1WuowOhi6LFW`，更新时复用该应用与域名。线上使用 WorkBuddy 云端静态版，不需要 Python 服务；演示数据存云数据库。

GitHub、本地工作目录和线上发布版本分别更新：`git pull` 只更新本地代码，`git push` 只更新 GitHub；仓库目前没有配置自动部署流程，推送后还需要在 WorkBuddy 中更新发布。

1. 在 WorkBuddy 中打开本仓库目录，确认当前分支及本地修改，再拉取 GitHub 最新代码；有冲突时先保留并处理本地修改。
2. 修改并通过本地预览检查；若改动住户卡片源码，先重新构建卡片。
3. 按需提交并推送 GitHub，然后在 WorkBuddy 的分享面板点击“更新”，或要求“更新发布到已有的安响社区守护应用，保持原域名”。
4. **发布入口必须改为 `web/welcome-static.html`**：它是 WorkBuddy 云端欢迎页，点“进入登录”后进入 `web/static.html` 的云端工作台；如果不需要欢迎页，也可以直接用 `web/static.html` 作为入口。`web/index.html` 是依赖本地 Python 服务的完整系统入口，静态托管下会显示“无法连接本地服务”，不能作为线上入口。`web/static-legacy.html` 只是旧静态存档，也不要作为发布入口。若发布配置仍指向 `web/index.html` 或根目录 `index.html`，需先在 WorkBuddy 中调整入口；当前仓库没有根目录跳转页。
5. 打开线上地址并强制刷新，检查登录页、网格员与管理员角色、云端数据同步、三维视图、告警详情、管理员新增入口及住户卡片，确认资源加载正常。演示登录不是真实身份验证，账号密码在前端代码中可见。

本机 WorkBuddy 关联文件为 `.workbuddy/applications.yaml` 和 `.wbapp_hTMKOcvWyv1WuowOhi6LFW.genie`，其中的本地路径依机器而异。不要将凭据、访问令牌或本机操作记录提交到仓库。修改关联文件本身不会触发发布；没有 WorkBuddy 发布工具或登录会话时，应在 WorkBuddy 内完成更新，不能把 Git 推送当作发布成功。

## 项目文件

- [`docs/产品方案.md`](docs/产品方案.md)：整理后的定位、范围、流程、演示边界与待验证问题。
- [`docs/完整系统说明.md`](docs/完整系统说明.md)：合并自 `demo1` 的完整系统的技术设计、演示账号、数据库与 API（含原开发记录）。
- [`web/`](web/)：本地完整系统入口 `index.html` 与欢迎页 `welcome.html`，WorkBuddy 云端欢迎页 `welcome-static.html`、云端静态版 `static.html`、旧静态存档 `static-legacy.html`，以及共用资源 `vendor/`、`profile-card/`、`architecture.js`、`page-transition.css`。云端静态版使用 `static-cloud.js`、`static-auth.js`、`static-cloud.css`、`cloud-config.js`。
- [`AGENTS.md`](AGENTS.md)：代码修改、验证及发布时的协作约定。

## 当前重点

第一阶段验证一个问题：当独居老人可能发生意外且无法主动求助时，系统能否提供足够清楚的依据，让网格员及时核实并完成处置。燃气等居家安全事件仅作为未来可接入的扩展方向；水、电异常暂不纳入当前核心场景。

真实试点前，还需要确定设备能提供什么数据、正常作息基线如何建立、误报如何处理、社区由谁接警，以及隐私和授权方式。具体阈值和效果需用真实数据验证。
