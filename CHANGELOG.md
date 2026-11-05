# 变更记录

本插件只声明它**真的验证过**的 DSH 版本：`engines.dsh`、`host/contracts.mjs` 的
`TESTED_DSH_VERSION`、以及本文件三处由 `scripts/check-version.mjs` 断言一致。
下文各版「已适配」指的就是这个已测版本。

## 0.3.2

发布产物的字节级对齐（不改代码）。

- 已发布的 0.3.1 里 `vendor/schemastery.mjs` 末尾多一个 CRLF，而仓库 blob 是 LF：
  `core.autocrlf=input` 让 `git status` 看不见它，打包时被带进了线上包。
- 新增 `.gitattributes`（`* text=auto eol=lf`），全部 tracked 文本文件确认为 LF。
- 本版起 `npm pack` 的 shasum 可直接与 `npm view dist.shasum` 比对（tag 树 == 线上包）。

已适配（verified）：**DSH 0.2.1-rc.5**。

## 0.3.1

发布链路对齐（不改代码）。

- `package.json` 的描述与关键词在 `v0.3.0` 打 tag **之后**才改，导致 tag 树的包与已发布的
  npm 0.3.0 不同源。本版重切：tag 树 == 工作树 == npm 包（可用 `npm pack` 的 shasum 与
  `npm view dist.shasum` 比对核实）。
- 仓库增加收录条目副本 `market/`，并忽略 `npm pack` 产物 `*.tgz`。

已适配（verified）：**DSH 0.2.1-rc.5**。

## 0.3.0

面向发布的清理。

- 包名迁到可发布的 `@wufeng0105/` scope，去掉 `private: true`，补齐 npm 通道字段；
  身份门新增旧 scope 不得残留、名字只能以完整包名出现两条漂移断言。
- 测试夹具与历史实测中的真实 provider/model 名改为中性占位。

已适配（verified）：**DSH 0.2.1-rc.5**。

## 0.2.0

工程化改造。

- Host 半拆为 contracts / core / adapters / entry 四层，Client 半保持单模块、内部分区；
  依赖方向由门禁断言。
- 契约清单进代码（`CONTRACTS`，16 条），启动期 probe 与运行期自证取代散文式耦合清单，
  "静默不生效"变成可读诊断。
- 新增 `npm run check`：静态/契约门 + 离线契约测试（Host fake-DSH、Client vm、负例自检）。
- `showPicker` 真正生效；新增「恢复派发路由」；settings 与 catalog 形状断言取代乐观读取；
  slot 服务缺失时 fail-closed。
- 打包清单与版本区间进入门禁；文档瘦身并纳入预算断言。

已适配（verified）：**DSH 0.2.1-rc.5**。

## 0.1.0

首个版本：队友会话的模型选择器。

- Host 半通过 `Config.overrides` + 三条 agent-scoped waterfall 覆盖队友的请求路由；
  Client 半在 `conversation.input.right` 座位注册两级模型选择器。
- 真机验证：额度失败 → 换模型 → 继续跑完；跨 Harness 重启仍生效；
  Lead 会话与全局默认模型全程未变。
