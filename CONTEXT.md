# dsh-teammate-model-picker

术语唯一真源（glossary）。只收本项目特有的词，不含实现细节与通用编程概念。

## Language

**队友（teammate）**:
一个 continuable subagent 会话：被派发时把当时的 LLM 路由写进自己的 durable descriptor，此后每次唤醒都从该 descriptor 恢复，不重新解析默认模型。
_Avoid_: subagent 会话、可继续的 subagent

**派发路由（dispatched route）**:
派发那一刻由 Lead 的请求头决定、并写进 descriptor 的 `provider` / `model` / `reasoningEffort`。
_Avoid_: 钉死的模型、初始模型、固化路由

**override**:
为某个队友显式指定的一条路由，持久化在用户配置层。
_Avoid_: 覆盖记录、切换记录、模型选择记录

**用户配置层（user config layer）**:
profile patch 层里 `- id: teammate-model-picker` 那一行；由 settings Remote 写入，跨重启与升级存活。
_Avoid_: 用户 patch 层、用户态、配置覆盖

**bundle 默认（bundle defaults）**:
源 `cordis.patch.yml` 里这一行的 `showPicker` / `overrides` 取值。
_Avoid_: 源 patch、交付默认值

**契约（contract）**:
本插件假定 DSH 提供的服务、事件、数据形状或存储布局。机器可读清单是 `host/adapters/probe.mjs` 里的 `CONTRACTS`，不是任何文档。
_Avoid_: 依赖、接口面（在本项目里都叫契约）

**门（gate）**:
一条能变红的检查：静态门与契约门由 `npm run check` 跑，行为门需要真机队友会话。
_Avoid_: 测试（行为门之外的东西不是测试）
