/** 首次采集的历史范围；值为提交给设置接口的天数，0 表示不限时间。 */
export const FOLLOW_INITIAL_RANGE_OPTIONS = [
  ['0', "기간 제한 없음"],
  ['7', "최근 7일"],
  ['30', "최근 30일"],
  ['90', "최근 90일"],
] as const satisfies readonly (readonly [value: string, label: string])[];

export type InitialFollowRange = typeof FOLLOW_INITIAL_RANGE_OPTIONS[number][0];
