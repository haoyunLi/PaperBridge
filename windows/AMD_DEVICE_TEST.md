# Windows AMD 真机回归（2026-09-20）

这份记录来自本机 Windows 11 Pro（build 26200）、AMD Radeon RX 7800 XT（驱动 32.0.31035.1003，16 GiB 显存）。集成显卡是 AMD Radeon Graphics。测试使用 Ollama 0.34.2、`translategemma:4b` 和 MinerU 3.4.5。生成的工作区、报告与截图保存在被 Git 忽略的 `test-artifacts/`。

## 翻译与 AMD 加速

Ollama 的服务日志将 RX 7800 XT 识别为 `ROCm gfx1101`，并跳过集成显卡。模型加载后，`/api/ps` 报告模型占用的 2.68 GiB 全部在 VRAM。这里的 GPU 结论同时有运行时后端日志与实际显存分配作为依据。

使用 Windows 版相同的提示词与 `temperature: 0.1` 测试英文到简体中文、中文到英文、医学统计与 Markdown：

| 测试 | 本机观察 |
| --- | --- |
| 随机对照试验、95% 置信区间、`p < 0.01`、`[12]` | 保留数值、单位、显著性符号和引用标记；首次冷启动约 4.6 秒。引用标记的位置发生了变化，仍需人工审校。 |
| 单细胞 RNA 测序与 CD8+ T 细胞 | 术语保留，否定因果关系的语义保留。 |
| 中文到英文 | 英文结果通顺，保留“样本量不足以证明因果”的意思。 |
| Markdown 公式与图片 | `$\beta=0.42$` 与 `![Figure 1](figures/flow.png)` 原样还原。 |
| 热模型速度 | 约 0.22–0.44 秒/短段；约 121–130 输出 token/秒。数字只代表这台机器和这些短段。 |

真实 PaperBridge Reader 按钮完成翻译，结果写入本地论文工作区。整段解释、三种阅读显示模式、摘要、独立全文翻译及关闭重启后的恢复也经界面验证。摘要最初生成 6 条主张但 0 条精确匹配来源；现在先要求 JSON，再按模型指出的段落逐条取原文精确摘录，并且只在原段落确实包含摘录时建立链接。练习论文重测得到 6 条主张、6 条精确匹配来源；精确匹配本身不能证明主张正确。

运行方式：`npm run test:live`。此命令要求本机 Ollama 已运行且已安装 `translategemma:4b`；可用 `PAPERBRIDGE_LIVE_MODEL` 和 `PAPERBRIDGE_LIVE_OLLAMA` 指定其它本地模型与回环地址。

## 真实 PDF 与 MinerU

