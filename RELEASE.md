# 发布流程：push → Tag → Release → npm

> 写给下一个接手发布的人。目标：把一次改动从 push 走到线上，并能自己证明「tag 树 == Release 资产 == npm 包」。
> 方式：**手工命令链 + 仓库自带门禁**（`npm run check`、`scripts/check-version.mjs`）。不引入 changesets / release-it：本仓是单包，多包版本图用不上，版本一致性已由门禁断言，引入工具只会多一条出错时更难查的发布路径。命令按 PowerShell 写。

## 0. 一次性前置

```powershell
npm login --registry=https://registry.npmjs.org   # 或走 3.1 的 token 路线
gh auth status                                     # 需要 repo 权限（建 tag / Release）
npm whoami --registry=https://registry.npmjs.org   # 校验点：打印出用户名
```

`~/.npmrc` 的 `registry=` 可能指向镜像，而认证按 registry 分开存放 —— 本文每条 npm 命令都显式带 `--registry=https://registry.npmjs.org`。

## 1. push 之后：定版本号、打 Tag

**版本号**：修 bug → patch；加能力 → minor；破坏性（改包名、改事件语义）→ 0.x 阶段用 minor。
npm 上的版本**不可变**，任何内容变化都要提号，不能重打同一个 tag。
若本次在新 DSH 版本上验证过，同时更新 `host/contracts.mjs` 的 `TESTED_DSH_VERSION`、`package.json` 的 `engines.dsh`、`CHANGELOG.md` —— 门禁断言三者一致。

```powershell
# 1) 改 package.json 的 "version"；2) 在 CHANGELOG.md 顶部加一节（写清改了什么，不用营销词）
node scripts/check-version.mjs   # 校验点：V1–V4 OK（V5 此刻会红，tag 还没打，属正常中间态）
npm run check                    # 校验点：8 道门 + 全部测试通过；D2/D5 报红就先修文档

git add -A
git commit -m "release: v<VER> — <一句话>"
git status --porcelain           # 校验点：输出为空（必须从干净的树发布）
git tag v<VER>                   # 规范：v + 语义化版本（v0.3.2；预发布写 v0.4.0-rc.1）
git push origin main
git push origin v<VER>
node scripts/check-version.mjs   # 校验点：V5 OK（最新 tag == package.json 版本）
```

| 失败现象 | 原因 | 处理 |
|---|---|---|
| V5 红 `tag=v0.3.1 version=0.3.2` | 改了版本号未打 tag | 打 tag 后重跑（正常中间态） |
| V5 红：tag 名与版本不符 | 写成 `0.3.2` / `V0.3.2` | `git tag -d` 后按 `v<VER>` 重打；已推送则 `git push origin :refs/tags/<错的tag>` |
| `git status` 有输出 | 有未提交改动 | 先提交；否则线上包会带上仓库里没有的字节 |

## 2. 创建 GitHub Release

```powershell
$notes = @'
## <插件名> v<VER>

<两三句：这版改了什么、为什么>

已适配（verified）：**DSH <TESTED_DSH_VERSION>**（`engines.dsh <range>`）。
'@
Set-Content -LiteralPath "$env:TEMP\release-notes.md" -Value $notes -Encoding utf8

gh release create v<VER> --title "v<VER> — <一句话标题>" --notes-file "$env:TEMP\release-notes.md"
npm pack --registry=https://registry.npmjs.org     # 产出 <name>-<VER>.tgz
gh release upload v<VER> "<name>-<VER>.tgz"        # 附预构建包
Remove-Item "<name>-<VER>.tgz" -Force              # 别把产物留在仓库（.gitignore 已忽略 *.tgz）
```

- 标题：`v<VER> — 做了什么`，不要只写版本号；说明与 `CHANGELOG.md` 同口径。
- Release 依附 tag，`tagName` 必须等于 `v<VER>`。**先推 tag 再建 Release**：`gh release create` 找不到 tag 会在默认分支上另建一个，那是错的。
- 校验点：`gh release view v<VER> --json tagName,assets --jq '{tag:.tagName,assets:[.assets[].name]}'`
- 写错说明 → `gh release edit v<VER> --notes-file ...`（不必重发版）；Release 挂错 tag → `gh release delete` 后按正确 tag 重建。

