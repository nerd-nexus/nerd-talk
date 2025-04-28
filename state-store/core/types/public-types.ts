/**
 * 계산된 속성 정의 타입
 * @template TState 스토어 상태 타입
 */
export type ComputedDef<TState extends Record<string, any>> = Record<
  string,
  (state: Readonly<TState>) => NonNullable<unknown>
>;

/**
 * 액션 결과 타입 - 부분 상태 또는 상태 업데이트 함수
 * @template TState 스토어 상태 타입
 */
export type ActionResult<TState> = Partial<TState> | ((state: Readonly<TState>) => Partial<TState>);

/**
 * 액션 정의 타입
 * @template TState 스토어 상태 타입
 */
export type ActionsDef<TState extends Record<string, any>> = Record<
  string,
  (...args: any[]) => ActionResult<TState>
>;

/**
 * 비동기 액션 결과 타입
 * @template TState 스토어 상태 타입
 */
export type AsyncResult<TState> =
  | {
      success: true;
      state: Partial<TState>;
    }
  | {
      success: false;
      error: Error;
    };

/**
 * 비동기 액션 정의 타입
 * @template TState 스토어 상태 타입
 */
export type AsyncActionsDef<TState extends Record<string, any>> = Record<
  string,
  (...args: any[]) => Promise<AsyncResult<TState>>
>;
