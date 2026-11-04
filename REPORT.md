# 队友会话模型切换 — 方案与验证报告

> 交付物目录：本仓库根目录。
> 已安装到 profile `desktop`（`@local/dsh-teammate-model-picker`），`application: applied`。
> 附录 A 记录一次独立封闭审计及其处置。

这是一份**本地绕过版**的交付说明，不是官方正解。它要回答的只有一件事：在不改官方包、不引入新 session 事件、不动"路由由派发决定"这条语义的前提下，怎么把"队友会话能换模型、且重启后仍生效"做成可交付、可审计、可回滚的一件事。全篇围绕这一句展开，随时标出哪些还没做、哪些该由 DSH 官方修。

给接手本项目的人看 —— 尤其是下一步要在设置页做功能开关的人。读完应当能判断当前交付边界、按命令复现验证、知道用户配置层落在哪里、知道哪些限制是本地绕过带来的代价。route 1 的完整改包操作、teammate roster 管理、其它 profile 配置项都不在这篇里。

---

## 1. 数据流：派发路由为什么换不了

队友（continuable teammate）在被派发的那一刻就把当时的 LLM 路由写进了自己的会话描述，此后每次唤醒都从这份描述恢复，不重新解析当前默认模型。用户要换模型，得先看清这条链在哪里闭合、又在哪里留了一道缝。

### 1.1 派发时路由从哪来、固化到哪里

`dsh-subagent/lib/index.js:293-303` 显示，父 Agent 的**当前请求头**（而非创建时的 options）决定继承给子 Agent 的路由：

```js
function parentAgentOptionsForDelegation(parent) {
  const requestConfig = parent.session.requestHeader()?.config;
  if (requestConfig === void 0) return { ...parent.options };
  ...
  return { ...createdOptions,
    provider: requestConfig.provider, model: requestConfig.model, ... };
}
```

`dsh-subagent/lib/index.js:315-331` 的 `resolveChildAgentOptions` 把父路由、`requested` 覆盖与 `subagentDepth` 合成子 `AgentOptions`。`startLocal()`（同文件 `:1401-1411`）再把路由快照进 durable descriptor：

```js
const agentProvider = agentOptions.provider;
const agentModel = agentOptions.model;
const descriptor = snapshotSubagentDescriptor({
  mode: "continuable", provider: spec.provider, label: spec.label,
  ...agentProvider !== void 0 ? { agentProvider } : {},
  ...agentModel !== void 0 ? { agentModel } : {}, ...
});
```

该事件在 `:1800` 追加进子会话 log：`child.session.append("subagent/descriptor", create.descriptor)`。

`dsh-subagent/lib/types/descriptor.js:30-45` 定义 v3 结构：`version / mode / provider / label / agentProvider / agentModel / agentReasoningEffort / persona / toolFilter`；`:113` 的 `assertKnownKeys` 拒绝未知字段，`:176-190` 的 `foldSubagentDescriptor` 取第一条 descriptor 且不可改写。这就是"派发路由"一词的由来 —— 它不是配置项，是写进会话 log 的既定事实。

实测证据由 `tools/session-model-log.mjs` 解压 `session.v4.jsonl.zstd` 得到：

```
[  0] subagent/descriptor {"version":3,"mode":"continuable","provider":"spawn",
      "label":"E2E verification teammate for model picker",
      "agentProvider":"tierflow","agentModel":"tierflow_pro"}
[ 14] request/header {"provider":"tierflow","model":"tierflow_pro","maxTokens":128000}
```

### 1.2 唤醒时从哪里恢复

`dsh-subagent/lib/index.js:2141-2183` 的 `coldResume()`：

```js
const descriptor = foldSubagentDescriptor(ownEvents);
if (descriptor === void 0 || descriptor.mode !== "continuable") throw ...("NOT_RESUMABLE");
activation = await this.materialize({
  kind: "local", childId, provider: descriptor.provider, parent,
  agentOptions: {
    ...descriptor.agentProvider !== void 0 ? { provider: descriptor.agentProvider } : {},
    ...descriptor.agentModel !== void 0 ? { model: descriptor.agentModel } : {},
    ...descriptor.agentReasoningEffort !== void 0 ? { reasoningEffort: ... } : {}
  }, ...
});
```

