# 大字号字体（显示用）

`*.bdf.gz` 由 `scripts/make-fonts.py` 从下列字体按固定像素字号栅格化生成（抗锯齿后按 50% 阈值二值化），
属于各字体的修改版本，依 SIL Open Font License 1.1 分发（全文见 `LICENSES/sil-ofl-1.1.txt`），
文件名不使用任何保留字体名。

| 生成的文件 | 原字体 | 版权声明 |
|---|---|---|
| `lxgw-wenkai-*.bdf.gz`（含日文、韩文补充字形 `*-extra`：JIS X 0208、KS X 1001 韩文） | 霞鹜文楷 LXGW WenKai Medium v1.522 | Copyright 2021 LXGW |
| `inter-medium-*.bdf.gz` | Inter Medium | Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) |
| `barlow-condensed-bold-*.bdf.gz` | Barlow Condensed Bold | Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow) |
| `noto-sans-sc-medium-*.bdf.gz` | Noto Sans SC Medium（思源黑体） | Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source' |

`candidates/big/` 里是"大字字体对比"画面用的临时候选（只含示例文字）；其中等线、微软雅黑是微软的商业字体，
只在开发机上对比，已被 `.gitignore` 排除，不得分发。
