# Windows 全软件功能复查：2026-09-20

## 第十九阶段：术语词典与写入反馈（2026-11-06 UTC）

术语匹配按语言方向和 Unicode 大小写归一化，较长匹配优先，最多 24 条。Reader 段落、结构化 Markdown、全文及选区翻译共用 JSON 词典格式。保存和删除以落盘结果为准，失败会保留草稿或旧词条供重试。原文与译文选区各自使用对应语言方向，已有译文继续可读。

桌面回归通过实际文件写入失败验证保存和删除提示、重试及重启。RX 7800 XT 上的 TranslateGemma 4B 对测试句采用了刚保存的“自注意机制”，模型完整驻留显存。

## 第十八阶段：论文库最近打开与文档标签（2026-11-06 UTC）

论文库按最近打开排序，并显示每篇论文已译段落、打开日期与标签。打开记录独立于论文保存时间，兼容只有最后打开 ID 的旧工作区。读取失败时在库内显示错误并保留条目。库标签和文档名分开保存，按 Mac 规则限制标题长度、标签长度和数量。

Windows 0.2.0 的安装版和便携版已通过公开链接下载并核对 SHA-256。真实 GitHub 更新源在当前版本参数为 0.1.0 时返回 0.2.0，为 0.2.0 时返回当前版本。仓库 Latest 仍指向 macOS v1.10.0。

## 第十七阶段：Windows 下载和跨版本安装（2026-11-06 UTC）

独立 `windows-v0.2.0` 发布提供 x64 Setup、Portable 与两个 SHA-256 校验文件。打包文件名与应用的 Release 检查使用同一版本命名，旧缓存可读。Windows 标签构建只有在单测和桌面回归通过后才上传 Release 资产，仓库 Latest 继续指向 macOS。

在本机隔离安装目录运行真实 NSIS 0.1.0，再升级到 0.2.0。核对了安装注册版本、两次启动的应用版本、论文原记录及高亮笔记。测试卸载清除了安装注册、快捷方式及本次安装缓存，保留测试工作区和设置。另从 Portable 外层 EXE 启动，确认能进入首次引导、打开 Reader 并退出。两份 x64 二进制当前未签名。

## 第十六阶段：长文摘要与来源校验（2026-11-06 UTC）

按 macOS 1.10 的摘要流程处理超过 6,000 字符的长段，段落编号跨批不变。候选超过六条时立即滚动合并，合并最多处理十二条。引文须逐字出现在当批同一编号的正文切片，合并仅能使用输入中已校验的编号与引文组合。最终结论逐条翻译，点击来源时仅译文模式切回双语。

桌面回归覆盖长段末尾、合并时序、来源核验、两种任务模型、重生成停止与输出截断后保留已保存摘要。真实测试中 TranslateGemma 4B 作为摘要模型曾生成到 Ollama 上下文截断；Windows 的本地 JSON 摘要请求现限制生成 2,048 token，并提示更换摘要模型后重试。

## 第十五阶段：PDF 原页与译文组合（2026-11-06 UTC）

对照 macOS 1.10 的 PDFKit facsimile，Windows 在 PDF 文字层的 Paper 双语和译文模式、Full Translation 中显示可翻页的原 PDF 预览。宽窗并排，窄窗堆叠，可折叠预览，也可打开带选择和批注的同一原页。预览按需渲染，便携包才生成 PNG。

便携包把完整原 PDF 链接和已保存的图像放在抽取正文与译稿前。导出最多渲染前 120 页，停止后索引与译稿只引用已保存的 PNG。桌面回归覆盖组合布局、精确原页切换、停止和重启。已由 AMD 翻译的 15 页工作区副本用于核对全文、15 张 PNG 和原 PDF 哈希；121 页测试 PDF 用于验证页数限制、提示和完整原件。

## 第十四阶段：普通全文分批、停止与续跑（2026-11-06 UTC）

普通文本和 PDF 文字层的 Full Translation 改用 macOS 1.10 的相邻段落分批思路。保护公式、链接和嵌入资源后，每批正文最多 4,800 字符，逐批保存译文和处理状态。停止后重新打开，或在失败后点击 Resume unfinished batches，只请求未完成批次。译稿仍显示该批原文，迟到的取消响应不能覆盖存档。已有独立全文稿继续可读和导出，显式 Regenerate 时才改用新批次。