源码注释写得很直白：「The descriptor supplies every reconstruction input; no subagent provider is dispatched.」—— 冷恢复只读 descriptor，不碰当前默认模型。发"继续"只会让队友在同一条已耗尽的路由上再失败一次。

### 1.3 普通会话的切换模型能力

理解官方怎么切换，才能判断哪一段可以复用、哪一段必须避开。

- **持久化意图**：`dsh-api-session-controller/lib/types/agent.js:332-335`
  ```js
  selectForNextRequest(agent, selection) {
    agent.session.append('model/selection', selection);
    this.selectionFor(agent).current = selection;
  }
  ```
- **投影**：`dsh-api-session-controller/lib/types/model-selection-projection.js:22-41` 折叠 `model/selection` 与 `request/header`，视图为 `{ lastUsed, next: pending ?? lastUsed }`。
- **请求路由**：`dsh-agent/lib/types/model-selection.js:45-94` 的 `installModelSelection(agentCtx, selection)` 注册三个 agent-scoped waterfall —— `system-prompt/assemble` 把 selection 快照到 `assembled`、`agent/request` 把 provider/model/effort 写进请求 config、`agent/pre-step` 在路由变化时追加 `[model changed: …]` 的 durable user notice。
- **Remote 入口**：`dsh-api-session-controller/lib/index.js:793-821` 的 `selectModel(request)` 除了 `agents.selectForNextRequest`，还调用 `this.ctx.agentDefaultModel.saveSelection(selected)`（**会改全局默认模型**）。
- **触发点**：`dsh-agent-loop/lib/index.js:1191-1197` 的 `prepareRequest()` 通过 `this.dispatch.waterfall("agent/request", …, () => seedConfig)` 解析最终路由；`:1794` 的 `loopCtx.agents.announce(agent, …)` 在首次请求之前发布 `agent/created`。
- **作用域**：`dsh-scope/lib/index.js:327-337` 的 `scopeTarget` 让未打 scope 标签的监听器收得到所有后代 Agent 的事件（"events flow up the chain, never down"）；`cordis/lib/index.js:258-263` 的 `dispatch()` 按 `Context.filter` 过滤。根上下文的 `agent/created` 监听器因此能覆盖所有队友。

这一段里，`model/selection` 事件类型、三个 waterfall 的形状、以及"route 由 `agent/request` 决定"这三条是本方案要复用的；`saveSelection` 那一句是要避开的。

### 1.4 三层拒绝，与唯一那道缝

队友换不了模型不是单点限制，而是三层叠加。

1. **Host 路由所有权**：`dsh-api-session-controller/lib/index.js:129`（`hasApiSessionSubagentOwner`）、`:141`（`apiSessionSubagentOwnershipError`）、`:225,238,242`（`resolve()`）以及 `types/agent.js:385-390`（`liveAgent`）—— 凡是 header `origin === "subagent"` 的会话，通用 Session 路由一律返回 `session/agent-busy: "session … is owned by subagent routing; use subagent delivery"`。`:189-203` 的 `typert.lookups.configure("agent")` 走同一 `resolveAgent`，所以 `commands.execute`、`goals.get` 等带 `agent` 参数的 Remote 同样拒绝队友。
2. **Client 官方选择器**：`dsh-client-ui-model-selection/lib/client.js:1913` 的 `const available = sessions.subagentAddress(sessionId) === void 0;`、`:1319` 的 `if (!available) return null;`、`:944` 的 `assertAvailable()`、以及 `/model` 命令 `:1873/1883/1887` 与 `ModelDirectoryResolver.directoryFor`（`:1034`）都是同一 gate。
3. **GUI 渲染**：`dsh-experimental-client-ui-agent-team/lib/client.js:477-489` 打开队友用的是普通 conversation view（`uiWorkspace.openSession({ parentSessionId, childSessionId, mode: "continuable" })`）；`dsh-client-ui-subagent/lib/client.js:990-995` 的只读 composer 只认 `mode: "unknown"/"one-shot"/parentAvailable === false`，continuable 队友回落到官方 InputBar → `conversation.input.model` 挂载 → 官方 `ModelSelect` 返回 `null`。结果是同一行里那个位置是空的，用户最初的截图里没有模型触发器。

