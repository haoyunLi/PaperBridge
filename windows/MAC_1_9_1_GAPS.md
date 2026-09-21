# macOS 1.9.1 新增行为与 Windows 差距

核对日期：2026-09-21。

- Mac 旧基线：`73951d9`，1.9 / build 10。
- Mac 新基线：`33cfb933871a58a63c8a87c935cc42b4be85c2cb`，1.9.1 / build 11；本次 `git fetch` 后的 `origin/main`。两者之间只有提交 `33cfb93`，共修改 16 个文件。
- Windows 对照：当前分支 `windows/` 0.2 工作区，已包含六步引导、设置六分页、推荐模型卡片和之前的阅读修复。
- 方法：读取上述两个 Git tree 的差异，再核对 Windows 实际源码；本报告没有在 Mac 真机运行 1.9.1，也没有把其发布说明中的测试结论当作 Windows 已通过的证据。

本表是 **1.9.1 增量对照**，不替换 [FEATURE_MAPPING.md](FEATURE_MAPPING.md) 的 Mac 1.9 基线。原有 **111 项 / 43 对齐 / 68 部分 / 0 缺失**统计保持不变。下文的“缺失”是新增行为没有 Windows 路径，“部分”是已有基础能力但未满足新增语义；不代表 Windows 整个笔记、保存或导航功能不存在。

## 结论与实施顺序

笔记的完整保存链路已补齐：输入即更新内存、350 ms 合并落盘、离开编辑与正常退出 flush，并提供真实 Saving / Saved / Error / Retry 状态。下一批集中补阅读 Back / Forward 与完整位置恢复，随后处理紧凑双语标题。

此次列出 **12 个增量验收项：8 项对齐、3 项部分、1 项缺失**。其中无效标注的复用、标题翻译被排除等问题是新对照暴露出的既有差距，不应写成 Windows 从上一版本产生的回归。

