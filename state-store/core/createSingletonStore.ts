import { ClientStoreConfigBuilder, StoreBuilder } from './internal/StoreBuilder';
import { ActionsDef, AsyncActionsDef, ComputedDef } from './types/public-types';
import {
  IStoreDevToolsBuilder,
  IStoreMiddlewareBuilder,
  Middleware,
  StoreInternal,
} from './types/internal/store';

// 클라이언트에서만 사용될 싱글톤 저장소
const SINGLETON_STORES = typeof window !== 'undefined' ? new Map<string, any>() : null;

// 스토어 타입별 카운터 (고유 ID 생성용)
let storeTypeCounter = 0;

/**
 * 싱글톤 스토어 생성 함수
 * - 서버: 매번 새 인스턴스 생성
 * - 클라이언트: 싱글톤 패턴 적용
 */
export function createSingletonStore<TState extends Record<string, any>>() {
  // 각 스토어 타입마다 고유한 문자열 ID 생성
  const STORE_TYPE_ID = `SingletonStore_${storeTypeCounter++}`;

  // 기본 StoreBuilder 인스턴스 생성
  const storeBuilder = new StoreBuilder<TState>();

  // SingletonClientStoreConfigBuilder 클래스 정의
  class SingletonClientStoreConfigBuilder<
    TState extends Record<string, NonNullable<unknown>>,
    TComputed extends ComputedDef<TState>,
    TActions extends ActionsDef<TState>,
    TAsyncActions extends AsyncActionsDef<TState>,
  > extends ClientStoreConfigBuilder<TState, TComputed, TActions, TAsyncActions> {
    override middleware(
      middlewares: Middleware<TState>[],
    ): IStoreMiddlewareBuilder<TState, TComputed, TActions, TAsyncActions> {
      // 기존 middleware 메서드 호출
      const middlewareBuilder = super.middleware(middlewares);

      // build 메서드 오버라이드
      const originalBuild = middlewareBuilder.build;
      middlewareBuilder.build = function () {
        // 서버 환경인 경우 (SINGLETON_STORES가 null인 경우)
        if (!SINGLETON_STORES) {
          return originalBuild.apply(this); // 매번 새 인스턴스 생성
        }

        // 클라이언트 환경에서 싱글톤 패턴 적용
        if (!SINGLETON_STORES.has(STORE_TYPE_ID)) {
          const store = originalBuild.apply(this);
          SINGLETON_STORES.set(STORE_TYPE_ID, store);
        }

        // 타입 안전성을 위한 단언 추가
        return SINGLETON_STORES.get(STORE_TYPE_ID) as StoreInternal<
          TState,
          TComputed,
          TActions,
          TAsyncActions
        >;
      };

      return middlewareBuilder;
    }

    override devTool(name: string): IStoreDevToolsBuilder<TState, TComputed, TActions, TAsyncActions> {
      // 기존 devTool 메서드 호출
      const devToolsBuilder = super.devTool(name);

      // build 메서드 오버라이드
      const originalBuild = devToolsBuilder.build;
      devToolsBuilder.build = function () {
        // 서버 환경인 경우 (SINGLETON_STORES가 null인 경우)
        if (!SINGLETON_STORES) {
          return originalBuild.apply(this); // 매번 새 인스턴스 생성
        }

        // 클라이언트 환경에서 싱글톤 패턴 적용
        if (!SINGLETON_STORES.has(STORE_TYPE_ID)) {
          const store = originalBuild.apply(this);
          SINGLETON_STORES.set(STORE_TYPE_ID, store);
        }

        // 타입 안전성을 위한 단언 추가
        return SINGLETON_STORES.get(STORE_TYPE_ID) as StoreInternal<
          TState,
          TComputed,
          TActions,
          TAsyncActions
        >;
      };

      return devToolsBuilder;
    }

    override build(): StoreInternal<TState, TComputed, TActions, TAsyncActions> {
      // 서버 환경인 경우 (SINGLETON_STORES가 null인 경우)
      if (!SINGLETON_STORES) {
        return super.build(); // 매번 새 인스턴스 생성
      }

      // 클라이언트 환경에서 싱글톤 패턴 적용
      if (!SINGLETON_STORES.has(STORE_TYPE_ID)) {
        const store = super.build();
        SINGLETON_STORES.set(STORE_TYPE_ID, store);

        // 스토어에 고유 ID 부여 (디버깅 및 메모리 관리 용이성)
        (store as any).__singletonId = STORE_TYPE_ID;
      }

      // 타입 안전성을 위한 단언 추가
      return SINGLETON_STORES.get(STORE_TYPE_ID) as StoreInternal<TState, TComputed, TActions, TAsyncActions>;
    }
  }

  // initialState 메서드 오버라이드
  const originalInitialState = storeBuilder.initialState;
  storeBuilder.initialState = function (this: StoreBuilder<TState>, initialState: TState) {
    const isServer = typeof window === 'undefined';

    // 서버 환경이면 기존 동작 유지
    if (isServer) {
      return originalInitialState.call(this, initialState);
    }

    // 클라이언트 환경에서는 싱글톤 빌더 반환
    const config = { initialState, computed: {}, actions: {}, asyncActions: {} };
    return new SingletonClientStoreConfigBuilder(config);
  } as typeof storeBuilder.initialState;

  // 싱글톤 스토어 삭제 기능 추가 (builder에 정적 메서드로 추가)
  Object.defineProperty(storeBuilder, 'cleanup', {
    value: function () {
      if (SINGLETON_STORES && STORE_TYPE_ID) {
        SINGLETON_STORES.delete(STORE_TYPE_ID);
      }
    },
    writable: false,
    configurable: false,
  });

  // Singleton 빌더에 ID를 추가하여 나중에 참조 가능하게 함
  Object.defineProperty(storeBuilder, '__singletonId', {
    value: STORE_TYPE_ID,
    writable: false,
    configurable: false,
  });

  return storeBuilder;
}

// 전역 함수 추가 - 모든 싱글톤 스토어 삭제 (메모리 leak 방지)
export function cleanupAllSingletonStores(): void {
  if (SINGLETON_STORES) {
    SINGLETON_STORES.clear();
  }
}
