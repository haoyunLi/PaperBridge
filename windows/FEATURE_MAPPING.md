# PaperBridge macOS 1.9 ↔ Windows 0.2 功能逐项映射

固定基线：macOS 1.9 commit `73951d9` 与本分支 `windows/` 的 0.2 实现，核对日期 2026-09-20。共 111 项：**43 对齐、68 部分、0 缺失**。本表按**用户可执行的动作与可观察的结果**拆分；同一行出现入口只代表有代码路径，不代表结果已经等价。`对齐`指静态代码核对显示主要行为等价，`部分`指有可用路径但缺少列出的行为，`缺失`指没有对应路径。[AMD 真机报告](AMD_DEVICE_TEST.md)已覆盖一台 RX 7800 XT、真实翻译、一篇复杂论文，以及单页图像型扫描 PDF 的 OCR 和译文；Electron 回归另覆盖重复文字、双页 PDF 同词不同标注、无文字层 PDF 的 OCR 引导、空 MinerU 结果降级、逐论文任务设置、导出及重启恢复。其它硬件、复杂扫描件、Mac 逐项对照和正式签名仍需验证。

macOS 1.9.1 的 12 项新增行为单独记录在 [MAC_1_9_1_GAPS.md](MAC_1_9_1_GAPS.md)，当前为 **12 对齐、0 部分、0 缺失**。笔记可靠性、50 条 Back / Forward 与完整位置恢复，以及独立标题分类、紧凑双语翻译/重试、标注、解释和导出均有专项自动化证据；这里的 111 项历史统计不回写。

本轮 [全软件复查](WHOLE_APP_REVIEW.md)最初对比 `73951d9`，记录了修复及验证。macOS 主分支随后前进到 1.9.1 commit `33cfb933`；新增的 12 项行为在 [1.9.1 增量差距报告](MAC_1_9_1_GAPS.md)中单独跟踪，不回写这张 1.9 历史基线的 111 项统计。

源代码入口：[Mac 主界面](../PaperBridge/ContentView.swift)、[Mac 阅读模型](../PaperBridge/PaperReaderViewModel.swift)、[Mac 选择与标注](../PaperBridge/PaperReaderViewModel+Selection.swift)、[Mac 图书馆](../PaperBridge/PaperReaderViewModel+Library.swift)、[Mac 设置](../PaperBridge/Views/SettingsView.swift)、[Windows 界面](src/main.jsx)、[Windows PDF 提取](src/pdf.mjs)、[Windows 本地安装](electron/setup.cjs)、[Windows 本地存储](electron/storage.cjs)。

