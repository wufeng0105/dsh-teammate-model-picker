# 验证记录

> 本文件是**验证记录**，不是设计说明：设计理由见 [DESIGN.md](./DESIGN.md)，术语见 [CONTEXT.md](./CONTEXT.md)。
> 规则：任何"会随代码失效"的判定都指向一条断言；本文件只记录**什么时候、在什么环境**上跑过，以及还没跑的部分。

## 1. 现在由谁判定

| 判定项 | 判定者（可复跑） |
|---|---|
| 三条 waterfall 被安装、`system-prompt/assemble` 快照、`agent/request` 改写路由 | `tests/host/apply.test.mjs` |
| 无 override 时零介入（不变量 I-1） | `tests/host/apply.test.mjs` |
| 只读被声明的服务，从不触碰全局默认模型（不变量 I-2） | `tests/host/apply.test.mjs` |
| `model/selection` 追加的形状（无空 effort） | `tests/host/apply.test.mjs` |
| 队友判定真值表（含"投影读不出来 → 拒绝"） | `tests/host/core.test.mjs` |
| 安装计划四态（noop / dispose / install） | `tests/host/core.test.mjs` |
| Client 注册值（loader id、5 项 inject、座位名/id/order/locale） | `tests/client/client.test.mjs` |
| settings 与 catalog 的响应形状被断言、坏形状报可读错误 | `tests/client/client.test.mjs` |
| `showPicker: false` 真的隐藏选择器 | `tests/client/client.test.mjs` |
| 每道门都能变红（9 条负例） | `tests/negative/gates.test.mjs` |
| 身份一致、依赖方向、样式 token、打包清单、版本区间、文档预算 | `scripts/check-*.mjs`（`npm run check`） |
| 版本区间 vs 本机运行时、row 是否挂上、会话日志格式、schema 协议自述 | `tools/doctor.mjs` |

## 2. 只需要真机判定的部分（行为门）

行为门必须有一条真实的队友会话，因此不进 `npm run check`。步骤与判定标准：

```powershell
node tools/session-model-log.mjs <teammateSessionId>
```

| # | 判定 | 成立条件 |
|---|---|---|
| B-1 | override 生效 | `request/header` 的 provider/model 等于 override，且不等于 `subagent/descriptor` 里的派发路由 |
| B-2 | 切换意图被记录 | 出现 `model/selection`，其值与 override 一致 |
| B-3 | 继续跑完 | 切换之后的 `turn/end` 是 `completed`（而非 `QUOTA_EXCEEDED` 之类的 error） |
| B-4 | 不越界 | Lead 会话仍在原模型；`agent-default-model` 配置未变 |
| B-5 | 跨重启仍生效 | Harness 重启后首次唤醒的 `request/header` 仍是 override 路由 |

## 3. 0.1.0 的历史实测（记录，不是当前断言）

在 DSH `0.2.1-rc.5` 上，用一次真实的额度失败走通了 B-1…B-4：`subagent/descriptor` 记下派发路由 `provider-a/model-a` → 同一路由的 `request/header` → `turn/end ERROR {"code":"QUOTA_EXCEEDED"}` → `model/selection` 记为 `provider-b/model-b`（effort `high`）→ 随后 `request/header` 变成该 override → `turn/end completed`。跨重启那条也在当时实测过（重启后首次唤醒仍走 override 路由）。路由名按中性占位书写：当时的具体 provider/model 名属本机配置，不随仓库发布。

这些是**当时**的观察：它们现在由 §1 的断言与 §2 的流程重新判定，不再由这段文字保证。

## 4. 未验证的边界（如实列出）

- **没有自动读取 DOM**：本机 Electron 未开 remote-debugging-port，GUI 需要鉴权。视觉对齐的依据是用户截图 + 座位占用值，不是自建截图。
- **渲染核对未执行**：规范要求安装后核对 `meta.title`/`description` 与渲染出的图标（中英各一遍）。静态部分已由 `scripts/check-pack.mjs` 与 `scripts/check-docs.mjs` 断言（locale 双语的键集一致、`meta.*` 非空、icon 与 locale 都在 `exports`/`files` 里），**渲染结果本身未核对** —— 需要一次 GUI 操作。
- **运行期 API 查阅未执行**：契约清单里的服务/事件形状目前由运行期自证（probe）盯着，没有用 inspection 工具逐条核对过（本会话的工具集里没有该工具）。
- **安装态未重载**：源码以 `link:` 挂进 profile，本次改动需要重载/重启 DSH 才在运行中的会话里生效；本次没有触发重启。
- **没有在真实额度耗尽上重跑行为门**：0.2.0 的改动（分层重写）不改变路由语义，且 I-1/I-2 与 waterfall 行为均有离线断言，但 B-1…B-5 尚未在真机上重跑一遍。

## 5. 上游建议（截至 DSH 0.2.1-rc.5）

这几条更适合由 DSH 官方修；本插件的存在理由是它们还没修：

- 队友会话被排除在模型选择器之外，不像是有业务理由 —— continuable 队友是可继续的会话，理应允许换模型。
- Host 侧 `session/agent-busy` 对 subagent-owned 会话的一刀切拒绝，阻断了所有 `agent`-lookup 型 Remote 对队友的服务。
- descriptor 取第一条且拒绝未知字段，使"用户显式改路由"无法写回权威结构；若官方允许队友会话以 `model/selection` 覆盖 descriptor，本插件就不必另开用户配置层。
- `selectModel` 顺带持久化全局默认模型，语义上可疑：会话级切换不应改全局默认值。
- `conversation.input.model` 是 `single` 且会遮蔽官方 UI，没有"给队友会话补一个 occupant"的官方路径。