## 3. 发布到 npm

### 3.1 认证（二选一）

- **A. 账号开 2FA**：发布时交互式要 OTP（或 `npm publish --otp=<6位>`）。最干净，推荐长期用。
- **B. granular access token + Bypass 2FA**：网页 `Settings → Access Tokens → Generate New Token`，勾 **Bypass two-factor authentication**、权限选 `Read and write (publish and stage)`、有效期 ≤90 天。写入：

```powershell
$rc = (Get-Content "$env:USERPROFILE\.npmrc") | Where-Object { $_ -notmatch '_authToken' }
$rc += '//registry.npmjs.org/:_authToken=<NPM_BYPASS_2FA_TOKEN>'    # 占位符，别把真 token 写进仓库/对话
Set-Content -LiteralPath "$env:USERPROFILE\.npmrc" -Value $rc -Encoding utf8
```

**B 的坑（踩过）**：表单里勾了 Bypass，token 记录也可能仍是 `false`，发布时报 `403 … bypass 2fa enabled is required`。生成后必须核实：

```powershell
$t = ((Get-Content "$env:USERPROFILE\.npmrc") | Where-Object { $_ -match '_authToken' }) -replace '.*=',''
curl.exe -s -H "Authorization: Bearer $t" https://registry.npmjs.org/-/npm/v1/tokens |
  Select-String -Pattern '"name"|"bypass_2fa"'
# 校验点：该 token 段内 "bypass_2fa": true；为 false 就删掉重建（用真实鼠标点，JS .click() 可能不生效）
```

**长期**：bypass-2FA token 已不能做账号治理类动作，直接发布将于 **2027-01** 停止支持（npm 官方时间表）—— 届时改用账号 2FA 或 Trusted Publishing。

### 3.2 包名与 scope

- 包名 = `package.json` 的 `name`；本项目是 scoped：`@wufeng0105/dsh-teammate-model-picker`。
- scoped 包**首次**发布要 `--access public`，否则按私有包处理（需付费）。
- `repository.url` 必须指回本仓库（市场的 npm 映射靠它自动关联）；发布前自查名字是否被占：`npm view <包名> version --registry=https://registry.npmjs.org`（404 = 可用）。

### 3.3 发布与验证

```powershell
npm publish --registry=https://registry.npmjs.org --access public
# 校验点：输出 "+ @wufeng0105/dsh-teammate-model-picker@<VER>"，退出码 0

# 权威查询：按版本（绕过 packument 缓存；npm view 可能因 CDN 滞后仍显示旧版）
curl.exe -s "https://registry.npmjs.org/@wufeng0105%2fdsh-teammate-model-picker/<VER>"
# 校验点：version / dist.shasum / gitHead 都是这一版，且 gitHead == tag 指向的提交
npm view @wufeng0105/dsh-teammate-model-picker dist-tags --registry=https://registry.npmjs.org
```

| 失败现象 | 原因 | 处理 |
|---|---|---|
| `403 … bypass 2fa required` | token 没有 bypass | 按 3.1 核实并重建 |
| `403 … may not perform this action` | 该动作属账号治理（unpublish、改可见性），bypass token 无权 | 用网页端做，或开账号 2FA |
| `EPUBLISHCONFLICT` | 版本已存在 | 提号重发，**不要** `--force` |
| 发布后 `npm view` 仍是旧版 | CDN 缓存 | 按上面的版本端点查；通常几十秒到几分钟 |
| npm 里多出 `<x>.0.0-stage` 之类 | staged publishing 的自动占位版本 | 不是发布物；不在 dist-tags 里，可留在网页端删除（bypass token 无权删） |

### 3.4 发布后确认「装得上、真的活」

线上可见 ≠ 装得上。用 registry 形态装一次（不是从工作树装），再做活体取证：

