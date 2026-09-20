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

使用 [Attention Is All You Need](https://arxiv.org/abs/1706.03762) 的 15 页 PDF 测试了双栏、公式、图片和表格。AMD 上 MinerU 使用 CPU pipeline；应用自动导入约 83 秒，生成 153 个 MinerU 阅读块、25 个标题、5 个图片资源块，并保留 167 个 PDF.js 文本块。结构化 Markdown 含公式，原 PDF 页面可正常打开，MinerU 辅助文件也被保存。

首次自动导入失败后回退到 PDF.js。原因是 MinerU 在临时输出路径中重复 PaperBridge 的 64 位哈希文件名，使 Windows 路径过长。现使用短名临时副本和短输出路径解析，再将辅助文件复制到论文工作区；原 PDF 始终保持原样。修复后重跑同一 PDF，自动 MinerU 导入成功。

运行方式：把测试论文放在 `test-artifacts/attention-is-all-you-need.pdf`，然后运行 `npm run test:live-mineru`。也可设置 `PAPERBRIDGE_LIVE_PDF` 和 `PAPERBRIDGE_LIVE_MINERU`。

## 一键安装和其它回归

本机从无 Ollama、无 MinerU 的状态开始安装。发现并修复两处真实安装问题：Windows PowerShell 被继承的模块路径干扰，导致真实有效的 Ollama 签名被误判；uv 在解压出有效 Python 后，创建次版本快捷链接时报错。签名校验现在只加载 Windows 系统模块；MinerU 安装可以直接验证并使用私有 Python 3.12 解释器。最终一键安装返回 Ollama 模型就绪、MinerU 3.4.5 就绪、MinerU backend `pipeline`。

当前回归：24 个单元测试通过；Electron 工作流测试通过；真实 Ollama 翻译/解释/摘要测试通过；真实 MinerU 论文导入通过；NSIS 与 portable 安装包构建成功，打包程序启动测试通过。两个安装包目前均未签名。

本次仅验证了一台 AMD 机器和一篇复杂论文。NVIDIA CUDA、无独显、扫描件 OCR、其它模型、长论文摘要的来源覆盖率、Mac 与 Windows 同机逐项对照、正式签名与 Windows Release 更新安装仍在 [功能映射](FEATURE_MAPPING.md)中保留为待验收项。