新增桌面回归覆盖三批中的失败与取消、重新启动、Ctrl+Enter 续跑及保存。单元覆盖长段 Unicode、保护标记验证、设置切换和旧版记录识别。MinerU 结构化全文继续与 Reader 共享结果。

## 第十三阶段：Reader 与结构化全文译稿共享（2026-11-06 UTC）

对照 macOS 1.10 的结构化全文路径后，Windows 的 MinerU 全文改为复用 Reader 已完成的段落。新请求只处理未完成正文，失败位置保留原文，Reader 重试同步更新全文和导出。旧独立全文稿继续显示，首次使用新路径时才按当前 Reader 生成；按模型、翻译方向或分块设置切换缓存时保留对应的译文，全文标注沿用现有精确锚点检查。嵌入图片的数据 URL 在截取选区或连续翻译上下文之前去除，在线请求还会再次剔除完整的数据 URL。

Electron 回归核对了四次未完成块请求、原文回退、单块重试及全文导出。AMD 扫描件真机验证了已有译文原样进入全文；另用真实 15 页论文通过界面导出并核对原 PDF、PNG 和外置图像。见 [AMD 真机记录](AMD_DEVICE_TEST.md)。

## 第十二阶段：MinerU 一键安装与 Windows DirectML（2026-11-06 UTC）

Windows 支持同时检测 MinerU 3.x 和 4.1+ 的 4.x 版本。4.x 通过本地 `mineru-kit parse` 解析所有页，Auto 使用 ONNX 设备选择，兼容模式固定 ONNX CPU。x64 无合适 NVIDIA CUDA 时，一键安装固定 MinerU 4.1.7；符合条件的 NVIDIA 新装保留 3.4.5 CUDA 路径。自动检测、版本验证、模型预载和回滚继续使用同一私有工具目录。RX 7800 XT 的独立安装及扫描件验证见 [AMD 真机报告](AMD_DEVICE_TEST.md)。

## 第十一阶段：复查在线授权和旧译文（2026-11-06 UTC）

按 macOS `16e01ac` 再核对选区和旧工作区。OpenAI 扩写选区时显示换模型提示，单次用户操作只提交一次；Ollama 仍会严格重译一次。早于 provider 设置的工作区按本地来源恢复缓存，打开时保留用户当前的 provider。清除工作区会在主进程撤销在线授权，保留独立加密的 key。Electron 验证这三项，1.10 增量映射增加到 21 项。真实 AMD 推理复测见 [设备报告](AMD_DEVICE_TEST.md)。

## 第十阶段：同步 macOS 1.10 provider 与导入反馈（2026-11-05）

重新获取 GitHub 后，macOS 主分支从 1.9.1 `33cfb933` 前进到 1.10.0 `16e01ac`。Windows 分支已合入这两个上游提交，并新增 [20 项 1.10 增量映射](MAC_1_10_GAPS.md)。本阶段首先补齐影响最大的在线/本地 AI 边界：Models 可显式选择 Ollama 或 OpenAI，四种在线任务模型与四种本地模型互不覆盖；模型列表只在用户点击时通过 `GET /v1/models` 获取，也允许手输 ID，不会自动选择付费模型或自动从本地回退云端。

OpenAI key 不进入 settings、paper workspace 或 export，而是由 Electron `safeStorage` 使用当前 Windows 账户 DPAPI 加密。每次 app session 都必须重新允许在线发送；切换 provider、替换/删除 key 或撤销授权会取消在线请求并阻止后续批次。固定官方 Responses API 请求使用 `store:false`、禁用重定向，并拒绝 partial、refusal、非 completed、空输出和畸形 JSON；服务错误不会把 response body、key 或论文文本带回 UI。Settings 明确展示所发送的提取文字范围、PDF/图片不上传、API 与 ChatGPT 分开计费、`store:false` 不等于零保留，并提供经过严格白名单的 key、usage 与 data controls 小入口。

provider、对应任务模型、翻译方向和最多 2,000 字符 style guide 已进入输出 cache namespace；本地/在线切换与重启会恢复各自的段落译文、摘要、全文译稿、解释和对应标注，但不会恢复在线许可。普通、Markdown 与选区提示词同步 1.10：单词、短语、标题、标签或站点名均视为完整翻译单元，不索要额外上下文；system 指令加入最多 300 字符论文标题、匹配术语和可选 style guide。专用 Electron 流程用受控在线响应实际核对 model、title、style，切换到 Ollama 后结果消失，切回 OpenAI 及重启后在线译文恢复且授权保持 Paused。

