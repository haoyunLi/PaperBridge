# Windows 发布者签名

PaperBridge 提供 Windows x64 安装版（Setup）与免安装便携版（Portable）。普通个人电脑允许未签名应用时，两种版本都可运行。请从项目的 GitHub Release 下载实际的 `.exe` 文件。如果 Windows 显示「未知发布者」，请先核对文件来源和该版本的 SHA-256。如果设备允许，而且你信任这一份下载，可以在「更多信息」中选择「仍要运行」。组织管理的设备按管理员的应用策略执行。

如果看到的是 **Open File – Security Warning（打开文件－安全警告）**，先核对对话框里的文件名与刚从项目发布页下载的文件是否一致。信任该文件时，选 **Run（运行）**。Windows 等待这个选择期间，PaperBridge 主窗口还不会出现。切到该对话框即可查看。Setup 和 Portable 都可能出现这一步。

### 怎样核对下载的文件

从同一 GitHub Release 下载 EXE 及同名的 `.exe.sha256` 文件，在它们所在的文件夹打开 PowerShell。以 0.2.61 便携版为例，把第一行的文件名换成实际下载的版本或安装版名称，再运行以下命令。显示 `True` 表示 EXE 的内容与该发布页给出的 SHA-256 一致。

```powershell
$file = 'PaperBridge-Windows-0.2.61-x64-Portable.exe'
$expected = ((Get-Content -LiteralPath "$file.sha256" -Raw).Trim() -split '\s+')[0]
(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -eq $expected
```

## 允许运行后没有看到窗口

想先读一篇论文，可以在仓库首页选择 **Download Windows portable (.exe)**。确认下载的文件名以 `-x64-Portable.exe` 结尾，然后从文件资源管理器打开。首次引导里选 **Skip setup** 即可导入 PDF。若选择的是 `-x64-Setup.exe`，请先完成安装，再到开始菜单打开 **PaperBridge**。再次打开已启动的阅读器会把原窗口带到前台。请使用 0.2.36 或更新的便携版，较早版本重复打开时可能清理第一个窗口仍在使用的临时资源。[Windows 下载入口](https://github.com/haoyunLi/PaperBridge#windows-download-preview)

从 0.2.42 起，如果窗口一直停在 **Opening PaperBridge…**，展开 **Trouble opening PaperBridge?** 后，点 **Try again** 可重新加载阅读器。这个入口在主界面脚本读取失败时也能使用。如果阅读器进程意外退出，Windows 对话框会显示原因和退出码。选 **Reopen reader** 可恢复最后保存的论文和标注，选 **Close PaperBridge** 可退出。仍未保存的编辑取决于上一次保存时间。

如果点「仍要运行」后仍然没有窗口，请记下文件名、Windows 显示的完整提示，以及发生时间。旧版在带有 `ELECTRON_RUN_AS_NODE` 环境变量的系统上曾出现静默退出。公开版已修复这一问题，发布测试也覆盖了这种环境。[启动验收记录](WHOLE_APP_REVIEW.md)

可以用启动时间区分两种原因。在「事件查看器 → Windows 日志 → 应用程序」中，事件 1000 的故障应用为 PaperBridge 时，记录故障模块和异常代码。如果系统提示应用控制阻止了运行，请查看「应用程序和服务日志 → Microsoft → Windows → CodeIntegrity → Operational」中的事件 3077，或「AppLocker → EXE and DLL」中的事件 8004。核对文件名及时间后可将对应信息交给维护者。历史日志可能已轮换。[微软的应用崩溃说明](https://learn.microsoft.com/en-us/troubleshoot/windows-server/performance/troubleshoot-application-service-crashing-behavior) · [微软的应用控制事件说明](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/operations/querying-application-control-events-centrally-using-advanced-hunting)

## 免费分发与可选签名

现有 GitHub 下载采用免费的未签名 EXE。开发者无需提交身份材料即可发布。Windows 可能在首次打开时询问是否运行，便携版也适用相同的系统策略。如果提示明确写着 **Smart App Control** 已阻止该应用，或系统管理员已禁止运行，设备可能不会提供「仍要运行」。普通 SmartScreen 的「未知发布者」提示可以按页面顶部的说明处理。[微软的 SmartScreen 说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)

如果以后希望免费提供经过签名的版本，可以考虑以下渠道。

- 美国个人开发者可以从微软的个人开发者注册入口免费开通 Microsoft Store 账户。本人需要使用证件和自拍完成身份核验。将 MSIX 提交至商店，认证通过后由微软为商店包签名，用户从商店安装。GitHub 下载的 EXE 有独立的签名状态。[个人免费注册与核验步骤](https://learn.microsoft.com/en-us/windows/apps/publish/whats-new-individual-developer) · [微软的分发与签名选项](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
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

公开下载验收还会用下载的 Setup 实际安装程序，用该副本导入同一份期刊 PDF，逐项核对 macOS 的五组结果。检查内容包括优先模式回退、严格模式失败时保留旧论文和笔记、仅文字层模式跳过解析器，以及成功时能取回字节一致的原 PDF。便携版另有离线阅读与重启检查。发布工作流在这些验收通过后更新应用内的下载清单。[安装版与便携版验收](https://github.com/haoyunLi/PaperBridge/actions/runs/44929230599/job/136924547284)
