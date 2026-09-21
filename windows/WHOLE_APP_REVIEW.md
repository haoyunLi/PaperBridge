# Windows 全软件功能复查：2026-09-20

## 第四阶段：翻译范围与 Paper 标注原位返回（2026-09-21）

继续按 macOS 总映射复查后，修正了两个可直接复现的小功能差距。Translation Range 现在由实际可执行队列统一计算：排除已完成块、资源块和参考文献，包含待译/失败标题；当前章节、Abstract & Conclusion、任意章节与 All unfinished 的数字和禁用状态均与点击后的任务一致。

Paper 预览和 Reader 的块级笔记/高亮现在保存独立 `paper` / `reader` 作用域。同一段同一偏移可在两个视图分别保存；正文只显示本视图记录，列表和 Markdown 导出明确标出来源，点击 Paper 记录会回到 Paper 原块并精确重选文字，同时接入 Back / Forward。旧版没有 scope 的记录继续按 Reader 处理。非 MinerU Paper 预览也改为呈现完整文档，不再在第 12 块截断，因此长文后半部分可直接选择和标注。

本阶段验证为 **95/95 单元测试**、生产构建，以及 `test:markdown`、`test:reader-review-e2e`、`test:note-autosave-e2e`、`test:heading-parity-e2e`、`test:reading-history-e2e` 和 `test:e2e`。`test:markdown` 还验证了 Paper→Reader 视图隔离、Paper 精确回跳及随后 Back / Forward 往返；`test:heading-parity-e2e` 验证非 MinerU Paper 的第 14 块实际渲染。当前剩余边界是复杂 Markdown 跨节点/跨块坐标和更多真实论文并排验收。

## 第三阶段：设置、自动发现、更新恢复与真实安装闭环（2026-09-21）

这一阶段补齐了上一轮明确列出的 Settings 小入口，并把只做静态/模拟验证的交付链路推进到真实安装器。macOS `origin/main` 同时从 1.9 `73951d9` 前进到 1.9.1 `33cfb933`；1.9.1 新增行为见 [12 项增量差距报告](MAC_1_9_1_GAPS.md)，不混入原有 111 项历史统计。

| 本次补齐 | 行为与验证 |
| --- | --- |
| 六分页 Settings | Local AI、Parsing、Models、Reading、Updates、Local Data；980×620 与 150% Electron 缩放可用，键盘 Left/Right/Home/End 导航通过。 |
| Settings 推荐模型 | 与引导共用 3 个翻译模型和 6 个助手模型；支持 RAM 建议、下载/取消/重试、Use、四任务角色、跨分页进度、重启恢复，迟到完成不会写错论文或 Ollama 端点。 |
| MinerU Auto-Detect | 设置按钮、导入、安装状态共用 resolver：优先兼容的应用私有 MinerU，再检查 PATH；显式路径保持权威。检测中取消、重复任务和原生菜单启动新任务均有 identity guard。 |
| 更新提示恢复 | 仅缓存校验后的 release tag 与精确 installer 名，启动时按当前版本重新计算；新版提示跨重启保留，过期刷新失败时保留 stale 提示并允许重试，损坏/未来缓存不能抑制检查。 |
| 安装路径保护 | 真实测试暴露 268 字符自定义路径会让 electron-builder NSIS 旧版原子移除失败；生产 assisted installer 现固定安全默认目录，测试在变更系统前计算最长安装路径并拒绝 ≥260 字符的 fixture。 |
| 真实 NSIS 生命周期 | 最终安装包完成首装、启动、创建练习论文与高亮/笔记、同版本重装、重新打开并恢复数据、卸载、确认注册/快捷方式/程序已移除且论文设置仍保留。测试前检查 HKCU/HKLM、32/64 位视图、进程、快捷方式和 updater cache；清理只处理本次验证过的安装和匹配 SHA-256 的缓存。 |

最终验证为 **83/83 单元测试**，以及 `test:e2e`、`test:settings-models-e2e`、`test:model-pull-e2e`、`test:paper-settings-e2e`、`test:onboarding-e2e`、`test:mineru-detect-e2e`、`test:update-restart-e2e`、`test:packaged` 和 opt-in `installer-e2e`。最新真实 AMD OCR 使用空 `mineruExecutable`，由应用自动发现私有 MinerU 3.4.5；约 **40.7 秒**得到 `pdfBlocks=0`、`mineruBlocks=5` 并完成中文翻译，Ollama 报告 `modelBytes = modelVramBytes = 2,875,656,764`。

最终 NSIS、portable 和 unpacked 主程序的 Authenticode 状态仍为 **NotSigned**。安装/重装/卸载已经真机验证；代码签名、正式 Windows Release、跨版本更新安装、NVIDIA/纯 CPU/更多 AMD 设备仍是发布前边界。

