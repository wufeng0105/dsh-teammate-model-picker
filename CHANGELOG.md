# 变更记录

本插件只声明它**真的验证过**的 DSH 版本；`engines.dsh` 与 `host/contracts.mjs` 的
`TESTED_DSH_VERSION`、以及本文件的记录由 `scripts/check-version.mjs` 断言三者一致。

## 0.3.0

面向发布的清理（不改任何一条不变量、不改路由语义、不改文档预算口径）。

- **包身份可发布**：包名从本地 scope 迁到 `@wufeng0105/dsh-teammate-model-picker`，
  去掉 `private: true`；`repository`/`license`/`keywords` 补齐 npm 通道所需字段。
  身份门新增 I7（旧 scope 不得残留）与 I8（名字只能以完整包名出现）两条漂移断言，
  并补负例；`row id`（settings/locale/entry 命名空间）不变，用户配置层无需迁移。
- **验证记录中立化**：测试夹具与历史实测中的真实 provider/model 名改为 `provider-a` /
  `model-x` 等占位 —— 本机路由配置不随仓库发布，历史实测事实不变。

已适配（verified）：**DSH 0.2.1-rc.5**。

## 0.2.0

工程化改造（不改任何一条不变量，不改路由语义）。

- **分层**：Host 半拆为 `host/contracts.mjs`（纯形状）、`host/core/*`（纯决策）、
  `host/adapters/*`（唯一持有 DSH 契约字符串处）、`index.js`（只装配）；
  Client 半保持单模块，内部按 region 分区。`scripts/check-layers.mjs` 断言依赖方向。
- **契约清单进代码**：`host/adapters/probe.mjs` 的 `CONTRACTS`（16 条）取代散文式耦合清单；
  启动期 probe 与运行期自证（B1/B3/B4/C）把"静默不生效"变成可读诊断。
- **可断言**：`npm run check` —— 6 道门 + 离线契约测试（Host fake-DSH、Client vm、
  9 条负例自检）。负例证明每道门都能变红。
- **ux**：`showPicker` 从"声明但无人读取"变为真正生效的开关；
  新增「恢复派发路由」（清除 override）；`settings.describe` 与 `modelCatalog` 的形状
  断言取代乐观读取；slot 服务缺失时 fail-closed 并报告。
- **打包纪律**：`files`/`exports` 与实际文件由 `scripts/check-pack.mjs` 对齐；
  版本区间与 CHANGELOG 由 `scripts/check-version.mjs` 对齐。
- **文档瘦身**：文档总量从 1622 行降到 400 行以内，且不超过代码的三分之一；
  会随代码失效的叙述改为断言或移入代码。

已适配（verified）：**DSH 0.2.1-rc.5**。

## 0.1.0

首个版本：队友会话的模型选择器。

- Host 半通过 `Config.overrides` + 三条 agent-scoped waterfall 覆盖队友的请求路由；
  Client 半在 `conversation.input.right` 座位注册两级模型选择器。
- 真机验证：额度失败 → 换模型 → 继续跑完；跨 Harness 重启仍生效；
  Lead 会话与全局默认模型全程未变。
