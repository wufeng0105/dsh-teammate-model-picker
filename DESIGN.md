# 设计：为什么只能这样绕

这份文档回答一个问题：为什么这个插件是这样的形状。它只放稳定结论——会随代码变化的东西（契约清单、验证信号、断言）都在代码里，见文末的指针。现象与用法在 [README.md](./README.md)；术语见 [CONTEXT.md](./CONTEXT.md)。

## 1. 派发路由为什么换不了

队友在被派发的那一刻就把当时的路由写进了自己的会话描述。此后每次唤醒（收消息、恢复运行、冷恢复）都从那份描述恢复，不重新解析当前默认模型。所以把队友"钉在"一条已耗尽的路由上的，不是配置，而是**写进会话 log 的既定事实**。

要换路由，得先看清三层叠加的拒绝：

1. **Host 路由所有权**：header `origin === "subagent"` 的会话，通用 Session 路由一律返回 `session/agent-busy`，凡带 `agent` 参数的 Remote（`commands.execute`、`goals.get` 等）都走同一条拒绝路径。
2. **Client 官方选择器**：官方 `ModelSelect` 与 `/model` 命令都用同一条 `sessions.subagentAddress(sessionId) === void 0` 判定，对队友直接不渲染。
3. **GUI 渲染**：队友以普通 conversation view 打开，continuable 队友回落到官方 InputBar，于是 `conversation.input.model` 挂载而官方组件返回空——那一格就是空的。

**唯一那道缝**是 settings Remote 的 `describe()` / `mutate()`：它按 entry id 寻址，不走 `agent` lookup，因此不受第 1 层拒绝影响；能读、能写，且写进用户配置层后跨重启存活。本插件的全部落点就建立在这一道上。

## 2. 为什么不是改 `app.asar`

改归档内的官方包技术上可行，但升级时会被安装器的整包重写静默抹掉、需要停机、改动面覆盖三四个包且没有可 diff 的回滚。用户配置层在升级后保留，因此改包路线的**全部成本**换来的是"下次升级即失效"。

## 3. 分层与依赖方向

四层，Host 半与 Client 半同构：

| 层 | 职责 | 允许知道什么 |
|---|---|---|
| L2 entry（`index.js`、`client.js` 的注册段） | 装配：读 Config、建 adapter、挂载与回收 | 全部下层，但不含领域规则 |
| L1 core（`host/core/*`、`client.js` 的 core 段） | 纯决策：override 表、队友判定、路由比较、notice 形状、安装计划 | 只依赖 contracts，**不知道 DSH 存在** |
| L0 adapter（`host/adapters/*`、`client.js` 的 adapter 段） | 唯一允许出现 DSH 契约字符串的地方 | DSH 运行时 + contracts |
| L3 contracts（`host/contracts.mjs`） | 纯数据：身份、字段名、上限 | 什么都不依赖 |

**禁止边**（由 `scripts/check-layers.mjs` 断言）：`core → adapter`、`core → ctx/window/document`、`adapter → entry`、Host 半 ↔ Client 半的运行时共享。Client 半的产物必须是单个模块，所以它的分层是文件内 region 约定，由同一脚本的命名规则约束。

`host/adapters/probe.mjs` 的 `CONTRACTS` 是升级时要对照的唯一清单：一份散文式的"我们依赖了什么"会静默过期，一份脚本读得到、probe 打得到的清单不会。

## 4. 两条不变量

- **I-1 无 override 即零介入**：没有 override 时不注册任何 waterfall，派发路由原样生效。判定在 `host/core/install-plan.mjs`，断言在 `tests/host/apply.test.mjs`。
- **I-2 永不触碰全局默认模型**：从不调用 `agentDefaultModel.saveSelection`；测试断言插件只读那两个被声明的服务。

## 5. 跨层数据流（settings 是唯一通道）