使用 [Attention Is All You Need](https://arxiv.org/abs/1706.03762) 的 15 页 PDF 测试了双栏、公式、图片和表格。AMD 上 MinerU 使用 CPU pipeline；应用自动导入约 83 秒，旧版粗分段生成 153 个阅读块，并保留 167 个 PDF.js 文本块。修正按行分段后，同一份 MinerU Markdown 得到 163 个阅读块，其中 25 个标题、5 张图、4 张 HTML 表和 5 个独立公式分别保留为独立结构；图注和表注成为可翻译段落。原 PDF 页面可正常打开，MinerU 辅助文件也被保存。

修正后重开这份实际 MinerU 输出，Paper 和 Reader 都显示 11 处上标、5 张图、4 张表及 5 个独立公式；`Vaswani∗` 可跨上标精确选中并显示高亮。合成论文另验证了恶意 HTML 属性被过滤、图片仍加载、选区笔记偏移正确，以及阅读字号、行距和宽度能用于 Paper 预览。运行方式：先运行 `npm run build`，再运行 `npm run test:reopen-mineru` 和 `npm run test:markdown`。重开测试复用已解析的 Markdown，不重新耗时解析 PDF。

再运行 `node tests/reopen-mineru.cjs --translate`，在真实 Reader 中分别翻译图 1 图注和表 1 表注，得到中文译文；对应的图片和 HTML 表格块没有进入翻译队列，原始资源内容不变。Ollama `/api/ps` 同时报告模型在 AMD GPU VRAM 占用 2.68 GiB。此回归使用已解析论文，仍只代表这一台 AMD 电脑和这两个图表说明。

首次自动导入失败后回退到 PDF.js。原因是 MinerU 在临时输出路径中重复 PaperBridge 的 64 位哈希文件名，使 Windows 路径过长。现使用短名临时副本和短输出路径解析，再将辅助文件复制到论文工作区；原 PDF 始终保持原样。修复后重跑同一 PDF，自动 MinerU 导入成功。

运行方式：把测试论文放在 `test-artifacts/attention-is-all-you-need.pdf`，然后运行 `npm run test:live-mineru`。也可设置 `PAPERBRIDGE_LIVE_PDF` 和 `PAPERBRIDGE_LIVE_MINERU`。

## 图像型扫描 PDF 的 OCR 与翻译

`npm run test:live-ocr` 使用私有 Python 和 Pillow 生成单页**只有图像、没有文字层**的 PDF，再通过 Windows 应用的默认 MinerU preferred 导入。应用保存的 PDF.js 文本块为 0，MinerU CPU pipeline 在本机几次运行中约 33–51 秒识别出 5 个阅读块；Reader 中的 “Researchers measured…” 段落随后经 `translategemma:4b` 译为中文。Original 原页显示“Open OCR Reader”，点击可返回识别后的段落。测试复核了本机 Ollama `/api/ps`：模型大小和显存分配均为 2,875,656,764 字节，表明这次翻译运行在 AMD GPU 上。生成 PDF、独立工作区及报告位于被 Git 忽略的 `test-artifacts/`。

此测试覆盖清晰的英文图像页。低分辨率、倾斜页面、手写体、中文扫描件和复杂多栏扫描件的 OCR 质量仍需逐项验证。可通过 `PAPERBRIDGE_LIVE_MODEL`、`PAPERBRIDGE_LIVE_OLLAMA` 和 `PAPERBRIDGE_LIVE_MINERU` 指定本地环境。

## 一键安装和其它回归

本机从无 Ollama、无 MinerU 的状态开始安装。发现并修复两处真实安装问题：Windows PowerShell 被继承的模块路径干扰，导致真实有效的 Ollama 签名被误判；uv 在解压出有效 Python 后，创建次版本快捷链接时报错。签名校验现在只加载 Windows 系统模块；MinerU 安装可以直接验证并使用私有 Python 3.12 解释器。最终一键安装返回 Ollama 模型就绪、MinerU 3.4.5 就绪、MinerU backend `pipeline`。

该阶段回归：53 个单元测试通过；Electron 工作流测试、双论文任务设置与解释缓存恢复、真实 MinerU Markdown 重开测试和 HTML 安全/选区测试通过；双页同词 PDF 的独立标注、导出及重启恢复通过；真实 Ollama 翻译/解释/摘要复测通过，模型 2.68 GiB 全部驻留 AMD VRAM；真实 MinerU 论文图表说明翻译，以及图像型扫描 PDF 的 OCR 到中文翻译复测通过。NSIS 与 portable 安装包重新构建成功，打包程序启动测试通过。Windows 验签结果确认两个安装包目前均未签名。

本次仅验证了一台 AMD 机器、一篇复杂论文和一页清晰扫描图像。NVIDIA CUDA、无独显、复杂扫描件 OCR、其它模型、长论文摘要的来源覆盖率、Mac 与 Windows 同机逐项对照、正式签名与 Windows Release 更新安装仍在 [功能映射](FEATURE_MAPPING.md)中保留为待验收项。

## 整体功能审查后的设备回归

2026-09-20（本机时区）再次执行 `npm run test:live-ocr`：真实 MinerU 提取加 Ollama 翻译共 50.8 秒。输入没有文字层，`pdfBlocks=0`、`mineruBlocks=5`，生成的中文译文为“研究人员测量了陶瓷样品对变化的磁场反应。磁场从零提升到两特斯拉，并在多次试验中进行。”本轮模型大小和 VRAM 占用仍均为 2,875,656,764 字节。

本轮同时补充模型/语言缓存切换、撤销保留后写译文、选区结果隔离、最近打开论文、模型下载取消/重试、导入取消及手动 OCR 保留文档结果的自动回归。安装包已重新构建，打包程序启动测试通过；NSIS 和 portable 的 Authenticode 状态均为 `NotSigned`。具体已修复和仍需对齐的项目见 [整体审查记录](WHOLE_APP_REVIEW.md)。

## Settings 与自动发现补齐后的设备复测

2026-09-21 再次执行 `npm run test:live-ocr`，测试没有传入 `PAPERBRIDGE_LIVE_MINERU`，保存设置中的 `mineruExecutable` 也为空，因此必须走应用统一的自动发现 resolver。应用找到私有 MinerU 3.4.5，runtime 检查为 `checked=true`、`cuda=false`，符合这台 AMD 机器使用 MinerU CPU pipeline 的设计。

这次图像型 PDF 的真实提取与翻译约 **40.7 秒**：`pdfBlocks=0`、`mineruBlocks=5`，Reader 获得中文译文；`autoDetectedMineru=true`。Ollama `/api/ps` 再次得到 `modelBytes = modelVramBytes = 2,875,656,764`，说明翻译模型在 RX 7800 XT 的 AMD GPU 显存中完整加载。自动测试同时验证 Settings 的硬件重新检测、九张推荐卡、四个任务模型和下载跨分页取消/恢复。

当前自动回归为 **83/83 单元测试**；真实 NSIS 最终包还完成了首装、应用内保存论文/高亮/笔记、同版本重装后恢复、卸载并保留论文数据。NSIS、portable 与 unpacked 主程序仍为 `NotSigned`。这些新增证据解决了“本机自动发现是否真的用于 OCR”和“真实安装器是否保留数据”，不扩大到 NVIDIA CUDA、其它 AMD 卡或复杂扫描件质量。

## macOS 1.10 对齐后的设备复测（2026-11-06 UTC）

当前 Windows 构建通过 `npm run test:live`。用真实 Reader 选中 `fictional practice document`，TranslateGemma 4B 只返回“虚构的练习文档”。同次测试覆盖段落翻译、段落解释、全文译稿及重启恢复。摘要有 6 条来源摘录逐字匹配原段落。统计段的译文保留数值和引用，但对照组与显著性符号的关系仍需人工核对。

Ollama 0.34.2 日志确认选择 `ROCm0 (AMD Radeon RX 7800 XT)`，`/api/ps` 报告模型大小与显存占用均为 2,875,656,764 字节（2.68 GiB）。热模型短段实测约 121–124 输出 token/秒，首次统计段请求耗时 4.62 秒。

本轮 `test:live-ocr` 在启动前发现本机私有工具目录缺少 MinerU，真实 OCR 仍需重新安装后复测。当前构建的 `test:import-progress-e2e` 使用受控 MinerU 响应，通过了文件名、阶段计数、取消及旧论文保护检查。

## MinerU 4.1.7 一键安装与 DirectML（2026-11-06 UTC）

从空工具目录在 Electron 的 **Local AI setup** 仅安装 MinerU。界面报告完成，用时 47.5 秒，测试复用了此前命令行试跑的模型下载缓存。自动发现识别到私有 MinerU 4.1.7，诊断报告选择 `AMD Radeon RX 7800 XT`。首次安装发现 MinerU 拒绝尚不存在的显式配置文件，改用私有目录下的默认配置路径后通过。

同版本命令行日志显示 `layout` 和 `ocr_rec` 会话使用 `DmlExecutionProvider`，并选中 RX 7800 XT；`ocr_det` 使用 CPU。Windows 界面导入合成扫描件，得到 `pdfBlocks=0`、`mineruBlocks=5`，通过 Reader 翻译并验证 Original 页可跳回 OCR Reader。导入、翻译和界面导航合计 16.0 秒。Ollama 日志报告 ROCm，`translategemma:4b` 的模型大小和显存占用均为 2,875,656,764 字节。识别文本有一处 `fieldwas` 连字，译文保留了磁场由零升到两特斯拉的含义。

同一安装在界面导入 15 页 Attention Is All You Need，38.8 秒内完成提取及原 PDF 页渲染检查。工作区保存 167 个 MinerU 阅读块，含 5 张图片、4 张表格（2 张 HTML、2 张 Markdown）和 5 个独立公式。另用相同本地 CLI 强制 ONNX CPU 解析扫描件，日志确认版面分析、检测和文字识别均使用 CPU，输出包含预期的实验段落。

复跑时将 `PAPERBRIDGE_TOOLS_ROOT` 指向一个新绝对路径，设置 `PAPERBRIDGE_LIVE_INSTALL_MINERU=1` 和 `PAPERBRIDGE_LIVE_DIRECTML=1`，启动本地 Ollama 后执行 `npm run test:live-ocr`。

## 结构化全文与便携导出（2026-11-06 UTC）

再次用空 MinerU 路径导入同一合成扫描件，自动发现 4.1.7 并提取 5 个块。用 `translategemma:4b` 先译 Reader 的实验段落，再生成全文，原有译文逐字保留在保存的全文稿中。其余 4 个块约 1.4 秒完成，含 OCR、翻译和视图导航的流程共 21.9 秒。Ollama 再次确认 RX 7800 XT 的 ROCm 路径和 2.68 GiB 显存驻留。

在独立工作区重开已解析的 15 页论文，通过 Electron 界面导出便携包。核对了 15 张可识别的 PNG（宽、高均大于 500 像素）、5 个带相对路径的图片资产、Markdown 中的表格与公式，以及导出 PDF 和工作区原 PDF 的 SHA-256 一致。

## PDF 文字层的全文分批与重启续跑（2026-11-06）

复用 Attention Is All You Need 的 15 页测试工作区副本，通过界面切换到 PDF 文字层，开始全文翻译。第 1 批译文保存后停止并关闭应用。重启后只处理剩余 6 批，第 1 批逐字保留。最终共 7 个翻译批次，均成功，停止和重启在内约 74.3 秒。Ollama 日志再次确认 ROCm，模型大小和显存占用均为 2,875,656,764 字节。此流程核验了持久化、续跑和实际显存分配，译文质量仍需人工审校。

复跑需先完成 DirectML 版的 `test:live-mineru`，再启动本机 Ollama 并运行 `npm run test:live-connected`。测试会复制工作区并在副本中覆盖逐论文模型与回环地址。
