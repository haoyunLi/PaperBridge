# macOS 1.10.0 → Windows 增量映射

基线：macOS `v1.10.0` / `16e01ac`，Windows `windows/desktop-app`。本报告只记录 macOS 1.9.2 与 1.10.0 相对 1.9.1 的新增可观察行为，不改写 [1.9 的 111 项历史映射](FEATURE_MAPPING.md)或 [1.9.1 的 12 项报告](MAC_1_9_1_GAPS.md)。核对日期：2026-11-05。

状态定义：`对齐`表示 Windows 已有等价用户行为与自动化证据；`部分`表示可用路径已存在，但列出的真实服务、设备或异常仍待验收。

| ID | macOS 1.10 新增行为 | Windows 对应 | 状态 | 自动化证据与剩余边界 |
| --- | --- | --- | --- | --- |
| M110-01 | Ollama 默认，可显式选择 OpenAI Online | Models 中提供 Ollama / OpenAI provider；从不自动切换或云端降级 | 对齐 | `ai-settings.test.cjs`、`openai-settings-e2e.cjs`。 |
| M110-02 | API key 不进入 workspace/settings/export | key 由 Electron `safeStorage` 使用 Windows DPAPI 加密到独立文件；设置保存显式剔除 key/consent 字段 | 对齐 | `openai.test.cjs`检查加密、删除与明文隔离；Electron 真机检查密文文件。 |
| M110-03 | 每个 app session 单独同意在线发送 | 首次启动与重启均为 Paused；有 key 后才能启用，切换 provider、替换/删除 key 会撤销 | 对齐 | Electron 验证启用、重启关闭和 header 状态。 |
| M110-04 | 撤销授权停止当前请求和后续批次 | 主进程 revision + AbortController 取消所有在线请求；renderer 同时取消当前任务 | 对齐 | 延迟多批次 Electron 回归在首个请求等待时撤销授权，验证仅发送 1 次、后续批次不启动、迟到结果不保存。已发送文本不能撤回。 |
| M110-05 | 显式 GET `/v1/models`，不自动选付费模型 | Refresh Available Models 只取 ID，也允许手输；四个字段默认空 | 对齐 | 单元验证 GET 无 body/论文文本；UI 不自动选择模型。模型列表不代表能力或价格。 |
| M110-06 | 翻译/摘要/解释/Quick Lookup 四套在线模型 | OpenAI 与 Ollama 各自保存四套独立角色；空字段报错、不回退本地模型 | 对齐 | 单元与 Electron 验证 Translation Model for All Tasks 和无 fallback。 |
| M110-07 | Responses API、`store:false`、重定向阻断与严格结果解析 | 固定官方 HTTPS `/v1/responses`；`store:false`、`stream:false`；拒绝 3xx、非 completed、refusal、partial、空/畸形响应 | 对齐 | `openai.test.cjs`验证请求体、输出解码、凭据/服务错误脱敏。未用真实付费 key。 |
| M110-08 | PDF 文件和图像不上传 | OpenAI IPC 只接收已提取的 prompt/system 字符串；PDF/MinerU 资源仍在本地 | 对齐 | 主进程 API 无 PDF/文件参数；隐私文案列明实际文字边界。 |
| M110-09 | provider/model/style 切换保留旧结果，重启可恢复 | 输出 cache namespace 包含 provider、任务模型、方向、style 与来源；段落、摘要、全文、解释及标注跟随变体 | 对齐 | 单元验证 Local/Online/style 三组；Electron 验证切换恢复及重启后在线译文仍在。 |
| M110-10 | 打开论文不静默选择云端或付费模型 | 恢复论文语言/解析任务设置时保留当前全局 provider 与当前 OpenAI 四模型；在线许可永不从论文恢复 | 对齐 | `loadPaper` 使用当前 provider/model 覆盖论文快照，再按 cache 恢复对应结果。 |
| M110-11 | word/phrase/heading 等均视为完整翻译单元 | 普通、Markdown 与选区提示明确禁止索要更多上下文，可保留不应翻译项 | 对齐 | `prompts.test.cjs`覆盖四类提示。 |
| M110-12 | 文档标题、术语和可选 style guide 参与翻译 | system 指令加入最多 300 字符标题、最多 2,000 字符 style；已匹配术语继续按语言方向加入 prompt | 对齐 | Electron 模拟在线翻译核对 model、标题、style；cache 按 style 隔离。 |
| M110-13 | 配额/凭据/无模型等全局错误停止批次 | 翻译/全文任务识别认证、权限、限额、400/404 与设置错误后终止，而非逐块重复 | 对齐 | Electron 多段队列注入额度错误，验证只请求首段即停止；单元测试覆盖认证、权限、限额、400/404 分类。普通单块失败继续保留原文并处理后续块。 |
| M110-14 | 选区重复任务的旧取消不清除新任务 | 选区 identity、request ID、task token 与迟到结果检查；严格重译使用独立请求 | 对齐 | 主 Electron 流程覆盖取消、迟到响应、重试和缓存。 |
| M110-15 | 所选 PDF 文件名立即替代旧正文并显示耗时 | 导入屏显示文件名、秒数、进度动画和 Cancel Import；侧栏/header 同步显示新文件 | 对齐 | `import-progress-e2e.cjs`使用延迟 MinerU 验证。文件对话框返回前仍不显示尚未确认的路径。 |
| M110-16 | 识别 MinerU layout/formula/text 阶段和阶段计数 | 日志归一为 Analyzing page layout / Recognizing formulas / Recognizing text，并保留本阶段 `x of y` | 对齐 | `import-progress.test.cjs`与 Electron formula 阶段验证。未知日志显示通用处理状态。 |
| M110-17 | 取消/失败导入保留前一论文全部工作 | 新论文只在提取完成后 commit；取消会隐藏导入屏，迟到 MinerU 结果无法覆盖旧论文 | 对齐 | Electron 验证旧 bookmark、正文和 paper 数量不变；真实 MinerU 崩溃仍继续扩大样本。 |
| M110-18 | 清除 workspace 不删除独立 API key | Local Data 文案明确保留 key；可在 Models 单独 Remove Key | 对齐 | Electron 验证清除后密钥文件存在，再单独删除。 |
| M110-19 | API key、usage、data controls 小入口 | OpenAI 设置提供三个官方链接；新窗口白名单只允许精确 HTTPS 路径 | 对齐 | unit/Electron link allowlist 拒绝端口、query、fragment、同形恶意域名。 |
| M110-20 | 开发构建与下载版分离 | 非 packaged 且非 production 的 Electron 使用 `PaperBridge Dev` 名称和独立 user-data 目录 | 对齐 | 正式包及 production E2E 保持 PaperBridge 目录；仍需一次交互式 `npm run dev` 目视确认。 |

## 当前结论

20 项中：**20 对齐、0 部分、0 缺失**。撤销授权的延迟多批次回归与全局服务错误的长队列回归均已补齐。没有真实 OpenAI key 或付费推理用于本轮验证；不同在线模型的实际输出质量仍需由用户用自己的 key 和真实论文另行检查。

Windows 平台差异：macOS Keychain 对应 Windows DPAPI / `safeStorage`，两者都把 key 排除在 workspace 和导出之外；Windows encrypted file 不承诺跨 Windows 账户或跨机器可迁移。OpenAI 的 `store:false` 也不代表零保留，仍应按官方 data controls 判断敏感论文是否适合发送。