```
plugin_manager  action=install_bundle  target=@wufeng0105/dsh-teammate-model-picker@<VER>
# 校验点：application=applied、warnings=[]、version=<VER>

cordis_inspect_query platform=host   provider=Config method=listConfigs input={"name":"<包名>"}   # status: schema
cordis_inspect_query platform=client provider=Slots  method=listSubTree  input={"root":"conversation.input.right"}   # occupant active: true
```

两种形态要说清：registry 与 `file:` tgz 装的是**独立副本**（改源码不影响，要重装）；从目录装是 **link**，改源码立即生效。验证线上包必须用前者。

## 4. 三者一致性核对（发布完成的判定）

四条都成立才算发完：

```powershell
node scripts/check-version.mjs     # ① tag ↔ 版本 ↔ CHANGELOG(→engines)：V2–V5
git describe --tags --abbrev=0     # ② = v<VER>
git rev-parse "v<VER>^{commit}"    #    tag 指向的提交
git status --porcelain             #    应为空
gh release view v<VER> --json tagName,assets --jq '{tag:.tagName,assets:[.assets[].name]}'   # ③
# ④ npm ↔ 仓库（内容同源，字节级）
$sh = npm view @wufeng0105/dsh-teammate-model-picker dist.shasum --registry=https://registry.npmjs.org
$wt = Join-Path $env:TEMP "rel-check-$([guid]::NewGuid().ToString('N').Substring(0,6))"
git worktree add --detach $wt v<VER> | Out-Null
Push-Location $wt; npm pack --registry=https://registry.npmjs.org | Out-Null
$local = (Get-FileHash -Algorithm SHA1 (Get-ChildItem *.tgz | Select-Object -First 1).FullName).Hash.ToLower()
Pop-Location; git worktree remove $wt --force
"线上=$sh"; "tag树=$local"          # 校验点：两者相同 = 逐字节同源
```

shasum 不同时别急着重发：解包两侧（`tar -xzf`）按相对路径逐文件比 SHA-256，先分清「内容真的不同」还是「打包差异」。踩过的两个真实原因：

1. **行尾**：`core.autocrlf` 会让工作树里的 CRLF 对 `git status` 隐形，而打包取的是工作树字节 —— 线上包与仓库差 1 字节（0.3.1 即此）。仓库已加 `.gitattributes`（`* text=auto eol=lf`）；Windows 下新生成的文件发布前比对一次。
2. **树不干净**：`files` 里被改过的文件会进包（`files` 之外的文件不影响）。

## 5. 回滚速查

| 阶段 | 可回滚 | 做法 |
|---|---|---|
| 只提交、未打 tag | 是 | 改完重新提交 |
| tag 已推、未发 npm、未建 Release | 是 | `git push origin :refs/tags/v<VER>` 删远端 tag，重打重推 |
| Release 已建、未发 npm | 是 | `gh release delete v<VER>` + 删 tag 重来 |
| **npm 已发布** | **否** | 向前修一版（patch）；坏版本用 `npm deprecate <pkg>@<VER> "原因"` 标注 |
| 线上包内容与仓库不符 | 否 | 提 patch 版重发，并在 CHANGELOG 写清原因 |

## 6. 与门禁的关系

发布前的判定全部来自仓库自身：`check-version`（engines/已测版本/tags↔版本）、`check-pack`（`files`/`exports`/`dsh.bundle` 与磁盘一致）、`check-docs`（文档预算与引用可追溯），统一由 `npm run check` 串起。**发布流程不新增脚本** —— 避免出现第二条发布路径。

## 7. 实例（v0.3.2）

```
npm publish → + @wufeng0105/dsh-teammate-model-picker@0.3.2
registry    → version=0.3.2  dist.shasum=9f90d61b…  gitHead=f8839d6c…
tag 树重打   → 9f90d61b…        ← 与线上完全相同
tag/Release → v0.3.2（资产 wufeng0105-dsh-teammate-model-picker-0.3.2.tgz）
```

插件市场上架是另一条链路：条目为 `data/plugins/<owner>__<repo>.yml`，规则见 `awesome-dsh-plugin/awesome-dsh-plugin` 的 `contributing.md`；本仓保留副本在 `market/`。
