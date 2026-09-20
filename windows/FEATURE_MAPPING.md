# PaperBridge macOS 1.9 ↔ Windows 0.2 功能逐项映射

基线：macOS `main` 的 1.9 功能和本分支 `windows/` 的 0.2 实现，核对日期 2026-09-20。共 111 项：**42 对齐、69 部分、0 缺失**。本表按**用户可执行的动作与可观察的结果**拆分；同一行出现入口只代表有代码路径，不代表结果已经等价。`对齐`指静态代码核对显示主要行为等价，`部分`指有可用路径但缺少列出的行为，`缺失`指没有对应路径。[AMD 真机报告](AMD_DEVICE_TEST.md)已覆盖一台 RX 7800 XT、真实翻译与一篇复杂论文；Electron 回归另覆盖重复文字、双页 PDF 同词不同标注、导出及重启恢复。其它硬件、扫描件、Mac 逐项对照和正式安装包仍需验证。

源代码入口：[Mac 主界面](../PaperBridge/ContentView.swift)、[Mac 阅读模型](../PaperBridge/PaperReaderViewModel.swift)、[Mac 选择与标注](../PaperBridge/PaperReaderViewModel+Selection.swift)、[Mac 图书馆](../PaperBridge/PaperReaderViewModel+Library.swift)、[Mac 设置](../PaperBridge/Views/SettingsView.swift)、[Windows 界面](src/main.jsx)、[Windows PDF 提取](src/pdf.mjs)、[Windows 本地安装](electron/setup.cjs)、[Windows 本地存储](electron/storage.cjs)。