## 第二阶段：首次使用和系统交互补齐

在下述整软件复查之后，继续实现 Mac 对应的首次引导和安装细节。映射仍为 **43 对齐、68 部分、0 缺失**，保留尚待真机与复杂文档验收的部分状态。

| 本次补齐 | 行为和边界 |
| --- | --- |
| 六步 Getting Started | 欢迎、Ollama、翻译模型、可选 MinerU、可选助手、就绪总结；首次启动自动显示，保存页码，支持跳过及从 Settings / Help 重开，结束可打开 PDF 或练习论文。首次显示只检测环境。 |
| Mac 对应的九个模型 | TranslateGemma 4B / 12B / 27B 和六个助手模型，展示下载量、用途、已装及已选状态；下载成功确认后才应用任务角色，保留已装专用助手，支持取消及重试。内存建议使用系统 RAM，不用 Windows 可能截断的 AdapterRAM 推断显存。 |
| 安装组件选择 | 可分别选择 Ollama、当前任务模型、MinerU；只选模型时仍会检查必要的 Ollama 依赖，只装 MinerU 不下载 Ollama 模型。未选择 MinerU 时不会改写已有路径或后端。 |
| MinerU 修复入口 | 显式 Repair / update MinerU 重装应用支持的固定版本；沿用私有环境和激活失败回滚。检测期间取消也不会再发送错误的安装完成状态。 |
| 原生菜单联动 | 导入、导出、翻译、摘要、选区、撤销等依据论文、选区和运行状态启停；首次引导期间禁用背景命令。原生菜单新增 Getting Started 入口。 |
| 引导交互边界 | 修复 Tab 可跳入背景 Settings 绕过安装锁的问题；背景区域设为 inert，焦点留在弹窗内，忙时 Esc / 关闭 / 换页无效，拖入 PDF 不能绕过弹窗。结束保存期间阻止重复操作，保存失败在引导内显示。 |
| 官网链接 | 官方 Ollama 下载和模型详情在外部浏览器打开；仅允许对应官方 HTTPS 路径，拒绝其它新窗口地址。 |
| 启动配置一致性 | 先恢复最后论文的任务设置，再显示引导；环境诊断按当前端点和 MinerU 路径校验，旧配置的迟到结果不能覆盖当前模型状态。 |

本阶段 **69/69 单元测试、生产前端构建、下列 9 个 Electron 回归套件通过**：

- 新增 `test:onboarding-e2e`、`test:onboarding-startup-e2e`、`test:setup-components-e2e`、`test:menu-state-e2e`、`test:menu-ui-e2e`、`test:official-links-e2e`。
- 再次通过 `test:e2e`、`test:paper-settings-e2e`、`test:model-pull-e2e`。
- 引导截图在 1320×820 和 980×620 两种视口下目视检查；小窗口内容可滚动，底部按钮完整可用。下载/安装中连续 Tab 与 Shift+Tab 不会进入背景；延迟保存时双击完成只打开一次 PDF 对话框。

安装与下载交互使用可控本地服务/IPC，本轮没有重新安装本机已有工具或下载九个大模型。真实硬件读取确认 **RX 7800 XT + AMD 集显、系统可识别物理内存约 63.15 GiB、无 NVIDIA CUDA**；这项读取不等同于重新测试推理速度。

本阶段重新运行 `npm run dist` 生成 NSIS 和 portable；`test:packaged` 通过首次引导、自动检测面板和 Reader 启动检查。两个可执行文件均为 **NotSigned**。六个新增桌面回归命令已接入 Windows GitHub Actions，远端结果以实际工作流运行结果为准。

## 第一阶段：整软件复查和数据正确性

本轮以本地 `origin/main` 的 `73951d9`（macOS 1.9）源码为基线，复查 Windows 0.2 的导入、阅读、翻译、摘要、选区、标注、恢复、安装和导出流程。重点检查操作顺序变化后是否仍保存正确的数据，以及小功能是否真正使用对应设置。

[111 项映射](FEATURE_MAPPING.md)仍为 **43 对齐、68 部分、0 缺失**。本轮结合源码比较、单元测试、Electron 流程回归修复了下列问题；未进行同一论文在 Mac 真机上的全流程并排验收，因此不据此提高映射状态或计算完成百分比。

## 本轮修复的 12 类问题