缝在这里：`settings.describe()/mutate()`（`dsh-api-settings-controller/lib/index.js:393-476`）走的是 **entry id** 而非 `agent` lookup，因此不受第 1 层拒绝影响。它既能读、又能写，且写进用户配置层后跨重启存活 —— 本方案的全部落点就建立在这一道上。

---

## 2. 路线与设计：为什么是官方插件，以及它怎么不破坏派发语义

第 1 节「数据流」留下的缝决定了一件事：可以不碰官方包的 Host 路由所有权，只用用户配置层的 override 与官方插件机制就够了。剩下的问题是，这条路和"直接改 `app.asar`"比，值不值。

### 2.1 放弃 route 1 的成本对比

`asar-route-check` 队友实测（Electron 44.7.0，`app.asar` 182,766,714 B / 21,317 条目）：

| 维度 | route 1：改 `app.asar` | route 2：官方插件 |
|---|---|---|
| 前置条件 | 全部满足：`EnableEmbeddedAsarIntegrityValidation = Disabled`、`OnlyLoadAppFromAsar = Disabled`（`@electron/fuses read` 实测）；`npx @electron/asar v4.3.1 list` 1.9 s 成功；三个目标文件确认在归档内且内容 raw 未压缩 | 只需 `plugin_manager install_bundle` |
| 改动面 | 至少 3–4 个官方包；**必须整包重打**（CLI 无单条目替换），并复现 1,583 个 `app.asar.unpacked` 原生文件的 `--unpack` 规则 | 1 个 workspace 包，0 个官方文件 |
| 停机 | 运行中 DELETE/rename 报 win32 error 32 → 必须停掉 app；约 1–2 分钟/次 | 无需停机，HMR 生效（`application: applied`） |
| 跨升级 | `app-update.yml` generic/nightly + 待安装的同版本 NSIS 安装包会在退出时重写安装目录 → 补丁被静默抹掉；每次升级需重打 | 用户配置层在升级后保留 |
| 故障可定位性 | 改的是归档内的官方压缩 JS，diff/回滚只能对比整包 SHA256（基线还已有 1 个陈旧 integrity hash：`types-Cl_DXjhk.js`） | 普通文本文件、git 可 diff、`remove_bundle` 一键回滚 |
| 回滚 | 需先备份 174 MiB + 243 MiB unpacked，当前无备份 | `plugin_manager remove_bundle` |
| 语义风险 | 要同时改 Host 所有权检查 + Client gate + descriptor 冷恢复，容易破坏"路由由派发决定" | 只在有 override 时追加 agent-scoped waterfall，不改任何官方语义 |

route 1 **技术上可行但有重大隐患**：升级即失效、需停机、无备份、改动面大、需长期维护。route 2 在所有成本维度上更优，且完全满足"不引入新 session 事件类型 / 不改变派发语义"的硬约束。route 1 的回滚基线（整包 SHA256 `939AA0A2…C290`）与逐文件校验要求仍留在调查记录里；本次只做了只读前提核实，未写 `app.asar`、未留归档备份。

### 2.2 设计：override 只在需要时介入

- **无 override 时**：descriptor 的派发路由原样生效，插件一行代码都不介入（`install()` 看到 `target === undefined` 直接返回）。这保住了"路由由派发决定"。
- **有 override 时**：只在该队友的 `agent.ctx` 上注册与 `installModelSelection` 等价的三个 waterfall，覆盖 `agent/request` 的最终路由；没有改 descriptor、没有改 `coldResume`、没有改父会话。
- **持久化**：`Config.overrides`（`.volatile()` 字段）由客户端通过 `ctx.remote.settings.mutate()` 写入用户配置层，跨重启/升级存活。写入会重启本 row 的 fiber，Host 半边 `apply()` 重新扫描 `ctx.agents.list()` 并重放 override。
- **不影响全局**：从不调用 `agentDefaultModel.saveSelection`；只匹配 `header.origin === "subagent"` 且 `subagent` 投影为 `mode: "continuable"` 的 agent。项目内收紧后的 `isContinuableTeammate` 仅在 `sessionProjections` 服务整体不存在时才回退到 header，服务存在但投影缺失或异常一律拒绝。
- **不引入新事件类型**：只追加既有的 `model/selection`，复用 `modelSelection` 投影与 `[model changed: …]` notice 的既有 source 形状（`kind: 'model-selection', form: 'notice'`）。
- **可调行为**：`Config.showPicker` 与 `Config.overrides` 都在 plugin Config / 用户配置层，用户可直接编辑。`showPicker` 目前**尚未接线成设置页开关**，见「已知限制与上游建议」。
- **约束合规**：客户端不 require 任何 `@deepseek-ai/dsh-client-*` 包（只用 `react` / `react-dom` 这两个 React 运行时，与官方一致）；样式全部 `--dsw-alias-*`/`--dsw-*` token；`meta.title`/`meta.description` 中英双语 + `icon.svg`，`exports`/`files` 已声明。

