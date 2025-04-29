import { ActionsDef, AsyncActionsDef, ComputedDef } from '../types/public-types.ts';
import { Action, ActionsApi } from '../types/internal/action.ts';
import { StoreInternal } from '../types/internal/store.ts';
import { fx, keys } from '@fxts/core';

/**
 * 액션 관리자 - 동기 액션을 처리하고 관리합니다.
 * @template TState 스토어 상태 타입
 * @template TComputed 계산된 속성 정의 타입
 * @template TActions 액션 정의 타입
 * @template TAsyncActions 비동기 액션 정의 타입
 */
export class ActionManager<
  TState extends Record<string, any>,
  TComputed extends ComputedDef<TState>,
  TActions extends ActionsDef<TState>,
  TAsyncActions extends AsyncActionsDef<TState>,
> {
  private readonly actions: TActions;
  private readonly store: StoreInternal<TState, TComputed, TActions, TAsyncActions>;

  constructor(actions: TActions, store: StoreInternal<TState, TComputed, TActions, TAsyncActions>) {
    this.actions = actions;
    this.store = store;
  }

  /**
   * 기본 디스패치 함수를 생성합니다.
   * @param setState 상태 업데이트 함수
   * @returns 디스패치 함수
   */
  createDispatcher(setState: (state: Partial<TState>) => void): (action: Action) => any {
    return (action: Action): any => {
      // 상태 업데이트 액션 처리 - 메타데이터로 구분
      if (action.meta?.isStateUpdate) {
        if (action.payload && Object.keys(action.payload).length > 0) {
          setState(action.payload);
        }
        return this.store;
      }

      return this.store;
    };
  }

  /**
   * 액션 API를 생성합니다.
   * @returns 액션 API 객체
   */
  createActionsApi(): ActionsApi<TState, TActions, TComputed, TAsyncActions> {
    const api = {} as ActionsApi<TState, TActions, TComputed, TAsyncActions>;

    fx(keys(this.actions))
      .filter((key) => Object.hasOwn(this.actions, key) && !!this.actions[key])
      .each((key) => {
        const actionKey = key as keyof TActions;
        const actionFn = this.actions[actionKey];
        api[actionKey] = this.createActionWrapper(key, actionFn);
      });

    return api;
  }

  /**
   * 개별 액션 래퍼 함수를 생성합니다.
   * @param key 액션 키
   * @param actionFn 원본 액션 함수
   * @returns 래핑된 액션 함수
   */
  private createActionWrapper<K extends keyof TActions>(key: string, actionFn: TActions[K]) {
    return (...args: Parameters<TActions[K]>): StoreInternal<TState, TComputed, TActions, TAsyncActions> => {
      const result = actionFn(...args);
      let stateUpdatePayload: Partial<TState>;

      if (typeof result === 'function') {
        stateUpdatePayload = result(this.store.getState());
      } else {
        stateUpdatePayload = result;
      }

      // 액션 타입을 원래 액션 함수 이름으로 설정하여 DevTools에서 식별 가능하게 합니다
      const actionToDispatch = {
        type: key, // 원래 액션 이름을 타입으로 사용
        payload: stateUpdatePayload,
        meta: {
          isStateUpdate: true, // 상태 업데이트임을 표시하는 플래그
          args,
        },
      } as Action;

      this.store.dispatch(actionToDispatch);

      return this.store;
    };
  }
}
