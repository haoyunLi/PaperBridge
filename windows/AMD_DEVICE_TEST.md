# Windows AMD 真机回归

## 0.2.96 便携版首次启动

本机在 125% 缩放下运行候选便携版，262 毫秒后出现原生解压提示，约 4 秒后显示完整的首次引导。再次打开 EXE 时，原有窗口从最小化状态恢复，76 份运行文件保留完整。时间为这台电脑的一次实测。

## Windows 0.2.95 的扫描页和本地模型

用公开的 0.2.91 打开 BERT 第 6–7 页的纯图像 PDF，在 RX 7800 XT 上运行 MinerU 4.1.7 和 TranslateGemma 4B，保存书签与译文后用候选版重新打开。跨页段落的两个页码都能用键盘打开对应的原始 PDF 页，返回后译文与书签仍在。原 PDF 和 7 个解析文件逐一核对哈希一致，其中有 4 张 JPG。注释 Markdown 的书签现在保留起止页。

在同一台 AMD 电脑上，通过带路径前缀的本地 HTTPS 服务生成并重开已保存的中文译文。客户端拒绝未受信任的证书和主机名不匹配的证书。另用独立 Ollama 服务分别运行一个 GPU 层、自动 GPU 和纯 CPU 推理，三次都译为「太阳能电池板为温度传感器供电。研究人员每小时记录一次温度。」设置页显示 631.2 MiB、2.7 GiB 和纯 CPU。每次点击释放内存后，模型均从运行列表消失，已安装的权重仍在。