## A. 导入、解析与原文保真

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| A01 | 文件对话框打开 PDF | Open PDF 对话框 | 对齐 | 真实文件含空格、中文路径可打开。 |
| A02 | 将 PDF 拖进窗口导入 | 窗口拖放 PDF 走同一导入与 SHA-256 去重 | 对齐 | Electron 流程验证单文件拖入及重复文件恢复。 |
| A03 | 粘贴全文并按段落建文档 | Paste Text | 对齐 | 保留章节和段落顺序。 |
| A04 | 无模型时试用虚构练习论文 | 有论文打开时保留原工作区并提示 | 对齐 | 练习论文只从空工作区创建。 |
| A05 | 重复打开同一 PDF 恢复原工作区 | SHA-256 去重并载入保存文档 | 对齐 | 验证编辑、翻译、标注均未覆盖。 |
| A06 | 重新提取为新的图书馆副本 | More 中重新提取为独立副本 | 对齐 | Electron 流程验证原副本保留且图书馆新增一项。 |
| A07 | 导入时自动优先 MinerU | 默认 MinerU preferred，导入自动检测并解析 | 部分 | 15 页双栏论文已在 AMD/CPU pipeline 自动解析；更多论文及 OCR 待验证。 |
| A08 | MinerU 失败自动降级，并说明原因 | MinerU preferred 失败显示原因并回退 PDF.js | 部分 | 真实失败和 OCR 设备路径待验证。 |
| A09 | MinerU only / MinerU preferred / PDFKit only 三种模式 | Settings 提供 MinerU only / preferred / PDF only | 部分 | 三模式已有代码路径；真实 MinerU-only 失败行为待验证。 |
| A10 | MinerU 多栏正文阅读顺序 | MinerU Markdown 或 PDF.js 简单双栏排序 | 部分 | 一篇双栏论文的标题顺序已核对；跨栏图、脚注及 Mac 对照仍待验收。 |
| A11 | 图片、表格、独立公式、代码随正文交错 | 按行拆出独立资源块，图表说明保留为可翻译段落；安全渲染 HTML | 部分 | 15 页论文重开验证 5 图、4 表、5 独立公式均按源顺序出现在 Paper/Reader；其它论文的复杂 HTML/代码仍待验收。 |
| A12 | 公式、图片路径、URL、代码、HTML 翻译前保护 | `protectMarkdown` / `restoreMarkdown` 包括代码围栏、整张 HTML 表格、行内标签及多种公式 | 部分 | 单元测试覆盖 token 还原；更多模型对复杂结构的输出位置仍待验收。 |
| A13 | 原 PDF 无修改保存并原样查看 | 复制原 PDF，PDF.js canvas + text layer | 对齐 | 像素、页数和可选文字与源文件一致。 |
| A14 | 无文字层的扫描件仍可看原 PDF | 原 PDF 仍可翻页，提示用 MinerU OCR | 部分 | AI 动作应明确禁用或引导 OCR；现有提示尚不完整。 |
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
| B02 | Paper / Reader / Overview / Full Translation 工作区 | Paper / Reader / Summary / Full Translation，另有 Original | 部分 | 名称与导航行为统一；Paper 内原文与结构化预览对应。 |
| B03 | Paper 中切换精确 PDF 与 MinerU 结构化页面 | Windows 用独立 Original 标签；Paper 渲染 Markdown | 部分 | 保持同一纸张上下文和视图切换位置。 |
| B04 | 双语、仅原文、仅译文三种阅读模式 | 双语、仅原文、仅译文并逐论文保存 | 对齐 | Electron 流程验证三模式切换。 |
| B05 | 问题、方法、证据、讨论、结论的原文阅读地图 | `readingMap` 五类标题匹配并跳转 | 部分 | 无标题时回退；验证所有主题与段落链接不串页。 |
| B06 | 章节大纲跳转 | 侧栏 OUTLINE | 对齐 | 长文与 MinerU 标题层级要验证。 |
| B07 | 段落书签及侧栏文字预览 | 书签按钮与侧栏摘要 | 对齐 | 解析来源切换后位置应保持。 |
| B08 | Reader 顶部搜索、清除后回到原位置 | 搜索前记录滚动位置并在清空时恢复 | 部分 | 长文和跨标签搜索仍需回归。 |
| B09 | Paper/PDF/Markdown/Reader 各自保存阅读位置 | 逐视图滚动位置、PDF 逐页滚动位置、段落和页码保存 | 部分 | Markdown 内部锚点和复杂页面重排仍需验证。 |
| B10 | 标注跳转校验锚点有效性 | 检查器验证 PDF 页码/偏移与 Markdown 原文偏移，定位后选回原文；失效锚点保留并提示检查 | 部分 | 双页同词回归通过；跨版本 Markdown 重排与真实长 PDF 仍需验证。 |
| B11 | 显示/隐藏左右侧栏 | 两侧切换按钮 | 对齐 | 面板切换不丢当前阅读位置。 |
| B12 | Focus Reading 退出后恢复进入前的面板状态 | 焦点阅读进入前保存左右面板状态，退出恢复 | 对齐 | 面板状态切换已实现。 |
| B13 | 窄窗口检查器改为底部布局 | Windows CSS 响应布局 | 部分 | 在 980px 最小宽度和高 DPI 下真机验收。 |
| B14 | 字号、行距、阅读宽度调节 | Settings 三项滑块用于 Reader、Paper 和 Full Translation 文字预览 | 对齐 | Electron 检查 21px、1.9 行距、700px 宽度；原 PDF 几何不受文字预览样式影响。 |
| B15 | 提取段落的质量提示与 Review 链接 | Overview 共用 A18 质量提示和段落 Review | 部分 | 识别率与复杂论文验证待完成。 |
| B16 | 结构化 Markdown 公式/表格本地预览 | React Markdown、KaTeX、GFM，加受限 HTML 渲染 | 部分 | 15 页论文的 11 处上标、4 张表、5 张图、5 个独立公式已在 Paper/Reader 验证；更多排版仍待验收。 |

