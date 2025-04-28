import { ActionsDef, AsyncActionsDef, ComputedDef } from '../types/public-types.ts';
import { createStoreInternal } from './createStoreInternal.ts';
import { ServerStoreConfigBuilder } from './ServerStoreBuilder.ts';
import { applyMiddlewares, connectDevTools } from './storeEnhancers';
import {
  IStoreConfigBuilder,
  IStoreDevToolsBuilder,
  IStoreMiddlewareBuilder,
  Middleware,
  Store,
  StoreConfig,
  StoreInternal,
} from '../types/internal/store.ts';

/**
 * 스토어 빌더 클래스 - 빌더 패턴의 시작점
 * @template TState 스토어 상태 타입
 */
export class StoreBuilder<TState extends Record<string, NonNullable<unknown>>> {
  /**
   * 초기 상태를 설정하고 스토어 설정 빌더를 반환합니다.
   * @param initialState 초기 상태 객체
   * @returns 스토어 설정 빌더 인스턴스
   */
  initialState(
    initialState: TState,
  ): IStoreConfigBuilder<TState, NonNullable<unknown>, NonNullable<unknown>, NonNullable<unknown>> {
    // 서버 환경에서는 ServerStoreConfigBuilder를 반환
    if (typeof window === 'undefined') {
      return new ServerStoreConfigBuilder<TState>({ initialState });
    } else {
      // 클라이언트 환경에서는 ClientStoreConfigBuilder를 반환
      return new ClientStoreConfigBuilder<
        TState,
        NonNullable<unknown>,
        NonNullable<unknown>,
        NonNullable<unknown>
      >({
        initialState,
        computed: {},
        actions: {},
        asyncActions: {},
      });
    }
  }
}

/**
 * 클라이언트 스토어 빌더 추상 클래스
 * @template TState 스토어 상태 타입
 * @template TComputed 계산된 속성 정의 타입
 * @template TActions 액션 정의 타입
 * @template TAsyncActions 비동기 액션 정의 타입
 */
abstract class BaseClientStoreBuilder<
  TState extends Record<string, NonNullable<unknown>>,
  TComputed extends ComputedDef<TState>,
  TActions extends ActionsDef<TState>,
  TAsyncActions extends AsyncActionsDef<TState>,
> {
  protected config: StoreConfig<TState, TComputed, TActions, TAsyncActions>;
  protected middlewares: Middleware<TState>[];

  constructor(
    config: StoreConfig<TState, TComputed, TActions, TAsyncActions>,
    middlewares: Middleware<TState>[] = [],
  ) {
    this.config = config;
    this.middlewares = middlewares;
  }

  /**
   * 스토어를 생성하는 공통 로직
   * @param withDevTools DevTools 연결 여부
   * @param devToolsName DevTools에 표시될 이름 (연결 시에만 사용)
   * @returns 생성된 스토어 인스턴스
   */
  protected buildStore(
    withDevTools = false,
    devToolsName?: string,
  ): StoreInternal<TState, TComputed, TActions, TAsyncActions> {
    // 스토어 생성
    let store = createStoreInternal<TState, TComputed, TActions, TAsyncActions>(this.config);

    // 미들웨어 적용
    if (this.middlewares.length > 0) {
      store = applyMiddlewares<TState, TComputed, TActions, TAsyncActions>(store, this.middlewares);
    }

    // DevTools 연결 (필요한 경우)
    if (withDevTools && devToolsName) {
      try {
        store = connectDevTools<TState, TComputed, TActions, TAsyncActions>(store, devToolsName);
      } catch (error) {
        // DevTools 연결 오류 무시
      }
    }

    return store;
  }
}

/**
 * 클라이언트측 스토어 미들웨어 빌더 클래스
 * @template TState 스토어 상태 타입
 * @template TComputed 계산된 속성 정의 타입
 * @template TActions 액션 정의 타입
 * @template TAsyncActions 비동기 액션 정의 타입
 */
class ClientStoreMiddlewareBuilder<
    TState extends Record<string, NonNullable<unknown>>,
    TComputed extends ComputedDef<TState>,
    TActions extends ActionsDef<TState>,
    TAsyncActions extends AsyncActionsDef<TState>,
  >
  extends BaseClientStoreBuilder<TState, TComputed, TActions, TAsyncActions>
  implements IStoreMiddlewareBuilder<TState, TComputed, TActions, TAsyncActions>
{
  /**
   * DevTools 설정을 추가합니다.
   * @param name DevTools에 표시될 스토어 이름
   * @returns 스토어 DevTools 빌더
   */
  devTool(name: string): IStoreDevToolsBuilder<TState, TComputed, TActions, TAsyncActions> {
    return new ClientStoreDevToolsBuilder<TState, TComputed, TActions, TAsyncActions>(
      this.config,
      this.middlewares,
      name,
    );
  }

  /**
   * 스토어를 생성합니다.
   * @returns 미들웨어가 적용된 스토어 인스턴스
   */
  build(): StoreInternal<TState, TComputed, TActions, TAsyncActions> {
    return this.buildStore();
  }
}