| # | 复查发现的问题 | 已完成修改 | 验证依据 |
| --- | --- | --- | --- |
| 1 | 切换语言、模型或 Ollama 地址后，旧译文仍可能被当作当前设置的已完成结果；解释缓存缺少模型和地址区分。 | 段落译文、摘要、全文译稿按相关设置和解析来源分别保存；只有原文仍匹配时才恢复。解释同时校验段落、语言、模型、地址和原文。缺少设置来源的旧解释保留但不冒充新设置结果。 | `output-cache.test.cjs`、`paper-settings-e2e.cjs`。 |
| 2 | 更换输出设置或 PDF/MinerU 来源时，译文标注可能跟错译稿；已有摘要、全文或便签时，手动解析可能直接替换阅读源。 | 译文侧笔记、高亮跟随对应输出版本恢复；不兼容原文不恢复旧锚点。手动 MinerU 保留已有阅读工作，显式切换来源后保留旧摘要/全文并标明过期。 | `output-cache.test.cjs`、`task-isolation-e2e.cjs`。 |
| 3 | 导入、重新提取、粘贴和 AI 任务缺少统一的取消边界；取消导入后晚到的 MinerU 成功或错误可能影响后来打开的论文。 | 导入纳入任务状态，运行期间阻止冲突操作；PDF.js 逐页提取进度、任务结果、错误和结束回调校验当前任务，避免写入新工作区。MinerU IPC 进度仍未附带任务 ID。 | `task-isolation-e2e.cjs`覆盖忙时拖入及取消后晚到的成功/失败。 |
| 4 | 选区 A 的延迟解释可能出现在选区 B 下；选中文字解释忽略独立解释语言，译文侧上下文也可能取原文。 | 结果绑定选区身份；改选、切换解释语言时取消旧请求。选区解释使用所选解释语言，译文侧使用译文上下文；缓存包含地址、语言和匹配术语。 | `reader-review-e2e.cjs`使用延迟本地假服务、French 提示检查和 DOM 变化监测。 |
| 5 | 撤销书签或高亮会恢复整篇论文快照，连后来生成的译文、摘要和设置一起回滚。 | 注释和书签仅撤销相关字段。结构编辑撤销恢复原结构及受影响段落原译文，保留未改段落新结果、后写便签正文和当前设置；保留后写摘要/全文并标为过期。无法唯一定位的新注释保留并提示复核。 | `paper-undo.test.cjs`及 `reader-review-e2e.cjs`中的“书签→翻译→撤销”。 |
| 6 | 启动时用最近修改的图书馆条目代替真正最后打开的论文。 | 单独保存最后打开记录；打开旧论文或修改另一篇的标签不会混淆下次启动恢复。 | `last-opened-e2e.cjs`跨启动验证最后打开 B，而图书馆最近修改项仍为 A。 |
| 7 | Settings 手动模型下载没有可靠取消，也可能与重复下载或一键安装同时运行。 | 模型下载使用流式进度、独立取消和互斥状态；取消后等待请求结束再释放状态，旧进度及成功消息不能污染重试。 | `model-pull.test.cjs`、`model-pull-e2e.cjs`覆盖取消、重复请求、与安装互斥、晚到结果及重试。 |
| 8 | 保存了最大翻译分块长度，却没有设置入口。 | Settings 增加 500–6000 字符滑块，按论文保存；改变长度只切换相关段落翻译缓存，摘要及全文输出保持对应状态。 | `paper-settings-e2e.cjs`及 `output-cache.test.cjs`。 |
| 9 | 搜索过滤会让目录、书签或来源跳转找不到目标；“当前章节”取最后点击段落，未随滚动更新。 | 导航前清搜索；Reader 滚动保存当前可见段落，翻译范围据此选择章节。 | `reader-review-e2e.cjs`覆盖搜索后目录跳转、长文不点击正文而滚动切换章节。 |
| 10 | Analysis、双语和便携导出遗漏书签及没有便签的高亮，部分便签未标明来源侧或失效状态。 | 两种 Markdown 和其 bundle 内容包含书签、各阅读视图的高亮/笔记、原文/译文侧、PDF 页码及需复核提示。 | `annotations-markdown.test.cjs`；`reader-review-e2e.cjs`通过真实导出 UI 检查仅高亮加书签的两份内容。 |
| 11 | 从译文侧保存术语时方向错误；重复词追加冲突项，超长词或满表会静默截断、挤掉旧项。 | 按选区所在侧决定方向；同词同方向替换；160/300 字和 500 条上限给出明确错误。 | `reader-review-e2e.cjs`验证 Chinese→English 方向和重复替换。 |
| 12 | 拖入多个文件会被直接拒绝，即使其中包含可用 PDF 也无法导入。 | 在拖入文件中选择第一个 PDF；保留单文件导入和重复恢复行为。 | `test:e2e`混合文件拖入流程。 |

实现入口：[主界面和任务控制](src/main.jsx)、[输出缓存](src/outputCache.mjs)、[撤销](src/paperUndo.mjs)、[阅读记录导出](src/annotationsMarkdown.mjs)、[模型下载](electron/model-pull.cjs)、[本地存储](electron/storage.cjs)。