### 2.3 装配机制：为什么注册了会渲染、以及为什么不能注册到那个位置

`dsh-client-ui-renderer/lib/client.js:1368-1427` 的 `slots.inject(key, cb)` 是声明生命周期等待：目标 slot 声明存在时同步执行 cb，声明塌陷时 dispose、再次声明时重跑；`ctx.slots.register(options, component)` 把 entry 挂到当前 fiber。`renderOutletContent`（`client.js:1129-1221`）按 kind 决定谁渲染：`single` 只渲染 `entriesOfSlot(slotKey)[0]`，`list` 按 `order` 升序渲染全部，`chain` 由 `select()` 选举。

`conversation.input.model` 是 `single`（Catalog `:3458-3493`，`replaceRisk: "shadows-shipped-ui"`，唯一 occupant 是官方 `ModelSelect`）；动态条目会被 `guardedSlots`（`dsh-cordis-client-runner/lib/client.js:275-280`）强制分配递减 priority（−1, −2…），**必然胜过官方条目 → 全局 Lead 的选择器消失**。这正是"注册成功却不渲染、反而破坏"的框架原因：不是没注册上，是注册在了会互相遮蔽的位置。

因此选择 `conversation.input.right`（`kind: "list"`、`occupants: []`、`replaceRisk: "none"`，Catalog `:3671-3726`）：它是 `standardControls` 里模型座位之前的相邻 flex 兄弟，同一行、同样式、纯附加。实测 occupant 为：

```
occupants: [{ id:"teammate-model-picker", order:10, priority:0, active:true },
            { id:"dsh-prompt-refine",    order:60, priority:0, active:true }]
```

### 2.4 UI 对齐：按截图反馈逐次修正

「装配机制」把位置定下来之后，观感还有两层要跟官方一致，都是按用户截图反馈改的。

- 初版是单层列表加一条多余的「已切换（重启后仍生效）」尾巴 → 按官方 `ModelSelect` 重写为**两级菜单**：root pane 的「模型 / 推理等级」两个 cell（`dsh-client-ui-model-selection/lib/client.js:1535-1573`）→ model pane 的搜索框 + 分组 + `menuitemradio` + 勾选（`:1574-1685`）；`reasoning !== undefined` 才显示推理等级 cell，与官方一致。
- CSS 逐条复制官方 `ModelSelect.module.css`（`:1060`），只把类名前缀改成 `tmp_`，保留全部 `--dsw-alias-*` token；补上 `--dsw-specific-menu` / `--dsw-menu-backdrop-filter` / `border-radius:12px`（`dsh-client-ui-conversation/lib/client.js:16832` 的面板 token）。
- 显示文本来自目录：`group.name` 作分组标题、`model.name` 原样显示，因此 `DeepSeek-V4.1-Flash · x0.11`、`Hy4 · x0.00→免费`、额度计数等都随运行时目录，不硬编码。
- **向上弹出**：初版写成 `rect.bottom + 4`（向下）→ 菜单被挤到 composer 下沿并被裁切。已改为官方 `:1280-1318` 的 `useLayoutEffect` 测量 —— `y = rect.top - 8 - lh`、`MARGIN=12` 视口夹取、`ResizeObserver` 在 pane/搜索/目录变化后重算；并用 `createPortal(menu, document.body)`（官方 `:1526`）避开 composer 祖先的 `backdrop-filter`/`contain` 对 `position:fixed` 的包含块影响。用户最终截图确认菜单已向上显示在 trigger 上方。

---

## 3. 可运行产物

「路线与设计」那一节的方案落成下列文件。`package.json` 的 `exports`（4 项）与 `files`（10 项）全部命中真实文件，三个 `.js/.mjs` 文件 `node --check` 通过。