/**
 * 클라이언트측 스토어 DevTools 빌더 클래스
 * @template TState 스토어 상태 타입
 * @template TComputed 계산된 속성 정의 타입
 * @template TActions 액션 정의 타입
 * @template TAsyncActions 비동기 액션 정의 타입
 */
class ClientStoreDevToolsBuilder<
    TState extends Record<string, NonNullable<unknown>>,
    TComputed extends ComputedDef<TState>,
    TActions extends ActionsDef<TState>,
    TAsyncActions extends AsyncActionsDef<TState>,
  >
  extends BaseClientStoreBuilder<TState, TComputed, TActions, TAsyncActions>
  implements IStoreDevToolsBuilder<TState, TComputed, TActions, TAsyncActions>
{
  private devToolsName: string;

  constructor(
    config: StoreConfig<TState, TComputed, TActions, TAsyncActions>,
    middlewares: Middleware<TState>[],
    devToolsName: string,
  ) {
    super(config, middlewares);
    this.devToolsName = devToolsName;
  }

  /**
   * 최종 스토어를 생성합니다.
   * @returns 미들웨어와 DevTools가 적용된 스토어 인스턴스
   */
  build(): Store<TState, TComputed, TActions, TAsyncActions> {
    return this.buildStore(true, this.devToolsName);
  }
}

/**
 * 클라이언트측 스토어 설정 빌더 기본 클래스
 * @template TState 스토어 상태 타입
 * @template TComputed 계산된 속성 정의 타입
 * @template TActions 액션 정의 타입
 * @template TAsyncActions 비동기 액션 정의 타입
 */
export class ClientStoreConfigBuilder<
  TState extends Record<string, NonNullable<unknown>>,
  TComputed extends ComputedDef<TState>,
  TActions extends ActionsDef<TState>,
  TAsyncActions extends AsyncActionsDef<TState>,
> implements IStoreConfigBuilder<TState, TComputed, TActions, TAsyncActions>
{
  protected config: StoreConfig<TState, TComputed, TActions, TAsyncActions>;

  constructor(config: StoreConfig<TState, TComputed, TActions, TAsyncActions>) {
    this.config = config;
  }

  /**
   * 계산된 속성을 설정합니다.
   * @param computedDefs 계산된 속성 정의 객체
   * @returns 업데이트된 스토어 설정 빌더
   */
  computed<NewComputed extends ComputedDef<TState>>(
    computedDefs: NewComputed,
  ): IStoreConfigBuilder<TState, NewComputed, TActions, TAsyncActions> {
    return new ClientStoreConfigBuilder<TState, NewComputed, TActions, TAsyncActions>({
      ...this.config,
      computed: computedDefs,
    });
  }

  /**
   * 액션을 설정합니다.
   * @param actionDefs 액션 정의 객체
   * @returns 업데이트된 스토어 설정 빌더
   */
  actions<NewActions extends ActionsDef<TState>>(
    actionDefs: NewActions,
  ): IStoreConfigBuilder<TState, TComputed, NewActions, TAsyncActions> {
    return new ClientStoreConfigBuilder<TState, TComputed, NewActions, TAsyncActions>({
      ...this.config,
      actions: actionDefs,
    });
  }

  /**
   * 비동기 액션을 설정합니다.
   * @param asyncActionDefs 비동기 액션 정의 객체
   * @returns 업데이트된 스토어 설정 빌더
   */
  asyncActions<NewAsyncActions extends AsyncActionsDef<TState>>(
    asyncActionDefs: NewAsyncActions,
  ): IStoreConfigBuilder<TState, TComputed, TActions, NewAsyncActions> {
    return new ClientStoreConfigBuilder<TState, TComputed, TActions, NewAsyncActions>({
      ...this.config,
      asyncActions: asyncActionDefs,
    });
  }

  /**
   * 미들웨어를 설정합니다.
   * @param middlewares 미들웨어 배열
   * @returns 스토어 미들웨어 빌더
   */
  middleware(
    middlewares: Middleware<TState>[],
  ): IStoreMiddlewareBuilder<TState, TComputed, TActions, TAsyncActions> {
    return new ClientStoreMiddlewareBuilder<TState, TComputed, TActions, TAsyncActions>(
      this.config,
      middlewares,
    );
  }

  /**
   * DevTools 설정을 추가합니다.
   * @param name DevTools에 표시될 스토어 이름
   * @returns 스토어 DevTools 빌더
   */
  devTool(name: string): IStoreDevToolsBuilder<TState, TComputed, TActions, TAsyncActions> {
    return new ClientStoreDevToolsBuilder<TState, TComputed, TActions, TAsyncActions>(this.config, [], name);
  }

  /**
   * 스토어를 생성합니다.
   * @returns 생성된 스토어 인스턴스
   */
  build(): StoreInternal<TState, TComputed, TActions, TAsyncActions> {
    return createStoreInternal<TState, TComputed, TActions, TAsyncActions>(this.config);
  }
}