```
Client 用户点选
  → settings.describe() 读当前 override 与 showPicker（带 revision）
  → settings.mutate(ns, [{op:'set', path:['overrides'], value}], revision)
      → 用户配置层（profile patch）
          → 框架副作用：本 row 的 fiber 重启
              → Host apply() 重新装配 → 扫描 ctx.agents.list() / 监听 agent/created
                  → 判定队友 → 安装三条 waterfall（assemble 快照 → request 改写路由 → pre-step 追加 notice）
                  → 追加既有事件 model/selection → modelSelection 投影
                      → Client useProjection('modelSelection') 显示
```

**只在需要时介入**：`Config.overrides` 命中该队友才安装 selection；`system-prompt/assemble` 快照、`agent/request` 改写、`agent/pre-step` 追加 notice 三条 waterfall 是官方 `installModelSelection` 的等价形状——它们是**复制**，所以 `CONTRACTS` 的 B1–B3 用运行期自证盯着它们。只追加既有的 `model/selection` 事件，不引入新事件类型。

## 6. 座位为什么是相邻的

`conversation.input.model` 是 `single` 座位，唯一 occupant 是官方组件；再注册一个会遮蔽它、把 Lead 自己的选择器一起弄没。`conversation.input.right` 是同行的 `list` 座位，纯附加，所以选择器落在那里。

代价要如实说：它不是官方那个 DOM 座位，tooltip/aria 与键盘 Tab 序列与官方不完全同源；样式是官方 `ModelSelect.module.css` 的逐条复制（类名前缀改成 `tmp_`，颜色/圆角/阴影全部走 `--dsw-*` token）。token 改名只会让外观退化、不会崩；官方改版样式时本插件需要同步——`scripts/check-css-tokens.mjs` 至少保证"字面色值 = 0"与"只引用主题命名空间"两条规则成立。

## 7. 与 DSH 规范的对齐

规范来源：DSH 随包分发的 preset skill（`cordis-plugin-development`、`cordis-composition-reference`、`editing-cordis-compositions`、`agent-experience`）。

| 规范要求 | 状态 |
|---|---|
| bundle 在 `package.json` 声明 `dsh.bundle.patch`；用 `install_bundle` 安装，不手改 profile | 已满足 |
| Host 导出 `apply` + 可选 `inject`/`Config`；注册走 `ctx.effect`/`ctx.on` 并返回 cleanup | 已满足 |
| 注册是被 context 拥有的 effect；`agent.ctx` 的注册在插件自己的 effect 里也留 disposer | 已满足（`index.js`） |
| waterfall 必须 `return next()`；改写 decision 要 spread；拒绝用 guard/reject 而不是新事件 | 已满足 |
| 不 append 新 `type` 的 session 事件；不 require 任何 `@deepseek-ai/dsh-client-*`；样式只用 token | 已满足 |
| 显示元数据：locale `meta.*` + icon，且 `exports`/`files` 齐备；发布前验证实际打包清单 | 已满足（`scripts/check-pack.mjs` 断言） |
| 可调值放 `Config`，让用户在 patch 层改 | 已满足（`showPicker` 真的生效，不再是无行为的字段） |
| 对应用数据与配置的操作应对 UI 与 agent 各有一个调用者 | **未落地**：picker 已收敛为单一实现，但 tool 注册未接线（需要一次 `cordis_inspect_query` 的 Tool inspection） |
| 每个 Service/Event/派发模式在依赖前用 inspection 确认；已安装的 Harness 是权威 | 部分：清单与运行期自证已就位（`host/adapters/probe.mjs`），但 inspection 本身未执行，见上 |
| `engines.dsh` 与已测版本一致 | 已满足（`scripts/check-version.mjs` 断言 range、`TESTED_DSH_VERSION`、CHANGELOG 三者一致） |
| Client 单文件内分层 | 偏离：Client 产物必须是单模块，因此分层以文件内 region + 脚本规则表达 |

## 8. 其余指针

- 验证状态与未验证边界：[REPORT.md](./REPORT.md)。
- 决策记录与组级账本（含本机环境细节）：`DECISIONS.md`（不入公开仓库）。
- 契约清单：`host/adapters/probe.mjs` 的 `CONTRACTS`（`node tools/doctor.mjs --contracts` 打印）。
- 门：`npm run check`（静态 + 契约），行为门见 REPORT。