```
dsh-teammate-model-picker/
├─ README.md             # 公开仓库入口：问题、安装、使用、限制
├─ LICENSE               # MIT（vendor/ 第三方代码各自保留 LICENSE）
├─ .gitignore            # 排除 .codegraph/ 与本地工作文档
├─ REPORT.md             # 本报告
├─ package.json          # dsh.bundle.patch + dsh.client(web, immediately) + exports/files/engines
├─ cordis.patch.yml      # 插入 1 行 Host row: teammate-model-picker，bundle 默认 overrides: []
├─ index.js              # Host 半边：Config(volatile overrides) + 与 installModelSelection 等价的 waterfall
├─ client.js             # Client 半边：conversation.input.right 的两级模型选择器
├─ icon.svg              # 原创图标
├─ locale/{en,zh}.json   # meta.title / meta.description + picker.* 双语
├─ vendor/               # schemastery 3.18.5 + cosmokit 1.8.6（MIT，含 LICENSE）
└─ tools/session-model-log.mjs  # 验证脚本：解压 session.v4.jsonl.zstd 打印路由相关事件
```

公开仓库是**本地项目的子集**：`OUTLINE.md`（写作账本）与 `DSH-UPGRADE-IMPACT-REPORT.md`（内部耦合审计）属内部过程文档，未随仓库发布，本地仍保留，故 `package.json` 的 `files` 中 `OUTLINE.md` 一项在仓库内不命中——npm 打包会跳过缺失条目，不影响安装。

Host 半边零 Harness import：全部服务经 `ctx.get(...)`；仅 `node:crypto` 与 vendored schemastery。`volatile()` 字段校验后是 accessor（`{ get() }`），读取走 `volatileValue()`（对照 `dsh-agent-default-model/lib/index.js:39-42` 的 `.get()`）—— 这是首装后 override 不生效的真实原因，已修。`vendor/` 之所以自带，是因为 bundle 以 `link:` 方式挂入 profile，裸包导入不解析（首装实测 `ERR_MODULE_NOT_FOUND '@deepseek-ai/schemastery'`）。

`tools/session-model-log.mjs` 是随包交付的验证工具，不是临时文件；`tools/official-model-select.css` 曾是为对齐官方样式抽取的参考文件，全项目零引用，清理时已删除。

---

## 4. 安装与验证

### 4.1 安装、配置层与卸载的区别

```
plugin_manager install_bundle  target = <本目录绝对路径>
```

返回 `application: applied` 且 `warnings: []` 即生效；`remove_bundle @local/dsh-teammate-model-picker` 才是卸载。`plugin_manager` 会自动写 profile 的 `package.json` / `pnpm-lock.yaml` / bundles 列表，不要手改。

这里要把三个动作分开，接手的人最容易混：

| 动作 | 落在哪一层 | 由谁写 |
|---|---|---|
| 安装 / 卸载 bundle | `package.json` 的 `dsh.profile.bundles` + link | `plugin_manager` |
| bundle 默认 | 源 `cordis.patch.yml` 的 `showPicker: true, overrides: []` | 交付物 |
| 用户配置 | 用户配置层 `- id: teammate-model-picker` 这一行 | `settings.mutate` / 将来的设置页开关 |

用户配置层里的增删**不等于**安装或卸载。框架自己会在 config 与 inherited 相等时删掉整行 config（`dsh-config-editor/lib/index.js:99-104`），所以"把用户配置清空回 bundle 默认"和"卸载 bundle"是两件事。下一步要在设置页做的功能开关，写的就是这一行 —— 它现在是 `showPicker: true, overrides: []`。

### 4.2 已实际验证的事实