| ID | 优先级 / 状态 | Mac 1.9.1 行为与源码 | Windows 当前证据与差距 | 完成验收标准 |
| --- | --- | --- | --- | --- |
| R191-01 | P1 · **对齐** | 笔记输入停顿 350 ms 后持久化。 | `updateNote` 直接更新选区 annotation，`paperSaveQueue.mjs` 合并待写快照；Reader、Paper、PDF、Summary 两侧及 Full Translation 共用 `noteAnnotations.mjs`。 | 单元覆盖全部 surface；`note-autosave-e2e.cjs` 验证真实 350 ms 落盘及重启恢复。 |
| R191-02 | P1 · **对齐** | 离开编辑、换选区/论文、关窗与 Quit flush。 | 选区、检查器、分页、tab、论文载入均调用 `finishNoteEditing()`；主进程关闭握手等待 renderer 保存，失败会取消关闭并留在应用内。 | Electron 回归验证选区切换与 debounce 窗口内直接退出后重启仍保留最后输入。 |
| R191-03 | P1 · **对齐** | 原样保留空白；空字符串清除 note 并保留 highlight。 | `applySelectionNote` 不再 trim；只把精确空字符串视为删除，笔记和高亮继续独立保存。 | 单元及 Electron 覆盖换行/首尾空格、空白 note、清空 note、保留高亮。 |
| R191-04 | P1 · **对齐** | 连续编辑为一个撤销会话；旧定时器不能覆盖 Undo。 | note 会话延迟生成最终 undo entry，结束编辑才封口；即时 Undo 会取消旧 debounce 并保存恢复快照，编辑器同步恢复。 | Electron 覆盖多次输入一次 Undo；原有 `paper-undo` 回归继续保证后续 AI 输出不被回滚。 |
| R191-05 | P1 · **对齐** | 回调必须匹配原 paper 与 selection。 | textarea 以 paper + scope + side + anchor identity 为 key，并把事件创建时 identity 传回；`sameNoteSelection` 在写入前与当前 paper/selection 双重比对。 | 单元验证相同文字跨论文/跨 surface 不匹配；旧编辑器节点卸载后不能写到新选区。 |
| R191-06 | P1 · **对齐** | Saving / Saved 只反映最新请求；失败保留内存并可 Retry。 | 串行保存队列按 revision 隔离旧结果，保存失败保留最新完整 snapshot；固定状态栏提供 Retry Save。 | 单元注入延迟/失败；Electron 注入真实 IPC 首次失败并验证常驻错误、重试落盘。 |
| R191-07 | P2 · **对齐** | 任务、保存及失败重试固定在正文滚动区外。 | `workspace-status-rail` 位于 header 与 `.main-scroll` 之间，容纳更新、任务进度/Stop、保存状态与 Retry。 | 1320×900 Electron 截图和完整流程已验证；现有 980×620 响应式回归继续覆盖正文可滚动空间。 |
| R191-08 | P2 · **缺失** | 当前论文有 Back / Forward 两个栈；跳转记录去重，上限 50；新跳转清空 Forward；无效目的地不污染历史。章节、书签、摘要来源、标注和 Compare Original 等跳转接入。换论文与结构修复重置；仅本会话存在。[Library:7–56][mac-history]、[ViewModel:504][mac-jump]、[App:90][mac-menu]。 | 当前只有目的地跳转：`navigate`、`navigateBlockAnnotation`、`navigateView`、`navigatePdf`，[main.jsx:1180](src/main.jsx#L1180)。原文 PDF 的左右箭头是翻页，不是阅读历史。没有 Back/Forward 栈、对应头部按钮或原生菜单命令；[electron/main.cjs:267](electron/main.cjs#L267) 的菜单也未提供。 | 从 Summary 来源/目录/书签/标注跳转后可以 Back，再 Forward；重复跳同一位置不产生空步，Back 后新跳转清除旧 Forward，最多保留 50。换论文、结构编辑后按钮禁用。Windows 按平台提供快捷键（如 Ctrl+[ / Ctrl+]）及动态菜单可用状态。 |
| R191-09 | P2 · **部分** | `ReadingLocation` 同时保存 workspace mode、display mode、选中段落、search text 和每个 surface 的位置。回退恢复这些值并重建阅读面；`readingRestorationID` 拒绝旧视口回调。Reader 位置到 block/resource，PDF 仍为 page 级，并非任意字符坐标。[Models:501][mac-location]、[Library:34][mac-history]、[Content:977][mac-position]。 | Windows 已保存 `position.block/tab/displayMode/page` 和 `scrollByTab`，恢复各视图滚动；[main.jsx:504](src/main.jsx#L504)、[main.jsx:706](src/main.jsx#L706)。清搜索也能返回一次 `searchOrigin`，[main.jsx:531](src/main.jsx#L531)。但这是一组当前阅读状态，没有历史快照中的 search/view/位置组合；滚动保存回调只校验 paper id，缺少“同论文不同恢复代次”的保护。 | 从带搜索的 Reader、滚到中段的 Summary/Full Translation、Original 第 2 页分别跳走，再 Back 恢复原 view、展示模式、search、block/resource/page/滚动锚点；旧视口迟到回调不能改掉恢复后的状态。不要把 PDF 任意像素精度写为 Mac 本次已保证的功能。 |
| R191-10 | P2 · **部分** | 独立标题只显示一次紧凑行，可双语显示；支持 Translate/Retry Heading、错误说明、书签、解释、结构编辑菜单；source-only/translation-only遵循标题当前翻译状态。[Content:908][mac-heading-call]、[Content:1273][mac-heading]。 | Windows `.heading-block` 已缩小上下 padding，标题没有额外重复的 section marker，已有书签/编辑入口。但仍沿用 block card；`translateBlocks` 明确排除 `block.heading`，[main.jsx:827](src/main.jsx#L827)，Reader 也不渲染标题译文且禁用整段解释，[main.jsx:1322](src/main.jsx#L1322)。现有标题 Translate 图标会进入空队列，因此新增双语紧凑标题不能仅改 CSS。 | `Abstract` / `2 Methods` / Markdown 自定义标题只呈现一个标题块；单独翻译、失败重试、双语/原文/译文模式均显示正确；标题原文和译文可选择、标注、书签；解释/结构菜单遵守来源编辑权限。对应导出中的标题译文也需明确处理，不能仍无条件只输出源标题。 |
| R191-11 | P2 · **部分** | 紧凑标题只接受整段等于已识别标题，或单行 Markdown heading、单行非空文本且不超过 200 字符；标题与正文同段时保留整段。[TextProcessing:268][mac-title-test]。 | Windows 普通标题用 [text.mjs:3](src/text.mjs#L3) 的正则和 100 字符限制；粘贴分段会将段内换行合并为空格，[text.mjs:12](src/text.mjs#L12)。结构化 Markdown 能区分 heading，[academicMarkdown.mjs:33/87](src/academicMarkdown.mjs#L33)，但两条输入路径没有统一“独立标题”判定。例如 `2 Methods\nWe retained all evidence` 合成一行后可被编号标题正则接受，并因 heading 标志从翻译队列排除。 | 纯标题可紧凑；`Abstract. We tested…`、`2 Methods\nWe retained all evidence.` 和不带末尾句号的同类段落保留全部正文并可翻译；`## Study design` 被识别为标题，带正文的 Markdown 不能整体替换成标题。用输入和输出内容断言，避免只检查样式 class。 |
| R191-12 | P1 · **对齐** | `needsReview` 不参与当前选区匹配；无效跳转先校验。 | 所有 note 查找/更新排除 review 记录；Reader 与 Markdown 在改 tab/mode 前验证，PDF review 记录也会在导航前拒绝。旧记录仍可见和删除。 | 单元预置同 quote/offset 的 review note；Markdown Electron 回归确认无效 Reader 跳转保留原 view/selection并标记记录。 |

## 建议的验证批次

### 第一批：笔记与保存可靠性（R191-01～06、12）

**已完成。** 编辑状态归属、存储完成状态、自动保存、关闭握手和无效锚点隔离已经接入。单元测试覆盖 debounce、会话 Undo、identity 与 invalid anchor；真实 Electron 流程覆盖输入、切选区、正常关窗重开、写入失败与 Retry，并保留 Windows 已有的“撤销不回滚后续 AI 结果”回归。

Mac [ReadingReliabilityRegression.swift:261][mac-tests] 已提供可移植案例：连续输入仅一个 Undo、保留空白、切选区前自动保存、迟到回调隔离、450 ms 后落盘、Undo 后定时任务不覆盖、换论文隔离、清空 note 保留 highlight、写失败及重试。时间断言应留调度余量，不能只固定 sleep 后假定磁盘写入已完成。

### 第二批：阅读连续性（R191-07～09）

建立同论文 50 条历史以及统一位置快照。用不同 view、搜索、段落、资源、PDF 页的起点验证真实 Back / Forward；恢复后再触发旧 scroll callback，确认不覆盖。把常驻任务进度与保存状态同时放到非滚动区域验收。单次“跳到段落成功”不能证明能够返回原阅读位置。

### 第三批：标题体验（R191-10～11）

先统一标题独立性判定和标题翻译路径，再调整紧凑排版；同时核对双语导出、标注和标题动作。Mac 本次更改主要是标题检测和呈现，Windows 对 heading 的翻译排除属于此前实现差异，补齐时需独立检查正文统计、重试和剩余翻译任务数。

## 本次范围外与证据边界

- 1.9.1 没有新增图书馆备份导入、逐论文删除或多论文后台任务；不能把这些写成本次 Mac 更新已具备的行为。
- Mac 的 1.9.1/build 11 版本号、Xcode `netrc` 包认证参数、发布脚本保留依赖缓存/符号及锁定 resolved package version 属于 Mac 构建发布变更，不计入上面的 Windows 阅读功能缺失。Windows 的正式签名和更新机制仍应在发布清单单独处理。
- 本报告现在同时记录源码增量审查和第一批落地证据。R191-08～11 仍需按后两批验收，不能因笔记链路完成就把整个 1.9.1 增量标为一比一。

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