## A. 导入、解析与原文保真

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| A01 | 文件对话框打开 PDF | Open PDF 对话框 | 对齐 | 真实文件含空格、中文路径可打开。 |
| A02 | 将 PDF 拖进窗口导入 | 窗口拖放 PDF 走同一导入与 SHA-256 去重；多文件选择首个 PDF | 对齐 | Electron 流程验证单文件、混合文件拖入及重复恢复；忙时不启动冲突导入。 |
| A03 | 粘贴全文并按段落建文档 | Paste Text | 对齐 | 保留章节和段落顺序。 |
| A04 | 无模型时试用虚构练习论文 | 有论文打开时保留原工作区并提示 | 对齐 | 练习论文只从空工作区创建。 |
| A05 | 重复打开同一 PDF 恢复原工作区 | SHA-256 去重并载入保存文档 | 对齐 | 验证编辑、翻译、标注均未覆盖。 |
| A06 | 重新提取为新的图书馆副本 | More 中重新提取为独立副本 | 对齐 | Electron 流程验证原副本保留且图书馆新增一项。 |
| A07 | 导入时自动优先 MinerU | 默认 MinerU preferred，导入自动检测并解析 | 部分 | 15 页双栏论文和单页图像型扫描 PDF 已在 AMD/CPU pipeline 自动解析；更多真实扫描件待验证。 |
| A08 | MinerU 失败自动降级，并说明原因 | MinerU preferred 失败或返回空块时保留 PDF.js 可用文本并说明原因 | 部分 | 合成空结果回归通过；真实失败和 OCR 设备路径待验证。 |
| A09 | MinerU only / MinerU preferred / PDFKit only 三种模式 | Settings 提供 MinerU only / preferred / PDF only | 部分 | 三模式已有代码路径；真实 MinerU-only 失败行为待验证。 |
| A10 | MinerU 多栏正文阅读顺序 | MinerU Markdown 或 PDF.js 简单双栏排序 | 部分 | 一篇双栏论文的标题顺序已核对；跨栏图、脚注及 Mac 对照仍待验收。 |
| A11 | 图片、表格、独立公式、代码随正文交错 | 按行拆出独立资源块，图表说明保留为可翻译段落；安全渲染 HTML | 部分 | 15 页论文重开验证 5 图、4 表、5 独立公式均按源顺序出现在 Paper/Reader；其它论文的复杂 HTML/代码仍待验收。 |
| A12 | 公式、图片路径、URL、代码、HTML 翻译前保护 | `protectMarkdown` / `restoreMarkdown` 包括代码围栏、整张 HTML 表格、行内标签及多种公式 | 部分 | 单元测试覆盖 token 还原；更多模型对复杂结构的输出位置仍待验收。 |
| A13 | 原 PDF 无修改保存并原样查看 | 复制原 PDF，PDF.js canvas + text layer | 对齐 | 像素、页数和可选文字与源文件一致。 |
| A14 | 无文字层的扫描件仍可看原 PDF | 原 PDF 保留画面与翻页；无文字层时 Paper、Reader、Original 显示 OCR 引导，OCR 完成后原页可直接跳到 OCR Reader；翻译/摘要/全文任务在无文本时禁用，缺少 MinerU 则进入一键安装 | 部分 | 空白无文字层 PDF 引导和单页图像型 PDF 的真实 OCR、翻译已验证；复杂扫描件的 OCR 质量仍待验收。 |
| A15 | PDFKit 便携页面图片（最多前 120 页） | 导出 bundle 时逐页渲染 PNG，最多 120 页 | 部分 | Electron 测试覆盖单页；长 PDF 页面尺寸、取消和空间占用待验证。 |
| A16 | 跨页断词、断句修复 | 页内断词处理，并保守拼接跨页未完句与断词 | 部分 | 公式、复合词及双栏跨页仍需真实论文对照。 |
| A17 | 重复页眉、页脚、图表标签过滤 | 按跨页重复签名过滤页眉、页脚和页码 | 部分 | 与 Mac 同类启发式；图表标签和复杂排版仍需验证。 |
| A18 | 提取质量警告定位到 Reader 段落 | Overview 列出可疑段落和 Review 跳转 | 部分 | 启发式规则仍需双栏及扫描件回归。 |
| A19 | 尾部参考文献或中途参考文献智能排除 | 参考文献区从正文翻译和摘要队列排除 | 部分 | 中途参考文献与后续章节边界仍需论文验证。 |
| A20 | MinerU 资源目录与原 PDF 持久化 | 原 PDF 持久化；图片转 data URI，另留 MinerU 输出目录 | 部分 | 资源可跨重启引用，丢失资产时报告且可恢复。 |