PDF 导入也同步 1.9.2/1.10：确认文件或拖入后，header、侧栏和正文立即显示新文件名、已耗时秒数、Cancel Import，以及从 MinerU 日志归一的 layout / formula / text 阶段和本阶段计数；旧论文只在导入完整成功后才被替换。延迟 MinerU Electron 回归验证取消后旧 bookmark、正文和 workspace 数量保持不变，随后到达的成功结果也不能写回。开发运行使用独立 `PaperBridge Dev` user-data，避免复用下载版工作区。

本阶段通过 **109/109 单元测试**、生产构建、主 Electron 流程、OpenAI settings/provider/result-variant 专项流程和 import progress/cancel 专项流程。OpenAI 专项还在延迟多批请求中撤销授权，核对仅发送一次、后续批次停止且迟到结果丢弃；额度/权限类全局错误同样只请求首段即终止长队列。因此 1.10 增量映射达到 **20 对齐、0 部分、0 缺失**。没有使用真实 OpenAI key 或付费推理。

## 第九阶段：精确选区翻译保护（2026-11-05）

对照 macOS `PaperReaderViewModel+Selection.swift` 后，Windows 补齐选区翻译的精确边界：翻译上下文围绕选中文字限制为 600 字符，解释上下文限制为 2400 字符；提示词用独立分隔符声明上下文只用于消歧、不可翻译，真正要翻译的选区另行标记。长度不超过 320 字符的选区若首次输出超过 `max(48, 选区长度 × 3)`，应用会显示 “Refining exact selection…” 并自动发送不含上下文的严格重译请求，避免模型把整段正文一起输出。缓存版本同步升级，旧的宽松结果不会被复用；原文与目标语言相同时直接返回选区，不浪费模型调用。

新增单元测试覆盖居中上下文裁剪、提示词分隔、术语、过度延伸阈值与缓存版本；主 Electron 流程模拟首次过长输出，核对两次请求的提示内容、严格重译结果和随后缓存命中。本阶段通过 **98/98 单元测试**、生产构建和主 Electron 端到端流程。

## 第八阶段：选区查询状态与取消（2026-09-21）

对照 macOS `QuickSelectionView` 和 `SelectionInspectorView` 后，Windows 把选区查询状态统一到 Quick Selection 与展开的 Research Inspector。两处现在都会显示翻译/解释进行状态和 Cancel；完成后显示 Selection translated / explained，重复同一查询显示 Using cached quick lookup，失败显示在当前选区内。展开检查器同时补上当前选区的 Original / Translation 侧标识，避免同一段双语内容难以辨认。

主 Electron 流程使用延迟本地服务，在完整检查器内启动翻译、主动取消、等待迟到响应并确认结果没有写回，然后重试成功并再次请求验证缓存命中；Quick Selection 也分别验证首次完成和缓存提示。生产构建及主流程通过，原有全局任务状态和 Stop 继续保留。

## 第七阶段：完整 Overview 阅读地图（2026-09-21）

继续对照 macOS `ReadingGuideBuilder` 和 `ReadingGuideView` 后，Windows 阅读地图不再用包含关系宽松匹配章节标题。它现在使用与 Mac 相同的五类主题、规范化编号/罗马数字标题，并且只接受完整标题、`标题:` 或 `标题 and …` 形式；每个摘录只能来自当前章节，章节内没有足够正文时不再误借下一章节。无可靠标题时仍回退到第一段可读正文，并明确提示先核对来源。

Overview 界面补齐 Mac 的 “Find your way into the paper.” 引导、五类问题、完整来源摘录标签、翻译进度、Start Reading、View Original 和缺失章节免责声明。View Original 会进入 Paper 的 Original 模式；PDF 因而显示精确原页，文本论文显示原文重排预览。主 Electron 流程实际点击阅读地图并核对 Reader 块，验证两个顶部入口和 Original 状态，并保存目视截图。新增单元测试覆盖宽松标题拒绝、编号与罗马数字标题，以及短章节不借用下一节正文。本阶段通过 **96/96 单元测试**、生产构建和主 Electron 流程。

## 第六阶段：响应式 Research Inspector（2026-09-21）

