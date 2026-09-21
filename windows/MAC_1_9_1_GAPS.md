# macOS 1.9.1 新增行为与 Windows 差距

核对日期：2026-09-21。

- Mac 旧基线：`73951d9`，1.9 / build 10。
- Mac 新基线：`33cfb933871a58a63c8a87c935cc42b4be85c2cb`，1.9.1 / build 11；本次 `git fetch` 后的 `origin/main`。两者之间只有提交 `33cfb93`，共修改 16 个文件。
- Windows 对照：当前分支 `windows/` 0.2 工作区，已包含六步引导、设置六分页、推荐模型卡片和之前的阅读修复。
- 方法：读取上述两个 Git tree 的差异，再核对 Windows 实际源码；本报告没有在 Mac 真机运行 1.9.1，也没有把其发布说明中的测试结论当作 Windows 已通过的证据。

本表是 **1.9.1 增量对照**，不替换 [FEATURE_MAPPING.md](FEATURE_MAPPING.md) 的 Mac 1.9 基线。原有 **111 项 / 43 对齐 / 68 部分 / 0 缺失**统计保持不变。下文的“缺失”是新增行为没有 Windows 路径，“部分”是已有基础能力但未满足新增语义；不代表 Windows 整个笔记、保存或导航功能不存在。

## 结论与实施顺序

笔记保存链路与阅读 Back / Forward 已补齐。Windows 现在会记录最多 50 条会话阅读位置，恢复 tab、显示模式、搜索、段落/PDF 页及各 surface 滚动位置，并隔离旧滚动回调。最后一批集中处理紧凑双语标题与正确标题分类。

此次列出 **12 个增量验收项：10 项对齐、2 项部分、0 项缺失**。其中标题翻译被排除等问题是新对照暴露出的既有差距，不应写成 Windows 从上一版本产生的回归。

