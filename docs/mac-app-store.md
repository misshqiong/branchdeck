# Mac App Store 版本

商店版使用 Electron 的 MAS 构建和 Apple App Sandbox。它与站外版共用项目、命令、文件和终端代码；仅在 `process.mas === true` 时启用持久目录授权。站外版无需授权管理，已有公证包不被商店版构建覆盖。

## 授权流程

在「应用设置 → 目录与文件授权」分别选择项目目录、Codex/Claude 索引、历史文件、Shell 配置、SSH/Git 配置和工具链目录。也可以自主选择整个个人目录以覆盖更多现有工作流，但这会允许应用及其命令访问该目录中的其他文件，不是使用应用的必选项。

每次选择使用系统文件面板返回的 security-scoped bookmark。书签只保存在商店版的本机数据目录，权限为 `0600`，不通过 IPC 发送给渲染器。启动时先恢复授权，再扫描项目。授权失效或位置改变时保留记录并提示重新选择，不把旧路径视为已经授权。

授权覆盖所选目录的子目录，不跟随指向未授权位置的符号链接。索引指向的外部项目、worktree、工具链及配置目录仍需分别授权。新增 Shell 配置对新建终端生效；已有终端不会被重启。

移除授权会立即停止持久保存该书签，但已有终端继承的权限只能在应用完全退出后释放。因此界面明确显示「下次启动移除授权」，不会伪装成即时撤销。

网络客户端、服务监听和创建用户选择目录内的可执行文件已在商店版声明对应 entitlement；没有添加全盘路径豁免或绕过沙盒的辅助进程。目录授权无法解除系统对 PTY、进程检查、信号、工具执行等其他操作的限制，必须使用真实 MAS 开发包验收。

## 构建

先按主 README 安装依赖，使用 Node.js 22.12+。

```sh
npm test
npm run pack:mas:dev
npm run pack:mas
```

- `pack:mas:dev`：输出 `release-mas-dev/mas-dev-arm64/BranchDeck Store.app`，用于本机真实沙盒验收。
- `pack:mas`：输出 `release-mas/`，使用 Apple Distribution 与 Mac Installer Distribution 证书生成商店安装包。商店分发签名包不能替代开发签名包进行本机验收。
- 站外版仍使用 `npm run pack` / `npm run dist`，输出 `release/`。

默认从 `.local/mas/development.provisionprofile` 和 `.local/mas/distribution.provisionprofile` 读取描述文件。可通过 `MAS_DEVELOPMENT_PROFILE` / `MAS_DISTRIBUTION_PROFILE` 指定其他本机路径，通过 `MAS_DEVELOPMENT_IDENTITY` 指定描述文件包含的开发证书 SHA-1。`BRANCHDECK_BUILD_NUMBER` 设置上传构建号，默认为 `1`。

签名材料必须属于 `APPLE_TEAM_ID` 指定的团队，App ID 为 `local.branchdeck.app`，开发描述文件必须包含测试 Mac。开发签名钩子保留 electron-builder 已验证选中的证书指纹，避免钥匙串中两张同名有效证书导致 `codesign` 歧义。不会删除、修改钥匙串证书，也不会关闭最终签名校验。

## 上架前验收

### 当前验证结果（2026-09-29）

开发签名的真实 MAS 包已验证：取消选择不会新增授权；选择独立测试项目后可以发现目录、列出文件并预览文本；完全退出后重启可以恢复该项目的持久授权。授权存储、失效、符号链接边界和撤销持久化行为另有自动化测试。

商店打包钩子 `scripts/prepare-mas-pty.cjs` 在独立临时目录编译 node-pty 1.1.0，将初始化终端属性和窗口尺寸的操作移到 PTY 主端，只替换 MAS 包内的原生模块，不修改站外版依赖。升级 node-pty 时必须重新审查这项兼容处理。

**目前仍不具备提交审核条件。** 修复后可以启动 zsh 并执行简单命令，但系统仍拒绝终端前台进程组操作（`can't set tty pgrp: operation not permitted`），Ctrl+C 中断尚未通过验收。系统 `/usr/bin/git` 还会报 `xcrun: error: cannot be used within an App Sandbox`，使 Git 仓库识别和相关操作不可用。目录授权不能解除这两项限制。需要继续解决可分发 Git 运行时和终端作业控制，并验证 Git/SSH、交互式工具和服务生命周期后才能上传；不能把此开发包当作功能等同的发布版本。

必须验证首次拒绝/取消授权、授权目录读写、重启恢复、授权失效、撤销后的重启行为，以及 PTY 交互、Git/SSH、工具链、服务启动停止、端口和子进程清理。Node 单元测试和普通 Electron 构建不能替代这些沙盒运行证据。

提交前还需准备 App Store Connect 应用记录、版本、截图、支持与隐私政策网址、审核联系信息和出口合规/隐私声明。上传构建和正式提交审核是不同步骤；构建成功不表示已通过 App Review。

参考：[Electron MAS 指南](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide)、[Apple 沙盒文件访问](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)。

签名身份通过 `MAS_DEVELOPMENT_IDENTITY` 和 `MAS_DISTRIBUTION_IDENTITY` 提供，不应将真实身份提交到仓库。商店发布计划已暂停。
