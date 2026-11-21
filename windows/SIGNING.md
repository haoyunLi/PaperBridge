# Windows 发布者签名

PaperBridge 提供 Windows x64 安装版（Setup）与免安装便携版（Portable）。普通个人电脑允许未签名应用时，两种版本都可运行。请从项目的 GitHub Release 下载实际的 `.exe` 文件。如果 Windows 显示「未知发布者」，请先核对文件来源和该版本的 SHA-256。如果设备允许，而且你信任这一份下载，可以在「更多信息」中选择「仍要运行」。组织管理的设备按管理员的应用策略执行。

## 免费分发与可选签名

现有 GitHub 下载采用免费的未签名 EXE。开发者无需提交身份材料即可发布。Windows 可能在首次打开时询问是否运行，便携版也适用相同的系统策略。

如果以后希望免费提供经过签名的版本，可以考虑以下渠道。

- 使用 MSIX 向 Microsoft Store 提交。商店认证通过后由微软为商店包签名，用户从商店安装。现有 GitHub EXE 继续沿用自己的发布流程。[微软的分发与签名选项](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- SignPath Foundation 为符合条件的开源项目提供免费签名。申请要求包括 OSI 认可的许可证、满足组件来源要求和逐次人工批准签名。当前仓库根目录没有声明项目许可证，是否采用开源许可由著作权人决定。[基金会申请条件](https://signpath.org/terms)

## 美国个人开发者申请

1. 在 Azure 门户创建 **Artifact Signing** 账户，选择 Basic 计划并先确认当前报价。微软列出的起价约为每月 9.99 美元。个人 Public Trust 目前面向美国和加拿大。Azure 订阅关联的计费账户类型需要为 Individual，法定姓名及地址须与身份证明匹配。[申请条件与操作步骤](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart) · [当前定价](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)
2. 在资源的 **Identity validations** 里选择 **Individual / Public**，按微软页面和验证邮件提示完成本人身份验证。提交前查看证书主体预览，它决定用户看到的发布者信息。仅在微软流程中提供证件。
3. 身份验证通过后，创建 **Public Trust** certificate profile。记录区域 endpoint、签名账户名、profile 名以及证书主体的 Common Name。
4. 在 Microsoft Entra 创建用于发布的应用和服务主体，在该 certificate profile 范围授予 **Artifact Signing Certificate Profile Signer** 角色。为下面的 CI 配置创建有期限的 client secret，并安排到期轮换。[签名权限说明](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)

## 接入此仓库

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加以下配置。使用受保护的发布标签，仅授权发布维护者更改工作流及创建发布标签。

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Variable | WINDOWS_SIGNING_PUBLISHER | 证书主体的 Common Name |
| Variable | WINDOWS_SIGNING_ENDPOINT | 资源提供的区域 HTTPS endpoint |
| Variable | WINDOWS_SIGNING_ACCOUNT | Artifact Signing 账户名 |
| Variable | WINDOWS_SIGNING_PROFILE | Public Trust certificate profile 名 |
| Secret | WINDOWS_SIGNING_CLIENT_ID | Entra 应用的 client ID |
| Secret | WINDOWS_SIGNING_TENANT_ID | Entra tenant ID |
| Secret | WINDOWS_SIGNING_CLIENT_SECRET | client secret 的值 |

配置齐全后将 Variable `WINDOWS_SIGNING_MODE` 设为 `azure`，按现有约定以新的 `windows-vX.Y.Z` 标签发布。普通分支测试仍可构建免费预览版。签名标签构建通过项目锁定的 electron-builder v26 在打包过程中调用 Azure，签署内部 PaperBridge.exe 和发行程序。发布步骤在内部主程序以及两份最终下载文件上验证 Authenticode 的有效性、时间戳和预期发布者，再计算各自的 SHA-256。签名配置错误将使发布失败。[electron-builder v26 的 Azure 配置](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/)

微软面向普通个人电脑的 SmartScreen 应用信誉随实际分发积累，没有通过邮件手工申请信誉的流程。新签名文件也可能暂时出现信誉提示。Defender 如报告具体病毒或 PUA 检测，可带上该检测名称和对应文件信息走误报复核。[SmartScreen 发布者说明](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation) · [微软误报提交入口](https://www.microsoft.com/en-us/wdsi/filesubmission)

## 发布包启动验收

GitHub 的 Windows 工作流先启动打包好的 Portable，再安装 Setup 并打开安装目录中的 PaperBridge.exe。测试使用独立工作区，从与源码无关的目录无参数启动应用，通过 Windows 辅助功能读取首次向导按钮，或向测试窗口发送 Esc 并核对向导完成状态已保存。安装版还会最小化窗口，再次启动并验证原窗口恢复，最后正常关闭。测试有意保留会干扰旧包的开发环境变量。发布后另一个全新 Windows runner 从公开下载链接重新下载两个文件，核对校验文件及 GitHub asset digest，再重复启动验收。自动化直接启动程序，不模拟浏览器的信誉提示或个人设备的管理策略。
