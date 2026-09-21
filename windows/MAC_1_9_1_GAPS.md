# macOS 1.9.1 新增行为与 Windows 差距

核对日期：2026-09-20。

- Mac 旧基线：`73951d9`，1.9 / build 10。
- Mac 新基线：`33cfb933871a58a63c8a87c935cc42b4be85c2cb`，1.9.1 / build 11；本次 `git fetch` 后的 `origin/main`。两者之间只有提交 `33cfb93`，共修改 16 个文件。
- Windows 对照：当前分支 `windows/` 0.2 工作区，已包含六步引导、设置六分页、推荐模型卡片和之前的阅读修复。
- 方法：读取上述两个 Git tree 的差异，再核对 Windows 实际源码；本报告没有在 Mac 真机运行 1.9.1，也没有把其发布说明中的测试结论当作 Windows 已通过的证据。

本表是 **1.9.1 增量对照**，不替换 [FEATURE_MAPPING.md](FEATURE_MAPPING.md) 的 Mac 1.9 基线。原有 **111 项 / 43 对齐 / 68 部分 / 0 缺失**统计保持不变。下文的“缺失”是新增行为没有 Windows 路径，“部分”是已有基础能力但未满足新增语义；不代表 Windows 整个笔记、保存或导航功能不存在。

## 结论与实施顺序

值得先补的是笔记的完整保存链路：输入即保留到内存，350 ms 合并落盘，离开编辑时立即提交，正常退出等待保存结束，并提供准确的保存状态和重试。随后补阅读 Back / Forward，最后补紧凑双语标题及相关翻译入口。

此次列出 **12 个增量验收项：4 项缺失、8 项部分**。其中无效标注的复用、标题翻译被排除等问题是新对照暴露出的既有差距，不应写成 Windows 从上一版本产生的回归。