| # | 验证项 | 信号 |
|---|---|---|
| 1 | 三个目标官方包确在 `app.asar` 内、asar 校验关闭、打包工具可用 | `asar-list.txt` 命中；`npx @electron/fuses read` → `EnableEmbeddedAsarIntegrityValidation is Disabled`；`npx @electron/asar list` 21,317 条 1.9 s |
| 2 | 队友 descriptor 把派发路由写进会话 log | seq 0 `agentProvider:"tierflow", agentModel:"tierflow_pro"`、seq 14 `request/header` 同路由 |
| 3 | Host Config 命名空间 alive 且字段可编辑 | `Config.listConfigs {entry:"include:teammate-model-picker"}` → `status:"schema"`，`showPicker`/`overrides` 带 `x-cordis.volatile: true` |
| 4 | Client slot 注册并渲染 | `Slots.listSubTree` → `occupants:[{id:"teammate-model-picker", order:10, active:true}, …]`；用户截图确认 trigger 与菜单出现 |
| 5 | GUI 真实写入路径 | 用户点击选择器后，用户配置层出现 `- id: teammate-model-picker … overrides: [{childSessionId, provider:"buddy", model:"hy4free", reasoningEffort:"high"}]`；而 bundle 源 `cordis.patch.yml` 仍是 `overrides: []` → 证明写的是用户配置层而非 bundle 默认 |
| 6 | 换模型立即生效 | seq 50 `model/selection {"provider":"buddy","model":"hy4free","reasoningEffort":"high"}` → seq 59 `request/header {"provider":"buddy","model":"hy4free",…}` |
| 7 | **额度失败 → 换模型 → 继续跑完**（核心场景） | seq 48 `turn/end ERROR … "code":"QUOTA_EXCEEDED"`（`deepseek-v4.1-flash` 全部账号限流）→ 用户改选 → seq 59 新路由 → seq 63 `turn/end completed`；队友回报 "now running on hy4free" |
| 8 | **跨重启仍生效** | Harness 于 16:54 重启（端口 4254→17871，进程全部换新）。重启后首次唤醒：seq 35 重新追加 `model/selection`、seq 45 `request/header` 仍是 override 的 `buddy/deepseek-v4.1-flash`；用户配置层内容在重启后完好 |
| 9 | 不影响 Lead/全局 | 全程 `agent-default-model` 配置（`provider: buddy, model: deepseek-v4.1-flash`）未变；Lead 本会话仍在原模型；`selectModel` 未被调用 |
| 10 | UI 观感对齐 | 用户最终截图：菜单向上弹在 trigger 上方，root pane「模型 / 推理等级」两行与官方一致，trigger 显示 `DeepSeek-V4.1-Flash · x0.11 High（队友）` |

复现验证的命令：

```powershell
cd <bundle dir>
node tools/session-model-log.mjs <teammateSessionId>
```

输出里关注 `subagent/descriptor` / `model/selection` / `request/header` / `turn/end` 四类事件。上表「GUI 真实写入路径」那条测试 override 已在交付前清理：用户配置层现在回到 `showPicker: true, overrides: []`，配置行本身保留，作为将来设置页开关的落点。清理前的副本留在 `~/.dsh/profiles/desktop/cordis.patch.yml.bak-before-cleanup-20261104T205350`。

### 4.3 未能验证与如实的边界

- **未通过 CDP/截图脚本自动读取 DOM**：本机 Electron 未开 remote-debugging-port，云端浏览器会话连不上 `127.0.0.1`，GUI 鉴权 token 不在明文日志中。视觉对齐依据用户提供的截图 + slot occupant 的 inspect 返回值，非自建截图。
- **`cordis_inspect_query` 的 `input` 对象校验偶发失败**（Host/Client 两侧都出现过 `"input" must be an object`，同一 schema 有时通过有时拒绝）—— 这是 DSH inspect 包装层自身的问题，不影响插件；`listBuiltins`（无 input）稳定可用。
- **Effort 子菜单只在目录带 `reasoning` 元数据时出现**：`buddy/deepseek-v4.1-flash` 无该元数据时 root pane 只显示「模型」一行，与官方 `reasoning !== undefined` 判定一致，非缺陷。
- **额度数字/价格文案来自目录 `model.name`**：插件不解析，随 provider 目录变化。
- **未在 route 1 上实际改包**：只做了只读前提核实，未写 `app.asar`、未留归档备份。

---

## 5. 已知限制与上游建议

「安装与验证」标出的边界里，有一部分不是"还没验证"，而是**本地绕过必然带来的代价**。这一节把它们和"该由官方修的"分开列，接手的人据此判断下一步该往哪边投入。

### 5.1 本地绕过的代价

