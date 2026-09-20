# PaperBridge macOS 1.9 ↔ Windows 0.2 功能逐项映射

基线：macOS `main` 的 1.9 功能和本分支 `windows/` 的 0.2 实现，核对日期 2026-09-20。共 111 项：**23 对齐、62 部分、26 缺失**。本表按**用户可执行的动作与可观察的结果**拆分；同一行出现入口只代表有代码路径，不代表结果已经等价。`对齐`指静态代码核对显示主要行为等价，`部分`指有可用路径但缺少列出的行为，`缺失`指没有对应路径。所有状态仍需真实 Windows 设备与复杂论文回归验证，尤其是 CUDA、AMD、MinerU 和安装包。

源代码入口：[Mac 主界面](../PaperBridge/ContentView.swift)、[Mac 阅读模型](../PaperBridge/PaperReaderViewModel.swift)、[Mac 选择与标注](../PaperBridge/PaperReaderViewModel+Selection.swift)、[Mac 图书馆](../PaperBridge/PaperReaderViewModel+Library.swift)、[Mac 设置](../PaperBridge/Views/SettingsView.swift)、[Windows 界面](src/main.jsx)、[Windows PDF 提取](src/pdf.mjs)、[Windows 本地安装](electron/setup.cjs)、[Windows 本地存储](electron/storage.cjs)。

## A. 导入、解析与原文保真

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| A01 | 文件对话框打开 PDF | Open PDF 对话框 | 对齐 | 真实文件含空格、中文路径可打开。 |
| A02 | 将 PDF 拖进窗口导入 | 无窗口拖放处理 | 缺失 | 拖入单个 PDF 后走同一导入和去重流程。 |
| A03 | 粘贴全文并按段落建文档 | Paste Text | 对齐 | 保留章节和段落顺序。 |
| A04 | 无模型时试用虚构练习论文 | Try a Practice Paper | 部分 | Mac 仅在没有打开论文时允许；Windows 按钮会替换当前论文，需防止误替换。 |
| A05 | 重复打开同一 PDF 恢复原工作区 | SHA-256 去重并载入保存文档 | 对齐 | 验证编辑、翻译、标注均未覆盖。 |
| A06 | 重新提取为新的图书馆副本 | 无新副本命令 | 缺失 | 原副本保留，新副本独立选解析器和结果。 |
| A07 | 导入时自动优先 MinerU | PDF.js 首先提取；More 手动 Parse with MinerU | 部分 | 按所选解析模式自动执行 MinerU。 |
| A08 | MinerU 失败自动降级，并说明原因 | 手动 MinerU 失败只显示错误，原 PDF.js 文本仍在 | 部分 | 自动回退时显示原因、解析来源及可用内容。 |
| A09 | MinerU only / MinerU preferred / PDFKit only 三种模式 | 仅手动 MinerU 与 PDF.js 来源切换 | 缺失 | 设置中提供等价三模式，并保证 only 失败时不悄悄降级。 |
| A10 | MinerU 多栏正文阅读顺序 | MinerU Markdown 或 PDF.js 简单双栏排序 | 部分 | 用双栏、跨栏图、脚注论文比对段落顺序。 |
| A11 | 图片、表格、独立公式、代码随正文交错 | Markdown 预览渲染；Reader 以空行粗分块 | 部分 | Reader 内按原顺序显示资源块，翻译不移动资产。 |
| A12 | 公式、图片路径、URL、代码、HTML 翻译前保护 | `protectMarkdown` / `restoreMarkdown` | 部分 | 针对全部结构类型验证还原和原位置。 |
| A13 | 原 PDF 无修改保存并原样查看 | 复制原 PDF，PDF.js canvas + text layer | 对齐 | 像素、页数和可选文字与源文件一致。 |
| A14 | 无文字层的扫描件仍可看原 PDF | 原 PDF 仍可翻页，提示用 MinerU OCR | 部分 | AI 动作应明确禁用或引导 OCR；现有提示尚不完整。 |
| A15 | PDFKit 便携页面图片（最多前 120 页） | 无页面图片资产 | 缺失 | 导出图片与原 PDF；保留 120 页上限。 |
| A16 | 跨页断词、断句修复 | 仅页内 `joinLines` 处理尾部连字符 | 部分 | 跨页拼接且不误删正常复合词。 |
| A17 | 重复页眉、页脚、图表标签过滤 | PDF.js 提取没有对应过滤 | 缺失 | 多页重复元素不进入翻译正文，原 PDF 仍完整。 |
| A18 | 提取质量警告定位到 Reader 段落 | 仅导入完成后的通用提醒 | 缺失 | Overview 显示具体可疑段落与 Review 跳转。 |
| A19 | 尾部参考文献或中途参考文献智能排除 | Summary 只过滤文本恰为 References/Bibliography 的块；翻译未排除 | 部分 | 正文任务跳过整个参考文献区，原文预览和导出保留。 |
| A20 | MinerU 资源目录与原 PDF 持久化 | 原 PDF 持久化；图片转 data URI，另留 MinerU 输出目录 | 部分 | 资源可跨重启引用，丢失资产时报告且可恢复。 |

