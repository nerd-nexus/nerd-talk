import { Action, ActionsApi, AsyncActionsApi } from './action.ts';
import { ActionsDef, AsyncActionsDef, ComputedDef } from '../public-types.ts';
import { AsyncState, ComputedState } from './state.ts';

/**
 * 스토어 내부 메서드 인터페이스
 * @template TState 스토어 상태 타입
 */
export interface StoreInternalMethods<TState extends Record<string, NonNullable<unknown>>> {
  getState: () => Readonly<TState>;
  subscribe: (listener: () => void) => () => void;
  subscribeState: <T>(
    selector: (state: Readonly<TState>) => T,
    listener: (value: T, oldValue?: T) => void,
  ) => () => void;
  subscribeStates: <S extends any[]>(
    selectors: { [K in keyof S]: (state: Readonly<TState>) => S[K] },
    listener: (values: S, oldValues?: S) => void,
  ) => () => void;
  _setState: (newState: Partial<TState>) => void;
  dispatch: (action: Action) => NonNullable<unknown>;
}

// 스토어 내부 구조에 대한 확장 인터페이스
export type StoreInternal<
  TState extends Record<string, NonNullable<unknown>>,
  TComputed extends ComputedDef<TState> = NonNullable<unknown>,
  TActions extends ActionsDef<TState> = NonNullable<unknown>,
  TAsyncActions extends AsyncActionsDef<TState> = NonNullable<unknown>,
> = Readonly<TState> & {
  computed: ComputedState<TState, TComputed>;
  actions: ActionsApi<TState, TActions, TComputed, TAsyncActions>;
  asyncActions: AsyncActionsApi<TState, TAsyncActions>;
  asyncState: {
    [K in keyof TAsyncActions]: AsyncState;
  };
} & StoreInternalMethods<TState>;

/**
 * 미들웨어 타입
 * @template TState 스토어 상태 타입
 */
export type Middleware<TState extends Record<string, NonNullable<unknown>>> = (
  store: StoreInternal<TState>,
) => (next: (action: Action) => NonNullable<unknown>) => (action: Action) => NonNullable<unknown>;

/**
 * 스토어 설정 인터페이스
 * @template TState 스토어 상태 타입
 * @template TComputed 계산된 속성 정의 타입
 * @template TActions 액션 정의 타입
 * @template TAsyncActions 비동기 액션 정의 타입
 */
export interface StoreConfig<
  TState extends Record<string, NonNullable<unknown>>,
  TComputed extends ComputedDef<TState>,
  TActions extends ActionsDef<TState>,
  TAsyncActions extends AsyncActionsDef<TState> = NonNullable<unknown>,
> {
  initialState: TState;
  computed?: TComputed;
  actions?: TActions;
  asyncActions?: TAsyncActions;
}

/**
 * 외부에 노출되는 스토어 타입 (내부 메서드 제외)
 * @template TState 스토어 상태 타입
 * @template TComputed 계산된 속성 정의 타입
 * @template TActions 액션 정의 타입
 * @template TAsyncActions 비동기 액션 정의 타입
 */
export type Store<
  TState extends Record<string, NonNullable<unknown>>,
  TComputed extends ComputedDef<TState> = NonNullable<unknown>,
  TActions extends ActionsDef<TState> = NonNullable<unknown>,
  TAsyncActions extends AsyncActionsDef<TState> = NonNullable<unknown>,
> = Omit<StoreInternal<TState, TComputed, TActions, TAsyncActions>, '_setState'>;

/**
 * 스토어 빌더 인터페이스 - DevTools 설정 단계
 */
export interface IStoreDevToolsBuilder<
  TState extends Record<string, NonNullable<unknown>>,
  TComputed extends ComputedDef<TState>,
  TActions extends ActionsDef<TState>,
  TAsyncActions extends AsyncActionsDef<TState>,
> {
  build(): Store<TState, TComputed, TActions, TAsyncActions>;
}

/**
 * 스토어 빌더 인터페이스 - 미들웨어 설정 단계
 */
export interface IStoreMiddlewareBuilder<
  TState extends Record<string, NonNullable<unknown>>,
  TComputed extends ComputedDef<TState>,
  TActions extends ActionsDef<TState>,
  TAsyncActions extends AsyncActionsDef<TState>,
> {
  devTool(name: string): IStoreDevToolsBuilder<TState, TComputed, TActions, TAsyncActions>;

  build(): StoreInternal<TState, TComputed, TActions, TAsyncActions>;
}

/**
 * 스토어 빌더 인터페이스 - 설정 단계
 */
export interface IStoreConfigBuilder<
  TState extends Record<string, NonNullable<unknown>>,
  TComputed extends ComputedDef<TState>,
  TActions extends ActionsDef<TState>,
  TAsyncActions extends AsyncActionsDef<TState>,
> {
  computed<NewComputed extends ComputedDef<TState>>(
    computedDefs: NewComputed,
  ): IStoreConfigBuilder<TState, NewComputed, TActions, TAsyncActions>;

  actions<NewActions extends ActionsDef<TState>>(
    actionDefs: NewActions,
  ): IStoreConfigBuilder<TState, TComputed, NewActions, TAsyncActions>;

  asyncActions<NewAsyncActions extends AsyncActionsDef<TState>>(
    asyncActionDefs: NewAsyncActions,
  ): IStoreConfigBuilder<TState, TComputed, TActions, NewAsyncActions>;

  middleware(
    middlewares: Middleware<TState>[],
  ): IStoreMiddlewareBuilder<TState, TComputed, TActions, TAsyncActions>;

  devTool(name: string): IStoreDevToolsBuilder<TState, TComputed, TActions, TAsyncActions>;

  build(): StoreInternal<TState, TComputed, TActions, TAsyncActions>;
}
