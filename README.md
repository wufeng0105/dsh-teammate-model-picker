# dsh-teammate-model-picker

给 DeepSeek Harness（DSH）的**队友会话**加一个模型选择器。

在队友因为额度耗尽而失败之后，你可以直接给它换一个有额度的模型，然后让它继续跑 —— 不必注销重建队友，也不影响你自己的会话或全局默认模型。

---

## 它解决什么问题

DSH 的队友（teammate / 可继续的 subagent）在**被派发的那一刻**就把当时 Lead 使用的模型写进了自己的会话描述（durable descriptor）。此后每次唤醒 —— 收到消息、恢复运行、冷恢复 —— 都按这份描述里的模型路由，**不会重新解析当前默认模型**。

于是当队友被钉在一个已耗尽额度的模型上时：

- 你在 GUI 里切换自己的模型，它不受影响；
- 给它发"继续"，它会在同一条已耗尽的路由上再失败一次。

而 DSH 现有的"切换模型"能力对队友会话是**明确拒绝**的：Client 侧官方选择器对 subagent 会话直接返回 `null`，Host 侧通用 Session 路由对 `origin: "subagent"` 的会话一律返回 `session/agent-busy`。队友会话的模型座位因此是空的。

## 它做了什么

一个 DSH 官方插件 bundle，分两半：

- **Host 半边**：把"每个队友的模型覆盖"存成插件 Config（`overrides`），在队友 Agent 发布时（`agent/created`）为它安装与官方 `installModelSelection` 等价的三个 waterfall，覆盖 `agent/request` 的最终路由。
- **Client 半边**：在 composer 工具行的 `conversation.input.right` 座位注册一个模型选择器，观感对齐官方 `ModelSelect`（两级菜单：模型 / 推理等级）。只在队友会话里渲染。

关键取舍：

- **不修改任何官方包**，不改 `app.asar`。
- **不引入新的 session 事件类型** —— 只复用既有的 `model/selection`。
- **不改变"队友路由由派发决定"这条语义** —— 没有覆盖时，descriptor 路由原样生效，插件一行代码都不介入。
- **不动全局默认模型** —— 从不调用 `agentDefaultModel.saveSelection`。

## 安装

```powershell
plugin_manager install_bundle  target = <本目录绝对路径>
```

返回 `application: applied` 且 `warnings: []` 即生效。

卸载：

```powershell
plugin_manager remove_bundle  target = @local/dsh-teammate-model-picker
```

> 注意区分三个层面：**安装/卸载 bundle** 改的是 profile 的 `package.json` 的 `dsh.profile.bundles`；**bundle 默认**在源 `cordis.patch.yml` 里；**用户配置**（你选的模型）在用户 profile patch 层的 `- id: teammate-model-picker` 这一行。清空用户配置 ≠ 卸载 bundle。

## 使用

1. 打开一个队友会话。
2. composer 工具行右侧会出现模型选择器（显示当前模型 + 推理等级）。
3. 点开 → 「模型」→ 选一个还有额度的模型。
4. 给队友发"继续"。

改动立即生效，并写入用户 profile patch 层，**重启 Harness 后依然生效**。

## 验证

仓库自带一个会话日志检查脚本，用来确认某个队友实际用的是哪条路由：

```powershell
node tools/session-model-log.mjs <teammateSessionId>
```

它解压 `session.v4.jsonl.zstd` 并打印四类事件：`subagent/descriptor`（派发时钉下的路由）、`model/selection`（切换意图）、`request/header`（每次请求实际用的路由）、`turn/end`（含失败原因）。

一次真实的额度失败 → 换模型 → 继续跑完，日志长这样：

```
[  0] subagent/descriptor {"mode":"continuable","agentProvider":"tierflow","agentModel":"tierflow_pro"}
[ 14] request/header      {"provider":"tierflow","model":"tierflow_pro"}
[ 48] turn/end            ERROR {"code":"QUOTA_EXCEEDED"}
[ 50] model/selection     {"provider":"buddy","model":"hy4free","reasoningEffort":"high"}
[ 59] request/header      {"provider":"buddy","model":"hy4free","reasoningEffort":"high"}
[ 63] turn/end            completed
```

## 已知限制

- **选择器落在相邻座位**，不是官方那个模型座位 —— 因为 `conversation.input.model` 是 `single` slot，再注册一个会遮蔽官方组件、连 Lead 自己的选择器一起弄没。`conversation.input.right` 是同行的 `list` slot，纯附加。
- **复制了官方 CSS**（类名前缀改成 `tmp_`，只保留 `--dsw-alias-*` token）。官方改版样式时需要同步。
- **没有"清除 override / 恢复派发路由"的 UI 项**：要完全回到 descriptor 路由，需手动把用户配置层的 `overrides` 清回 `[]`。
- **没有模型白名单**：展示的是运行时 `modelCatalog()` 全量目录，没有复用子代理模型白名单那套设置。
- **设置页开关尚未实现**：`Config.showPicker` 已声明并暴露在用户配置层，但组件还没读它做条件渲染，也还没有 Settings 页面来开/关本功能。

## 与官方的关系

这份实现是**本地绕过**，不是官方正解。其中几条更适合由 DSH 官方修：

- 队友会话被排除在模型选择器之外本身就像官方缺陷 —— continuable 队友是可继续的会话，理应允许换模型；
- Host 侧 `session/agent-busy` 对 subagent-owned 会话的一刀切拒绝，阻断了所有 `agent`-lookup 型 Remote；
- descriptor 取第一条且拒绝未知字段，使得"用户显式改路由"无法写回权威结构；
- `selectModel` 顺带持久化全局默认模型，语义上可疑。

完整的数据流分析（附文件与行号）、路线对比、验证信号与上游建议见 [`REPORT.md`](./REPORT.md)。

## 仓库内容说明

这是一个**公开子集**。以下本地工作文档未包含在仓库中：

| 未包含 | 原因 |
|---|---|
| `OUTLINE.md` | 本项目的写作账本（一体成文流程用），属内部过程文档 |
| `DSH-UPGRADE-IMPACT-REPORT.md` | 内部耦合审计，含本机环境细节 |

因此 `REPORT.md` 里提到这两份文档的位置在仓库中读不到，属预期。`.codegraph/`（本机索引）也不入库。

## License

MIT，见 [`LICENSE`](./LICENSE)。

`vendor/` 下的 `@deepseek-ai/schemastery` 3.18.5 与 `@deepseek-ai/cosmokit` 1.8.6 为原样内置的第三方代码（MIT），各自保留 LICENSE 文件。之所以内置，是因为 bundle 以 `link:` 方式挂入 profile 时，裸包导入无法解析。