独立的 16 GiB 纯 CPU Windows 下载并加载了 17,358,650,268 字节的 27B 模型，约 616 秒后生成超时。设置里释放模型内存成功，随后模型盘只剩 155,648 字节，未能再下载 4B。这次验证覆盖了释放内存及空间不足的故障，没有获得 27B 译文。[27B 下载及释放内存记录](https://github.com/haoyunLi/PaperBridge/actions/runs/45166379239)

## Windows 0.2.93 的双栏阅读与摘要

从 GitHub 下载的 Windows 0.2.93 在 RX 7800 XT 上读取 ResNet 的表 14，跨栏恢复的段落在翻译后保留了 33.1%、13.3%、11.7% 和 14.4%。BERT 第 6–7 页的一句话被三张表打断，重建后原文和译文都保留了 TriviaQA 及 0.1–0.4 F1。第 3 页的 BERT 子型号及 110M、340M 参数量也保留在各自的句子里。20 页论文的摘要使用了与 Mac 相同的 11 批输入，本机完成时间为 133 秒。[Windows 发布包与 Mac 对照](https://github.com/haoyunLi/PaperBridge/actions/runs/45155801727)

在另一台全新 Windows 上，引导下载并加载了 27B。16 GiB 内存、纯 CPU 条件下，客户端约 332 秒后报告生成超时，Ollama 仍在运行。通过应用内的模型选择切换到 4B 后，同一原文生成了中文译文，退出重开后仍能读取。此次使用 GitHub 测试机下载大模型。[27B 下载、故障恢复与译文](https://github.com/haoyunLi/PaperBridge/actions/runs/45154513298)

## Windows 0.2.91 的首次本地翻译

两台全新 Windows 测试机分别从首次引导安装了签名通过校验的 Ollama 0.40.17。在收到真实模型数据后取消下载，从后台继续，分别完成了 TranslateGemma 4B（3,298,875,707 字节）和 12B（8,109,827,612 字节）的安装。两台都通过 CPU 生成译文。4B 和 RX 7800 XT 的实际结果一致，为「太阳能电池板为温度传感器供电。研究人员每小时记录一次温度。」12B 的第一句为「太阳能电池板为温度传感器提供电力。」每台都确认旧阅读器进程退出、新进程启动、原译文恢复。12B 在独立测试机下载。[4B 首装与重启](https://github.com/haoyunLi/PaperBridge/actions/runs/45140574505) · [12B 首装与重启](https://github.com/haoyunLi/PaperBridge/actions/runs/45141422747)

## RX 7800 XT 的模型显存与多栏翻译

在同一台 RX 7800 XT 上，用单独的 Ollama 服务加载本机已有的 TranslateGemma 4B，依次测试一个 GPU 层、自动分配、纯 CPU，再逐次卸载。设置页持续打开，自动读到 631.2 MiB 显存、2.7 GiB 显存、仅 CPU 和无模型四种状态。三次均使用应用的段落翻译提示，译文均为“太阳能电池板为温度传感器供电。研究人员每小时记录一次温度。” 此测试使用 2048 的上下文长度。[可复现的真机测试](tests/live-model-memory.cjs)

BERT 第六页以 `fine-` 结束，第七页的三张表格下方才接续正文。修复后，原文和实际 AMD 译文都保留了 TriviaQA 和 0.1–0.4 的 F1 差值，正文没有混入表格或页脚。ResNet 最后一页也能跨过表 14 的位置把 `re-ports` 接回正文，四个误差百分比均保留。用五篇 PDF 共 1,265 个原始段落回归，除这两处正文拼接及书目引用间距外，其余段落文字一致。[BERT 对照](https://github.com/haoyunLi/PaperBridge/actions/runs/45144662049) · [ResNet 对照](https://github.com/haoyunLi/PaperBridge/actions/runs/45142007188)

## BERT 双栏论文的正文与公式

同一份 ACL 出版的 16 页 BERT 论文经过 Windows PDF 文字层导入。第三页的跨栏插图原先截断了第二页的 `language model-ing`，图注的最后一行也出现在正文里。修复后，读者能在一个段落内选中完整句子，两栏之间的 `mini-mal` 也合为一个词。RX 7800 XT 用 TranslateGemma 4B 译出了预训练架构与最终下游架构之间的差异。第五页的隐藏向量和分类层权重在实际译文里分别保留为 `C ∈ ℝ^{H}` 和 `W ∈ ℝ^{K×H}`，关闭再打开阅读器后译文一致。四篇既有回归论文合计 811 个文字块的逐块内容与本次修复前一致。[ACL 论文](https://aclanthology.org/N19-1423/) · [Mac 原生 PDFKit 的图注、栏边界和公式选区](https://github.com/haoyunLi/PaperBridge/actions/runs/45137884416)

## 结构化论文中可运行的 Python 代码

在同一篇 *Tabbed* 论文上，两端用相同的 TranslateGemma 4B 权重处理许可证、正文、Python 导入语句和小标题。Mac 与 RX 7800 XT 的许可证译文及链接、小标题逐字一致。类型转换段落均为中文，具体措辞有所不同。Mac 和 Windows 0.2.89 都把 Python 的 `from`、`import` 译成了中文。Windows 修复后保留紧接 Python 代码块之前的合法导入语句。这行可在模型服务离线时重新生成，其余已保存译文不受影响。[Mac 真实模型对照](https://github.com/haoyunLi/PaperBridge/actions/runs/45132517461) · [论文及材料来源](tests/mac-parity/tabbed/LICENSE.md)

## 同一模型在 Mac 与 RX 7800 XT 上的逐段翻译（2026-11-22）

用 Mac 1.10.0 的原生阅读器代码和 Windows 阅读器翻译 PLOS 论文 *Good enough practices in scientific computing* 的第 54–56 段。两端均使用 Ollama 0.40.16、相同摘要指纹的 TranslateGemma 4B 及 500 字符段落上限。前两段分别请求一次，第三段分两次翻译并保存为一段。两端的全文翻译各完成一个批次。Mac 使用 Intel CPU；Windows 使用 RX 7800 XT，Ollama 报告占用 2,881,948,220 字节显存。[原生 Mac 翻译及结果文件](https://github.com/haoyunLi/PaperBridge/actions/runs/45118307078)

第 54 段要求记录数据处理步骤。Windows 0.2.85 曾把其中一句译成「数据处理是分析过程的 integral 部分」。开发版采用 Mac 的普通段落翻译提示后，在同一台 AMD 电脑上译为「数据处理对于您的分析至关重要，与统计建模和推论一样」。第 56 段两端都保留软件名 OpenRefine 和保存区域边界坐标的操作。样本为三段英文到简体中文的技术写作，覆盖段落拆分、合回及上下文连译。

## 0.2.76 公开版的代码、公式与图注翻译（2026-11-22）

在 RX 7800 XT 上把同一段仪器测量说明交给 `translategemma:4b`。0.2.74 把代码中的 `sample` 译成了「样本」，还改写了 HTML 属性中的 `threshold`。0.2.76 的译文逐字保留双反引号代码、公式、带引号的 HTML 属性以及包含括号的链接和图像路径。全文译稿导出到磁盘后可重开，Reader 中的代码和链接与源文相同。Ollama 报告模型使用 2,881,948,220 字节显存。另用公开便携版对扫描 PDF 实测，Auto 选中 RX 7800 XT 的 DirectML，识别出五个文字块。[公开下载](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.76)

## 0.2.72 公开程序再次验证扫描件翻译（2026-11-21）

从 GitHub 下载 0.2.72 便携版，在 RX 7800 XT 上自动选择 ONNX DirectML。输入 PDF 没有可选文字，MinerU 识别出五段。用 `translategemma:4b` 进行单段和全文翻译，Ollama 报告模型使用 2,881,948,220 字节显存。样例正确保留了陶瓷样品、磁场与「从零提升到两特斯拉」。原文的多次试验被译成「并在多次试验中进行」，中文仍可改进。该样例用于检查识别、显卡与翻译链路。[该版本的发布文件](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.72)

## 0.2.69 自动选择和兼容模式（2026-11-21）

用公开下载的 0.2.69、MinerU 4.1.7 及 `translategemma:4b` 测试同一份扫描件。RX 7800 XT 的自动模式通过 ONNX DirectML 识别五段，兼容模式通过 CPU 也识别五段。两次均完成段落翻译和全文翻译，Ollama 报告模型使用 2,881,948,220 字节显存。解析使用 CPU 时，翻译模型仍可使用 GPU。安装入口复用环境时保留选择，切换后端后的界面状态与实际运行时一致。NVIDIA 目前有软件回归，仍缺显卡实测。

## 0.2.68 长篇 PDF 和修正后的章节翻译（2026-11-21）

RX 7800 XT 上先用 0.2.67 的公开程序将 20 页 PLOS 论文的 208 个可译段落翻成简体中文，模型为 `translategemma:4b`。随后用公开 0.2.68 重新导入原 PDF，从段落菜单单独翻译修正后的 Overview。其原文与 Mac 完全相同，中文译文覆盖原段结尾，重启后保留，Ollama 报告模型占用 2,881,948,220 字节显存。两端导出使用同一份已保存的译文，便于独立检查导出格式；此项没有评测两端分别运行模型时的翻译质量。[论文及验收记录](WHOLE_APP_REVIEW.md)

同一段的默认译文把课程名 Software Carpentry 和 Data Carpentry 合并成了“软件和数据卡普琴工作坊”。在独立测试资料库给两个专名各保存一条保留英文的术语，再用相同版本和同一台 AMD 电脑从阅读器重新翻译，译文中两个英文名称均完整保留。这是一次具体的译文质量抽查。

## 0.2.67 从公开便携版翻译章节并导出分析稿（2026-11-21）

本机检测到 AMD Radeon RX 7800 XT 和 AMD Radeon(TM) Graphics。使用从公开 Release 下载的便携版，通过 Reader 的当前章节操作翻译 *Tabbed* 的结论，Ollama 报告模型使用 2,881,948,220 字节显存。关闭并重开后仍能读取这一段中文译文。保存的 *emcee v3* 双语摘要通过导出菜单保留六条结论和五处来源。在另一份已完成的 *Tabbed* 存档上，分析导出中的 42 段原文和 42 段 AMD 译文与 Mac 使用同一输入生成的报告分别比对，渲染后文字一致。[分析导出验收](WHOLE_APP_REVIEW.md)

## 0.2.65 重开旧译稿与 Mac 导出对照（2026-11-21）

用公开版对 *Tabbed* 做了两组测试。第一组使用本机 Ollama，RX 7800 XT 完成全部 42 个可译块，10 个正文链接均保留原目标，模型报告占用 2,881,948,220 字节显存。

第二组将 0.2.64 保存的同一份译稿复制到两个独立工作区，模型地址设为离线。一个保留存档中的 Markdown，另一个将 13 个已译标题改存为纯文字，模拟仅保存纯文字译文的旧格式。旧格式在公开 0.2.64 的全文窗口只显示参考文献标题。0.2.65 在两个工作区均显示了全部 13 个译文标题和参考文献标题，切换阅读视图后退出重开，摘要书签和笔记仍在。两组导出的纯译文、全文和双语正文分别与原生 Mac 导出的内容逐块一致，图像按字节核对。这里的两端排版对照使用相同的已存译文。[原生 Mac 导出](https://github.com/haoyunLi/PaperBridge/actions/runs/44940497790/job/136956396144) · [论文](https://joss.theoj.org/papers/10.21105/joss.08964)

## 0.2.64 结构化论文译文中的链接（2026-11-21）

公开 0.2.62 在本机翻译 *Tabbed* 的结论时，曾把 Markdown 链接结尾的右括号改成全角标点。阅读器里实际可点击的地址因此包含了后续中文。这个问题与生成结果有关，同一段落的另一次翻译给出了正确地址。

0.2.64 在翻译时保留链接的 Markdown 分隔符和完整目标，标签文字仍可翻译。对于单独成行的「Review」链接，只将标签交给模型。在 RX 7800 XT 的原存档副本中，从段落菜单重新翻译后，核对了阅读器里链接的实际地址，再关闭并重开核对。旧译文可以按段手动更新。

公开便携版重开旧论文后生成了整篇中文译稿，3 个已完成块沿用原有结果，其余 39 个可译块一次完成。逐段检查了 10 个链接的实际目标。代码块 2 个、表格 1 张、图片 2 张以及文末 7 个参考文献块均保留，原 PDF 的 SHA-256 与导入时一致。通过界面导出 Markdown 文件夹后，全文文件中 16 个外部链接的目标和顺序与应用内译稿相同，两个代码块内容一致，两张图的导出文件与原图逐字节相同。本机通过 Ollama 使用 `translategemma:4b`，模型报告占用 2,881,948,220 字节显存。[期刊论文](https://joss.theoj.org/papers/10.21105/joss.08964)

## 0.2.62 当前章节与资源块（2026-11-21）

在 RX 7800 XT 上用公开便携版打开 *Tabbed* 论文的既有 MinerU 存档。选中结论正文，再分别把 Comparison 正文、代码、图片和表格滚到阅读区顶部。0.2.61 在这三种资源位置中会选到 Statement of need 或 Comparison。0.2.62 在普通正文处指向 Comparison，在三个资源位置都保留 Conclusion。从表格处执行「当前章节」后，只有结论标题和正文（第 43、44 块）增加了译文。第 35 块的旧译文、图表与原 PDF 均保留。重开后菜单显示结论已经译完。[论文](https://joss.theoj.org/papers/10.21105/joss.08964) · [公开便携版](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.62)

这次翻译由本机 Ollama 的 `translategemma:4b` 完成，模型报告使用 2,881,948,220 字节显存。另一个校准样例在原生 Mac 上使用固定模型响应，在 Windows 上分别使用固定响应和本机模型，便于独立核对选段范围。两端执行相同操作后，完成的段落数依次为 2、4、7。[原生 Mac 对照](https://github.com/haoyunLi/PaperBridge/actions/runs/44936014351/job/136942665650)

## 0.2.61 离线看扫描页与文末缩放（2026-11-21）

在 RX 7800 XT 机器上，通过 Edge 从首页下载公开便携版，将解析方式设为仅 PDF 文字层，并使用离线模型地址。扫描样例来自 ResNet 论文的前两页，经栅格化并将第 2 页旋转 1.2° 后重新保存。导入得到零个文字段落，存档 PDF 与输入逐字节一致。在 Paper 预览查看第 1 页，在 Original 查看第 2 页，放大至 125% 并滚动，退出重开后页码、缩放和页内位置均恢复。[论文原件](https://arxiv.org/abs/1512.03385)

将阅读器显示的三幅页面图像分别与 Poppler 独立渲染的两页比对。按网格统计墨迹密度，对应页的相关系数均超过 0.99，与另一页的相关系数约为 0.61。另在八页横版样例中验证了 150% 与 200% 系统显示缩放，50% 文档缩放下文末四张可见页均显示正确。翻译回归中本机 Ollama 仍使用显存，由公开版生成传感器校准段落的中文译文。[发布运行](https://github.com/haoyunLi/PaperBridge/actions/runs/44933677794)

## 0.2.60 从旧论文恢复被目录遮住的引言（2026-11-21）

在 RX 7800 XT 上用公开的 0.2.59 便携版粘贴一份九段校准样例。样例包含目录里的 References、引言、真正的文献和附录。旧版全文译稿把引言留成英文，摘要说摘录没有描述方法。用公开的 0.2.60 打开同一份旧存档，全文译稿和摘要均提示刷新。刷新后的正文包括「我们独立校准了每个传感器」，摘要提到了三个传感器的校准与测量重复性，引用条目逐字保留。附录的书签和对 *individual* 的笔记仍指向原选区。

两次运行均通过本地 Ollama 生成结果。译文使用 `translategemma:4b`，Ollama 报告该模型使用 2,881,948,220 字节显存。这个样例检验了遗漏段落的恢复。[公开下载](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.60)

## 0.2.59 从「仅 PDF 文字层」启用 OCR（2026-11-21）

在 RX 7800 XT 上对比两个公开便携版。为每版准备独立的目录，只复制已缓存的 Python、uv、软件包和模型，开始时均无 MinerU 可执行文件。通过「本地 AI 安装」进行真实安装，随后应用探测到了 MinerU 4.1.7 和 DirectML。两版都从「仅 PDF 文字层」开始，导入同一页无文字层的陶瓷实验扫描样本。

| 版本与操作 | 导入和翻译结果 |
| --- | --- |
| 0.2.58，一键安装 | 安装成功后仍为仅文字层，保留原扫描 PDF，可读文字为 0 段。 |
| 0.2.59，一键安装 | 自动启用优先 MinerU。原文件文字层为 0 段，OCR 得到 5 段。Reader 中第 3 段可以实际翻译。 |
| 0.2.59，已安装可用解析器 | 从「首次使用向导」或「本地 AI 安装」分别点击 **Use MinerU for PDFs**。两条路径各用独立资料库，均得到 5 段并完成本机翻译。 |

三个流程中，Ollama 均用 `translategemma:4b` 和显存完成翻译，重启后保留译文和解析模式。第 3 段的译文保留了「陶瓷样品」和「从零提升到两特斯拉」。OCR 原文中 `fieldwas` 两词连在一起，因此仍应对照原页。三个资料库保存的原始 PDF 均与输入逐字节相同。[公开文件启动验收](https://github.com/haoyunLi/PaperBridge/actions/runs/44928677731/job/136922341493)

## 0.2.58 用 AMD 翻译期刊表头（2026-11-21）

先用公开 0.2.57 便携版导入未修改的 *Tabbed* 四页 PDF。三组翻译使用这份已提取论文的独立副本。在 RX 7800 XT 上，从第 37 块的表中连续选中 Structural Detection、Casting、Value-based Filtering、Iterative 四个表头。每次通过 Reader 的检查器翻译，记录应用发送给本机 Ollama 的选区和返回的中文。三次均使用 `translategemma:4b`，模型占用 2,881,948,220 字节显存。[测试论文](https://joss.theoj.org/papers/10.21105/joss.08964)

| 实测版本与设置 | 输入与译文 |
| --- | --- |
| 公开 0.2.57，默认术语 | 四个列名连在一起。模型返回三行「结构检测」「基于铸造值的过滤」「迭代」，中间两个列名的含义合并。 |
| 公开 0.2.58，默认术语 | 四个列名由制表符分开。模型返回「结构检测」「铸造」「基于值的过滤」「迭代」，保留四列，但第二列不符合数据处理语境。 |
| 公开 0.2.58，在检查器保存 Casting → 类型转换 | 模型返回「结构检测」「类型转换」「基于值的过滤」「迭代」，四列由制表符分隔。 |

公开 0.2.58 还分别从 Reader 和 Paper 重开并保存了 0.2.57 的三格笔记，核对了笔记的原始 ID、正文与锚点。再次重启后，行列和引文一致。[Windows 公开下载验收](https://github.com/haoyunLi/PaperBridge/actions/runs/44926090164/job/136914804484) · [Mac 原生表格选区对照](https://github.com/haoyunLi/PaperBridge/actions/runs/44926090164/job/136912383488)

## 0.2.56 表后正文与跨单元格笔记（2026-11-21）

在 RX 7800 XT 上用 0.2.56 的公开便携版导入未修改的四页 *Tabbed* 论文。MinerU 4.1.7 在 274 字符的临时路径配置下返回 54 个块，表格和两张图可见。在 Reader 和 Paper 双语预览中，分别保存 pandas 行两个不同列上的「+」，再保存 frictionless 行横跨三个单元格的笔记。重启后六次回跳均选中原行列。[期刊原文](https://joss.theoj.org/papers/10.21105/joss.08964)

另用这篇论文的 Markdown 制作表格格式变体。本机 TranslateGemma 对新增表后句子的输出为「两位读者在比较后都成功恢复了校准。」原文、译文与双语 Markdown 均保留了表格源码。对未修改论文的第 35 块，译文保留了函数名，默认设置仍会把包名 `comma` 译成「逗号」。[公开下载与启动验收](https://github.com/haoyunLi/PaperBridge/actions/runs/44923536313/job/136907722399)

## 0.2.55 在 RX 7800 XT 上读取图表和翻译函数名（2026-11-21）

两次从 GitHub 的未签名便携版导入 *Tabbed* 原始 PDF，使用 MinerU 4.1.7 的 DirectML 和本机 Ollama 的 `translategemma:4b`。在一次测试中把临时目录设为 274 个字符。结构化 Reader 显示了比较表、514 × 401 和 530 × 418 像素的两张图。搜索 `read_csv` 命中第 35 和 38 块。翻译第 35 块后，重启仍能看到图表和保留该函数名的译文，原始 PDF 校验值相同。[测试用论文](https://joss.theoj.org/papers/10.21105/joss.08964)

| 第 35 块英译简中 | 本次输出 |
| --- | --- |
| 默认术语设置 | 译文保留函数名 `read_csv` 和 `extract`，但把 Python 包名 `comma` 译成了「逗号」。 |
| 保存英译简中的术语 `comma → comma`，在独立资料库翻译同一段 | 译文保留包名 `comma` 及两个函数名。重启后可以打开该译文。 |

Ollama 报告翻译模型使用 2,881,948,220 字节显存，约 2.7 GiB。另从公开版 0.2.54 当时退回 PDF 文字层的资料库出发，对同一篇论文重新提取为独立副本，重启后原来的 55 块与书签仍保留，新副本有 54 块。[公开文件启动测试](https://github.com/haoyunLi/PaperBridge/actions/runs/44921278562/job/136899665394)

## 0.2.52 在 RX 7800 XT 上逐段翻译（2026-11-21）

从 GitHub 下载未签名便携版，以本机 Ollama 的 `translategemma:4b` 在 Reader 中逐个翻译 *emcee v3* 的第 17、18、19 段。用两个独立资料库比较同一段英文，源 PDF 相同。第一个资料库没有保存术语，第二个保存了英译简中的 `ensemble samplers → 集成采样器`。只在第 17 段比较了这两种设置。[测试用论文](https://doi.org/10.21105/joss.01864)

| 原文内容 | 本次输出 |
| --- | --- |
| affine-invariant ensemble samplers | 未使用术语时出现「具有仿射不变性的组装采样器」。保存术语后出现「仿射不变的集成采样器」。同一段其他语句也有变化。 |
| first major release … in about 6 years | 译文保留「约 6 年」。同句中的 full re-write 译成了「一体重写」，中文表达仍需润色。 |
| HDFBackend … h5py | 两个标识符均原样保留，译文保留了把采样链序列化到磁盘的含义。 |

三段原文与译文均在重开后核对。Ollama 报告翻译模型使用 2,881,948,220 字节显存，约 2.7 GiB。另行生成双语摘要得到 6 条论点，其中 5 条有可回跳的精确引文。设置页识别出 RX 7800 XT 的 16 GiB 独立显存。[公开版下载与启动验收](https://github.com/haoyunLi/PaperBridge/actions/runs/44915960028/job/136883478941)

## 0.2.50 公开安装包和便携包（2026-11-21）

RX 7800 XT 上打开公开便携包时，安装页能同时显示显卡、已安装模型和目前为空的加载状态。完成 *emcee v3* 的双语摘要后，设置页与安装页分别显示 TranslateGemma 占用 2.7 GiB 显存、Qwen 占用 3 GiB。4 处摘要引文均跳转至正确的 Reader 段号并选中原文。另一次测试从此前用该设备保存的 2,960 字符全文译稿出发，拆段、撤销并重启后，8 个批次的来源和译文均与原稿相同。[0.2.50 公开发行](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.50)

## 0.2.49 模型内存显示（2026-11-21）

在本机 RX 7800 XT 上，从 GitHub 便携版打开一键安装，Ollama 已启动且两个模型都已安装。运行任务前 `/api/ps` 为空，界面显示暂无模型载入。检查结束后模型列表仍为空。

用公开版处理两页 *emcee v3* 论文，Qwen 生成摘要，TranslateGemma 生成中文译文。设置页和安装页分别读取到 `translategemma:4b` 占用 2.7 GiB 显存，`qwen3:4b-instruct` 占用 3 GiB 显存。此次 Ollama 报告两者的显存字节数与各自模型的总内存字节数相等。打开这两个页面没有发起生成或下载请求，重启后保存的摘要和原 PDF 均通过核对。[公开下载验收](https://github.com/haoyunLi/PaperBridge/actions/runs/44911368527/job/136869632837)

## 0.2.48 深层目录下的 MinerU 与段落来源（2026-11-21）

在本机 RX 7800 XT 上使用 MinerU 4.1.7 的 DirectML 后端解析两页期刊 PDF。设备回归把 Windows 临时目录设置到 280 个字符深处，解析工具根目录为 286 个字符。导入得到 28 个块，Reader 可读，Original 能渲染原始页。解析结束后临时工作目录已清理。另用 382 字符的中文及空格路径传入 PDF，验证了生成的 ZIP。[测试用论文](https://doi.org/10.21105/joss.01864)

另外从 GitHub 下载 0.2.48 便携版，在 0.2.47 导入失败的相同缓存路径和 278 字符临时目录重新导入。该公开包恢复使用原有模型，抽查的 ONNX 文件哈希、修改时间和缓存配置一致。MinerU 摘要的模型输入有 21 段，比 0.2.47 多四个标题。六条结论中共有四条通过原文核验的引文，重启后内容一致。改用 PDF 文字层重新导入，摘要输入从 16 段增加到 21 段，这次生成了六条结论和五条可跳转的引文。两次均使用 Qwen3 4B Instruct 和 TranslateGemma 4B。[公开包下载与离线启动](https://github.com/haoyunLi/PaperBridge/actions/runs/44909863386/job/136865012268)

要从源码复测，在 Windows 项目目录中运行以下 PowerShell 命令。若 MinerU 安装在自定义目录，可先将 `PAPERBRIDGE_LIVE_MINERU` 设为设置页显示的 `mineru.exe` 完整路径。命令仅为测试进程设置独立的临时目录与模型缓存。

```powershell
$env:PAPERBRIDGE_LIVE_PDF = (Resolve-Path 'tests/mac-parity/emcee-v3.pdf').Path
$env:PAPERBRIDGE_LIVE_DIRECTML = '1'
$env:PAPERBRIDGE_LIVE_LONG_PATHS = '1'
npm run build
npm run test:live-mineru
```

## 0.2.47 从公开便携版生成和离线阅读摘要（2026-11-21）

在 RX 7800 XT 上从公开便携版导入两页 *emcee v3*。本地 Qwen3 4B Instruct 生成六条结论，TranslateGemma 4B 翻译成中文。六条引文分别跳到 Reader 的 P20、P19、P17、P18、P17 和 P21，并选中所引的原句。关闭后重新打开，双语摘要、引文和 PDF 原文件仍可读回。再打开 0.2.46 保存的摘要，将本地模型服务设为不可用，0.2.47 仍能显示六条结论及其引文，没有请求模型。[公开版本](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.47) · [Windows 公开包启动验收](https://github.com/haoyunLi/PaperBridge/actions/runs/44907689194/job/136858455185)

## 0.2.45–0.2.46 真实论文的长段翻译与双语摘要（2026-11-21）

在 RX 7800 XT 上，0.2.45 的公开便携版用 TranslateGemma 4B 翻译了 *Attention Is All You Need* 原 MinerU 工作区第 71 段。500 字符上限下，895 字符的正文分为三次请求。保存后仍可在一个阅读段落内读完整译文，两个行内公式 `$O ( n )$` 与 `$O ( n / r )$` 逐字保留，重启后译文一致。[0.2.45 公开版本](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.45)

0.2.46 的公开便携版在同一个 895 字符段落复测通过。另用新导入的 *emcee v3* 打开跨页列表，按同一 500 字符上限提交两次模型请求。随后单独翻译第 2 页结尾正文，只提交一次请求。每次发送的原文均与 Mac 对应段的分块逐字一致。旧版 0.2.45 中标在第 2 页的笔记，升级后仍定位在原段偏移 229 处（按 UTF-16 代码单元计数）。

在同一篇期刊 PDF 上用 Qwen3 4B Instruct 与 TranslateGemma 4B 生成双语摘要，六条结论各附一条能在 Reader 中选中原句的引文。第一条跳到跨页列表（P20），第五条跳到第 2 页独立正文（P21）。重启后双语摘要和六条来源均与生成时一致。Ollama 报告两种模型分别占用 3,180,247,121 和 2,881,948,220 字节显存。这次核对的是引文位置、原文和保存结果。结论的学术准确性仍需读者结合原文判断。[0.2.46 公开版本](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.46) · [期刊原文](https://doi.org/10.21105/joss.01864)

## 0.2.44 学术数字、否定含义与译稿恢复（2026-11-21）

从公开便携版粘贴四段英文物理测量样例，逐段使用本地 TranslateGemma 4B 翻译。译文保留了 24 次独立曝光、15.0 °C、532.1 ± 0.3 nm、95% 置信区间 0.92 至 1.08、偏移量由 −3.2 mV 变为 +1.4 mV，以及两组 10⁻³ s 数值。第二段明确译出“并未提高信噪比”。首段中文把曝光次数放在句末，读起来略生硬。四段译文重启后逐字一致。模型已加载时，四次点击到保存分别为 510、450、439 和 576 毫秒。计时只覆盖本机这四个短段落。

设置页在本机识别 16 GiB RX 7800 XT 及核显。两页 *emcee v3* 的全文翻译和导出保留了 13 位作者署名，导出的 4,777 字节 Markdown 与保存的译稿一致。Ollama 报告模型显存用量为 2,881,948,220 字节。两种窗口大小、五档显示缩放下，长标题均有两行空间，元数据和阅读工具栏保持间距。[公开版本](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.44) · [期刊原文](https://doi.org/10.21105/joss.01864)

## 0.2.43 公开便携版与 RX 7800 XT（2026-11-21）

本机通过 Local AI setup 识别 RX 7800 XT。公开包用本地 TranslateGemma 4B 翻译两页 *emcee v3*，核对了 13 位作者署名、参考文献及导出的 4,796 字节 Markdown。退出重开后译稿恢复，原 PDF 的哈希相同。另测光谱学段落，已存术语“通量定标”进入请求并出现在译文中。Ollama 报告模型占用 2,881,948,220 字节显存。[0.2.43 发布记录](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.43) · [期刊原文](https://doi.org/10.21105/joss.01864)

## 0.2.42 公开便携版与 RX 7800 XT（2026-11-21）

从 GitHub 下载并校验便携版，在本机 Ollama 上用 TranslateGemma 4B 重译两页 *emcee v3*。28 个阅读块中，全文完成一批中文正文，保留了参考文献标题和六条引文。13 位作者的署名和单位编号在 Reader、全文译稿和导出中保持一致。Markdown 共 4,828 字节，逐字匹配工作区译稿。重新打开后译稿仍在，原 PDF 的 SHA-256 一致。单段光谱学测试也从印刷连字 `ﬂux calibration` 匹配到术语库的 `flux calibration`，译文中使用了指定的“通量定标”。两次测试的模型显存用量均为 2,881,948,220 字节。记录为 `test-artifacts/emcee-AMD-uaO8Bt/result.json` 和 `test-artifacts/search-amd-B8HzQ9/result.json`。[0.2.42 公开下载](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.42) · [原期刊论文](https://doi.org/10.21105/joss.01864)

## 0.2.39–0.2.40 作者署名、单位编号与本地翻译（2026-11-21）

用公开 0.2.39 的便携版重译两页 *emcee v3*，以原 PDF 署名为准。Reader 单段译文、全文译稿和导出的 Markdown 均保留了 13 位作者的原名、顺序和单位编号，包括 `Joe Zuntz8`。标题、单位名称和正文继续由 TranslateGemma 4B 翻译。导出的 4,835 字节与工作区译稿一致，关闭后重新打开，原 PDF 与译稿都可恢复。结果见 `test-artifacts/emcee-AMD-SWzlU3/result.json`。[0.2.39 公开包](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.39) · [原期刊论文](https://doi.org/10.21105/joss.01864)

公开 0.2.40 用同一台 RX 7800 XT、同一篇论文和同一模型再测。两页 PDF 解析出 28 个块，全文翻译完成一批正文，另有原文保留的参考文献标题及六条引文。13 位作者的完整署名通过了逐段、全文、导出三处核对。导出的 4,850 字节逐字匹配工作区译稿，便携版重启后译稿和原 PDF 均一致。另用光谱学句子实测设置好的术语，印刷连字 `ﬂux calibration` 在请求中匹配 `flux calibration`，模型返回“通量定标”。Ollama 报告的显存用量为 2,881,948,220 字节。记录为 `test-artifacts/emcee-AMD-894nUI/result.json` 和 `test-artifacts/search-amd-aKNL6j/result.json`。[0.2.40 公开包](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.40)

## 0.2.38 公开便携版与两页期刊论文（2026-11-21）

RX 7800 XT 上的公开便携版使用本地 Ollama 和 TranslateGemma 4B 完成两页 *emcee v3* 的全文翻译，解析出 28 个块。正文一批译为中文，七个参考文献相关块原样保留。导出文件与工作区译稿一致，共 4,795 字节。重新打开便携版后取回了同一译稿与字节一致的 PDF。Ollama 报告模型占用显存 2,881,948,220 字节。这次译稿的技术标题保留了 MCMC，但作者行把 Joe Zuntz 写成了“乔·zun茨”，部分作者单位编号也在译文中丢失。[原期刊论文](https://doi.org/10.21105/joss.01864)

另在 Reader 单段翻译中，把已保存的术语 `flux calibration` 用于含印刷连字 `ﬂux calibration` 的光谱学原文。从实际请求和译文两处确认采用“通量定标”。两次实测记录为 `test-artifacts/emcee-AMD-A0hVg0/result.json` 和 `test-artifacts/search-amd-yp5u8g/result.json`。[公开便携版与校验文件](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.38)

## 0.2.37 公开便携版的印刷连字与术语（2026-11-21）

用公开 0.2.36 与 0.2.37 便携版在同一台 RX 7800 XT 上翻译相同的英文光谱学句子。原文使用印刷连字 `ﬂux calibration`，术语库存的是普通字母 `flux calibration`，用户指定译文为“通量定标”。两个版本都通过本机中转记录请求，原样转发至同一 Ollama 服务及 TranslateGemma 4B，实测模型显存 2,881,948,220 字节。

旧版请求未附上该条术语，此次译为“流光校准”。新版请求含正确语言方向的术语，返回了“对厄切尔光谱的通量定标在每次曝光后重复进行，以检查探测器的稳定性。” 在 Reader 输入普通字母也能找到含印刷连字的原文。记录分别为 `test-artifacts/search-amd-tBvRlj/result.json` 和 `test-artifacts/search-amd-TK3VTJ/result.json`。这是一次具体句子的模型输出。[公开版本](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.37)

## 0.2.36 公开便携版（2026-11-21）

公开便携版检测到 AMD Radeon RX 7800 XT（专用显存 17,163,091,968 字节）。在没有 NVIDIA CUDA 驱动的这台机器上，Ollama 为 TranslateGemma 4B 分配了 2,881,948,220 字节显存。由公开包完成的两页 *emcee v3* 中文译稿含一批正文及按原文保留的七个参考文献块。使用该包内的应用导出了 4,844 字节 Markdown，逐字核对了工作区译稿。便携版重启后能读回译稿和原始 PDF。记录在 `test-artifacts/emcee-AMD-3bVqTM/result.json`。[0.2.36 公开下载](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.36)

## 0.2.35 公开便携版（2026-11-21）

在 RX 7800 XT 上从 GitHub 公开便携版导入两页 *emcee v3* PDF。新提取产生 28 个块。Ollama 加载 TranslateGemma 4B，报告 `size_vram = 2881948220` 字节。全文翻译完成一批正文，参考文献标题及六项条目均保留原文。英文标题完整译为“emcee v3：用于仿射不变的 MCMC 的 Python 组合采样工具包”。提取的英文作者行保留单位上标，模型在中文作者行中省略了部分编号。

通过该公开包内的应用执行 **Full Translation Markdown**，导出的 4,862 字节逐字匹配工作区译稿。重启便携版后译文仍在，原 PDF 的 SHA-256 与导入前一致。记录在 `test-artifacts/emcee-AMD-E3IFri/result.json`，导出样本为同目录 `paper-full.md`。[公开版本](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.35) · [原论文](https://doi.org/10.21105/joss.01864)

## 0.2.34 公开便携版（2026-11-21）

RX 7800 XT 用本机 Ollama 和 TranslateGemma 4B 翻译 ResNet 小节标题及脚注。标题译为“3.3. 网络架构”，脚注译文保留编号 `2` 与文献引用 `[28]`。另用双栏样张生成两批全文译稿，末条编号 `1` 与译稿在重启后保留。Ollama 报告显存占用 2,881,948,220 字节。记录在 `test-artifacts/public034-pdf-amd-E1swXP/result.json`。[公开版本](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.34)

## 0.2.33 公开便携版的双栏脚注与小节标题（2026-11-21）

RX 7800 XT 用从 GitHub 下载的 0.2.33 便携版再次翻译 ResNet 第 3 页。脚注译为“2 然而，这一假设仍然是一个未解决的问题。参见 [28]。”，小节译为“3.3. 网络架构”。双栏样张的全文译稿分两批完成，末条附注保留编号 `1`，重启后能重新打开译稿。本机报告 `test-artifacts/public033-pdf-amd-hFM0Yk/result.json`。[公开下载](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.33)

开发分支在 RX 7800 XT 上用本机 TranslateGemma 4B 单独翻译 ResNet 第 3 页的脚注和标题。在首次对照中，模型给出的脚注译文保留了文内引用 `[28]`，省略了开头的脚注编号 `2`。把 PDF 里识别出的上标编号留给应用排版后，相同模型的译文保留了两者，下一节标题译为“3.3. 网络架构”。对双栏校准样张生成完整中文译稿时，第二批脚注也保留了编号 `1`。Ollama 报告模型占用 2,881,948,220 字节显存。设备上的前后对照分别保存在 `test-artifacts/resnet-footnote-amd-e7k4Lb` 和 `test-artifacts/resnet-footnote-amd-JvWd1S`。

## 0.2.32 公开便携版（2026-11-21）

RX 7800 XT 上从 GitHub 下载便携版，用已保存的 15 页《Attention Is All You Need》PDF 文字层生成英中双语摘要。六批输入经过五次合并，得到六条结论。四条结论带有五处引文，逐一点击均在阅读器中选中对应原句，重启后六条结论和引文均恢复。生成、跳转及重启共用时约 63 秒。Ollama 报告 Qwen3 4B Instruct 占用 3,180,247,121 字节显存，TranslateGemma 4B 占用 2,881,948,220 字节显存。

两条结论没有通过引文核验。其中一条将英语到法语翻译的 BLEU 分数写成了 `41.-41.8`，该论文摘要中的原值是 `41.8`。界面将此条标为未验证。本机记录为 `test-artifacts/public032-summary-acceptance.log`，工作区为 `test-artifacts/public032-summary-amd-Sfc79k`。[公开版本](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.32)

## 0.2.31 公开便携版（2026-11-21）

从 GitHub 下载的便携版在 Radeon RX 7800 XT 上调用本机 Ollama 的 `translategemma:4b`。两篇短文分别覆盖无标题的 DOI 书目、书目之后继续的方法段。三条 DOI 引文按原样保留。方法段译出“我们使用了新鲜样本”和“团队在解冻后重复测量”。Ollama 报告模型占用 2,881,948,220 字节显存。本机报告为 `test-artifacts/public031-amd-bibliography-JobbH5/result.json`。[公开版本](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.31)

同一便携版对《Attention Is All You Need》的 36 段节选完成初译和改术语后的重译。两轮各有一次模型漏掉标记，界面保留原文，选择续译后完成。两份译稿的三批内容逐项保留了原有的 25、14 和 7 个标记。之前被扩写的小标题在此次译稿中保持为标题。两轮共 44 次本机模型请求，累计约 62 秒。重启后笔记及高亮保留，旧引文在新译稿中有三个匹配位置时会提示复核。本机报告为 `test-artifacts/public031-amd-regenerated-multi-weQpJ0/result.json`。

## 0.2.30 公开便携版与开发分支（2026-11-21）

RX 7800 XT 上的公开便携版通过键盘选中全文译稿中的“注”，再以鼠标选中“注意力函数”，回译为“Attention function”。应用通过本机 Ollama 返回选区解释。三次依次切换高亮颜色后仍只有一条高亮。保存笔记、将术语改为“注意力映射函数”、关闭软件并重新生成译稿，旧引文消失时，批注列表提示需要复核，笔记和高亮再次重启后仍在。此次输入为《Attention Is All You Need》的第 35、42 段，4 次模型请求均使用 `translategemma:4b`，Ollama 报告模型及显存占用均为 2,881,948,220 字节。[公开版本](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.30) · 本机报告 `test-artifacts/public030-amd-regenerated-notes-6OWhmi/result.json`。

较长样例取自同一论文第 35 至 76 段中的 36 段文字，分成三批。公开 0.2.30 在本地模型漏掉受保护标记时保留了该批次的原文。显式续译后，三批中原有的 25、14 和 7 处公式或标记均按原顺序保留。不过，模型还将一个 29 字符的小标题扩写到 553 字符，并添加了一段原文没有的 Softmax 公式代码，因此公开包未通过这次严格的译稿保真检查。记录位于 `test-artifacts/public030-amd-regenerated-multi-znRKAX/result.json`。随后复制这份真实译稿到隔离工作区，在同一公开便携版中标注首段术语并改词重译。新的三批译文保留全部 46 处原有标记。旧选区在其他位置仍有三处相同引文，界面提示复核，重启后笔记与高亮均保留。本机报告 `test-artifacts/public030-captured-annotation-L1rZxA/result.json` 分别记录批注结果与初译中额外的公式。

开发分支拒绝模型自行添加的公式、代码、链接和明显的标题扩写。以公开版真实返回的 553 字符回答回放时命中了校验。再在同一台机器上用相同的 36 段原文完成初译、改术语、重生成及重启。两份完整译稿逐批保留了原有的全部 46 处标记，未出现新增标记。重译后旧引文在其他位置出现三次，批注列表提示需要复核，保存的笔记内容及颜色都可恢复。两轮合计 43 次本地模型请求，耗时合计约 61 秒。该结果针对这份节选和这次模型输出。[开发分支修复](https://github.com/haoyunLi/PaperBridge/commit/0267dd4) · 本机报告 `test-artifacts/development030-amd-regenerated-multi-6kyCiq/result.json`。

## 0.2.29 公开便携版与开发分支对照（2026-11-21）

从 GitHub 下载的便携版在 RX 7800 XT 上使用 `translategemma:4b` 翻译 Transformer 编码器段落。两次请求分别生成 80 和 66 个 token，实测生成速度为 126.4 和 128.6 tokens/s。模型采用了术语表中的“逐位置全连接前馈网络”。Ollama 报告模型与显存占用均为 2,881,948,220 字节。重启后保存的原文、公式和译文通过校验。[公开版本](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.29) · 本机报告 `test-artifacts/portable-0229-amd-glossary-66b6sG/result.json`。

使用同一论文第 35、42 段的原文生成全文译稿，标注“注意力函数”，再改用术语“注意力映射函数”并重启、重译。模型两次都采用了指定译法。公开 0.2.29 在旧引文完全消失后仍显示普通批注。开发分支使用渲染后的文字检查旧选区，显示需要复核的提示。两次测试均在重启后保留原引文、笔记正文与珊瑚色高亮。报告分别为 `test-artifacts/baseline029-amd-regenerated-notes-yQVjLM/result.json` 和 `test-artifacts/development029-amd-regenerated-notes-9h0Win/result.json`。

## 0.2.28 公开便携版 · 2026-11-21（美国中部）

RX 7800 XT 使用 `translategemma:4b` 翻译《Attention Is All You Need》的编码器段落。该段包含公式及术语表中的 `positionwise fully connected feed-forward network`，最终保存的译文采用“逐位置全连接前馈网络”。两次模型请求分别生成 80 和 66 个 token，从发出请求到收到结果分别耗时 4.88 秒和 0.67 秒，生成阶段实测 129.2 和 129.6 tokens/s。Ollama 报告模型大小及显存占用均为 2,881,948,220 字节。关掉并重开软件后，译文、原文和引用资源通过校验。这次使用已安装的本地模型，数据限于该论文段落和这台设备。[公开版本](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.28) · 本机报告 `test-artifacts/portable-0228-amd-glossary-ed2grF/result.json`。

## 0.2.27 公开便携版 · 2026-11-20（美国中部）

从 GitHub 下载的 0.2.27 在 RX 7800 XT 上运行 `translategemma:4b`，实测显示公式及代码中的 `$&` 原样保存并重启恢复。在真实论文的编码器段落，应用按术语表译作“逐位置全连接前馈网络”，两次请求耗时 0.79 秒和 0.68 秒，生成速度约 129 tokens/s。Ollama 报告模型占用与显存占用均为 2,881,948,220 字节。包含公式、引用和论文资源的重启验证通过。术语表的同版本有无对照见下方 0.2.26 记录。[公开版本](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.27) · 本机报告 `test-artifacts/public-0.2.27-amd-protected-U0NUxy/result.json`、`test-artifacts/portable-0227-amd-glossary-q1hk0o/result.json`。

## 0.2.26 公开便携版 · 2026-11-20（美国中部）

同一台 RX 7800 XT 以 `translategemma:4b` 在公开 0.2.25 和 0.2.26 上翻译同一段包含显示公式及代码的英语测试文本。两次模型原始回复相同。旧版把双美元公式保存成单美元，并把代码中的 `$&` 写成占位符。新版在阅读器保存并重启后保留了 `$$E = m c^2$$` 和 `const sample = "$&"`。新版单次请求耗时 4.76 秒，约 131 tokens/s。两次本机原始报告分别为 `test-artifacts/public-0.2.25-amd-protected-r3id4p/result.json` 和 `test-artifacts/public-0.2.26-amd-protected-qSJZsU/result.json`。

在另一份已保存的真实 MinerU 论文上，新版重译 Transformer 编码器段落，两次请求耗时 1.79 秒和 0.66 秒。Ollama 报告模型占用与显存占用均为 2,881,948,220 字节。公式、引用、论文资源和重启恢复验证通过。模型将原文 *positionwise* 译为“位置相关的”，该处应按上下文理解为“逐位置的”。这次运行复用了已加载的模型，后端加载日志见下方 0.2.25 的独立记录。[公开发布](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.26) · 本机报告 `test-artifacts/portable-0226-amd-mineru-9dwTMg/result.json`。

在同一版本、同一论文和模型上，给隔离工作区添加英语 → 简体中文术语 `positionwise fully connected feed-forward network` → `逐位置全连接前馈网络`，再重译同一段。请求中包含该术语，译文逐字采用指定译法，公式和引用保留，重启再次打开仍一致。原论文库和原术语表保持原样。本机报告 `test-artifacts/portable-0226-amd-glossary-gNFxYQ/result.json`。

2026-11-20（美国中部），从 GitHub 公开下载的 [0.2.25 Portable](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.25) 在 RX 7800 XT 上用 Ollama 的 `translategemma:4b` 翻译了一段真实论文。程序识别出约 16 GiB 独显和 512 MiB 核显，Ollama 本次新增日志确认使用 ROCm。模型分配与显存分配同为 2,881,948,220 字节，两次请求耗时 4.62 秒和 0.65 秒，生成速度分别约 129.8 和 130.3 tokens/s。两处公式与源文本一致，关闭并重新打开后译文和批注保留。模型把 “position-wise” 译成了“位置相关的”，此处应理解为“逐位置的”。完整记录在 `test-artifacts/portable-0225-amd-mineru-O2Bfwz/result.json`。

2026-11-20（美国中部）在 RX 7800 XT 和同机 AMD 核显上验证显存识别。Win32_VideoController 的 32 位 AdapterRAM 为独显返回 4,293,918,720 字节。按显示适配器匹配驱动的 64 位记录后，独显得到 17,163,091,968 字节，核显得到 536,870,912 字节。真实桌面应用的 Models 和 Local AI setup 均分别显示 16 GiB、512 MiB。NVIDIA 驱动回补、同型号双卡和不可用显存有模拟回归。报告为 `test-artifacts/amd-inventory-wl4HR6/report.json`。

2026-11-20（美国中部）复测了公开 Windows 0.2.24 Portable。下载文件的 SHA-256 为 `c6881ec35ecb42e9094dbbd4293be6fb74ef432555576085de3b9550a4d5918d`。在 RX 7800 XT 上，Ollama 通过 ROCm 运行 `translategemma:4b`，报告的模型分配和显存分配均为 2,881,948,220 字节。对已有 MinerU 提取结果中的 Encoder 长段执行翻译，两次请求分别耗时 6.01 秒和 0.64 秒，生成速度约 130 tokens/s。两处公式保留，重启后译文、批注、PDF 和资源校验通过。模型把 position-wise 译成“位置相关的”，此处“逐位置的”更准确。该次复测使用既有解析结果和已安装模型。详见本机 `test-artifacts/portable-0224-amd-mineru-dsCYmx/result.json`。

2026-11-07 09:34 UTC：**公开 Windows 0.2.20 Portable 的真实长段翻译与重启通过**，报告 `test-artifacts/portable-0220-amd-mineru-Y0St0z/result.json`。公开文件 SHA-256 `e47e7fed40a9f11666e7a31660cca63aea17a0bb93a2bd40cbc1b6a0c41bf66a` 已与校验文件和 GitHub digest 核对。使用此前真实 MinerU 提取的 Attention Is All You Need（15 页、167 块），只翻译原本 pending 的第 32 段 Encoder，原 Markdown 660 字符，含两条公式。隔离设置明确预置 maxParagraphChars=500，不声称通过设置 UI 修改；已有原始工作区未改动。

公开应用的实际段落菜单发送 **两次真实 Ollama 请求**，完整 payload（模型、system、prompt、语言、标题/样式/术语、stream 和 temperature）与预期精确匹配。保护后的正文分别为 **363 / 296 字素**；结果还原两条原公式，保存 English→Simplified Chinese，无残留保护标记。两次墙钟耗时 **4.837 秒 / 0.647 秒**，分别输出 80 / 66 tokens，模型生成速度约 **129.5 / 129.4 tokens/秒**；第一次含冷加载，不能把总耗时都当作生成时间。

本次日志从调用前文件偏移读取新增行，明确记录 **AMD Radeon RX 7800 XT、ROCm gfx1101、35/35 层 GPU**，模型与显存分配均为 **2,881,948,220 字节**。适配器 WMI 的 memoryBytes 受其字段限制，不能把约 4 GiB 报告值当作此卡物理显存；本次 Ollama ROCm 设备日志给出 16,368 MiB。完整关闭重启后新译文、语言、全部其它块/输出/批注和原 PDF、MinerU 资源字节保持，renderer errors 为 0，无清理错误。中文及两条公式在 1306×758 CSS、DPR 1.25 的 CDP renderer 截图中完整可见；这是原生窗口尺寸下的渲染截图，不是 OS 桌面截屏。

译文保留层数、残差连接、引用与模型维度，但将 position-wise 译为“位置相关”，专业措辞仍需人工审校。此次只证明本机这一段的真实请求、公式/资源保全和加速路径，不是整篇质量评测，也不是旧分块算法的失败样例。本轮不重新运行 MinerU/DirectML 解析、安装环境或测试 NVIDIA。用户 Ollama 未启停或重配，按服务自身策略保持模型驻留。

2026-11-07 08:40 UTC：公开 Windows 0.2.19 Portable 完成新推理与重启验收（`test-artifacts/portable-0219-amd-4uExfj/result.json`）。仅翻译真实论文此前 pending 的第 22 段，热模型 1.094 秒、约 127.6 输出 token/秒；Ollama 0.40.15 / TranslateGemma 4B 报告 modelBytes = vramBytes = 2,881,948,220。新输出 English→Simplified Chinese 与旧第 17 段 Chinese/null 译文分别经语言切换和完整重启保留，原文、缓存与 PDF 哈希不变，renderer errors 为 0。此前冷启动生成 6.125 秒，当次新增日志确认 RX 7800 XT、ROCm gfx1101、35/35 层 GPU；首次报告因脚本把缺失空批注数组与 [] 判为不同而失败，原报告 `portable-0219-amd-YztbEf/result.json` 保留，修正空容器比较后独立重跑通过。两轮各一次生成；热运行没有新后端加载行，不冒充新的 ROCm 日志证据。译文保留 [21]/[32]、ht/ht−1 和顺序计算限制，个别措辞仍需审校；只代表本段论文和本机。环境与用户 Ollama 未修改。分块修复属于后续开发代码，不在此公开包内。

2026-11-07：公开 Windows 0.2.19 便携版通过 SHA-256、校验文件和 GitHub digest 核对后，重新打开真实 Attention Is All You Need。首次加载与完整重启均保留原有 266 个 PDF 文字段落、第 17 段已存中文译文及字节不变的 15 页原 PDF；另用独立夹具验证选中段落与阅读位置、输出语言缓存及批注删除/撤销。原生窗口与明确标注为 CDP CSS 模拟的短视口截图均已检查。此次是公开产物与保存结果的兼容验证，模型请求为 0、renderer errors 为 0，不更新下方真实推理和 GPU 加速的证据。报告为 `test-artifacts/portable-0219-TdKMsM/result.json`，具体范围与限制见[全软件复查第 79 阶段](WHOLE_APP_REVIEW.md)。

2026-11-07 05:09 UTC：公开 Windows 0.2.16 便携版通过 SHA-256 校验后，直接打开真实 Attention Is All You Need，恢复原有 AMD 中文译文，并检查新段落修复弹窗、语言状态、三种阅读模式与搜索。该次为公开产物和已保存结果的兼容验证，没有重新运行推理或更换 GPU 环境；最近一次真实模型调用仍为下述 03:21 UTC 记录。报告为 `test-artifacts/portable-0216-ggksrb/result.json`。

2026-11-07 03:21 UTC：当前开发版再次完成 `npm run test:live`。Reader 通过新 Paragraph actions 菜单翻译练习段落，选词输出“虚构的练习文档”；灯泡先打开检查器，再通过检查器按钮获得真实段落解释。摘要有 6 处已核验来源引用，全文与重启流程通过。Ollama `/api/ps` 报告 `translategemma:4b` 模型大小和显存分配均为 2,881,948,220 字节。四个样例覆盖统计数字、CD8+ T 细胞术语、中译英和 Markdown 公式/图片保留。统计例的数值与单位保留，但译文改变了 p 值短语的位置，不能把这些检查当作全面的语义准确率评测。本次没有重新安装环境、运行 MinerU 或测 NVIDIA。结果为 `test-artifacts/live-local-report.json`，界面截图为 `test-artifacts/live-amd-reader.png`。

这份记录来自本机 Windows 11 Pro（build 26200）、AMD Radeon RX 7800 XT（驱动 32.0.31035.1003，16 GiB 显存）。集成显卡是 AMD Radeon Graphics。测试使用 Ollama 0.34.2、`translategemma:4b` 和 MinerU 3.4.5。生成的工作区、报告与截图保存在被 Git 忽略的 `test-artifacts/`。

2026-11-06 用通过 SHA-256 校验的公开 Windows 0.2.2 便携版直接打开真实 MinerU 论文，在 Reader 翻译 Attention Is All You Need 的第 30 块。TranslateGemma 4B 输出了包含“堆叠的自注意力机制”的中文段落。Ollama 0.40.15 选中 RX 7800 XT 的 ROCm `gfx1101`，日志显示 35/35 层卸载到 GPU，`/api/ps` 的模型大小和显存分配均为 2,881,948,220 字节。 [公开便携版](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.2)

同日重新下载并校验公开 0.2.3 便携版。Reader 再次完成同一真实段落的中文翻译，ROCm 仍使用 RX 7800 XT，35/35 层载入 GPU，模型大小与显存分配均为 2,881,948,220 字节。 [Windows 0.2.3](https://github.com/haoyunLi/PaperBridge/releases/tag/windows-v0.2.3)

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

## 已有 AMD 译稿与原页的便携导出（2026-11-06）

重开上述已翻译的 15 页论文工作区副本，在 Full Translation 中翻到第 3 页并检查实际渲染。通过桌面界面导出便携包，核对全文稿引用 15 张真实 PNG、宽高均超过 500 像素，译文正文与已保存结果一致，导出的 PDF 和工作区原 PDF 字节一致。此轮复用已有 AMD 译稿。

## 长文摘要与逐批证据（2026-11-06）

复用 15 页论文的 DirectML 导入工作区副本，在界面切换为 PDF 文字层后生成双语摘要。初次用 TranslateGemma 4B 兼做摘要时，Ollama 报告响应触及上下文上限，应用保留了原工作区。Windows 现在对本地 JSON 摘要限制 2,048 个输出 token，并在截断时提示选择不同的摘要模型。

用 Qwen3 4B Instruct 生成摘要、TranslateGemma 4B 翻译结论，完成 6 个正文批次、5 次滚动合并及 6 条双语结论，耗时 584.8 秒。4 条带引文的结论引用了 3 个原段，逐字匹配，另外 2 条显示无核验来源。从仅译文模式点击引用后，Reader 恢复双语并打开对应原段。两模型均使用 RX 7800 XT 的 ROCm 后端，Ollama 报告 Qwen3 的 3,178,149,969 字节和 TranslateGemma 的 2,875,656,764 字节均在显存。抽查时，未验证来源的结论中有一条把并行化扩大到整个推理过程。

复跑需先完成 DirectML 版的 `test:live-mineru`，在本机 Ollama 下载 `qwen3:4b-instruct` 与 `translategemma:4b`，再运行 `npm run test:live-summary`。该测试复制源工作区，可用 `PAPERBRIDGE_LIVE_SUMMARY_WORKSPACE`、`PAPERBRIDGE_LIVE_SUMMARY_MODEL`、`PAPERBRIDGE_LIVE_MODEL` 和 `PAPERBRIDGE_LIVE_OLLAMA` 指定工作区、两个模型与回环地址。

## 保存术语后翻译（2026-11-06）

在隔离工作区通过 Reader 选区保存 `Self-attention → 自注意机制`，等待写盘成功后翻译该段。TranslateGemma 4B 生成“自注意机制稳定了基线注意力得分。”Ollama 日志确认使用 RX 7800 XT 的 ROCm 后端，模型大小与显存占用均为 2,881,948,220 字节。此次验证的是一个英译中样例。

## 导入策略与 DirectML 独立重提取（2026-11-06）

在隔离工作区用同一份 15 页论文验证。故意指定缺失的 MinerU 路径，严格模式保留当前练习论文和书签，优先模式打开原 PDF 并得到 214 个文字层块，原因随论文保存。切回 MinerU-only 并指定本机 MinerU 4.1.7 后，通过 **Re-extract PDF as New Copy** 创建独立副本，得到 167 个结构化块。原文字层版本仍在库中。进度日志确认 DirectML 选择 RX 7800 XT，提取及原页渲染约 28.2 秒。

## 两页双栏图像扫描（2026-11-06 UTC）

将 ResNet 论文前两页以 145 DPI 灰度栅格化，第 2 页顺时针倾斜 1.2 度，再保存成只有图像的 PDF。采用默认 MinerU preferred 和 Auto，留空可执行路径。软件自动发现先前一键安装的 MinerU 4.1.7，解析日志确认选择 `dml` 和 RX 7800 XT。日志也显示 OCR 检测会话使用 CPU。导入约 16.8 秒，PDF 文字层为 0 块，MinerU 保存 29 块，其中有 3 个图像块。五处标题与正文锚点按预期顺序出现。 [原论文](https://arxiv.org/abs/1512.03385)

从 Paper 精确 PDF 第 2 页且当前采用 PDF 文字层的状态打开 OCR Reader。后退恢复原 PDF 第 2 页，前进回到 OCR Reader。第 2 页的段落经 TranslateGemma 4B 得到中文译文，Ollama 日志确认 ROCm，模型大小与显存占用均为 2,881,948,220 字节。退出并重开后仍可查看译文和书签。实际便携导出将三个图像写为 Markdown 引用的本地文件，导出的 `original.pdf` 与扫描输入逐字节一致。该样本验证双栏和轻微倾斜的英文扫描。

## 图注翻译、术语与提取警告（2026-11-23 UTC）

在 RX 7800 XT 上从原 PDF 导入 *Attention Is All You Need* 第 7 版。第 13–15 页的三幅图共包含十行旋转轴标签。Windows 读出十行完整标签，保留图 3–5 的说明，并把图 4 的 Top 与 Bottom 说明连在同一个段落中。原生 PDFKit 的文字层还包含五处被裁出图框的内部标题。Windows 已将这五处从阅读文字中剔除，原 PDF 的 SHA-256 保持一致。[原论文](https://arxiv.org/abs/1706.03762) · [macOS 对照](https://github.com/haoyunLi/PaperBridge/actions/runs/45122595860)

在 Original PDF 中直接双击第四幅图的第二个 `application` 时，0.2.88 的透明文字层会让一处不可见标题拦截鼠标。开发版现在保留旧笔记的文字偏移，并让鼠标命中印刷文字。在两页上分别选取四处同名标签，保存八条不同笔记。退出后改变缩放，从 Reader 的标注列表逐条跳回，选区与 Mac PDFKit 的实际位置均相符。旧版的可见标签笔记仍能跳转，锚在不可见标题上的旧笔记保留并提示复核。跨过被裁文字的引文仅显示印刷内容。[Mac PDFKit 同名标签定位](https://github.com/haoyunLi/PaperBridge/actions/runs/45124348109)

这些轴标签原先触发了十条“句末缺标点”提醒。修正后，Overview 和 Reader 都保留了真正需要核对的段落。实测从 Overview 打开第 4 页警告，再点击 Compare Original，可到达原 PDF 第 4 页并返回该段。手动改写标签文字后，常规质量检查重新生效。

TranslateGemma 4B 默认曾将图 4 的 `layer 5 of 6` 译为“第 5 层（也是第 6 层）”。在阅读器选区保存 `layer 5 of 6` 和 `attention heads` 两条术语，随后使用段落菜单重新翻译，得到了“两个注意力头，也位于六层中的第五层”。退出并重新打开后，修订译文与原文均保留。此例验证了术语修订的实际效果，普通模型输出仍需结合原文判断。

## 修复期间退出与预下载取消（2026-11-06 UTC）

复制已一键安装的 MinerU 4.1.7、Python、uv 包缓存及模型到隔离目录。通过 **Repair / update MinerU** 实际离线重装。在新环境运行时验证期间正常退出，退出结束后旧环境标记恢复，暂存目录和备份目录已清理。再次启动后自动发现旧环境，仍可选择 RX 7800 XT 的 DirectML。

第二次修复通过运行时验证后，取消可选的模型预下载。Setup 显示解析器已安装，新的环境保留。随后直接用该环境重新解析两页 ResNet 图像扫描，现有模型可用，日志确认 DirectML，读取 29 个块。

## 强制终止后的修复恢复（2026-11-06 UTC）

两个隔离应用实例使用同一份 MinerU、Python 和模型副本。第一实例实际离线重装，并在图形后端验证前暂停。第二实例检测时报告正在修复，原有备份保留。强制终止第一实例后，第二实例自动恢复并探测到原来的 DirectML 环境。另一次修复通过验证后强制终止，第二实例仍能打开新版，并通过 DirectML 解析 ResNet 两页扫描，得到 29 个块。
