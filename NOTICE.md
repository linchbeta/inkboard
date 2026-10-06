# 第三方来源与许可

本项目整体按 **GNU GPL v3.0** 发布（见 [`LICENSE`](LICENSE)）。其中包含或改编自下列项目的部分，各自的版权与许可如下。

## 代码

### InkSight（MIT）

`firmware/` 是在 [datascale-ai/inksight](https://github.com/datascale-ai/inksight) 的 ESP32 固件基础上修改的
（网络、配网、显示、OTA、音频等模块，以及 `firmware/boards/other_panels.ini` 里的上游面板与开发板）。
`server/` 实现了与 InkSight 固件兼容的接口，但代码是独立编写的。

```
MIT License

Copyright (c) 2026 datascale-ai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### EPD-nRF5（GPL-3.0）

月历画面（`server/src/screens/calendar.ts`、`server/src/render/gfx.ts`、`server/src/render/reftext.ts`，
以及它在固件里的移植 `firmware/src/calendar_render.cpp`）移植自 EPD-nRF5 的 `GUI/GUI.c` 和 `GUI/Lunar.c`；
3.98" SE0398NZ07 A0 / A1 的驱动时序参考了它的 `EPD/UC81xx.c`。EPD-nRF5 按 GPL-3.0 发布，本项目因此整体采用 GPL-3.0。

### Waveshare e-Paper 示例代码

`firmware/src/epd_wft.h`、`firmware/src/epd4in2_wft.h`（WFT0420CZ15 4.2" 屏的驱动和波形表）改编自
[waveshareteam/e-Paper](https://github.com/waveshareteam/e-Paper) 的示例代码，按其原许可（宽松许可，保留版权声明）使用。

## 字体（`server/assets/fonts/`）

| 字体 | 许可 |
|---|---|
| 文泉驿点阵宋体 12/16px（`wqy-bitmapsong-*`） | GPLv2，附字体嵌入例外（`LICENSES/wqy-bitmapsong-COPYING.txt`） |
| Fusion Pixel 10/12px | SIL OFL 1.1 |
| 霞鹜文楷 LXGW WenKai、Inter、Barlow Condensed、Noto Sans SC（`*.bdf.gz`，按固定像素字号栅格化） | SIL OFL 1.1，详见 `NOTICE-display-fonts.md` |
| Helvetica Bold 数字点阵、文泉驿正黑 9px 农历字形（`ref-*`） | 取自 EPD-nRF5 使用的 u8g2 字体（Adobe/DEC X11 位图字体许可；GPLv2 + 字体例外） |
| 字体对比画面的候选字体（`candidates/`） | 各自许可见 `candidates/LICENSES/` |

## 数据

| 数据 | 来源 | 许可 |
|---|---|---|
| 法定节假日（`server/assets/holidays/`，以及固件里的 `calendar_data.h`） | [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn) | MIT |
| 农历、节气、干支 | [lunar-javascript](https://github.com/6tail/lunar-javascript)（npm 依赖） | MIT |
| 英语课本、雅思、GRE、GMAT、BEC、专四专八词库（`server/assets/words/`，打包） | [kajweb/dict](https://github.com/kajweb/dict) | 原仓库未声明许可证 |
| 小学英语大纲、中考、COCA 两万词（`server/assets/words/`，打包） | [mahavivo/english-wordlists](https://github.com/mahavivo/english-wordlists) | 原仓库未声明许可证 |
| 初中到 SAT 分级词表（运行时下载） | [KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary) | BSD-3-Clause |
| 日语 JLPT N5–N1（运行时下载） | [jamsinclair/open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks) | MIT |
| 各语言常用词（运行时下载） | [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords) | CC BY-SA 4.0 |
| HTTPS 根证书（`firmware/tools/certs/`、`firmware/src/cert_bundle.cpp`） | 公开的根证书机构证书 | — |

kajweb/dict 和 mahavivo/english-wordlists 的词库没有声明许可证，仅为方便离线使用而打包；
如果权利人有异议，请联系删除，删除后这些词库会在首次使用时联网下载。

运行时调用的在线服务（有道词典、Free Dictionary API、MyMemory、一言 hitokoto.cn、Open-Meteo 天气、腾讯 / 新浪行情）
不随本项目分发，使用时请遵守各自的服务条款。

## 固件依赖（编译时由 PlatformIO 下载，不随本仓库分发）

GxEPD2（GPL-3.0）、Adafruit GFX Library（BSD）、WebSockets（LGPL-2.1）、Arduino-ESP32 / ESP-IDF（Apache-2.0 / LGPL）。