Mac 证据：[解析路由](../PaperBridge/PaperReaderViewModel.swift#L1547)、[PDF 文本修复](../PaperBridge/Services/PDFTextExtractor.swift)、[Markdown 结构](../PaperBridge/Services/AcademicMarkdownProcessor.swift)、[原页归档](../PaperBridge/Services/PDFVisualArchiveService.swift)。Windows 证据：[导入与手动 MinerU](src/main.jsx)、[PDF.js 提取](src/pdf.mjs)、[Markdown 按行分段](src/academicMarkdown.mjs)、[原 PDF 复制](electron/main.cjs#L105)。

## B. 工作区、阅读与导航

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| B01 | 三栏：文档侧栏、正文、研究检查器 | 三栏布局 | 对齐 | 窄窗口各面板仍能使用。 |
| B02 | Paper / Reader / Overview / Full Translation 工作区 | Paper 完整文档预览、Reader、Overview（阅读地图、质量检查与双语摘要）、Full Translation，另有 Original；内部保留旧 `Summary` 状态值兼容已保存位置 | 对齐 | Original 是 Windows 额外的原生 PDF 工作区。 |
| B03 | Paper 中切换精确 PDF 与 MinerU 结构化页面 | Paper 的 Original 模式直接复用精确 PDF 画布/文字层，Bilingual / Translation 显示完整结构文档；Windows 另保留 Original 标签 | 对齐 | Paper 内即可完成 Mac 对应切换，额外 Original 入口不改变 Paper 行为。 |
| B04 | 双语、仅原文、仅译文三种阅读模式 | 双语、仅原文、仅译文并逐论文保存 | 对齐 | Electron 流程验证三模式切换。 |
| B05 | 问题、方法、证据、讨论、结论的原文阅读地图 | Overview 使用 Mac 同组五类规范化标题、问题提示和精确原文摘录；只在当前章节内找正文，无标题时回退开篇，并提供 Reader 精确跳转、Start Reading、View Original、翻译进度及来源免责声明 | 对齐 | 单元测试覆盖编号/罗马数字标题、拒绝宽松子串误匹配及不借用下一章节正文；Electron 实际验证段落跳转和 Original 模式。 |
| B06 | 章节大纲跳转 | 侧栏 OUTLINE，跳转前清除 Reader 搜索 | 对齐 | 搜索后目录跳转已回归；复杂 MinerU 标题层级仍需验证。 |
| B07 | 段落书签及侧栏文字预览 | 书签按钮与侧栏摘要 | 对齐 | 解析来源切换后位置应保持。 |
| B08 | Reader 顶部搜索、清除后回到原位置 | 搜索前记录滚动位置并在清空时恢复；目录、书签和来源跳转先清搜索 | 部分 | 搜索后目录跳转已回归；跨标签与复杂重排仍需验证。 |
| B09 | Paper/PDF/Markdown/Reader 各自保存阅读位置 | 逐视图滚动位置、PDF 逐页滚动位置、段落和页码保存；Reader 滚动更新可见段落 | 部分 | 长文无点击滚动已验证当前章节更新；Markdown 内部锚点和复杂页面重排仍需验证。 |
| B10 | 标注跳转校验锚点有效性 | 检查器验证 Reader 块、PDF 页码/偏移与 Markdown 原文偏移，定位后选回原文；失效锚点保留并提示检查 | 部分 | Reader 重复词、译文选区和失效笔记回归通过；跨版本 Markdown 重排与真实长 PDF 仍需验证。 |
| B11 | 显示/隐藏左右侧栏 | 两侧切换按钮 | 对齐 | 面板切换不丢当前阅读位置。 |
| B12 | Focus Reading 退出后恢复进入前的面板状态 | 焦点阅读进入前保存左右面板状态，退出恢复 | 对齐 | 面板状态切换已实现。 |
| B13 | 窄窗口检查器改为底部布局 | 与 Mac 相同在 `<1400px` 切换为独立底部抽屉，按窗口高度限制为 190–340px；选区和解释/已存标注分成可独立滚动的两列，宽窗口恢复 330px 右侧检查器 | 对齐 | Electron 自动验证 980×620、1320×820、1500×820 及运行时跨断点切换；仍随整软件继续做更多 Windows DPI 真机目视验收。 |
| B14 | 字号、行距、阅读宽度调节 | Settings 三项滑块用于 Reader、Paper 和 Full Translation 文字预览 | 对齐 | Electron 检查 21px、1.9 行距、700px 宽度；原 PDF 几何不受文字预览样式影响。 |
| B15 | 提取段落的质量提示与 Review 链接 | Overview 与阅读地图、摘要同页展示 A18 质量提示和 Reader Review 跳转 | 部分 | 识别率与复杂论文验证待完成。 |
| B16 | 结构化 Markdown 公式/表格本地预览 | React Markdown、KaTeX、GFM，加受限 HTML 渲染 | 部分 | 15 页论文的 11 处上标、4 张表、5 张图、5 个独立公式已在 Paper/Reader 验证；更多排版仍待验收。 |

Mac 证据：[工作区、搜索与位置](../PaperBridge/ContentView.swift#L480)、[阅读地图](../PaperBridge/Services/ReadingGuideBuilder.swift)、[Markdown 预览](../PaperBridge/Views/MarkdownPreviewView.swift)。Windows 证据：[导航与阅读界面](src/main.jsx#L338)、[阅读地图](src/text.mjs)、[显示状态](src/main.jsx#L94)。

## C. 段落翻译与全文翻译

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| C01 | 源/目标语言可选、可交换 | Settings 中 11 语言与 Swap | 对齐 | 各语种语言代码在 Ollama 提示中正确。 |
| C02 | 分段逐项翻译并原/译对齐 | `translateBlocks` 逐块保存，独立普通/Markdown 标题也进入队列并紧凑对齐 | 部分 | 图片资源继续保留原结构；更多复杂 Markdown 与真实模型待并排验收。 |
| C03 | 长段在句界分块，结果仍为一个段落 | `chunkText` 再拼接；Settings 提供逐论文 500–6000 字符分块滑块 | 部分 | 设置恢复与缓存隔离已回归；超长单句、公式和多语标点仍需验证。 |
| C04 | 单段失败隔离，其他段继续 | 每块 try/catch，状态 failed | 对齐 | 单块失败不阻断队列。 |
| C05 | 只恢复 pending/failed，不重译 ok | 队列过滤 `status !== ok`，结果按语言、模型、地址、分块和来源版本保存 | 对齐 | 更换设置不把旧译文当作新任务已完成；切回且原文匹配时恢复结果。 |
| C06 | 单段 Retry | 块级翻译/Retry 按钮 | 对齐 | 成功块保持不变。 |
| C07 | 停止请求并保留已完成翻译 | 统一任务身份、Ollama Abort 和导入取消；运行中阻止冲突导入/切换 | 部分 | 延迟 MinerU 成功/失败和选区改选隔离已回归；真实 Ollama 长队列与复杂导出取消仍需验证。 |
| C08 | 当前任务进度与失败数量 | Windows 显示线性进度条、已处理数、侧栏总失败数及单块错误；无总量时显示不确定进度 | 部分 | Electron 流程已验证翻译块完成后进度增长；长任务失败数需真机回归。 |
| C09 | Abstract & Conclusion 范围 | Translation Range 同名选项；没有待译块时禁用，计数与实际队列一致 | 部分 | 复杂标题导致的章节误检仍需验证。 |
| C10 | 当前章节范围 | Translation Range 使用滚动后当前可见段落所属章节 | 部分 | 长文纯滚动切换章节回归通过；复杂排版和高 DPI 仍需验收。 |
| C11 | 任意检测章节选择翻译 | Translation Range 列出检测章节及精确未完成数，空章节禁用 | 部分 | 复杂标题检测待验证。 |
| C12 | 所有未完成块 | All unfinished blocks | 对齐 | 包含可翻译标题，排除资源块与参考文献区。 |
| C13 | 正在翻译时将当前章节插队 | 运行时可把当前章节插入剩余队列前端 | 部分 | 异步取消及真实 Ollama 长队列待验证。 |
| C14 | 连贯全文翻译是独立可选任务 | Full Translation 单独按钮与保存 | 对齐 | 不自动替代段落翻译。 |
| C15 | 全文翻译保留原 Markdown 非语言块与共享译稿 | 独立 connectedBlocks 译稿保留 Markdown 资源，并供导出 | 部分 | 结构化 Markdown 全文与 Paper 同步仍需复杂论文验证。 |
| C16 | 上下文分批与失败块保留原文 | 逐块上下文翻译、进度保存与失败原文保留；全文输出和标注按设置/来源版本保存 | 部分 | 设置切换与原文失效已有单元回归；真实长文恢复及失败重试仍待验证。 |
| C17 | 按方向匹配保存术语注入提示 | `matchingTerms` 限 24 条 | 对齐 | 已完成译文不被术语更新静默覆盖。 |

Mac 证据：[段落队列与全文翻译](../PaperBridge/PaperReaderViewModel.swift#L741)、[翻译范围菜单](../PaperBridge/ContentView.swift#L633)、[结构化保护](../PaperBridge/Services/AcademicMarkdownProcessor.swift#L273)。Windows 证据：[翻译任务](src/main.jsx#L191)、[全文翻译](src/main.jsx#L253)、[范围菜单](src/main.jsx#L403)。

## D. 摘要、解释与证据

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| D01 | 原文语言与目标语言双摘要 | Summary 生成 source/target | 对齐 | 两种语言与设置匹配。 |
| D02 | 长文分批摘要再合并 | Windows 6000 字分批再合并 | 部分 | 分批不漏结尾和中途章节。 |
| D03 | 编号 claim 与来源摘录 | JSON claim、来源 quote 与块 ID 结构化保存；真实模型漏 quote 时逐段提取并精确校验 | 部分 | AMD 实测练习论文 6 条 claim 均有精确来源；长论文和其它模型仍待验证。 |
| D04 | 引文必须与原段落精确匹配 | 来源 quote 必须逐字匹配真实块 | 对齐 | 单元测试覆盖虚构来源不能生成链接。 |
| D05 | “Check the Sources” 列出每条验证结果 | 逐条 claim 展示已验证摘录或未验证提示 | 对齐 | 旧摘要也标明无验证证据。 |
| D06 | 点击有效证据回到确切原文段落 | 只有 quote 匹配后来源链接才可跳到块 | 对齐 | 不接受仅凭模型给出的块 ID。 |
| D07 | 旧版摘要无证据结构时仍可阅读 | 普通字符串摘要可读取 | 对齐 | 标为未验证，重新生成时升级。 |
| D08 | 单段解释、可单独选择解释语言 | 选区和整段解释共用独立解释语言；缓存按论文、段落原文、模型、地址、语言保存 | 对齐 | French 选区提示、模型切换和旧缓存迁移已回归；原文不匹配时不显示旧解释。 |
| D09 | 摘要标明 AI 输出不能证明科学结论 | 摘要显式展示证据验证状态 | 对齐 | 未验证 claim 不产生来源链接。 |

Mac 证据：[摘要生成](../PaperBridge/PaperReaderViewModel.swift#L1040)、[证据校验](../PaperBridge/Services/SummaryEvidence.swift)、[检查来源 UI](../PaperBridge/ContentView.swift#L1460)。Windows 证据：[摘要生成](src/main.jsx#L234)、[摘要 UI](src/main.jsx#L382)。

## E. 选区、标注、术语与检查器

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| E01 | Reader 原文/译文选区 | Reader DOM 选区 | 部分 | 译文 Markdown 选区也能正确找回来源。 |
| E02 | Paper 结构化 Markdown 选区 | Paper 三种显示模式均按块/原译文侧定位选区，重复文字保留精确偏移；笔记/高亮保存 Paper 作用域并只在 Paper 对应侧显示 | 部分 | 跨块选区及格式复杂时的 Markdown 原文偏移仍需补齐。 |
| E03 | 原 PDF 可选文字按页/偏移锚定 | Paper 精确 PDF 与 Original 标签分别按 scope、页码、页内偏移与原文保存笔记/高亮；导航时回到创建视图并校验原文，失效则保留并提示 | 部分 | 同页同词跨 Paper/Original 隔离、双页同词不同色、跳转与重启回归通过；真实长 PDF 的跨行选区和扫描件仍需验收。 |
| E04 | 双语摘要两侧选区 | 两侧选区可查词、解释、保存笔记；三色高亮正文可见，列表可跳回选区 | 部分 | 复杂 Markdown 和源文重排时的显示偏移仍需验收。 |
| E05 | Full Translation 选区 | 全文译稿可查词、解释、保存笔记；三色高亮正文可见，列表可跳回选区 | 部分 | 复杂 Markdown 和译稿重生成后的锚点仍需验收。 |
| E06 | 选中文字即时翻译 | 检查器 Translate 按原/译文侧决定方向并匹配对应术语 | 部分 | 反向术语保存已回归；复杂上下文、模型过度延伸与 Mac 输出仍需比较。 |
| E07 | 选中文字解释 | 检查器 Explain 使用独立解释语言和对应侧上下文，结果绑定当前选区 | 对齐 | 延迟 A 请求后改选 B 不显示 A 结果，French 提示已验证。 |
| E08 | 快速查词独立模型 | Settings 独立 quick lookup model 并纳入安装检测 | 对齐 | 四套模型分别配置。 |
| E09 | 查词结果按选区与语言缓存 | 按论文、选区、上下文、方向、模型、地址、解释语言及匹配术语缓存本次会话结果；Quick Selection 与完整检查器都显示进行中、取消、完成、缓存命中和局部错误状态 | 部分 | 自动回归验证主动取消后迟到结果不显示、重试完成及同键缓存命中；跨重启持久化及复杂 Markdown 原文变更仍需验收。 |
| E10 | 选区延伸保护与上下文边界 | 仅截取 DOM 字符串并限 3000 字 | 部分 | 不跨无关段落或抓取错误上下文。 |
| E11 | 三种颜色高亮 | Amber / Cobalt / Coral 三色按精确偏移保存；同一选区换色会替换原色，Reader、Paper、PDF、摘要和全文译稿均在正文显示；旧 `blue` 数据继续按 Cobalt 渲染 | 部分 | 真实 MinerU 上标已验证；更多 PDF 跨行与 KaTeX 混排仍需验收。 |
| E12 | 删除高亮保留笔记 | 检查器和 Quick Selection 均提供显式 Remove Highlight；只清除同一精确选区的颜色，笔记保持，支持会话撤销 | 对齐 | Reader Electron 流程验证换色、删除、笔记保留及逐步撤销。 |
| E13 | 为选区创建、更新、删除笔记 | Reader 同选区笔记可创建、更新、删除 | 对齐 | 标注清单提供删除入口。 |
| E14 | 标注列表、预览、跨工作区跳转 | 检查器区分 Paper/Reader 原译文、Paper exact PDF/Original PDF、摘要与全文译稿；均可返回创建视图并精确重选，Paper 译文恢复 Bilingual | 部分 | 复杂 Markdown、跨节点与跨块坐标仍需更多真实论文验收。 |
| E15 | 标注位置失效时保留笔记并标明需检查 | Reader 失效选区不跳错文字，保存笔记并标记 needsReview；PDF 与视图锚点也校验 | 部分 | 合成失效笔记回归通过；更多编辑和跨视图路径仍需验证。 |
| E16 | 高亮/笔记更改撤销 | 最多 20 次变更记录，仅还原相关注释/书签字段 | 部分 | 书签→翻译→撤销不会丢译文，后来便签修改保留；复杂混合操作和重启仍需验收。 |
| E17 | 精确选区注释跨分段编辑迁移 | 拆分、合并、编辑迁移原文精确锚点 | 部分 | 重排及 Markdown 结构化编辑仍缺。 |
| E18 | 保存术语及语言方向 | 各视图 Save term 按选区侧决定方向，同词同方向替换 | 对齐 | Chinese→English 和重复替换已回归；160/300 字及 500 条上限报错，不静默截断或删除旧项。 |
| E19 | 术语搜索、审阅和删除 | 术语列表按原词或译词搜索、删除 | 对齐 | 索引按当前术语数组执行。 |
| E20 | 紧凑选区工具条和展开检查器 | 检查器关闭时显示底部 Quick Selection：选文预览、翻译、解释、三色高亮/移除、保存术语、取消任务及 Notes & More；检查器打开时不重复显示，滚动后自动收起 | 对齐 | Electron 验证 1320×820 与 980×620 完整可见、直接存术语、展开检查器，以及同一选区翻译/解释结果并存。 |
| E21 | 检查器隐藏/显示 | 顶部按钮 | 对齐 | 窄窗口与焦点模式状态一致。 |

Mac 证据：[选区行为](../PaperBridge/PaperReaderViewModel+Selection.swift)、[检查器与标注列表](../PaperBridge/Views/SelectionInspectorView.swift)、[选区数据模型](../PaperBridge/Models.swift#L420)。Windows 证据：[选区与注释](src/main.jsx#L305)、[检查器](src/main.jsx#L386)。

## F. 手工修复、图书馆与恢复

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| F01 | 手动改段落原文 | Reader 编辑源文，MinerU 结构化块禁用 | 部分 | 复杂编辑后的全文译稿与摘要仍需回归。 |
| F02 | 按安全边界拆分段落 | Windows 在句号附近 Split | 部分 | 拆分后标注、书签、译文失效语义正确。 |
| F03 | 与前段合并 | 与前段合并并迁移笔记/高亮 | 部分 | 标题和资源跨界合并仍需验证。 |
| F04 | 与后段合并 | 与后段合并并迁移标注 | 对齐 | 复用同一安全合并逻辑。 |
| F05 | 对选中段落重排文字 | 按完整句边界将长段重排为短段 | 部分 | 笔记和高亮迁移已测试；真实论文复杂标点待验证。 |
| F06 | 段落编辑撤销 | 恢复原结构及受影响段落原译文，保留未改段落新输出和当前设置，后写摘要/全文保留并标过期 | 部分 | 拆分/合并、后写便签和旧锚点已单元回归；复杂真实论文和重启仍需验收。 |
| F07 | MinerU 结构化段落禁止破坏性编辑 | MinerU 来源禁用编辑、拆分、合并 | 对齐 | 避免 Markdown 资源锚点被直接破坏。 |
| F08 | 图书馆搜索标题与标签 | 搜索框及 library 弹窗 | 对齐 | 中文/大小写、空结果验收。 |
| F09 | 打开旧论文恢复结果、标注、阅读位置 | 恢复结果、标注、模式、解释缓存、检查器、任务设置及各视图位置；单独记录最后打开的论文 | 部分 | 双论文切换/重启及最后打开独立于修改顺序已回归；长论文和跨版本迁移仍需验证。 |
| F10 | 编辑图书馆显示标题与标签 | Library 编辑显示标题与标签，不修改源 PDF | 对齐 | Electron 流程验证图书馆标签入口。 |
| F11 | 自动本地保存、损坏时读 `.backup` | JSON 原子写、备份回退、错误提示 | 对齐 | 故意损坏主文件后恢复最近可读副本。 |
| F12 | 清除保存的 PaperBridge 数据 | Settings 确认后清除保存数据，保留 PDF 副本 | 对齐 | 单元测试验证 PDF 文件未删。 |
| F13 | 全局外观与单论文任务设置分开恢复 | 每篇论文保存语言、四种模型、Ollama 地址、分段与 MinerU/PDF 解析设置；切换/重启恢复，阅读外观与更新偏好保持全局 | 对齐 | Electron 双论文流程验证；旧论文无任务设置时继承当前设置并提示检查。 |

Mac 证据：[段落编辑](../PaperBridge/PaperReaderViewModel.swift#L1182)、[图书馆](../PaperBridge/Views/PaperLibraryView.swift)、[工作区恢复](../PaperBridge/PaperReaderViewModel.swift#L1474)。Windows 证据：[段落编辑和图书馆](src/main.jsx#L337)、[本地存储](electron/storage.cjs)。

## G. 导出、安装、系统集成

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| G01 | 导出原文 Markdown | 原文 Markdown 单文件及便携 bundle | 部分 | 复杂 MinerU 资产引用仍需验证。 |
| G02 | 导出逐段译文 Markdown | 逐段译文 Markdown 单文件及便携 bundle | 部分 | 结构化全文稿和逐段译稿语义仍需比较。 |
| G03 | 导出双语 Markdown | 双语 Markdown 单文件及 bundle 包含书签、各视图高亮和笔记 | 部分 | 仅高亮加书签的导出 UI 已回归；复杂资产及公式顺序仍需验证。 |
| G04 | 导出摘要/笔记/证据 Markdown | 摘要、证据、书签、各视图高亮/笔记含 Paper/Reader、原译文侧、Paper exact PDF/Original PDF、页码及需复核提示 | 部分 | 仅高亮加书签及同页双 PDF scope 的 Analysis 导出已回归；复杂 Markdown 锚点与证据格式仍需比较。 |
| G05 | 资源 bundle、原 PDF、便携页面图片和独立全文译稿 | 便携 bundle 含 Markdown、外置图片、原 PDF、前 120 页 PNG 与独立全文稿 | 部分 | 复杂 MinerU 资产和长 PDF 仍需真机验收。 |
| G06 | 首次启动分步引导；可重新打开 | 首次启动六步 Getting Started：Ollama、翻译模型、MinerU、解释模型及就绪检查；Settings 与 Help 可重开，可跳过并记录完成状态 | 部分 | 六步、跨启动页码恢复、跳过/重开、忙时焦点和关闭锁、保存去重、练习文档及 980×620/1320×820 布局已通过 Electron 验证；仍需更多 DPI 和 Mac 实机并排对照。 |
| G07 | 自动检测/启动/安装 Ollama | SetupPanel 可勾选 Ollama、模型、MinerU；仅选模型时自动补 Ollama 依赖，单选 MinerU 不启动 Ollama | 部分 | AMD 真机已完成签名安装和复用；组件选择及依赖由单元与 Electron mock 回归验证，真实安装取消及其它硬件待验收。 |
| G08 | 自动发现、下载并选择模型 | 六步引导及 Settings > Local AI 都提供 TranslateGemma 4B/12B/27B 和六个可选助手模型卡片、内存建议、下载/选择/取消；下载状态跨设置分页保持可见 | 部分 | 九张卡、角色继承、四任务模型、下载取消/重试、跨论文/端点迟到结果隔离及重启恢复已通过 Electron 回归；12B/27B 等大模型仍需实际下载及更多内存配置验证。 |
| G09 | 翻译、摘要、解释、快速查词四套模型设置 | 四套任务模型可分别设置；引导选择翻译或助手模型会更新相应角色，保留用户另选的已安装助手模型 | 对齐 | 安装计划检查四套已选模型；引导模型角色继承有单元验证。 |
| G10 | 独立安装 MinerU，允许自动发现、手动路径/后端 | 私有 Python/MinerU 安装；Settings 可 Use Auto-Detect 或指定路径/后端；检测、状态、导入共用 resolver；可单独选择 MinerU，并显式 Repair / update，使用暂存环境及旧版本回滚 | 部分 | AMD 已实际安装 MinerU 3.4.5；空路径自动发现后完成图像型 PDF OCR 和中文翻译。延迟检测取消/任务竞争、PATH/私有环境选择和失败回滚有自动回归；真实修复、NVIDIA CUDA 和复杂扫描件待验收。 |
| G11 | 后台下载及进度、取消 | 安装与模型下载由主进程管理；模型下载可取消、重试并与安装互斥，引导与 SetupPanel 都可显示进度及取消 | 部分 | 模型流关闭、旧消息隔离与重试已回归；安装状态检测期间取消不误报完成的单元和组件界面取消/重开的 Electron mock 已过；真实安装中退出及恢复待验收。 |
| G12 | 本地 Ollama 限回环地址 | Windows `localOllamaURL` 限 localhost/127.0.0.1/::1 | 对齐 | 各 IPC 入口应统一校验。 |
| G13 | 自带程序菜单与快捷键 | File/Paper/Selection/View/Help 原生菜单；Ctrl+1/F/O/Enter、Ctrl+Shift+L/E/I/T/H、Ctrl+Alt+E 及旧 Ctrl+L；菜单项随论文、任务、选区和更新检查状态动态启停 | 部分 | 状态转换有单元覆盖，空白页、论文、选区、忙碌任务、撤销及重开引导有 Electron 菜单回归；其它键盘布局与 Mac 实机菜单逐项对照仍待验收。 |
| G14 | 签名更新源检查及应用内更新 | 每日检查 Windows 专属 GitHub Release，设置可手动检查；验证后的 tag/安装器身份缓存会跨重启保留提示，过期刷新失败仍显示 stale 提示并允许重试 | 部分 | 单元覆盖损坏/未来/旧缓存、版本重算和失败重试；双次真实 Electron 启动验证新版提示保留。签名后的应用内下载、验证与安装仍待 Windows 证书和正式 Release。 |
| G15 | 发布安装包 | NSIS 与 portable 构建，当前未签名；assisted installer 固定安全默认目录 | 部分 | 真实 NSIS 首装、应用保存论文/高亮/笔记、同版本重装恢复、卸载及用户数据保留已通过；打包程序启动通过。仍需代码签名、正式 Release 和跨版本更新安装。 |

Mac 证据：[bundle 导出](../PaperBridge/Services/MarkdownBundleExporter.swift)、[首次引导](../PaperBridge/Views/OnboardingView.swift)、[模型目录](../PaperBridge/Models.swift)、[设置中的独立安装入口](../PaperBridge/Views/SettingsView.swift)、[安装器](../PaperBridge/Services/LocalToolInstaller.swift)、[菜单](../PaperBridge/PaperBridgeApp.swift#L62)、[更新](../PaperBridge/Services/AppUpdateController.swift)。Windows 证据：[导出与引导入口](src/main.jsx)、[六步引导](src/Onboarding.jsx)、[六分页设置](src/SettingsPanel.jsx)、[设置推荐模型](src/SettingsModels.jsx)、[模型目录](src/modelCatalog.mjs)、[组件安装 UI](src/SetupPanel.jsx)、[统一 MinerU 发现](electron/mineru-discovery.cjs)、[安装逻辑](electron/setup.cjs)、[更新缓存](electron/updates.cjs)、[菜单状态](electron/menu-state.cjs)、[原生菜单](electron/main.cjs)、[设置模型回归](tests/settings-models-e2e.cjs)、[MinerU 检测回归](tests/mineru-detect-e2e.cjs)、[更新重启回归](tests/update-restart-e2e.cjs)、[真实安装器闭环](tests/installer-e2e.cjs)、[构建](package.json)。

## Windows 特有的硬件映射

这不是 Mac 功能的同名复制，而是 Windows 的平台适配：`electron/hardware.cjs` 检测显卡及 `nvidia-smi`；`electron/setup.cjs` 在 NVIDIA 驱动报告 CUDA ≥12.6 时选 `cu126`/`cu128` PyTorch wheel，并在 MinerU 私有环境里检查 `torch.cuda.is_available()`。AMD **不能使用 CUDA**；受支持的 AMD/Vulkan 显卡可由 Ollama 自行选择后端，MinerU 维持 CPU pipeline。Settings 可看 Ollama `/api/ps` 的实际 VRAM 使用。RX 7800 XT 真机已验证 Ollama 选择 ROCm 且模型全部放入 VRAM；NVIDIA 和纯 CPU 路径仍需逐台验收，不能因检测到显卡就声称已经 GPU 加速。

## 实施顺序和完成标准

1. **P0：阅读和数据正确性** — A07–A09 自动解析策略；A19 参考文献过滤；B04 三种阅读模式；C15 结构化全文译稿；D03–D06 精确证据；E03/E11/E15/E17 标注锚点；F07 MinerU 编辑保护；G05 完整导出。任一项“对齐”须有 Mac 同一用户流程与 Windows 结果对照。
2. **P1：1.9 小功能** — 拖放、练习论文不误替换、跨页修复、质量警告、搜索位置、任意章节/队列插队、整段解释与独立语言、术语搜索、编辑/撤销、图书馆标签和多视图位置。
3. **P2：交付与体验** — 剩余快捷键验收、安装器签名与正式更新安装、更多 DPI 和设备兼容性；Settings 推荐卡片和 MinerU 自动发现入口已实现并纳入回归。

关闭某一行前，至少使用同一份普通 PDF、双栏 PDF、扫描 PDF、含公式/图片的 MinerU PDF 和粘贴文本做 Mac↔Windows 行为核对；保存、关闭、重启、取消任务、切换论文、导出后复查结果。GPU 安装流程另需 NVIDIA、AMD、纯 CPU 设备分别验收。这里的状态是代码审计结论，并非这些真实设备验收已经完成。