## 验证范围

本轮 **53/53 单元测试、生产前端构建及以下 8 个 Electron 流程均已通过**。Electron 流程使用各自的测试工作区，其中 AI 交互测试使用本地假 Ollama 服务或受控 IPC，验证状态和数据正确性；它们不构成真实模型质量或安装器兼容性结论。

| 命令 | 本轮验证内容 |
| --- | --- |
| `npm run test:e2e` | 主工作流、快捷键、进度、标注、PDF 和混合文件拖入。 |
| `npm run test:paper-settings-e2e` | 双论文设置切换/重启、分块滑块、解释缓存及检查器恢复。 |
| `npm run test:last-opened-e2e` | 最后打开论文独立于最近修改顺序。 |
| `npm run test:model-pull-e2e` | 下载流、进度、取消、互斥与重试。 |
| `npm run test:reader-review-e2e` | 撤销不丢译文、搜索导航、滚动章节、选区任务、解释语言、术语方向、导出阅读记录。 |
| `npm run test:task-isolation-e2e` | 导入取消后迟到成功/错误隔离，手动 MinerU 保留已有阅读源及输出。 |
| `npm run test:markdown` | 结构化资源、公式、表格和选区行为。 |
| `npm run test:reopen-mineru` | 已解析论文重开后的结构与资源。 |

本轮 `npm run test:live-ocr` 在 RX 7800 XT 上再次通过，耗时约 **50.8 秒**：图像型 PDF 的直接文本块为 **0**，MinerU 得到 **5** 个块并完成真实中文翻译；Ollama 返回 `modelBytes = modelVramBytes = 2,875,656,764`，本次模型全部放入显存。已有[AMD 真机报告](AMD_DEVICE_TEST.md)另记录一键安装、真实本地模型及 15 页双栏论文。

清晰合成图像页的 OCR 通过不能代表低清扫描、倾斜、多栏或复杂公式扫描件全部通过。NVIDIA CUDA、纯 CPU 和其它 AMD 设备仍需要分别验收。

本轮 `npm run dist` 已成功生成 NSIS 安装包和 portable 可执行文件，`npm run test:packaged` 启动检查通过。两个产物的 `Get-AuthenticodeSignature` 结果均为 **NotSigned**，仍属未签名预览；本次构建与启动通过不代表正式签名、安装/卸载及更新升级流程已经验收。

测试产物保存在被 Git 忽略的 `windows/test-artifacts/`。其中 `reader-review-requests.json` 为本地假服务的请求记录，`reader-review-exports.json` 为导出 UI 传出的 Markdown，用于复查本轮回归；它们不是用户论文或真实模型效果样本。

## 仍值得补齐的项目

| 优先级 | 剩余差距 | 完成验收点 |
| --- | --- | --- |
| P1 | 新增组件选择与 MinerU 修复还需更多真实安装环境验收。 | 在干净机器、损坏旧环境、激活失败、取消和重启的条件下检查实际安装及回滚；现有新增流程验证使用受控安装响应。 |
| P1 | Windows 尚未完成正式签名与跨版本更新交付。 | 真实首装/同版本重装/卸载已通过；仍需签名后的 NSIS/portable、正式 Windows Release、下载校验和旧版本→新版本更新安装。当前应用检查新版并打开发布页。 |
| P1 | macOS 1.9.1 笔记可靠性第一批已补齐。 | 350 ms autosave、离开/退出 flush、原始空白、会话 Undo、paper/selection identity、Saving/Saved/Error/Retry、固定状态栏及 `needsReview` 隔离均有单元和 Electron 回归；继续做真实复杂文档并排验收。 |
| P2 | macOS 1.9.1 阅读历史与标题体验已补齐。 | 50 条 Back/Forward、全 surface 位置恢复与代次保护，以及独立标题分类、翻译重试、三模式、两侧标注、动作与导出均有专项回归；继续做真实复杂论文并排验收。 |
| P2 | 高 DPI、最小窗口、复杂结构和真实扫描件覆盖不足。 | 在多种缩放与分辨率下验证面板、选区、滚动位置；同一批普通/双栏/扫描/公式图表论文与 Mac 真机逐项比较。 |
| P2 | NVIDIA CUDA 与更多设备未实测。 | 在 NVIDIA、纯 CPU 及其它 AMD 实机检查安装、推理后端、VRAM、失败降级、取消和恢复。 |

继续使用同仓库 Windows 分支和[现有 PR](https://github.com/haoyunLi/PaperBridge/pull/1)维护源码与测试；macOS 和 Windows 分别构建、分别发布。当前结论是本轮列出的可复现问题已修复，接近一比一体验仍需完成上述交互和设备验收。
