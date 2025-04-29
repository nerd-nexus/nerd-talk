import { ComputedDef } from '../../types/public-types';

export interface UpdateOptions {
  priority?: 'high' | 'normal' | 'low';
  updateId?: string;
  silent?: boolean;
  statePath?: string;
}

// 상태 컨테이너 인터페이스
export interface IStateContainer<TState extends Record<string, any>> {
  getState(): Readonly<TState>;
  updateState(newState: Partial<TState>, options?: UpdateOptions): void;
}

// 구독자 인터페이스
export interface ISubscriptionManager {
  subscribe(
    listener: () => void,
    options?: {
      priority?: number;
      throttle?: number;
      errorHandler?: (error: Error) => void;
      paths?: string[];
    },
  ): () => void;

  subscribeState<TState extends Record<string, any>, T>(
    selector: (state: Readonly<TState>) => T,
    listener: (value: T, oldValue?: T) => void,
    options?: {
      priority?: number;
      throttle?: number;
      memoize?: boolean;
      cacheSize?: number;
      ttl?: number;
      errorHandler?: (error: Error) => void;
      getState?: () => Readonly<TState>;
      trackDependencies?: (selector: (state: Readonly<TState>) => T) => string[];
      getMemoizedSelector?: (
        selector: (state: Readonly<TState>) => T,
        options?: any,
      ) => (state: Readonly<TState>) => T;
    },
  ): () => void;

  subscribeStates<TState extends Record<string, any>, S extends unknown[]>(
    selectors: { [K in keyof S]: (state: Readonly<TState>) => S[K] },
    listener: (values: S, oldValues?: S) => void,
    getState?: () => Readonly<TState>,
    trackDependencies?: (selector: (state: Readonly<TState>) => unknown) => string[],
  ): () => void;

  notifySubscribers(changedPaths: string[]): void;
}

// 계산된 값 관리자 인터페이스
export interface IComputedManager<TState extends Record<string, any>, TComputed extends ComputedDef<TState>> {
  getComputedValue(key: keyof TComputed): any;
  updateComputedValues(changedStateKeys: Set<string>, currentState: TState): void;
  buildDependencyGraph(): void;
}

// 의존성 추적 인터페이스
export interface IDependencyTracker<TState extends Record<string, any>> {
  createTrackingProxy(target: any, dependencies?: Set<string>, path?: string, depth?: number): any;
  trackDependencies<T>(selector: (state: Readonly<TState>) => T): string[];
}