| ID | 优先级 / 状态 | Mac 1.9.1 行为与源码 | Windows 当前证据与差距 | 完成验收标准 |
| --- | --- | --- | --- | --- |
| R191-01 | P1 · **对齐** | 笔记输入停顿 350 ms 后持久化。 | `updateNote` 直接更新选区 annotation，`paperSaveQueue.mjs` 合并待写快照；Reader、Paper、PDF、Summary 两侧及 Full Translation 共用 `noteAnnotations.mjs`。 | 单元覆盖全部 surface；`note-autosave-e2e.cjs` 验证真实 350 ms 落盘及重启恢复。 |
| R191-02 | P1 · **对齐** | 离开编辑、换选区/论文、关窗与 Quit flush。 | 选区、检查器、分页、tab、论文载入均调用 `finishNoteEditing()`；主进程关闭握手等待 renderer 保存，失败会取消关闭并留在应用内。 | Electron 回归验证选区切换与 debounce 窗口内直接退出后重启仍保留最后输入。 |
| R191-03 | P1 · **对齐** | 原样保留空白；空字符串清除 note 并保留 highlight。 | `applySelectionNote` 不再 trim；只把精确空字符串视为删除，笔记和高亮继续独立保存。 | 单元及 Electron 覆盖换行/首尾空格、空白 note、清空 note、保留高亮。 |
| R191-04 | P1 · **对齐** | 连续编辑为一个撤销会话；旧定时器不能覆盖 Undo。 | note 会话延迟生成最终 undo entry，结束编辑才封口；即时 Undo 会取消旧 debounce 并保存恢复快照，编辑器同步恢复。 | Electron 覆盖多次输入一次 Undo；原有 `paper-undo` 回归继续保证后续 AI 输出不被回滚。 |
| R191-05 | P1 · **对齐** | 回调必须匹配原 paper 与 selection。 | textarea 以 paper + scope + side + anchor identity 为 key，并把事件创建时 identity 传回；`sameNoteSelection` 在写入前与当前 paper/selection 双重比对。 | 单元验证相同文字跨论文/跨 surface 不匹配；旧编辑器节点卸载后不能写到新选区。 |
| R191-06 | P1 · **对齐** | Saving / Saved 只反映最新请求；失败保留内存并可 Retry。 | 串行保存队列按 revision 隔离旧结果，保存失败保留最新完整 snapshot；固定状态栏提供 Retry Save。 | 单元注入延迟/失败；Electron 注入真实 IPC 首次失败并验证常驻错误、重试落盘。 |
| R191-07 | P2 · **对齐** | 任务、保存及失败重试固定在正文滚动区外。 | `workspace-status-rail` 位于 header 与 `.main-scroll` 之间，容纳更新、任务进度/Stop、保存状态与 Retry。 | 1320×900 Electron 截图和完整流程已验证；现有 980×620 响应式回归继续覆盖正文可滚动空间。 |
| R191-08 | P2 · **对齐** | 同论文 Back / Forward 两栈，去重、上限 50、新跳转清 Forward，无效目的地不入栈。 | `readingHistory.mjs` 管理会话历史；目录、书签、阅读地图、摘要来源、Reader/Markdown/PDF 标注及比较入口接入。头部按钮、Ctrl+[ / Ctrl+] 和原生 Paper 菜单动态启停。结构编辑、来源切换和换论文重置。 | 单元覆盖去重/50 条/分支；Electron 覆盖往返、重复跳转、新分支、快捷键、结构与论文隔离。 |
| R191-09 | P2 · **对齐** | 位置包含 workspace/display/search 与各 surface 位置；旧恢复回调必须失效。 | 历史快照保存 tab、displayMode、search、block、PDF page 和完整 `scrollByTab`；恢复代次会取消旧 scroll timer，并拒绝旧 requestAnimationFrame/350 ms 回调。 | Electron 实测 Summary 滚动、Reader 搜索、PDF 第 2 页及迟到滚动回调；纯逻辑测试覆盖完整 surface map。 |
| R191-10 | P2 · **部分** | 独立标题只显示一次紧凑行，可双语显示；支持 Translate/Retry Heading、错误说明、书签、解释、结构编辑菜单；source-only/translation-only遵循标题当前翻译状态。[Content:908][mac-heading-call]、[Content:1273][mac-heading]。 | Windows `.heading-block` 已缩小上下 padding，标题没有额外重复的 section marker，已有书签/编辑入口。但仍沿用 block card；`translateBlocks` 明确排除 `block.heading`，[main.jsx:827](src/main.jsx#L827)，Reader 也不渲染标题译文且禁用整段解释，[main.jsx:1322](src/main.jsx#L1322)。现有标题 Translate 图标会进入空队列，因此新增双语紧凑标题不能仅改 CSS。 | `Abstract` / `2 Methods` / Markdown 自定义标题只呈现一个标题块；单独翻译、失败重试、双语/原文/译文模式均显示正确；标题原文和译文可选择、标注、书签；解释/结构菜单遵守来源编辑权限。对应导出中的标题译文也需明确处理，不能仍无条件只输出源标题。 |
| R191-11 | P2 · **部分** | 紧凑标题只接受整段等于已识别标题，或单行 Markdown heading、单行非空文本且不超过 200 字符；标题与正文同段时保留整段。[TextProcessing:268][mac-title-test]。 | Windows 普通标题用 [text.mjs:3](src/text.mjs#L3) 的正则和 100 字符限制；粘贴分段会将段内换行合并为空格，[text.mjs:12](src/text.mjs#L12)。结构化 Markdown 能区分 heading，[academicMarkdown.mjs:33/87](src/academicMarkdown.mjs#L33)，但两条输入路径没有统一“独立标题”判定。例如 `2 Methods\nWe retained all evidence` 合成一行后可被编号标题正则接受，并因 heading 标志从翻译队列排除。 | 纯标题可紧凑；`Abstract. We tested…`、`2 Methods\nWe retained all evidence.` 和不带末尾句号的同类段落保留全部正文并可翻译；`## Study design` 被识别为标题，带正文的 Markdown 不能整体替换成标题。用输入和输出内容断言，避免只检查样式 class。 |
| R191-12 | P1 · **对齐** | `needsReview` 不参与当前选区匹配；无效跳转先校验。 | 所有 note 查找/更新排除 review 记录；Reader 与 Markdown 在改 tab/mode 前验证，PDF review 记录也会在导航前拒绝。旧记录仍可见和删除。 | 单元预置同 quote/offset 的 review note；Markdown Electron 回归确认无效 Reader 跳转保留原 view/selection并标记记录。 |

## 建议的验证批次

### 第一批：笔记与保存可靠性（R191-01～06、12）

**已完成。** 编辑状态归属、存储完成状态、自动保存、关闭握手和无效锚点隔离已经接入。单元测试覆盖 debounce、会话 Undo、identity 与 invalid anchor；真实 Electron 流程覆盖输入、切选区、正常关窗重开、写入失败与 Retry，并保留 Windows 已有的“撤销不回滚后续 AI 结果”回归。

Mac [ReadingReliabilityRegression.swift:261][mac-tests] 已提供可移植案例：连续输入仅一个 Undo、保留空白、切选区前自动保存、迟到回调隔离、450 ms 后落盘、Undo 后定时任务不覆盖、换论文隔离、清空 note 保留 highlight、写失败及重试。时间断言应留调度余量，不能只固定 sleep 后假定磁盘写入已完成。

### 第二批：阅读连续性（R191-07～09）

**已完成。** 同论文 50 条历史、统一位置快照和非滚动任务/保存状态已接入。专项 Electron 回归从 Summary、Reader 搜索和 Original PDF 第 2 页执行真实 Back / Forward，并在恢复后等待旧 scroll callback，确认不会覆盖恢复位置。

### 第三批：标题体验（R191-10～11）

先统一标题独立性判定和标题翻译路径，再调整紧凑排版；同时核对双语导出、标注和标题动作。Mac 本次更改主要是标题检测和呈现，Windows 对 heading 的翻译排除属于此前实现差异，补齐时需独立检查正文统计、重试和剩余翻译任务数。

## 本次范围外与证据边界

- 1.9.1 没有新增图书馆备份导入、逐论文删除或多论文后台任务；不能把这些写成本次 Mac 更新已具备的行为。
- Mac 的 1.9.1/build 11 版本号、Xcode `netrc` 包认证参数、发布脚本保留依赖缓存/符号及锁定 resolved package version 属于 Mac 构建发布变更，不计入上面的 Windows 阅读功能缺失。Windows 的正式签名和更新机制仍应在发布清单单独处理。
- 本报告现在同时记录源码增量审查和前两批落地证据。R191-10～11 的标题体验仍需按最后一批验收，不能因笔记与历史完成就把整个 1.9.1 增量标为一比一。

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
