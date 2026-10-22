# PairDrop 私人传输助手 · 第一阶段 UI 改造

> 基于 schlagmichdoch/PairDrop 的 `master`。本阶段仅增加覆盖样式，以及对应的样式引用与 PWA 缓存更新。文件传输与配对实现保持不变。

## 本次变更

- `public/styles/personal-transfer.css`：独立 UI 覆盖样式，兼容亮暗模式、窄屏与减少动画偏好。
- `public/index.html`：只添加 CSS 引用，不修改原有 DOM 结构和事件。
- `public/service-worker.js`：预缓存新样式并更新缓存版本。
- `PERSONAL_UI_README.md`：改造说明。

**未改动**：`public/scripts/`、`server/`、WebRTC、WebSocket、配对逻辑、文件传输逻辑。

## 如何检查

1. 从 `feature/personal-ui-v1` 分支启动 PairDrop，参照上游 README 配置运行环境。
2. 在电脑和手机上检查设备发现和首次配对。
3. 发送文件及文字，检查接收与确认弹窗。
4. 切换亮/暗色主题，测试手机端窄屏和 PWA 更新。
5. 若发现视觉变化影响交互，可移除 `public/index.html` 的自定义 CSS 链接快速回退样式。

> 当前为第一轮样式层改造，不是最终的聊天式界面，不包括 Windows 托盘程序。尚未完成跨设备真实传输验收。

## 后续路线

- V2：基于实际 UI 验收反馈逐步改进页面布局，尽可能保留 PairDrop 现有交互事件与业务 API。
- V3：独立开发 Tauri Windows 托盘外壳，实现开机启动、快捷键和剪贴板快捷操作。
- Android：先使用 PWA；后台接收能力需另外评估系统限制。

## 许可证

上游 PairDrop 采用 GPL-3.0；Fork 的分发需遵守原许可证要求，保留版权与许可文件。