- **选择器位置是相邻兄弟而非官方座位**：「装配机制」已经说明 `conversation.input.model` 是 `single`，插件无法与官方 occupant 共存，只能落在 `conversation.input.right`。视觉上极接近，但不是同一个 DOM 座位，tooltip/aria、键盘 Tab 序列与官方组件不完全同源。
- **复制了官方 CSS 与图标**：若官方改版 `ModelSelect.module.css` 或 `--dsw-alias-*` token，本插件需同步。token 改名只会退化外观、不会崩；类名是自己的前缀，不受影响。
- **无"清除 override / 恢复派发路由"UI 项**：目前只能再选一个模型；要完全回到 descriptor 的派发路由，需手动把用户配置层的 `overrides` 清回 `[]`。这与「安装、配置层与卸载的区别」说的设置页开关是同一处缺口。
- **无模型目录 allowlist**：普通会话的 `subagent/model-selection-policy` / `list_subagent_models` 那套白名单没有复用；本插件展示的是 `modelCatalog()` 全量目录，若部署启用了子代理模型白名单，二者可能不一致。
- **切换在活跃 turn 中生效于下一个 step**：`installModelSelection` 的语义是"prompt assembly 快照、下一次请求生效"，与官方一致，不会中断进行中的请求。
- **设置页开关尚未实现**：`Config.showPicker` 已声明并暴露在用户配置层，但组件没有读它做条件渲染，也还没有 `settings.section` 页面来开/关本功能。这是下一步要做的事，不是已完成项。

### 5.2 应由 DSH 官方修的

- **队友会话被排除在模型选择器之外本身是官方缺陷**：`dsh-client-ui-model-selection/lib/client.js:1913, 1319, 944` 的 `sessions.subagentAddress(...) === void 0` gate 与 `/model` 命令 `:1873` 的 gate 没有业务理由 —— continuable 队友是可继续的会话，理应允许换模型。
- **Host 侧 `session/agent-busy` 对 subagent-owned 会话的一刀切拒绝**（`dsh-api-session-controller/lib/index.js:129,141,225`）阻断了所有 `agent`-lookup 型 Remote 对队友服务。官方应提供"按 durable parent address 授权"的 `selectModel` 变体，或让 `subagents` 服务暴露 `setModel`。
- **descriptor v3 不可改写**（`foldSubagentDescriptor` 取第一条 + `assertKnownKeys`）使得任何用户显式改路由都无法写回权威结构。官方可允许队友会话追加 `model/selection` 并在 `coldResume` 中以它覆盖 descriptor，这样持久状态仍完全由 session log 表达，不需要插件另开用户配置层。
- **`selectModel` 顺带持久化全局默认模型**（`index.js:809` 的 `agentDefaultModel.saveSelection`）语义上可疑：会话级切换不应改全局默认值，官方应拆分。
- **`conversation.input.model` 是 `single` 且 `replaceRisk: shadows-shipped-ui`**：没有"给队友会话补充一个 occupant"的官方路径。建议为该 seat 增加 `keyed`/`chain` 语义或专门的 `conversation.input.model.subagent` 子座位。
- **`cordis_inspect_query` 的 input 校验偶发失败**，以及 `Slots.listSubTree` 在部分时刻 client 无响应 —— 属工具链可靠性问题。

---

## 6. 关键文件索引

| 主题 | 文件:行 |
|---|---|
| 队友路由固化 | `dsh-subagent/lib/index.js:293-331, 1401-1411, 1800`；`lib/types/descriptor.js:30-45, 113, 176-190` |
| 冷恢复只读 descriptor | `dsh-subagent/lib/index.js:2141-2183` |
| 官方切换模型 | `dsh-api-session-controller/lib/index.js:793-821`；`lib/types/agent.js:332-335`；`lib/types/model-selection-projection.js:22-41` |
| agent/request waterfall | `dsh-agent-loop/lib/index.js:1191-1197`；`dsh-agent/lib/types/model-selection.js:45-94` |
| 队友被拒绝 | `dsh-api-session-controller/lib/index.js:129,141,225,238`；`dsh-client-ui-model-selection/lib/client.js:944,1319,1873,1883,1887,1913` |
| Slot 装配机制 | `dsh-client-ui-renderer/lib/client.js:1129-1221,1368-1427`；`dsh-cordis-client-runner/lib/client.js:275-288,3671-3726` |
| 官方菜单定位/结构 | `dsh-client-ui-model-selection/lib/client.js:1280-1318,1440-1573,1574-1720`；CSS `:1060` |
| 设置写入路径 | `dsh-api-settings-controller/lib/index.js:393-476`；`dsh-settings/lib/types/index.js:43-54,317-396`；`dsh-config-editor/lib/index.js:69-124` |
| 重启后 volatile 语义 | `cordis/lib/index.js:956-961`（`resolveConfig`）；`dsh-agent-default-model/lib/index.js:39-42` |
| bundle 安装/卸载 | `plugin_manager install_bundle` / `remove_bundle`；`dsh-config-editor/lib/index.js:99-104` |

