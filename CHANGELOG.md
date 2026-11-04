# 变更记录

本插件只声明它**真的验证过**的 DSH 版本；`engines.dsh` 与 `host/contracts.mjs` 的
`TESTED_DSH_VERSION`、以及本文件的记录由 `scripts/check-version.mjs` 断言三者一致。

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
