/** fingerpose（npm）未自带类型声明——按 v2 运行时 API 手写
 *  ⚠️ 关键点必须是 [x,y,z] 数组格式（对象格式会全 NaN，见 HandTracker 注释） */
declare module 'fingerpose' {
  export type Landmark = [number, number, number]
  export interface GestureMatch { name: string; score: number }
  export interface EstimateResult {
    score: number;
    gestures: GestureMatch[];
    /** 逐指弯曲度/方向：[fingerName, curlName, directionName] × 5 */
    poseData?: [string, string, string][];
  }
  export class GestureDescription {
    constructor(name: string);
    name: string;
    addCurl(finger: number, curl: number, weight?: number): void;
    addDirection(finger: number, direction: number, weight?: number): void;
  }
  export class GestureEstimator {
    constructor(descriptions: GestureDescription[]);
    estimate(landmarks: Landmark[], minimumScore: number): EstimateResult;
  }
  export const Finger: {
    Thumb: number; Index: number; Middle: number; Ring: number; Pinky: number;
  };
  export enum FingerCurl { NoCurl = 0, HalfCurl = 1, FullCurl = 2 }
  export enum FingerDirection {
    VerticalUp = 0, VerticalDown = 1, HorizontalLeft = 2, HorizontalRight = 3,
    DiagonalUpLeft = 4, DiagonalUpRight = 5, DiagonalDownLeft = 6, DiagonalDownRight = 7, None = 8,
  }
  export const Gestures: Record<string, GestureDescription>;
}
