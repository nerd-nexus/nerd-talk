import { ActionsDef, AsyncActionsDef, ComputedDef } from '../types/public-types.ts';
import { createStoreInternal } from './createStoreInternal.ts';
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
 * 서버 스토어 빌더 추상 클래스
 * @template TState 스토어 상태 타입
 */
abstract class BaseServerStoreBuilder<TState extends Record<string, NonNullable<unknown>>> {
  protected config: StoreConfig<TState, NonNullable<unknown>, NonNullable<unknown>, NonNullable<unknown>>;

  constructor(config: StoreConfig<TState, NonNullable<unknown>, NonNullable<unknown>, NonNullable<unknown>>) {
    this.config = config;
  }

  /**
   * 스토어를 생성하는 공통 로직
   * 서버 환경에서는 미들웨어와 DevTools를 적용하지 않습니다.
   * @returns 생성된 스토어 인스턴스
   */
  protected buildStore(): StoreInternal<TState> {
    return createStoreInternal<TState>(this.config);
  }
}

/**
 * 서버 환경용 미들웨어 빌더 클래스
 * 서버에서는 미들웨어를 적용하지 않고 빌더 패턴만 유지합니다.
 *
 * @template TState 스토어 상태 타입
 */
export class ServerStoreMiddlewareBuilder<TState extends Record<string, NonNullable<unknown>>>
  extends BaseServerStoreBuilder<TState>
  implements IStoreMiddlewareBuilder<TState, NonNullable<unknown>, NonNullable<unknown>, NonNullable<unknown>>
{
  /**
   * 서버 환경용 DevTools 빌더를 반환합니다.
   * 실제로는 DevTools 연결을 수행하지 않습니다.
   *
   * @param _name 사용하지 않는 DevTools 이름 파라미터
   * @returns 서버 환경용 DevTools 빌더
   */
  devTool(
    // eslint-disable-next-line unused-imports/no-unused-vars,@typescript-eslint/no-unused-vars
    _name: string,
  ): IStoreDevToolsBuilder<TState, NonNullable<unknown>, NonNullable<unknown>, NonNullable<unknown>> {
    return new ServerStoreDevToolsBuilder<TState>(this.config);
  }

  /**
   * 스토어를 생성합니다.
   * 서버 환경에서는 미들웨어를 적용하지 않습니다.
   *
   * @returns 생성된 스토어 인스턴스
   */
  build(): StoreInternal<TState> {
    return this.buildStore();
  }
}

/**
 * 서버 환경용 DevTools 빌더 클래스
 * 서버에서는 DevTools를 연결하지 않고 빌더 패턴만 유지합니다.
 *
 * @template TState 스토어 상태 타입
 */
class ServerStoreDevToolsBuilder<TState extends Record<string, NonNullable<unknown>>>
  extends BaseServerStoreBuilder<TState>
  implements IStoreDevToolsBuilder<TState, NonNullable<unknown>, NonNullable<unknown>, NonNullable<unknown>>
{
  /**
   * 스토어를 생성합니다.
   * 서버 환경에서는 DevTools를 연결하지 않습니다.
   *
   * @returns 생성된 스토어 인스턴스
   */
  build(): Store<TState> {
    return this.buildStore();
  }
}

/**
 * 서버 환경용 스토어 설정 빌더 클래스
 * 서버에서는 최소한의 기능만 제공하고 빌더 패턴만 유지합니다.
 *
 * @template TState 스토어 상태 타입
 */
