import { ComputedDef } from '../public-types.ts';

/**
 * 비동기 액션 상태 추적 타입
 */
export interface AsyncState {
  pending: boolean;
  error: Error | null;
  loaded: boolean;
}

/**
 * 계산된 상태 타입
 * @template TState 스토어 상태 타입
 * @template TComputed 계산된 속성 정의 타입
 */
export type ComputedState<
  TState extends Record<string, NonNullable<unknown>>,
  TComputed extends ComputedDef<TState>,
> = {
  readonly [K in keyof TComputed]: ReturnType<TComputed[K]>;
};