---

## 附录 A：独立封闭审计

按用户要求，另派一名 `context: "fresh"`（无本会话上下文）的队友做审计。约束设计为封闭而非开放：

- **范围封闭**：仅 7 个文件（`package.json` / `cordis.patch.yml` / `index.js` / `client.js` / `icon.svg` / `locale/{en,zh}.json`）；明确排除 `vendor/` `tools/` `REPORT.md` `node_modules/` profile 目录、`app.asar`、DSH 官方包源码。
- **动作封闭**：只读；禁写文件、禁 plugin_manager、安装/卸载/重启、任何改变状态的 RPC；不连 GUI、不向其他队友发消息。
- **内容封闭**：12 项固定检查清单，禁止新增检查项、禁止输出清单外的发现/建议/待验证项/评价；无法判定只能记 `UNVERIFIABLE` 并一句带过。
- **格式封闭**：只允许一张表格 + 一行总计，无前言结语。

审计结果：**PASS 8 / FAIL 3 / UNVERIFIABLE 1**。

| 编号 | 审计结论 | 复核与处置 |
|---|---|---|
| 1 | FAIL — `files` 里的 `README.md` 无对应文件 | 属实。改为 `REPORT.md`；清理时又把 `vendor/LICENSE-*`、`tools/session-model-log.mjs`、`OUTLINE.md` 补进 `files`，本地 10 项全部命中真实文件（公开仓库子集下 `OUTLINE.md` 一项不命中，原因见「可运行产物」末段） |
| 7 | FAIL — 投影缺失时跳过 `mode === 'continuable'` 校验 | 属实的措辞问题。原 `isContinuableTeammate` 在 `identity === undefined` / catch 时 `return true`。已收紧为：仅当 `sessionProjections` 服务整体不存在才回退 header，服务存在但投影缺失或异常一律拒绝。重装后队友仍正常（seq 71 `buddy/hy4free`、seq 74 completed），无回归 |
| 10 | FAIL — `ctx.on('agent/created')` 未显式归 effect teardown | 复核后判定为误报（检查项措辞与框架机制冲突）。`cordis/lib/index.js:335-344, 361-380`：`ctx.on` 经 `register()` 已把 disposer 挂到 `ctx.fiber.effect`，fiber 卸载自动移除，`unregister` 幂等。保留框架原生所有权，仅加注释说明依据，不引入冗余双重注册 |
| 12 | UNVERIFIABLE — `expectedRevision` 需外部契约确认 | 约束设计的预期结果：审计被禁止读排除范围内的 Typert/settings 契约。「三层拒绝」与「已实际验证的事实」已单独验证 `settings.mutate(ns, ops, expectedRevision)` 与 GUI 实写成功 |

其余 8 项 PASS（locale 双语 key 一致且 meta 非空、icon 良构 ≤262 KiB 且相对路径、client 只 require `react`/`react-dom` 无任何 dsh-client 包、CSS 0 处字面色值、仅既有 `model/selection` 事件、无 `agentDefaultModel.saveSelection` 写操作、volatile 经 `.get()` 读取、client 生命周期清理成对）。

有一处教训要留在这里，因为它和本报告一直强调的"区分推断与已验证事实"是同一件事：审计队友在 `hy4free` 上跑了约 19 分钟仍未返回，我一度把"耗时长"**推断**成"卡住"，据此中断它并重复派发了一个队友 —— 这正是无验证信号时叠加假设性动作。用户指出后已纠正：停掉重复派发的 `bundle-audit-2`、撤销误发的终止指令、让原队友继续完成，最终表格由原队友产出。全篇因此把"事实（有出处、可复现）"与"结论（判断）"分开写，凡未验证、未实现、受限制处一律明示。
