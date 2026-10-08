# 离线日历一致性测试

检查固件里的日历（`src/calendar_render.cpp`）和服务器画的日历逐字节相同：两边各渲染每一天、两种屏，
比较发给屏幕的 2bpp 画面的 FNV-1a 校验值。需要一个电脑上的 C++ 编译器（如 w64devkit）。

```powershell
g++ -O2 -o caltest.exe tools\calendar_test\main.cpp src\calendar_render.cpp
.\caltest.exe 2025 2074 > actual.txt
cd ..\server; npx tsx ..\firmware\tools\calendar_test\expected.ts 2025 2074 > ..\firmware\expected.txt
```

再加一个方向参数（`landscape`、`portrait`、`landscape-flip`、`portrait-flip`，默认横向）就比较那个方向的画面，
例如 `.\caltest.exe 2025 2030 all portrait` 和 `npx tsx ...expected.ts 2025 2030 all portrait`；只比我们两块屏时第三个参数写 `ours`。

两边命令末尾加 `all` 会覆盖固件里所有有日历的屏（4.2" 黑白黄红、5.83" / 7.5" 三色，以及 4.2" / 5.83" / 7.5" 黑白，
还有 5.65" / 7.3" 彩色、7.5" / 5.83" V1 三色和黑白、5.83" 黑白黄红、7.5" HD 三色和黑白、9.7" 三色），
例如 `.\caltest.exe 2025 2034 all`。设备端每一帧都画两遍：整帧一次、按 24 行一段（逐行写屏的屏就是这样画的）一次，
两者不同时输出 `BANDS DIFFER`。

然后比较两个文件（忽略行尾）：`Compare-Object (gc expected.txt) (gc actual.txt)` 没有输出即一致。
`caltest.exe dump 2026 10 4` 会写出那天的两块屏的原始画面（`cal_*.raw`）方便对比。

日历数据和字形由 `server/scripts/export-firmware-calendar.ts` 生成到 `src/calendar_data.h`；
后端的日历版式或节假日数据变了，就重新生成并跑一遍这个测试。

## 节假日的两端一致性

`holidays.mts` 往服务器加两份虚构的安排（2027 年从 2026-12 开始放假、2028 年从 2027-12-31 开始），
保存 `/api/holidays/<年>` 的真实回应和服务器每天的休/班；`holidays.cpp` 用固件的同一份查询代码
（`src/holiday_table.h` + 内置表）逐日对比，并比较两个跨年前后的日历画面：

```powershell
cd ..\server; npx tsx ..\firmware\tools\calendar_test\holidays.mts $out   # $out：一个空文件夹
g++ -O2 -o holtest.exe tools\calendar_test\holidays.cpp src\calendar_render.cpp
.\holtest.exe $out device > got_device.txt     # 和 $out\holidays_expected.txt 比较
.\holtest.exe $out download > got_download.txt # 同上（不用内置年份，全部下载）
.\holtest.exe $out frames > got_frames.txt     # 和 $out\holidays_frames.txt 比较
```
