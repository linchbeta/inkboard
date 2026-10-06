// Minimal typings for the parts of lunar-javascript (MIT, github.com/6tail/lunar-javascript) we use.
declare module "lunar-javascript" {
  interface Lunar {
    getYear(): number;
    /** Lunar month, negative for a leap month (e.g. -6 = 闰六月). */
    getMonth(): number;
    getDay(): number;
    getYearInGanZhi(): string;
    getYearShengXiao(): string;
    getDayInGanZhi(): string;
    getMonthInGanZhi(): string;
    /** Almanac 宜 / 忌 activities for the day. */
    getDayYi(): string[];
    getDayJi(): string[];
    getSolar(): Solar;
    getYueXiang(): string;
    getDayChongDesc(): string;
    getDaySha(): string;
    getPengZuGan(): string;
    getPengZuZhi(): string;
    getDayPositionXiDesc(): string;
    getDayPositionFuDesc(): string;
    getDayPositionCaiDesc(): string;
    getDayTianShen(): string;
    getDayTianShenLuck(): string;
    getXiu(): string;
    getXiuLuck(): string;
    getZheng(): string;
    getAnimal(): string;
    getDayNaYin(): string;
    getZhiXing(): string;
    getMonthInChinese(): string;
    getDayInChinese(): string;
    /** Name of the solar term starting on this day, or "". */
    getJieQi(): string;
    /** Next solar term (wholeDay: compare by date, not exact time). */
    getNextJieQi(wholeDay?: boolean): { getName(): string; getSolar(): Solar };
  }
  interface Solar {
    getLunar(): Lunar;
    getWeek(): number;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
  }
  const pkg: {
    Solar: { fromYmd(year: number, month: number, day: number): Solar };
    Lunar: { fromYmd(year: number, month: number, day: number): Lunar };
  };
  export default pkg;
}
