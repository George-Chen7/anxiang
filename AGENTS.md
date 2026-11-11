# 项目协作约定

## 范围与结构

- 修改前检查 Git 状态、现有实现和目录内的 AGENTS.md，保留用户未提交的修改。
- 当前为本地演示系统：`web/index.html` 使用本机 SQLite 与演示账号，`web/static.html` 为纯静态模拟数据原型；不得声称已经接入真实传感器、真实住户或生产后端。
- 主页面位于 `web/index.html`，交互及样式位于 `web/app.js`、`web/console.js`、`web/style.css`、`web/console.css`；数据层为 `web/store.js`、`web/api.js`、`web/server.py`、`web/database.py`。复用现有实现，避免无关重构。静态原型由 `web/static.html` + `web/static-app.js` 组成，两套入口共用 `style.css`、`vendor/` 和 `profile-card/`，改动时一并检查。
- 住户卡片位于 `web/profile-card/`，以独立 iframe 加载其 `dist/index.html`；保持既有通信方式，不引入第二套三维场景。

## 实现与验证

- 匹配现有文件风格；新增代码使用明确的类型或 JSDoc 类型，复杂数据结构定义清楚。函数单一职责，不用默认参数或切换行为的标志参数。
- 导入放在文件顶部。错误应明确报告并包含可定位的上下文，不吞掉异常，不擅自增加回退逻辑。
- 依赖写入子项目 `package.json`，使用项目环境和锁文件，不做全局安装。
- 使用 `rg` 搜索；使用 `git --no-pager diff` 审查改动。
- 文档修改检查链接、路径和命令是否符合当前仓库。页面修改通过本地 HTTP 服务验证受影响流程；卡片源码修改后在 `web/profile-card` 执行 `npm ci`、`npm run build`，同时保留更新后的构建产物供审查。
- 不默认新增单元测试，按变更范围使用现有检查或最小的真实流程验证。未运行的验证必须如实说明。

## WorkBuddy 与 GitHub

- 发布地址、应用 ID、入口及操作步骤以 [README.md](README.md#workbuddy-发布与同步) 为准，避免在多个文件重复维护。
- 发布前检查本机 WorkBuddy 关联配置是否指向该目录和现有应用，入口是否存在。保留原应用及域名，不另建站点替代。
- Git 拉取、Git 推送和 WorkBuddy 更新发布是不同操作；只有发布完成并验证线上结果后才能报告网站已更新。
- 不提交 WorkBuddy 凭据、访问令牌、本机路径配置或操作记录；没有发布工具或登录会话时明确说明限制。
- 不擅自接入外部服务或扩大后端范围；新增数据存储、外部依赖或线上后端时先确认范围。本地 SQLite 演示系统已在 `web/` 中，改动前参考 `docs/完整系统说明.md`。
- 仅在用户明确要求时提交；仅在获得授权时推送或发布。不使用强制推送，不覆盖无关改动。
