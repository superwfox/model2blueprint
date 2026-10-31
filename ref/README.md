# 窗棂设计参考

2026-10-29 从本机 `minecraft-dev` 项目复制，原项目文件保持原样：

| 本地文件 | 原始位置 | 用途 |
| --- | --- | --- |
| `refer.html` | `minecraft-dev/ref/refer.html` | 卡片、按钮、层级及角花动画原型；保留原始早期配色 |
| `lattice.css` | `minecraft-dev/src/styles/lattice.css` | 实际黑底麦金色主题、直角边框、间距和状态，以此配色为准 |
| `lattice.ts` | `minecraft-dev/src/ui/lattice.ts` | 原 Vue 指令与 SVG 角花几何 |
| `typography.css` | `minecraft-dev/src/styles/typography.css` | Minecrafter 品牌字、江西拙楷固定文案、钉钉进步体动态内容 |

参考文件是原始快照，不作为当前页面的运行代码。可通过开发服务的 `/ref/refer.html` 打开样稿。

## 本项目的应用

- `src/app/style.css`：统一主题变量，背景 `#000000`，麦金色 `#c6b07d`，正文 `#d1c8b6`；上传区、工具栏、表单和面板使用直角细边框。
- `src/app/components/LatticeCorners.vue`：以 Vue SVG 保留参考角花。卡片角花在框外，按钮角花内嵌，均不接收鼠标或键盘事件。
- `src/app/components/UploadArea.vue`：保留窗棂角花的顺序起伏；工作期间随进度加快，接近完成后恢复，隐藏或减少动态效果时停止动画。
- `WorkspaceToolbar.vue` / `HistoryPanel.vue`：下载按钮右侧使用时钟历史入口，沿用容器内展开、黑底金色上箭头及窗棂按钮；历史动态文件名与操作使用本地进步体，长文件名省略并保留完整 title，按钮保持独立内边距。
- `TransientBar.vue` / `NavigationBar.vue`：复用现有窗棂框、按钮、动态字体与间距；移动触发底部滑入，5 秒无刷新滑出，减少动态效果时直接切换。落点选择提示使用带背景的状态框，保留文字四周留白。
- 所有运行滑条在 `style.css` 统一为 2px 细直线轨道、12px 方形滑块与 24px 操作高度；无圆角，颜色继续使用主题变量。步行、飞行速度同栏显示，最长「取消落点选择」按钮保留内边距；ref 中的原始快照不修改。
- `src/adapters/renderer/viewer.ts` 与 `src/adapters/slice.ts`：画布使用同一黑色系，网格使用中性色；模型灯光、原始材质、方块贴图及几何处理保持原有行为。
- `public/fonts/`：复用 Minecrafter，江西拙楷裁切为固定文案字集，钉钉进步体保留来源完整字集，用于材质名、方块名、输入值和处理状态。全部本地加载。

2026-10-31 将运行界面迁移为 Vue，新增依赖已单独获用户确认；四份原始设计快照保持原样。字体验证与更新方式见项目 README，本轮记录见根目录 Changelog。

## 2026-10-29 本地设计检查

- 四份参考与原文件的 SHA-256 一致。
- `npm run typecheck`、字体维护脚本的 Python 语法检查与 `git diff --check` 通过。
- 完成上传页、转换结果、材质展开、四类实际最长方块名称及切片的基础视觉检查；桌面检查在 1440×900 的页面容器中进行，另核对窄侧栏布局。项目直接页面重新加载后未出现控制台警告或错误。
- 未运行测试套件或生产构建，未提交、推送或部署。本轮使用本地生成的简单 GLB 检查界面，不代表已完成复杂建筑或游戏内导入验收。

## 2026-10-30 推送前检查

- 按用户推送要求运行 `npm run check`：33 项核心测试全部通过，TypeScript 检查与 Vite 生产构建通过。
- 构建保留主入口文件超过 500 kB 的体积提示；本项目没有服务端或单独的服务端测试命令。
- 复用上一轮已完成的基础视觉检查；本次未修改界面实现，不重复进行视觉检查。以上检查不代替复杂建筑或 Axiom 内的实际导入验收。
