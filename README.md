# dsh-teammate-model-picker

给 DeepSeek Harness（DSH）的**队友会话**加一个模型选择器。

在队友因为额度耗尽而失败之后，你可以直接给它换一个有额度的模型，然后让它继续跑 —— 不必注销重建队友，也不影响你自己的会话或全局默认模型。

---

## 它解决什么问题

DSH 的队友（teammate / 可继续的 subagent）在**被派发的那一刻**就把当时 Lead 使用的模型写进了自己的会话描述（durable descriptor）。此后每次唤醒 —— 收到消息、恢复运行、冷恢复 —— 都按这份描述里的模型路由，**不会重新解析当前默认模型**。

于是当队友被钉在一个已耗尽额度的模型上时：

- 你在 GUI 里切换自己的模型，它不受影响；
- 给它发"继续"，它会在同一条已耗尽的路由上再失败一次。

而 DSH 现有的"切换模型"能力对队友会话是**明确拒绝**的：Client 侧官方选择器对 subagent 会话直接返回空，Host 侧通用 Session 路由对 `origin: "subagent"` 的会话一律返回 `session/agent-busy`。队友会话的模型座位因此是空的。

## 它做了什么

一个 DSH 插件 bundle，分两半：

- **Host 半边**：把"每个队友的模型覆盖"存成插件 Config（`overrides`），在队友 Agent 发布时（`agent/created`）为它安装与官方 `installModelSelection` 等价的三个 waterfall，覆盖 `agent/request` 的最终路由。
- **Client 半边**：在 composer 工具行的 `conversation.input.right` 座位注册一个模型选择器，观感对齐官方选择器（两级菜单：模型 / 推理等级）。只在队友会话里渲染。

关键取舍：

- **不修改任何官方包**，不改 `app.asar`。
- **不引入新的 session 事件类型** —— 只复用既有的 `model/selection`。
- **不改变"队友路由由派发决定"这条语义** —— 没有覆盖时，descriptor 路由原样生效，插件一行代码都不介入。
- **不动全局默认模型** —— 从不调用 `agentDefaultModel.saveSelection`。

完整的设计理由（为什么只能走这条缝、为什么座位是相邻的、分层与依赖方向）见 [DESIGN.md](./DESIGN.md)。

## 安装

```powershell
plugin_manager install_bundle  target = <本目录绝对路径>
```

返回 `application: applied` 且 `warnings: []` 即生效。

卸载：

```powershell
plugin_manager remove_bundle  target = @wufeng0105/dsh-teammate-model-picker
```

> 三个层面要分清：**安装/卸载 bundle** 改的是 profile 的 `package.json` 里 `dsh.profile.bundles`；**bundle 默认**在源 `cordis.patch.yml` 里；**用户配置**（你选的模型）在用户 profile patch 层的 `- id: teammate-model-picker` 这一行。清空用户配置 ≠ 卸载 bundle。

## 使用

1. 打开一个队友会话。
2. composer 工具行右侧会出现模型选择器（显示当前模型 + 推理等级）。
3. 点开 → 「模型」→ 选一个还有额度的模型。
4. 给队友发"继续"。

改动立即生效，并写入用户 profile patch 层，**重启 Harness 后依然生效**。菜单里的「恢复派发路由」会删掉这个队友的 override，让它回到派发时钉下的那条路由。

`Config.showPicker` 是真正的开关：设为 `false` 时选择器不渲染（默认 `true`）。

## 验证

**离线门（一条命令，秒级）**：

```powershell
npm run check
```

6 道静态/契约门（身份一致、依赖方向、样式 token、打包清单、版本区间、文档预算与可追溯性）+ 离线契约测试（Host fake-DSH、Client vm、负例自检）。负例保证每道门都能变红。

**环境检查**：

```powershell
node tools/doctor.mjs              # 版本区间 / row / 会话日志格式 / schema 协议自述
node tools/doctor.mjs --contracts  # 打印本插件依赖的契约清单
```

**行为门（需要真机队友会话）**：换模型是否真的生效，只能由一条真实会话判定。

```powershell
node tools/session-model-log.mjs <teammateSessionId>
```

它解压 `session.v4.jsonl.zstd` 并打印四类事件：`subagent/descriptor`（派发时钉下的路由）、`model/selection`（切换意图）、`request/header`（每次请求实际用的路由）、`turn/end`（含失败原因）。判定标准与历史实测见 [REPORT.md](./REPORT.md)。

## 已知限制

- **选择器落在相邻座位**，不是官方那个模型座位 —— 官方座位是 `single`，再注册一个会遮蔽官方组件、连 Lead 自己的选择器一起弄没。视觉接近，但 tooltip/aria 与键盘 Tab 序列与官方不完全同源。
- **复制了官方 CSS**（类名前缀 `tmp_`，只用主题 token）。官方改版样式时需要同步；token 改名只退化外观、不会崩。
- **没有模型白名单**：展示的是运行时目录全量。若部署启用了子代理模型白名单，二者可能不一致。
- **切换在活跃 turn 中生效于下一个 step**：与官方 `installModelSelection` 语义一致，不中断进行中的请求。
- **对 agent 暴露的操作尚未接线**：换模型目前只有 UI 路径，规范要求的 agent tool 还没注册（需要一次运行期 API 查阅）。

## 与官方的关系

这份实现是**本地绕过**，不是官方正解。其中几条更适合由 DSH 官方修：队友会话被排除在模型选择器之外、Host 侧对 subagent-owned 会话的一刀切拒绝、descriptor 不可改写、`selectModel` 顺带持久化全局默认模型。详见 [REPORT.md](./REPORT.md) 的「上游建议」。

## 仓库内容

公开仓库是本地项目的子集：内部工作文档（决策记录、写作账本、耦合审计、改造方案）不随仓库发布。`REPORT.md` 与 `DESIGN.md` 里提到它们的位置在仓库中读不到，属预期。

## License

MIT，见 [LICENSE](./LICENSE)。

`vendor/` 下的 `@deepseek-ai/schemastery` 3.18.5 与 `@deepseek-ai/cosmokit` 1.8.6 为原样内置的第三方代码（MIT），各自保留 LICENSE 文件。之所以内置，是因为 bundle 以 `link:` 方式挂入 profile 时，裸包导入无法解析。