Mac 证据：[解析路由](../PaperBridge/PaperReaderViewModel.swift#L1547)、[PDF 文本修复](../PaperBridge/Services/PDFTextExtractor.swift)、[Markdown 结构](../PaperBridge/Services/AcademicMarkdownProcessor.swift)、[原页归档](../PaperBridge/Services/PDFVisualArchiveService.swift)。Windows 证据：[导入与手动 MinerU](src/main.jsx#L171)、[PDF.js 提取](src/pdf.mjs)、[Markdown 粗分段](src/main.jsx#L25)、[原 PDF 复制](electron/main.cjs#L105)。

## B. 工作区、阅读与导航

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| B01 | 三栏：文档侧栏、正文、研究检查器 | 三栏布局 | 对齐 | 窄窗口各面板仍能使用。 |
| B02 | Paper / Reader / Overview / Full Translation 工作区 | Paper / Reader / Summary / Full Translation，另有 Original | 部分 | 名称与导航行为统一；Paper 内原文与结构化预览对应。 |
| B03 | Paper 中切换精确 PDF 与 MinerU 结构化页面 | Windows 用独立 Original 标签；Paper 渲染 Markdown | 部分 | 保持同一纸张上下文和视图切换位置。 |
| B04 | 双语、仅原文、仅译文三种阅读模式 | Reader 固定双语 | 缺失 | 三种模式切换且保存选择。 |
| B05 | 问题、方法、证据、讨论、结论的原文阅读地图 | `readingMap` 五类标题匹配并跳转 | 部分 | 无标题时回退；验证所有主题与段落链接不串页。 |
| B06 | 章节大纲跳转 | 侧栏 OUTLINE | 对齐 | 长文与 MinerU 标题层级要验证。 |
| B07 | 段落书签及侧栏文字预览 | 书签按钮与侧栏摘要 | 对齐 | 解析来源切换后位置应保持。 |
| B08 | Reader 顶部搜索、清除后回到原位置 | 过滤 Reader 块 | 部分 | 清空搜索后恢复原滚动位置；支持结果定位。 |
| B09 | Paper/PDF/Markdown/Reader 各自保存阅读位置 | 保存 tab、block、PDF page | 部分 | 加入 Markdown 与 PDF 页内滚动坐标，分视图存储。 |
| B10 | 标注跳转校验锚点有效性 | 无保存标注清单/锚点校验 | 缺失 | 锚点不匹配时提示，不跳到错误文本。 |
| B11 | 显示/隐藏左右侧栏 | 两侧切换按钮 | 对齐 | 面板切换不丢当前阅读位置。 |
| B12 | Focus Reading 退出后恢复进入前的面板状态 | Focus 切换检查器，CSS 隐藏面板 | 部分 | 保存并恢复两侧原始状态。 |
| B13 | 窄窗口检查器改为底部布局 | Windows CSS 响应布局 | 部分 | 在 980px 最小宽度和高 DPI 下真机验收。 |
| B14 | 字号、行距、阅读宽度调节 | Settings 三项滑块，仅用于 Reader | 部分 | 同样应用到文字预览，不改变原 PDF 几何。 |
| B15 | 提取段落的质量提示与 Review 链接 | 无 | 缺失 | 与 A18 共用同一结果，不重复检测。 |
| B16 | 结构化 Markdown 公式/表格本地预览 | React Markdown、KaTeX、GFM | 部分 | 离线大文档、公式与图片按源顺序验收。 |

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
| C08 | 当前任务进度与失败数量 | Windows 显示进度、成功数量及块错误 | 部分 | 增加总体失败数和确定/不确定进度区分。 |
| C09 | Abstract & Conclusion 范围 | Translation Range 同名选项 | 部分 | 章节误检、缺失时禁用或解释。 |
| C10 | 当前章节范围 | Translation Range 当前章节 | 部分 | 章节依据应跟随真实阅读位置。 |
| C11 | 任意检测章节选择翻译 | 无章节子菜单 | 缺失 | 列出所有章节并仅翻译所选章节未完成块。 |
| C12 | 所有未完成块 | All unfinished blocks | 对齐 | 排除章节标题与参考文献。 |
| C13 | 正在翻译时将当前章节插队 | 无运行中队列重排 | 缺失 | 当前块完成后先处理所选章节，已完成项不重跑。 |
| C14 | 连贯全文翻译是独立可选任务 | Full Translation 单独按钮与保存 | 对齐 | 不自动替代段落翻译。 |
| C15 | 全文翻译保留原 Markdown 非语言块与共享译稿 | 对纯文本块拼接后翻译，单独显示 | 部分 | 译稿同时驱动 Paper、Full Translation、导出，公式/资源留在原位。 |
| C16 | 上下文分批与失败块保留原文 | Windows 4800 字分块，逐块保存 | 部分 | 失败后可恢复，并保留原块顺序和语境。 |
| C17 | 按方向匹配保存术语注入提示 | `matchingTerms` 限 24 条 | 对齐 | 已完成译文不被术语更新静默覆盖。 |

Mac 证据：[段落队列与全文翻译](../PaperBridge/PaperReaderViewModel.swift#L741)、[翻译范围菜单](../PaperBridge/ContentView.swift#L633)、[结构化保护](../PaperBridge/Services/AcademicMarkdownProcessor.swift#L273)。Windows 证据：[翻译任务](src/main.jsx#L191)、[全文翻译](src/main.jsx#L253)、[范围菜单](src/main.jsx#L403)。

## D. 摘要、解释与证据

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| D01 | 原文语言与目标语言双摘要 | Summary 生成 source/target | 对齐 | 两种语言与设置匹配。 |
| D02 | 长文分批摘要再合并 | Windows 6000 字分批再合并 | 部分 | 分批不漏结尾和中途章节。 |
| D03 | 编号 claim 与来源摘录 | Windows 仅提示模型输出 `[block ID]` | 部分 | 解析每条 claim 与原文 quote。 |
| D04 | 引文必须与原段落精确匹配 | 无 quote 精确匹配 | 缺失 | 虚构 ID/引文不生成有效跳转。 |
| D05 | “Check the Sources” 列出每条验证结果 | 仅显示文中有效 ID 的块链接 | 部分 | 每条 claim 展示匹配摘录或“未验证”。 |
| D06 | 点击有效证据回到确切原文段落 | 点击块 ID 跳转 Reader | 部分 | 只有 quote 精确匹配后才启用链接。 |
| D07 | 旧版摘要无证据结构时仍可阅读 | 普通字符串摘要可读取 | 对齐 | 标为未验证，重新生成时升级。 |
| D08 | 单段解释、可单独选择解释语言 | 仅通过选中文字 Explain，固定目标语言 | 部分 | 增加整段按钮与解释语言选择。 |
| D09 | 摘要标明 AI 输出不能证明科学结论 | Summary 写有核对提示 | 部分 | 未验证来源在 UI 中明确标记。 |

Mac 证据：[摘要生成](../PaperBridge/PaperReaderViewModel.swift#L1040)、[证据校验](../PaperBridge/Services/SummaryEvidence.swift)、[检查来源 UI](../PaperBridge/ContentView.swift#L1460)。Windows 证据：[摘要生成](src/main.jsx#L234)、[摘要 UI](src/main.jsx#L382)。

## E. 选区、标注、术语与检查器

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| E01 | Reader 原文/译文选区 | Reader DOM 选区 | 部分 | 译文 Markdown 选区也能正确找回来源。 |
| E02 | Paper 结构化 Markdown 选区 | Paper 没有绑定选区处理 | 缺失 | Paper 任意文字进入检查器。 |
| E03 | 原 PDF 可选文字按页/偏移锚定 | PDF text layer 可选，但仅猜测同页块 | 部分 | 保存页码与文本范围；匹配失败不写错块。 |
| E04 | 双语摘要两侧选区 | Summary 无选区处理 | 缺失 | 标明 source/target scope 并可执行四种操作。 |
| E05 | Full Translation 选区 | 无选区处理 | 缺失 | 译文精确选区、保存锚点。 |
| E06 | 选中文字即时翻译 | 检查器 Translate | 部分 | 正确反转译文侧方向，保持原术语方向。 |
| E07 | 选中文字解释 | 检查器 Explain | 对齐 | 输出异常、取消与切换论文时结果隔离。 |
| E08 | 快速查词独立模型 | 使用 `translationModel`/`explainModel` | 缺失 | Settings 增加 quick lookup model，选区任务使用它。 |
| E09 | 查词结果按选区与语言缓存 | Windows 每次请求 Ollama | 缺失 | 相同选区再次点开即时恢复，源变更时失效。 |
| E10 | 选区延伸保护与上下文边界 | 仅截取 DOM 字符串并限 3000 字 | 部分 | 不跨无关段落或抓取错误上下文。 |
| E11 | 三种颜色高亮 | amber/blue/coral | 部分 | 重复文本以精确偏移区分；Markdown/PDF 也可见。 |
| E12 | 删除高亮保留笔记 | 同色点击移除高亮，笔记单独保存 | 部分 | 高亮与注释关联同一精确选区。 |
| E13 | 为选区创建、更新、删除笔记 | Windows 只能添加；无编辑/删除 UI | 部分 | 同选区再次选中可编辑，支持删除。 |
| E14 | 标注列表、预览、跨工作区跳转 | 只在 Reader 块底部显示笔记 | 部分 | 检查器列出全部标注及来源视图。 |
| E15 | 标注位置失效时保留笔记并标明需检查 | 无 `needsReview` 语义 | 缺失 | 编辑源文后未匹配标注不能错误着色。 |
| E16 | 高亮/笔记更改撤销 | Windows 单步 `undo` 快照 | 部分 | 多步撤销并同时保留后续笔记。 |
| E17 | 精确选区注释跨分段编辑迁移 | Windows 改块后重排 ID，不迁移精确锚点 | 缺失 | split/merge/reflow 后笔记和书签指向正确来源。 |
| E18 | 保存术语及语言方向 | Reader 选区 Save term | 对齐 | 160/300 字与 500 条上限。 |
| E19 | 术语搜索、审阅和删除 | 列表与删除，无列表搜索 | 部分 | 术语列表按原词/译词搜索。 |
| E20 | 紧凑选区工具条和展开检查器 | 仅右侧检查器 | 缺失 | 小工具条可快速查词，展开完整注释工具。 |
| E21 | 检查器隐藏/显示 | 顶部按钮 | 对齐 | 窄窗口与焦点模式状态一致。 |

Mac 证据：[选区行为](../PaperBridge/PaperReaderViewModel+Selection.swift)、[检查器与标注列表](../PaperBridge/Views/SelectionInspectorView.swift)、[选区数据模型](../PaperBridge/Models.swift#L420)。Windows 证据：[选区与注释](src/main.jsx#L305)、[检查器](src/main.jsx#L386)。

## F. 手工修复、图书馆与恢复

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| F01 | 手动改段落原文 | Reader Edit source | 部分 | MinerU 结构化块应禁止直接编辑以免资产脱锚。 |
| F02 | 按安全边界拆分段落 | Windows 在句号附近 Split | 部分 | 拆分后标注、书签、译文失效语义正确。 |
| F03 | 与前段合并 | Merge previous | 部分 | 锚点和资源迁移正确。 |
| F04 | 与后段合并 | 无 | 缺失 | 支持后段合并且保持稳定顺序。 |
| F05 | 对选中段落重排文字 | 无 Reflow | 缺失 | 不改变原 PDF；必要时只重建阅读文字。 |
| F06 | 段落编辑撤销 | 单步 Undo last change | 部分 | Mac 快照包含标注、书签、阅读位置。 |
| F07 | MinerU 结构化段落禁止破坏性编辑 | Windows 仍可编辑、拆合 | 缺失 | UI 禁用并提示导出 Markdown 修改。 |
| F08 | 图书馆搜索标题与标签 | 搜索框及 library 弹窗 | 对齐 | 中文/大小写、空结果验收。 |
| F09 | 打开旧论文恢复结果、标注、阅读位置 | 加载纸张 JSON、tab/block/page | 部分 | 精确锚点、各视图位置和任务设置待补。 |
| F10 | 编辑图书馆显示标题与标签 | 仅当前论文标签可编辑 | 部分 | 提供独立标题/标签编辑，不修改原文件。 |
| F11 | 自动本地保存、损坏时读 `.backup` | JSON 原子写、备份回退、错误提示 | 对齐 | 故意损坏主文件后恢复最近可读副本。 |
| F12 | 清除保存的 PaperBridge 数据 | 无清除 UI | 缺失 | 明确范围并确认；不要误删用户原 PDF。 |
| F13 | 全局外观与单论文任务设置分开恢复 | Windows 全局 settings + paper 内容 | 部分 | 论文切换需恢复专属任务设置。 |

Mac 证据：[段落编辑](../PaperBridge/PaperReaderViewModel.swift#L1182)、[图书馆](../PaperBridge/Views/PaperLibraryView.swift)、[工作区恢复](../PaperBridge/PaperReaderViewModel.swift#L1474)。Windows 证据：[段落编辑和图书馆](src/main.jsx#L337)、[本地存储](electron/storage.cjs)。

## G. 导出、安装、系统集成

| ID | Mac 1.9 行为 | Windows 0.2 对应 | 状态 | 补齐与验收点 |
| --- | --- | --- | --- | --- |
| G01 | 导出原文 Markdown | Export Original Markdown | 部分 | MinerU 资源不能只依赖 data URI。 |
| G02 | 导出逐段译文 Markdown | Export Translated Markdown | 部分 | 结构化全文译稿与视图使用同一份。 |
| G03 | 导出双语 Markdown | Export Bilingual Markdown | 部分 | 图片、公式与章节留在原位。 |
| G04 | 导出摘要/笔记/证据 Markdown | Export Summary and notes | 部分 | 加入原文摘录及校验状态。 |
| G05 | 资源 bundle、原 PDF、便携页面图片和独立全文译稿 | 只保存一个 `.md`，图片可为内嵌 data URI | 缺失 | 选择目录后形成可移动 bundle，资产引用可解析。 |
| G06 | 首次启动分步引导；可重新打开 | Windows 欢迎页 + 一页 Local AI setup | 部分 | 重现分步说明、模型选择及再次打开入口。 |
| G07 | 自动检测/启动/安装 Ollama | SetupPanel 诊断 + 签名安装器 | 部分 | 真机测试安装、取消、已有安装复用。 |
| G08 | 自动发现、下载并选择模型 | 检测模型、下载当前三个任务模型 | 部分 | Mac 4B/12B/27B 与可选助手模型推荐卡片尚缺。 |
| G09 | 翻译、摘要、解释、快速查词四套模型设置 | Windows 前三套 | 部分 | 增加快速查词模型，并纳入一键检测。 |
| G10 | 独立安装 MinerU，允许手动路径/后端 | 私有 Python/MinerU 安装，路径与后端设置 | 部分 | 多硬件与安装失败回滚真机测试。 |
| G11 | 后台下载及进度、取消 | 安装任务由主进程继续；状态可再打开 | 部分 | 最小化、关弹窗、重开与中途退出的状态恢复。 |
| G12 | 本地 Ollama 限回环地址 | Windows `localOllamaURL` 限 localhost/127.0.0.1/::1 | 对齐 | 各 IPC 入口应统一校验。 |
| G13 | 自带程序菜单与快捷键 | Ctrl+O/F/L、Escape | 部分 | 补翻译、导出、选区、标注、检查器、Overview 快捷键。 |
| G14 | 签名更新源检查及应用内更新 | Windows 无自动更新 | 缺失 | 有 Windows 签名发布后加入受信更新通道。 |
| G15 | 发布安装包 | NSIS 与 portable 构建，当前未签名 | 部分 | 真机安装、卸载与签名后发布验证。 |

Mac 证据：[bundle 导出](../PaperBridge/Services/MarkdownBundleExporter.swift)、[首次引导](../PaperBridge/Views/OnboardingView.swift)、[安装器](../PaperBridge/Services/LocalToolInstaller.swift)、[菜单](../PaperBridge/PaperBridgeApp.swift#L62)、[更新](../PaperBridge/Services/AppUpdateController.swift)。Windows 证据：[导出](src/main.jsx#L295)、[安装 UI](src/SetupPanel.jsx)、[安装逻辑](electron/setup.cjs)、[快捷键](src/main.jsx#L159)、[构建](package.json)。

## Windows 特有的硬件映射

这不是 Mac 功能的同名复制，而是 Windows 的平台适配：`electron/hardware.cjs` 检测显卡及 `nvidia-smi`；`electron/setup.cjs` 在 NVIDIA 驱动报告 CUDA ≥12.6 时选 `cu126`/`cu128` PyTorch wheel，并在 MinerU 私有环境里检查 `torch.cuda.is_available()`。AMD **不能使用 CUDA**；受支持的 AMD/Vulkan 显卡可由 Ollama 自行选择后端，MinerU 维持 CPU pipeline。Settings 可看 Ollama `/api/ps` 的实际 VRAM 使用。当前只有静态代码和自动测试，NVIDIA、AMD、纯 CPU 真机路径仍需逐台验收，不能因检测到显卡就声称已经 GPU 加速。

## 实施顺序和完成标准

1. **P0：阅读和数据正确性** — A07–A09 自动解析策略；A19 参考文献过滤；B04 三种阅读模式；C15 结构化全文译稿；D03–D06 精确证据；E03/E11/E15/E17 标注锚点；F07 MinerU 编辑保护；G05 完整导出。任一项“对齐”须有 Mac 同一用户流程与 Windows 结果对照。
2. **P1：1.9 小功能** — 拖放、练习论文不误替换、跨页修复、质量警告、搜索位置、任意章节/队列插队、整段解释与独立语言、术语搜索、编辑/撤销、图书馆标签和多视图位置。
3. **P2：交付与体验** — 引导页、剩余快捷键、安装器签名与自动更新、窄窗口和设备兼容性。

关闭某一行前，至少使用同一份普通 PDF、双栏 PDF、扫描 PDF、含公式/图片的 MinerU PDF 和粘贴文本做 Mac↔Windows 行为核对；保存、关闭、重启、取消任务、切换论文、导出后复查结果。GPU 安装流程另需 NVIDIA、AMD、纯 CPU 设备分别验收。这里的状态是代码审计结论，并非这些真实设备验收已经完成。
