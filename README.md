# Upwork Chrome Extension Filter

一个在 Upwork 搜索页面（`/nx/search/jobs`）注入工具栏的 Chrome 插件，提供以下功能：
- 工具栏包含两个按钮：`采集工作` 和 `暂停`（暂停后按钮变为 `恢复`）。
- 点击 `采集工作` 后，遍历页面上的所有 `article`（JobTile），采集标题链接和是否 `Payment verified`。
- 若为 `Payment verified`，在弹窗中展示可跳转的列表，点击即可在新标签打开。
 - 自动翻页：采集完本页后，自动点击“下一页”按钮（`button[data-test="next-page"]`），等待页面内容更新并继续采集，直到无下一页或检测到重复页面为止。

## 安装使用

1. 将本项目解压到本地文件夹。
2. 打开 Chrome → `chrome://extensions/`。
3. 右上角开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择本项目根目录。
5. 访问 `https://www.upwork.com/nx/search/jobs`（或 `https://upwork.com/nx/search/jobs`）。
6. 页面右上角会出现工具栏：
   - 点击 `采集工作`：采集当前页面可见的所有工作。
   - 点击 `暂停/恢复`：暂停或继续采集流程（采集中可随时暂停）。
   - 采集完成后，会弹出列表，显示 `Payment verified` 的工作，点击可在新标签打开。

## 工作项判定与选择器说明

- JobTile：`article[data-test="JobTile"]` 或 `article.job-tile`（兼容选择器）。
- 标题链接：优先 `div.job-tile-header.d-flex.align-items-start` 下的 `a.air3-link[href]`，或备选 `a.air3-link[href][data-test*="job-tile-title-link"]`。
- 付款验证：在 `div[data-test="JobTileDetails"]` 里存在 `li[data-test="payment-verified"]` 即视为已验证。
 - 发布时间过滤：从 `small[data-test="job-pubilshed-date"]` 读取发布时间，仅采集发布在 1–2 天内或数小时内的工作（例如 `Posted 3 hours ago`）。

## 其他说明

- 链接会用 `https://upwork.com/` 作为域名前缀进行拼接。
- 工具栏固定在页面右上角，不影响页面内容。
- 本插件仅采集当前已加载的内容，不会自动滚动加载更多。
 - 跨页采集基于按钮可用状态与页面内容变化判断，若网络较慢或页面结构变化，可能导致等待超时提前终止。

## 文件结构

- `manifest.json`：扩展清单，定义匹配页面与注入脚本。
- `content.js`：内容脚本，注入工具栏并实现采集逻辑与弹窗。
- `content.css`：样式文件，工具栏与弹窗的外观。