export class ServerStoreConfigBuilder<TState extends Record<string, NonNullable<unknown>>>
  implements IStoreConfigBuilder<TState, NonNullable<unknown>, NonNullable<unknown>, NonNullable<unknown>>
{
  protected config: StoreConfig<TState, NonNullable<unknown>, NonNullable<unknown>, NonNullable<unknown>>;

  constructor(config: Partial<StoreConfig<TState, NonNullable<unknown>, NonNullable<unknown>>>) {
    if (!config.initialState) {
      throw new Error('초기 상태는 필수입니다');
    }

    this.config = {
      initialState: config.initialState,
      computed: {},
      actions: {},
      asyncActions: {},
    };
  }

  /**
   * 계산된 속성을 설정합니다.
   * 서버 환경에서는 실제로 계산된 속성을 설정하지 않습니다.
   *
   * @param _computedDefs 사용되지 않는 계산된 속성 정의
   * @returns 업데이트된 스토어 설정 빌더
   */
  computed<NewComputed extends ComputedDef<TState>>(
    // eslint-disable-next-line unused-imports/no-unused-vars,@typescript-eslint/no-unused-vars
    _computedDefs: NewComputed,
  ): IStoreConfigBuilder<TState, NewComputed, NonNullable<unknown>, NonNullable<unknown>> {
    return this as unknown as IStoreConfigBuilder<
      TState,
      NewComputed,
      NonNullable<unknown>,
      NonNullable<unknown>
    >;
  }

  /**
   * 액션을 설정합니다.
   * 서버 환경에서는 실제로 액션을 설정하지 않습니다.
   *
   * @param _actionDefs 사용되지 않는 액션 정의
   * @returns 업데이트된 스토어 설정 빌더
   */
  actions<NewActions extends ActionsDef<TState>>(
    // eslint-disable-next-line unused-imports/no-unused-vars,@typescript-eslint/no-unused-vars
    _actionDefs: NewActions,
  ): IStoreConfigBuilder<TState, NonNullable<unknown>, NewActions, NonNullable<unknown>> {
    return this as unknown as IStoreConfigBuilder<
      TState,
      NonNullable<unknown>,
      NewActions,
      NonNullable<unknown>
    >;
  }

  /**
   * 비동기 액션을 설정합니다.
   * 서버 환경에서는 실제로 비동기 액션을 설정하지 않습니다.
   *
   * @param _asyncActionDefs 사용되지 않는 비동기 액션 정의
   * @returns 업데이트된 스토어 설정 빌더
   */
  asyncActions<NewAsyncActions extends AsyncActionsDef<TState>>(
    // eslint-disable-next-line unused-imports/no-unused-vars,@typescript-eslint/no-unused-vars
    _asyncActionDefs: NewAsyncActions,
  ): IStoreConfigBuilder<TState, NonNullable<unknown>, NonNullable<unknown>, NewAsyncActions> {
    return this as unknown as IStoreConfigBuilder<
      TState,
      NonNullable<unknown>,
      NonNullable<unknown>,
      NewAsyncActions
    >;
  }

  /**
   * 미들웨어를 설정합니다.
   * 서버 환경에서는 실제로 미들웨어를 적용하지 않습니다.
   *
   * @param _middlewares 사용되지 않는 미들웨어 배열
   * @returns 스토어 미들웨어 빌더
   */
  middleware(
    // eslint-disable-next-line unused-imports/no-unused-vars,@typescript-eslint/no-unused-vars
    _middlewares: Middleware<TState>[],
  ): IStoreMiddlewareBuilder<TState, NonNullable<unknown>, NonNullable<unknown>, NonNullable<unknown>> {
    return new ServerStoreMiddlewareBuilder<TState>(this.config);
  }

  /**
   * DevTools 설정을 추가합니다.
   * 서버 환경에서는 실제로 DevTools를 연결하지 않습니다.
   *
   * @param _name 사용되지 않는 DevTools 이름
   * @returns 스토어 DevTools 빌더
   */
  devTool(
    // eslint-disable-next-line unused-imports/no-unused-vars,@typescript-eslint/no-unused-vars
    _name: string,
  ): IStoreDevToolsBuilder<TState, NonNullable<unknown>, NonNullable<unknown>, NonNullable<unknown>> {
    return new ServerStoreDevToolsBuilder<TState>(this.config);
  }

  /**
   * 스토어를 생성합니다.
   * 서버 환경에서는 최소한의 기능만 제공합니다.
   *
   * @returns 생성된 스토어 인스턴스
   */
  build(): StoreInternal<TState> {
    return createStoreInternal<TState>(this.config);
  }
}
