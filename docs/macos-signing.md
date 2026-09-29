# macOS 签名与打包

macOS 站外分发使用 Developer ID Application 证书。通过本机环境变量 `CSC_NAME` 选择证书，不在仓库中写入姓名、团队 ID 或证书指纹。有效签名仍会在安装包中包含证书主体身份；要求隐藏该身份时，不应发布使用个人证书签名的安装包。

## 环境与命令

需要 macOS、Node.js 22.12+、npm、Xcode，以及钥匙串中的上述证书和私钥。证书和私钥不放入仓库。

```sh
security find-identity -v -p codesigning
npm ci
npm run pack
npm run dist
```

`pack` 生成签名的 `.app`；`dist` 生成签名应用以及 DMG、ZIP。Apple Silicon 应用位于 `release/mac-arm64/BranchDeck.app`，安装包位于 `release/`。默认构建当前主机架构。

构建强制要求签名，使用 Hardened Runtime，仅声明 Electron JIT 所需的 `com.apple.security.cs.allow-jit`。缺少指定证书时失败，不回退到未签名应用。Bundle ID 保持 `local.branchdeck.app`。

如果 npm 的全局缓存存在权限问题，可以使用忽略提交的项目缓存：

```sh
npm ci --cache .local/npm-cache
```

## Apple 公证

签名与公证是两个步骤。未提供公证凭据时，electron-builder 会提示跳过公证；该产物不能视为已经通过 Gatekeeper 的公开分发包。

先在本机交互式保存本团队的公证凭据（按提示输入 Apple ID、团队及 App 专用密码，不要把密码写入仓库）：

```sh
xcrun notarytool store-credentials branchdeck-notary
```

之后通过钥匙串配置名称启用公证：

```sh
APPLE_KEYCHAIN_PROFILE=branchdeck-notary npm run dist
```

electron-builder 会提交应用给 Apple 公证，并在成功后装订公证票据，再生成分发包。配置了无效凭据或公证失败时构建会失败。

也支持已有 App Store Connect 团队 API 密钥：通过环境变量 `APPLE_API_KEY`（本机 `.p8` 路径）、`APPLE_API_KEY_ID` 和 `APPLE_API_ISSUER` 配置，随后运行 `npm run dist`。不要将私钥内容或认证令牌写入项目。

## Mac App Store

当前 `pack` / `dist` 产物用于站外分发，不能直接作为 Mac App Store 构建上传。商店提交本身包含安全检查，不以站外公证为前置条件。

商店版需要独立的 Electron MAS 构建、Apple Distribution 应用签名、Mac Installer Distribution 安装包签名、App ID 及对应描述文件，并启用 Apple App Sandbox。当前渲染器的 `sandbox: true` 不等于 Apple App Sandbox。

独立商店版已接入用户主动授权目录和跨启动恢复 security-scoped bookmarks，配置见 [Mac App Store 版本](mac-app-store.md)。交互终端、子进程、开发服务、项目发现和历史读取仍须以实际 MAS 开发包验收，不能仅以构建成功认定具备上架条件。

参考：[Electron Mac App Store 指南](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide)、[Apple 公证说明](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)。

## 验证

每次重新构建都必须重新签名、公证并验证。历史验证结果不能替代当前产物检查。发布前还需扫描原生模块的编译路径及签名身份。

```sh
codesign --verify --deep --strict --verbose=2 release/mac-arm64/BranchDeck.app
codesign -dv --verbose=4 release/mac-arm64/BranchDeck.app
```

确认输出包含预期的 Developer ID Application 证书、团队标识和 `runtime`。完成公证后再检查：

```sh
xcrun stapler validate release/mac-arm64/BranchDeck.app
spctl --assess --type execute --verbose=2 release/mac-arm64/BranchDeck.app
```