对照 macOS `ContentView` 和 `SelectionInspectorView` 后，Windows 把原先 1190px 以下的固定浮层改为相同的 1400px 响应断点。窗口小于 1400px 时，检查器占据工作区自己的底部网格行，不再遮住正文；高度随窗口取约 30%，并限制为 190–340px。抽屉内容与 Mac 一样分为两个独立滚动列：左列处理当前选区，右列显示当前 Reader 段落解释和已存标注。PDF、Paper、Overview 或 Full Translation 选区不会再混入无关的 Reader 段落解释。窗口达到 1400px 后，检查器恢复为完整高度的右侧栏，并使用对应的侧栏关闭图标和无障碍名称。

主 Electron 流程自动验证了 1320×820 的底部行、两列结构和动态高度，980×620 的 190px 最小高度与两列可用宽度，以及 1500×820 恢复右侧栏；随后再缩回 1320px 验证运行时断点切换。两张抽屉截图经过目视检查。逐论文设置回归也重新选择解释所属段落，确认布局变化后解释缓存、检查器开关、论文切换和重启恢复仍然正确。本阶段继续通过 **95/95 单元测试**、生产构建及主流程、逐论文设置、Markdown、标题、Reader Review、阅读历史和便签自动保存回归。

## 第五阶段：Quick Selection 与高亮语义（2026-09-21）

继续对照 macOS `QuickSelectionView` 和 `SelectionInspectorView` 后，Windows 不再在每次选文时强制打开研究检查器。检查器关闭时，正文右下角显示完整 Quick Selection 卡片，包含选文预览、Translate、Explain、取消任务、Amber / Cobalt / Coral、高亮移除、Save Term 与 Notes & More；检查器已打开时不会重复显示。翻译和解释结果现在可同时保留，快速术语保存可直接使用翻译结果。卡片在滚动导致选区离开时收起，并在 1320×820、最小 980×620 窗口内保持完整可见。

高亮数据也改为 macOS 的单标注语义：同一 scope、页/块、原译文侧、文字和偏移只能有一种颜色，选择新颜色会替换原色；删除改为显式 Remove Highlight，并只移除颜色而保留独立笔记。旧 Windows `blue` 记录继续按 Cobalt 显示，用户下次换色时会写为新 `teal` 值。检查器标题补上与 macOS 相同的标注撤销入口。

本阶段验证为 **95/95 单元测试**、生产构建，以及 `test:e2e`、`test:markdown`、`test:heading-parity-e2e`、`test:reader-review-e2e`、`test:reopen-mineru`、`test:paper-settings-e2e` 和 `test:note-autosave-e2e`。主 Electron 流程实际验证 Quick Selection 保存术语、Notes & More、双结果并存、单色替换、显式删除、笔记保留和逐步撤销。

## 第四阶段：翻译范围与 Paper 标注原位返回（2026-09-21）

继续按 macOS 总映射复查后，修正了两个可直接复现的小功能差距。Translation Range 现在由实际可执行队列统一计算：排除已完成块、资源块和参考文献，包含待译/失败标题；当前章节、Abstract & Conclusion、任意章节与 All unfinished 的数字和禁用状态均与点击后的任务一致。

Paper 预览和 Reader 的块级笔记/高亮现在保存独立 `paper` / `reader` 作用域和原译文侧。同一段同一偏移可在两个视图分别保存；正文只显示本视图对应侧的记录，列表和 Markdown 导出明确标出来源，点击 Paper 记录会回到 Paper 原块、恢复 Bilingual 并精确重选文字，同时接入 Back / Forward。旧版没有 scope 的记录继续按 Reader 处理。Paper 本身也与 macOS 一样提供 Original / Bilingual / Translation 三种完整文档模式：PDF 的 Original 直接显示精确原页，后两者显示完整重排文档；Paper exact PDF 与额外 Original 标签的同页同词标注也以 `paperPdf` / `pdf` 隔离并返回创建视图，旧 PDF 记录默认 Original。非 MinerU 重排预览不再在第 12 块截断，因此长文后半部分及 Paper 译文都可直接选择和标注。第三个工作区按 macOS 命名为 Overview，并把原先散落在 Paper 的阅读地图、提取质量 Review 与 AI 双语摘要合到同一页；内部仍接受旧 `Summary` 状态，已保存位置无需迁移。

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