Mac 证据：[工作区、搜索与位置](../PaperBridge/ContentView.swift#L480)、[阅读地图](../PaperBridge/Services/ReadingGuideBuilder.swift)、[Markdown 预览](../PaperBridge/Views/MarkdownPreviewView.swift)。Windows 证据：[导航与阅读界面](src/main.jsx#L338)、[阅读地图](src/text.mjs)、[显示状态](src/main.jsx#L94)。

## C. 段落翻译与全文翻译

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| C01 | 源/目标语言可选、可交换 | Settings 中 11 语言与 Swap | 对齐 | 各语种语言代码在 Ollama 提示中正确。 |
| C02 | 分段逐项翻译并原/译对齐 | `translateBlocks` 逐块保存 | 部分 | 结构化 Markdown 时图片/标题也维持对齐。 |
| C03 | 长段在句界分块，结果仍为一个段落 | `chunkText` 再拼接 | 部分 | 超长单句、公式和多语标点不截断语义。 |
| C04 | 单段失败隔离，其他段继续 | 每块 try/catch，状态 failed | 对齐 | 单块失败不阻断队列。 |
| C05 | 只恢复 pending/failed，不重译 ok | 队列过滤 `status !== ok` | 对齐 | 重启后状态和结果仍在。 |
| C06 | 单段 Retry | 块级翻译/Retry 按钮 | 对齐 | 成功块保持不变。 |
| C07 | 停止请求并保留已完成翻译 | `cancelTask` + Ollama Abort | 部分 | 验证旧请求绝不会写入新任务或新论文。 |
| C08 | 当前任务进度与失败数量 | Windows 显示已处理数、成功数、侧栏总失败数及单块错误；无总量时提示正在处理 | 部分 | 缺 Mac 的可视进度条；长任务的失败数更新需真机回归。 |
| C09 | Abstract & Conclusion 范围 | Translation Range 同名选项 | 部分 | 章节误检、缺失时禁用或解释。 |
| C10 | 当前章节范围 | Translation Range 当前章节 | 部分 | 章节依据应跟随真实阅读位置。 |
| C11 | 任意检测章节选择翻译 | Translation Range 列出检测章节 | 部分 | 入口与队列过滤已实现，复杂标题检测待验证。 |
| C12 | 所有未完成块 | All unfinished blocks | 对齐 | 排除章节标题与参考文献。 |
| C13 | 正在翻译时将当前章节插队 | 运行时可把当前章节插入剩余队列前端 | 部分 | 异步取消及真实 Ollama 长队列待验证。 |
| C14 | 连贯全文翻译是独立可选任务 | Full Translation 单独按钮与保存 | 对齐 | 不自动替代段落翻译。 |
| C15 | 全文翻译保留原 Markdown 非语言块与共享译稿 | 独立 connectedBlocks 译稿保留 Markdown 资源，并供导出 | 部分 | 结构化 Markdown 全文与 Paper 同步仍需复杂论文验证。 |
| C16 | 上下文分批与失败块保留原文 | 逐块上下文翻译、进度保存与失败原文保留 | 部分 | 长文恢复与失败后重试需模型回归。 |
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
| D08 | 单段解释、可单独选择解释语言 | 选区和整段解释；整段解释有独立语言选择 | 对齐 | Reader 按钮和检查器入口均已实现。 |
| D09 | 摘要标明 AI 输出不能证明科学结论 | 摘要显式展示证据验证状态 | 对齐 | 未验证 claim 不产生来源链接。 |

Mac 证据：[摘要生成](../PaperBridge/PaperReaderViewModel.swift#L1040)、[证据校验](../PaperBridge/Services/SummaryEvidence.swift)、[检查来源 UI](../PaperBridge/ContentView.swift#L1460)。Windows 证据：[摘要生成](src/main.jsx#L234)、[摘要 UI](src/main.jsx#L382)。

## E. 选区、标注、术语与检查器

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| E01 | Reader 原文/译文选区 | Reader DOM 选区 | 部分 | 译文 Markdown 选区也能正确找回来源。 |
| E02 | Paper 结构化 Markdown 选区 | Paper 预览按块定位选区，重复文字保留精确偏移；笔记/高亮回写源块且正文可见 | 部分 | 跨块选区及格式复杂时的 Markdown 原文偏移仍需补齐。 |
| E03 | 原 PDF 可选文字按页/偏移锚定 | PDF text layer 按页码、页内偏移与原文保存独立笔记/高亮；导航时校验原文，失效则保留并提示 | 部分 | 双页同词不同色标注、跳转与重启回归通过；真实长 PDF 的跨行选区和扫描件仍需验收。 |
| E04 | 双语摘要两侧选区 | 两侧选区可查词、解释、保存笔记；三色高亮正文可见，列表可跳回选区 | 部分 | 复杂 Markdown 和源文重排时的显示偏移仍需验收。 |
| E05 | Full Translation 选区 | 全文译稿可查词、解释、保存笔记；三色高亮正文可见，列表可跳回选区 | 部分 | 复杂 Markdown 和译稿重生成后的锚点仍需验收。 |
| E06 | 选中文字即时翻译 | 检查器 Translate | 部分 | 正确反转译文侧方向，保持原术语方向。 |
| E07 | 选中文字解释 | 检查器 Explain | 对齐 | 输出异常、取消与切换论文时结果隔离。 |
| E08 | 快速查词独立模型 | Settings 独立 quick lookup model 并纳入安装检测 | 对齐 | 四套模型分别配置。 |
| E09 | 查词结果按选区与语言缓存 | 按论文、选区、方向和模型缓存本次会话的查词 | 部分 | 跨重启持久化及源文复杂变更失效仍缺。 |
| E10 | 选区延伸保护与上下文边界 | 仅截取 DOM 字符串并限 3000 字 | 部分 | 不跨无关段落或抓取错误上下文。 |
| E11 | 三种颜色高亮 | 三色高亮用偏移区分重复原文；Reader、Paper、PDF、摘要和全文译稿均在正文显示 | 部分 | 真实 MinerU 上标已验证；PDF 多页与 KaTeX 混排仍需验收。 |
| E12 | 删除高亮保留笔记 | 同色点击移除高亮，笔记单独保存 | 部分 | 高亮与注释关联同一精确选区。 |
| E13 | 为选区创建、更新、删除笔记 | Reader 同选区笔记可创建、更新、删除 | 对齐 | 标注清单提供删除入口。 |
| E14 | 标注列表、预览、跨工作区跳转 | 检查器列出 Reader、PDF、摘要和全文译稿标注；PDF 页内及摘要/全文译稿选区可精确跳转 | 部分 | Reader/Paper 跨视图选区跳转与复杂 Markdown 坐标仍需补齐。 |
| E15 | 标注位置失效时保留笔记并标明需检查 | 编辑后失效锚点标记 needsReview 并保留笔记 | 部分 | 更多编辑和跨视图路径仍需验证。 |
| E16 | 高亮/笔记更改撤销 | 最多 20 次工作区快照撤销，覆盖标注与段落编辑 | 部分 | 跨重启撤销栈未保存；混合操作仍需更多回归。 |
| E17 | 精确选区注释跨分段编辑迁移 | 拆分、合并、编辑迁移原文精确锚点 | 部分 | 重排及 Markdown 结构化编辑仍缺。 |
| E18 | 保存术语及语言方向 | Reader 选区 Save term | 对齐 | 160/300 字与 500 条上限。 |
| E19 | 术语搜索、审阅和删除 | 术语列表按原词或译词搜索、删除 | 对齐 | 索引按当前术语数组执行。 |
| E20 | 紧凑选区工具条和展开检查器 | 选区旁浮动查词、解释、笔记入口；滚动后收起工具条并保留检查器选区 | 部分 | 真实论文翻译图表说明并滚动时已验证工具条不遮挡；窄屏位置需回归。 |
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
| F06 | 段落编辑撤销 | 最多 20 次完整论文状态快照撤销 | 部分 | 已覆盖标注和段落内容；跨重启撤销栈未保存。 |
| F07 | MinerU 结构化段落禁止破坏性编辑 | MinerU 来源禁用编辑、拆分、合并 | 对齐 | 避免 Markdown 资源锚点被直接破坏。 |
| F08 | 图书馆搜索标题与标签 | 搜索框及 library 弹窗 | 对齐 | 中文/大小写、空结果验收。 |
| F09 | 打开旧论文恢复结果、标注、阅读位置 | 加载论文恢复结果、标注、模式及各视图位置 | 部分 | 任务专属设置仍缺。 |
| F10 | 编辑图书馆显示标题与标签 | Library 编辑显示标题与标签，不修改源 PDF | 对齐 | Electron 流程验证图书馆标签入口。 |
| F11 | 自动本地保存、损坏时读 `.backup` | JSON 原子写、备份回退、错误提示 | 对齐 | 故意损坏主文件后恢复最近可读副本。 |
| F12 | 清除保存的 PaperBridge 数据 | Settings 确认后清除保存数据，保留 PDF 副本 | 对齐 | 单元测试验证 PDF 文件未删。 |
| F13 | 全局外观与单论文任务设置分开恢复 | Windows 全局 settings + paper 内容 | 部分 | 论文切换需恢复专属任务设置。 |

Mac 证据：[段落编辑](../PaperBridge/PaperReaderViewModel.swift#L1182)、[图书馆](../PaperBridge/Views/PaperLibraryView.swift)、[工作区恢复](../PaperBridge/PaperReaderViewModel.swift#L1474)。Windows 证据：[段落编辑和图书馆](src/main.jsx#L337)、[本地存储](electron/storage.cjs)。

## G. 导出、安装、系统集成

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| G01 | 导出原文 Markdown | 原文 Markdown 单文件及便携 bundle | 部分 | 复杂 MinerU 资产引用仍需验证。 |
| G02 | 导出逐段译文 Markdown | 逐段译文 Markdown 单文件及便携 bundle | 部分 | 结构化全文稿和逐段译稿语义仍需比较。 |
| G03 | 导出双语 Markdown | 双语 Markdown 单文件及便携 bundle | 部分 | 复杂资产及公式顺序仍需验证。 |
| G04 | 导出摘要/笔记/证据 Markdown | 摘要、验证状态、来源 quote、Reader、PDF 页码和视图笔记 Markdown | 部分 | 复杂 Markdown 锚点与证据格式仍需比较。 |
| G05 | 资源 bundle、原 PDF、便携页面图片和独立全文译稿 | 便携 bundle 含 Markdown、外置图片、原 PDF、前 120 页 PNG 与独立全文稿 | 部分 | 复杂 MinerU 资产和长 PDF 仍需真机验收。 |
| G06 | 首次启动分步引导；可重新打开 | Windows 欢迎页 + 一页 Local AI setup | 部分 | 重现分步说明、模型选择及再次打开入口。 |
| G07 | 自动检测/启动/安装 Ollama | SetupPanel 诊断 + 签名安装器 | 部分 | AMD 真机已完成从无到有的签名安装和复用；取消及其它硬件待验证。 |
| G08 | 自动发现、下载并选择模型 | 检测模型、下载当前三个任务模型 | 部分 | Mac 4B/12B/27B 与可选助手模型推荐卡片尚缺。 |
| G09 | 翻译、摘要、解释、快速查词四套模型设置 | 翻译、摘要、解释、快速查词四套模型设置 | 对齐 | 一键安装计划检查四套已选模型。 |
| G10 | 独立安装 MinerU，允许手动路径/后端 | 私有 Python/MinerU 安装，路径与后端设置 | 部分 | AMD 真机已装 MinerU 3.4.5 并解析论文；NVIDIA CUDA、回滚和扫描件待验证。 |
| G11 | 后台下载及进度、取消 | 安装任务由主进程继续；状态可再打开 | 部分 | 最小化、关弹窗、重开与中途退出的状态恢复。 |
| G12 | 本地 Ollama 限回环地址 | Windows `localOllamaURL` 限 localhost/127.0.0.1/::1 | 对齐 | 各 IPC 入口应统一校验。 |
| G13 | 自带程序菜单与快捷键 | File/Paper/Selection/View/Help 原生菜单；Ctrl+1/F/O/Enter、Ctrl+Shift+L/E/I/T/H、Ctrl+Alt+E 及旧 Ctrl+L | 部分 | 快捷键与菜单点击已回归；菜单项按当前任务和选区动态禁用、其它键盘布局仍需补齐。 |
| G14 | 签名更新源检查及应用内更新 | 每日检查 Windows 专属 GitHub Release，设置可手动检查，发现新版显示提示并打开官方发布页 | 部分 | 签名后的应用内下载、验证与安装仍待 Windows 发布证书和正式 Release。 |
| G15 | 发布安装包 | NSIS 与 portable 构建，当前未签名 | 部分 | 真机安装、卸载与签名后发布验证。 |

Mac 证据：[bundle 导出](../PaperBridge/Services/MarkdownBundleExporter.swift)、[首次引导](../PaperBridge/Views/OnboardingView.swift)、[安装器](../PaperBridge/Services/LocalToolInstaller.swift)、[菜单](../PaperBridge/PaperBridgeApp.swift#L62)、[更新](../PaperBridge/Services/AppUpdateController.swift)。Windows 证据：[导出](src/main.jsx#L295)、[安装 UI](src/SetupPanel.jsx)、[安装逻辑](electron/setup.cjs)、[快捷键](src/main.jsx#L159)、[构建](package.json)。

## Windows 特有的硬件映射

这不是 Mac 功能的同名复制，而是 Windows 的平台适配：`electron/hardware.cjs` 检测显卡及 `nvidia-smi`；`electron/setup.cjs` 在 NVIDIA 驱动报告 CUDA ≥12.6 时选 `cu126`/`cu128` PyTorch wheel，并在 MinerU 私有环境里检查 `torch.cuda.is_available()`。AMD **不能使用 CUDA**；受支持的 AMD/Vulkan 显卡可由 Ollama 自行选择后端，MinerU 维持 CPU pipeline。Settings 可看 Ollama `/api/ps` 的实际 VRAM 使用。RX 7800 XT 真机已验证 Ollama 选择 ROCm 且模型全部放入 VRAM；NVIDIA 和纯 CPU 路径仍需逐台验收，不能因检测到显卡就声称已经 GPU 加速。

## 实施顺序和完成标准

1. **P0：阅读和数据正确性** — A07–A09 自动解析策略；A19 参考文献过滤；B04 三种阅读模式；C15 结构化全文译稿；D03–D06 精确证据；E03/E11/E15/E17 标注锚点；F07 MinerU 编辑保护；G05 完整导出。任一项“对齐”须有 Mac 同一用户流程与 Windows 结果对照。
2. **P1：1.9 小功能** — 拖放、练习论文不误替换、跨页修复、质量警告、搜索位置、任意章节/队列插队、整段解释与独立语言、术语搜索、编辑/撤销、图书馆标签和多视图位置。
3. **P2：交付与体验** — 引导页、剩余快捷键、安装器签名与自动更新、窄窗口和设备兼容性。

关闭某一行前，至少使用同一份普通 PDF、双栏 PDF、扫描 PDF、含公式/图片的 MinerU PDF 和粘贴文本做 Mac↔Windows 行为核对；保存、关闭、重启、取消任务、切换论文、导出后复查结果。GPU 安装流程另需 NVIDIA、AMD、纯 CPU 设备分别验收。这里的状态是代码审计结论，并非这些真实设备验收已经完成。
