import { ActionsDef, AsyncActionsDef, ComputedDef } from '../types/public-types.ts';
import { StoreCreator } from './StoreCreator.ts';
import { StoreConfig, StoreInternal } from '../types/internal/store.ts';

/**
 * 스토어의 내부 상태와 메서드를 생성합니다.
 * 이 함수는 내부적으로 사용되며 일반적으로 직접 호출하지 않습니다.
 *
 * @template TState 스토어 상태 타입
 * @template TComputed 계산된 속성 정의 타입
 * @template TActions 액션 정의 타입
 * @template TAsyncActions 비동기 액션 정의 타입
 * @param config 스토어 설정 객체
 * @returns 생성된 스토어 인스턴스
 */
export function createStoreInternal<
  TState extends Record<string, NonNullable<unknown>>,
  TComputed extends ComputedDef<TState> = NonNullable<unknown>,
  TActions extends ActionsDef<TState> = NonNullable<unknown>,
  TAsyncActions extends AsyncActionsDef<TState> = NonNullable<unknown>,
>(
  config: StoreConfig<TState, TComputed, TActions, TAsyncActions>,
): StoreInternal<TState, TComputed, TActions, TAsyncActions> {
  const storeCreator = new StoreCreator<TState, TComputed, TActions, TAsyncActions>(config);
  return storeCreator.createStore();
}