| ID | 优先级 / 状态 | Mac 1.9.1 行为与源码 | Windows 当前证据与差距 | 完成验收标准 |
| --- | --- | --- | --- | --- |
| R191-01 | P1 · **缺失** | 笔记编辑直接更新选区对应的 annotation；每次输入取消前一个任务，停顿 **350 ms** 后 `persistWorkspace()`。[Selection:157][mac-note]；编辑器直接绑定模型，[Inspector:272][mac-editor]。 | [main.jsx:370](src/main.jsx#L370) 的 `noteDraft` 是独立组件状态；[main.jsx:1341](src/main.jsx#L1341) 只在 `onChange` 中 `setNoteDraft`，需要显式 `Save note` 才调用 [saveNote:1137](src/main.jsx#L1137)。[main.jsx:512](src/main.jsx#L512) 的 350 ms 定时器用于滚动位置，不能算笔记自动保存。 | 在 Reader 原文/译文、Paper、Summary 原文/译文、Full Translation、Original PDF 中输入笔记，不点保存；连续输入只保留一个待写任务，停顿后落盘，重启恢复。测试应等待真实保存完成，不能仅看到内存里出现笔记。 |
| R191-02 | P1 · **缺失** | 切选区、清选区调用 `finishNoteEditing()`；检查器消失也调用；换论文先保存旧 workspace；关窗和正常退出执行 `flushPendingSaves()`，等待存储队列。[Selection:40/62/187][mac-selection]、[Inspector:21][mac-inspector]、[ViewModel:1497][mac-load]、[App:7/51][mac-app]、[Store:130][mac-store]。 | `captureSelection()` 直接覆盖旧 `noteDraft`，[main.jsx:1088](src/main.jsx#L1088)。关检查器仅 `setInspector(false)`；换论文的 [loadPaper:418](src/main.jsx#L418) 会等待**已经提交的** `saveChain`，但不会提交未按 Save 的草稿。`before-quit` 只取消安装/下载/OCR，[electron/main.cjs:338](electron/main.cjs#L338)，没有 renderer 草稿与滚动定时器的退出 flush。 | 输入后不足 350 ms 分别执行：选另一段、关闭选区、关检查器、切视图、切论文、关窗口和正常 Quit；重开均保留旧选区的最后输入。正常退出应等待 renderer→IPC→落盘完成；不要承诺强杀进程或断电时保留 debounce 窗口内的按键。 |
| R191-03 | P1 · **部分** | 新编辑路径保留笔记原始换行、尾部空格；清空 note 会删除无高亮的 annotation，或只清空文字、保留其高亮。[Selection:157][mac-note]；[Regression:261][mac-tests] 有原始空白与保留高亮的断言。 | Windows 已有独立删除笔记/高亮的路径，可分别保留；但 [saveNote:1137](src/main.jsx#L1137) 用 `noteDraft.trim()` 判断和存储，空字符串直接返回，不能在编辑器里清空旧笔记，首尾空白也会改变。 | 输入 `Draft line one\nLine two  ` 后重开逐字符相同；清空笔记后它从笔记列表移除，而同一选区的高亮仍存在；Undo 能恢复被清空的文字。 |
| R191-04 | P1 · **部分** | 一次连续笔记编辑只建立一个撤销快照；350 ms 落盘不会切断编辑会话。换选区/结束编辑后，下次输入建立新快照。撤销会提交恢复值，旧定时器不能随后写回新值。上限仍为 **20 条**，[Selection:157/205/211][mac-selection]。 | Windows 已有会话内 20 条撤销、注释字段定向回滚和结构修复撤销：[commitPaper:405](src/main.jsx#L405)、[undoLastChange:498](src/main.jsx#L498)、[paperUndo.mjs:18](src/paperUndo.mjs#L18)。目前按手动 Save 建快照；`undoLastChange` 没有同步独立 `noteDraft`，也没有自动保存的编辑会话分组。现有避免回滚后续 AI 输出的保护应保留。 | 同一选区多次输入、跨多个 350 ms 停顿后，一次 Undo 回到本次开始编辑前；切选区回来产生新的撤销单元。Undo 后编辑器与保存内容一致，等待旧定时器也不覆盖；同时完成的翻译、摘要和解释不能被回滚。撤销历史无需跨应用重启持久化。 |
| R191-05 | P1 · **缺失** | 编辑回调同时携带原论文 checksum 和原 selection，二者必须仍匹配；迟到的旧编辑器回调直接丢弃。[Selection:157][mac-note]、[Inspector:272][mac-editor]。 | Windows 已为 AI 选区结果做 identity 隔离，[main.jsx:858](src/main.jsx#L858)，但 note 目前只有 `noteDraft` 和当前 `selection` 的手动保存路径，尚没有对应的自动保存任务身份。不能将 AI 请求的保护视为笔记编辑回调已受保护。 | 选区 A 输入后立刻切 B，迟到 A 回调不能改 B；切到内容相同但 paper id 不同的论文也必须拒绝旧回调。保存对象应固定为编辑事件原始 paper + scope + side + anchor，不能在延迟回调执行时取“当前选区”替代。 |
| R191-06 | P1 · **部分** | 保存时显示 Saving，最近一次实际完成后才显示 Saved；旧保存完成不能覆盖新请求状态。失败保留内存内容，常驻错误及 **Retry Save**。[ViewModel:2455][mac-save]、[Content:1236][mac-status]、[Store:108][mac-store]。 | Windows `commitPaper` 先更新内存，再把 `api.savePaper(next)` 串入 Promise；失败会提示 `Could not save paper`，[main.jsx:405](src/main.jsx#L405)。但 `saveNote` 紧接着就显示 `Note saved`，并未等待 IPC 完成；错误放在滚动内容中，没有待保存/已落盘状态，也没有 Retry Save 按钮。底层 [storage.cjs:37](electron/storage.cjs#L37) 已有临时文件+rename及 backup，这不等同于 UI 保存完成确认。 | 注入延迟成功：IPC 未完成时不能显示 Saved；注入写失败：文字仍在内存、状态持续失败且可重试；恢复可写后 Retry Save 成功落盘再改为 Saved。旧请求错误/成功不覆盖更新请求状态，换论文后也不误报到新论文。 |
| R191-07 | P2 · **部分** | 正在进行的任务消息、确定/不确定进度条和本地保存状态固定在文档滚动面外；保存失败提示和重试同样留在此区域。[Content:478][mac-workspace]、[Content:1236][mac-status]。 | 已有 `TaskProgress` 和 Stop，能显示完成数、失败数、不确定进度：[main.jsx:245](src/main.jsx#L245)。但 [main.jsx:1305](src/main.jsx#L1305) 把 `TaskProgress`、错误和普通状态一起放入 `.main-scroll`；[parity.css:20](src/parity.css#L20) 没有 sticky/fixed。设置页固定的**模型下载栏**属于另一个界面，不能算阅读任务进度已固定。 | 长论文滚到中部和末尾，翻译/摘要/OCR 的进度和停止入口仍可见；保存失败与 Retry Save 不随正文滚走。验证 980×620、检查器打开/关闭、150% 页面缩放，正文仍有可滚动空间。 |
| R191-08 | P2 · **缺失** | 当前论文有 Back / Forward 两个栈；跳转记录去重，上限 50；新跳转清空 Forward；无效目的地不污染历史。章节、书签、摘要来源、标注和 Compare Original 等跳转接入。换论文与结构修复重置；仅本会话存在。[Library:7–56][mac-history]、[ViewModel:504][mac-jump]、[App:90][mac-menu]。 | 当前只有目的地跳转：`navigate`、`navigateBlockAnnotation`、`navigateView`、`navigatePdf`，[main.jsx:1180](src/main.jsx#L1180)。原文 PDF 的左右箭头是翻页，不是阅读历史。没有 Back/Forward 栈、对应头部按钮或原生菜单命令；[electron/main.cjs:267](electron/main.cjs#L267) 的菜单也未提供。 | 从 Summary 来源/目录/书签/标注跳转后可以 Back，再 Forward；重复跳同一位置不产生空步，Back 后新跳转清除旧 Forward，最多保留 50。换论文、结构编辑后按钮禁用。Windows 按平台提供快捷键（如 Ctrl+[ / Ctrl+]）及动态菜单可用状态。 |
| R191-09 | P2 · **部分** | `ReadingLocation` 同时保存 workspace mode、display mode、选中段落、search text 和每个 surface 的位置。回退恢复这些值并重建阅读面；`readingRestorationID` 拒绝旧视口回调。Reader 位置到 block/resource，PDF 仍为 page 级，并非任意字符坐标。[Models:501][mac-location]、[Library:34][mac-history]、[Content:977][mac-position]。 | Windows 已保存 `position.block/tab/displayMode/page` 和 `scrollByTab`，恢复各视图滚动；[main.jsx:504](src/main.jsx#L504)、[main.jsx:706](src/main.jsx#L706)。清搜索也能返回一次 `searchOrigin`，[main.jsx:531](src/main.jsx#L531)。但这是一组当前阅读状态，没有历史快照中的 search/view/位置组合；滚动保存回调只校验 paper id，缺少“同论文不同恢复代次”的保护。 | 从带搜索的 Reader、滚到中段的 Summary/Full Translation、Original 第 2 页分别跳走，再 Back 恢复原 view、展示模式、search、block/resource/page/滚动锚点；旧视口迟到回调不能改掉恢复后的状态。不要把 PDF 任意像素精度写为 Mac 本次已保证的功能。 |
| R191-10 | P2 · **部分** | 独立标题只显示一次紧凑行，可双语显示；支持 Translate/Retry Heading、错误说明、书签、解释、结构编辑菜单；source-only/translation-only遵循标题当前翻译状态。[Content:908][mac-heading-call]、[Content:1273][mac-heading]。 | Windows `.heading-block` 已缩小上下 padding，标题没有额外重复的 section marker，已有书签/编辑入口。但仍沿用 block card；`translateBlocks` 明确排除 `block.heading`，[main.jsx:827](src/main.jsx#L827)，Reader 也不渲染标题译文且禁用整段解释，[main.jsx:1322](src/main.jsx#L1322)。现有标题 Translate 图标会进入空队列，因此新增双语紧凑标题不能仅改 CSS。 | `Abstract` / `2 Methods` / Markdown 自定义标题只呈现一个标题块；单独翻译、失败重试、双语/原文/译文模式均显示正确；标题原文和译文可选择、标注、书签；解释/结构菜单遵守来源编辑权限。对应导出中的标题译文也需明确处理，不能仍无条件只输出源标题。 |
| R191-11 | P2 · **部分** | 紧凑标题只接受整段等于已识别标题，或单行 Markdown heading、单行非空文本且不超过 200 字符；标题与正文同段时保留整段。[TextProcessing:268][mac-title-test]。 | Windows 普通标题用 [text.mjs:3](src/text.mjs#L3) 的正则和 100 字符限制；粘贴分段会将段内换行合并为空格，[text.mjs:12](src/text.mjs#L12)。结构化 Markdown 能区分 heading，[academicMarkdown.mjs:33/87](src/academicMarkdown.mjs#L33)，但两条输入路径没有统一“独立标题”判定。例如 `2 Methods\nWe retained all evidence` 合成一行后可被编号标题正则接受，并因 heading 标志从翻译队列排除。 | 纯标题可紧凑；`Abstract. We tested…`、`2 Methods\nWe retained all evidence.` 和不带末尾句号的同类段落保留全部正文并可翻译；`## Study design` 被识别为标题，带正文的 Markdown 不能整体替换成标题。用输入和输出内容断言，避免只检查样式 class。 |
| R191-12 | P1 · **部分** | `annotationIndex` 新增排除 `needsReview == true`，待核对的旧笔记不再被当作当前有效选区自动取出/覆盖。Reader 标注跳转把改视图的时机移到目标检查之后；已有的 `activateAnnotation` 保护继续保留。[Selection:219/514][mac-invalid]。 | Windows 已在列表显示“source changed, review needed”，并对引用文字/offset做 exact 校验；结构编辑会保留并标记笔记：[paper.mjs:109](src/paper.mjs#L109)、[main.jsx:308](src/main.jsx#L308)。但 `captureSelection` / `pdfNavigationReady` 的 `.find` 以及 `saveNote` 的 existing 匹配都未排除 `needsReview`；保存时还可能直接置为 false。[main.jsx:1104](src/main.jsx#L1104)、[main.jsx:1137](src/main.jsx#L1137)、[main.jsx:1197](src/main.jsx#L1197)。`navigateBlockAnnotation` 在随后 exact 验证前就改 tab/mode。[main.jsx:1181](src/main.jsx#L1181)。 | 预置 `needsReview:true` 且同 quote/offset 的旧记录：重新选择文字时不自动载入旧 note，编辑新 note 不覆盖或静默“修复”旧记录；旧记录仍能查看/删除。不存在的段落不能改变当前阅读 view；无效 quote 不生成虚假高亮，提供核对提示。对 Reader 原文/译文、PDF、Summary/Full Translation 分别测。 |

## 建议的验证批次

### 第一批：笔记与保存可靠性（R191-01～06、12）

先把“编辑状态归属”和“存储完成状态”建立起来，再接自动保存。单元测试负责 debounce、会话 Undo、identity 与 invalid anchor；真实 Electron 流程负责输入、切选区、关检查器、换论文、正常关窗重开、写入失败与 Retry。保留 Windows 已有的“撤销不回滚后续 AI 结果”回归。

Mac [ReadingReliabilityRegression.swift:261][mac-tests] 已提供可移植案例：连续输入仅一个 Undo、保留空白、切选区前自动保存、迟到回调隔离、450 ms 后落盘、Undo 后定时任务不覆盖、换论文隔离、清空 note 保留 highlight、写失败及重试。时间断言应留调度余量，不能只固定 sleep 后假定磁盘写入已完成。

### 第二批：阅读连续性（R191-07～09）

建立同论文 50 条历史以及统一位置快照。用不同 view、搜索、段落、资源、PDF 页的起点验证真实 Back / Forward；恢复后再触发旧 scroll callback，确认不覆盖。把常驻任务进度与保存状态同时放到非滚动区域验收。单次“跳到段落成功”不能证明能够返回原阅读位置。

### 第三批：标题体验（R191-10～11）

先统一标题独立性判定和标题翻译路径，再调整紧凑排版；同时核对双语导出、标注和标题动作。Mac 本次更改主要是标题检测和呈现，Windows 对 heading 的翻译排除属于此前实现差异，补齐时需独立检查正文统计、重试和剩余翻译任务数。

## 本次范围外与证据边界

- 1.9.1 没有新增图书馆备份导入、逐论文删除或多论文后台任务；不能把这些写成本次 Mac 更新已具备的行为。
- Mac 的 1.9.1/build 11 版本号、Xcode `netrc` 包认证参数、发布脚本保留依赖缓存/符号及锁定 resolved package version 属于 Mac 构建发布变更，不计入上面的 Windows 阅读功能缺失。Windows 的正式签名和更新机制仍应在发布清单单独处理。
- 此报告完成的是源码增量审查及验收设计。当前 Windows 的已有测试通过情况应看主报告；没有执行这些**尚未实现**的新验收，因此不能把本表标为已对齐。

## 固定版本源码索引

Mac 链接固定到 `33cfb933…`，避免后续 `origin/main` 移动后改变本次证据。Windows 链接指向此工作区对应实现；后续补齐时应更新状态和证据，不回写旧 1.9 基线统计。

[mac-selection]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/PaperReaderViewModel%2BSelection.swift#L40
[mac-note]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/PaperReaderViewModel%2BSelection.swift#L157
[mac-editor]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/Views/SelectionInspectorView.swift#L272
[mac-inspector]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/Views/SelectionInspectorView.swift#L21
[mac-load]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/PaperReaderViewModel.swift#L1497
[mac-app]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/PaperBridgeApp.swift#L7
[mac-store]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/Services/WorkspaceStore.swift#L108
[mac-tests]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/Tests/ReadingReliabilityRegression.swift#L261
[mac-save]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/PaperReaderViewModel.swift#L2455
[mac-status]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/ContentView.swift#L1236
[mac-workspace]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/ContentView.swift#L478
[mac-history]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/PaperReaderViewModel%2BLibrary.swift#L7
[mac-jump]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/PaperReaderViewModel.swift#L504
[mac-menu]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/PaperBridgeApp.swift#L90
[mac-location]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/Models.swift#L501
[mac-position]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/ContentView.swift#L977
[mac-heading-call]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/ContentView.swift#L908
[mac-heading]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/ContentView.swift#L1273
[mac-title-test]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/Services/TextProcessing.swift#L268
[mac-invalid]: https://github.com/haoyunLi/PaperBridge/blob/33cfb933871a58a63c8a87c935cc42b4be85c2cb/PaperBridge/PaperReaderViewModel%2BSelection.swift#L514
