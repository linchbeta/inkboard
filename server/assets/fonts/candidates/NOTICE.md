# 字体对比候选（临时）

这些文件只用于"字体对比"画面（`src/screens/fontCompare.ts`），只保留了对比画面用到的字符。
选定字体后，会按完整字符集重新生成正式字体，没选中的候选会删除。
生成脚本：`scripts/make-font-candidates.py`。

| 文件 | 来源 | 许可 |
|---|---|---|
| `wqy-bitmapsong-12px.bdf`、`wqy-bitmapsong-16px.bdf` | 文泉驿点阵宋体 1.0.0-RC1（`wenquanyi_9pt.bdf` / `wenquanyi_12pt.bdf`），SourceForge 上的 wqy 项目 | GPL v2 + 字体嵌入例外，见 `LICENSES/wqy-bitmapsong-COPYING.txt` |
| `ref-wqy-zenhei-9px.bdf` | EPD-nRF5 参考项目 `GUI/fonts.c` 里的 `u8g2_font_wqy6_t_lunar`（由文泉驿正黑 9px 生成） | 文泉驿正黑：GPL v2 + 字体嵌入例外 |
| `ref-helvetica-bold-20px.bdf`、`ref-helvetica-bold-25px.bdf` | 同上，来自 `u8g2_font_helvB14_tn` / `helvB18_tn`（X11 Adobe Helvetica Bold 100dpi，仅数字） | Adobe / DEC 的 X11 位图字体许可（允许复制和分发，需保留版权声明）：Copyright (c) 1984, 1987 Adobe Systems Incorporated; Copyright (c) 1988, 1991 Digital Equipment Corporation |
| `barlow-condensed-*.bdf` | Barlow Condensed SemiBold / Bold（google/fonts），用 Pillow 按固定字号栅格化 | SIL OFL 1.1，见 `LICENSES/barlow-condensed-OFL.txt` |
| `lxgw-wenkai-medium-*.bdf` | 霞鹜文楷 Medium v1.522（github.com/lxgw/LxgwWenKai），用 Pillow 按固定字号栅格化 | SIL OFL 1.1（Copyright 2021 LXGW），条款见 `LICENSES/sil-ofl-1.1-text.txt` |
