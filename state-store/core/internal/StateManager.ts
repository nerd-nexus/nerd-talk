import { createBatchedUpdates } from '../../utils/createBatchedUpdateds';
import { ComputedDef } from '../types/public-types.ts';
import { deepEqual, detectStructuralChanges } from '../../utils/compare';
import { createSelector, memoize } from '../../utils/selectorMemoization';
import { SubscriptionTree } from '../../utils/subscriptionTree';
import { globalErrorBoundary, safeAction } from '../../utils/errorBoundary';
import { LRUCache } from '../../utils/lruCache';
import {
  createNormalizedPath,
  getObjectType,
  isDepthLimitExceeded,
  safeGetPropertyDescriptor,
} from '../../utils/objectTraversal';

/**
 * 상태 관리자 - 상태 변경 및 계산된 값 캐싱 로직을 처리합니다.
 *
 * @template TState 스토어 상태 타입
 * @template TComputed 계산된 속성 정의 타입
 */
export class StateManager<TState extends Record<string, any>, TComputed extends ComputedDef<TState>> {
  private state: TState;
  private computedCache: Map<keyof TComputed, any> = new Map();

  // 구독자 관리 - SubscriptionTree만 사용
  private subscriptionTree: SubscriptionTree = new SubscriptionTree();

  // 의존성 추적
  private selectorDependencies: WeakMap<(state: Readonly<TState>) => unknown, Set<string>> = new WeakMap();
  private computedDependencies: Map<keyof TComputed, Set<string>> = new Map();

  // 타입 단언을 사용하여 타입 오류 해결
  private batchedUpdates = createBatchedUpdates() as {
    scheduleUpdate(
      update: () => void,
      options?: {
        priority?: 'high' | 'normal' | 'low';
        id?: string;
        replace?: boolean;
      },
    ): void;
    hasScheduledUpdate(id: string): boolean;
    cancelUpdate(id: string): boolean;
    flushUpdatesImmediately(): void;
  };
  private readonly computed?: TComputed;

  // 메모이제이션 및 캐싱
  private memoizedComputedFns = new Map<keyof TComputed, any>();
  private memoizedSelectors = new WeakMap<
    (state: Readonly<TState>) => unknown,
    (state: Readonly<TState>) => unknown
  >();

  // 구독자 라이프사이클 지표
  private nextSubscriberId = 1;
  private subscriberMetadata: Map<
    string,
    {
      createdAt: number;
      updateCount: number;
      lastUpdateAt: number;
      activePathCount: number;
    }
  > = new Map();

  constructor(initialState: TState, computed?: TComputed) {
    this.state = { ...initialState };
    this.computed = computed;
    this.initializeComputedValues();
  }

  /**
   * 현재 상태의 읽기 전용 사본을 반환합니다.
   */
  getState(): Readonly<TState> {
    return Object.freeze({ ...this.state });
  }

  /**
   * 상태 변경 구독을 추가합니다.
   * SubscriptionTree를 직접 사용하여 중복 코드를 제거했습니다.
   *
   * @param listener 상태 변경 시 호출될 리스너 함수
   * @param options 구독 옵션 (우선순위, 스로틀링, 등)
   * @returns 구독 해제 함수
   */
  subscribe(
    listener: () => void,
    options: {
      priority?: number;
      throttle?: number;
      errorHandler?: (error: Error) => void;
      paths?: string[]; // 관심 있는 특정 상태 경로
    } = {},
  ): () => void {
    const {
      priority = 0,
      throttle,
      paths = ['*'], // 기본적으로 모든 변경 구독
      errorHandler,
    } = options;

    // 고유 구독자 ID 생성
    const subscriberId = `global-${this.nextSubscriberId++}`;

    // 에러에 강한 콜백 래퍼 생성
    const safeListener = () => {
      try {
        listener();
      } catch (error) {
        console.error('[StateManager] Error in subscriber:', error);

        // 사용자 정의 에러 핸들러 호출
        if (errorHandler) {
          try {
            errorHandler(error as Error);
          } catch (handlerError) {
            console.error('[StateManager] Error in subscriber error handler:', handlerError);
          }
        }
      }
    };

    // 구독 메타데이터 기록
    this.subscriberMetadata.set(subscriberId, {
      createdAt: Date.now(),
      updateCount: 0,
      lastUpdateAt: 0,
      activePathCount: paths.length,
    });

    // 구독 트리에 직접 등록 - safeAction 래퍼 제거
    const unsubscribe = this.subscriptionTree.subscribe(subscriberId, safeListener, paths, {
      priority,
      throttle,
    });

    // 구독 해제 함수 반환 - 중첩된 콜백 제거
    return () => {
      unsubscribe();
      this.subscriberMetadata.delete(subscriberId);
    };
  }

  /**
   * 단일 셀렉터를 메모이제이션하여 반환합니다.
   * @private
   * @param selector 셀렉터 함수
   * @param options 메모이제이션 옵션
   */
  private getMemoizedSelector<T>(
    selector: (state: Readonly<TState>) => T,
    options: {
      memoize?: boolean;
      cacheSize?: number;
      ttl?: number;
    } = {},
  ): (state: Readonly<TState>) => T {
    const { memoize = true, cacheSize = 100, ttl } = options;

    // 메모이제이션 옵션이 비활성화된 경우, 원본 셀렉터 반환
    if (!memoize) {
      return selector;
    }

    // 이미 메모이제이션된 셀렉터가 있는지 확인
    if (this.memoizedSelectors.has(selector)) {
      return this.memoizedSelectors.get(selector) as (state: Readonly<TState>) => T;
    }

    // 새로운 메모이제이션된 셀렉터 생성
    const memoizedSelector = createSelector(selector, {
      cacheSize,
      ttl,
      trackDependencies: true,
    });

    // 메모이제이션된 셀렉터 저장
    this.memoizedSelectors.set(selector, memoizedSelector);
    return memoizedSelector;
  }

  /**
   * 셀렉터의 의존성을 추적합니다.
   * @private
   * @param selector 셀렉터 함수
   * @returns 정규화된 의존성 경로 배열
   */
  private trackSelectorDependencies<T>(selector: (state: Readonly<TState>) => T): string[] {
    const dependencies = new Set<string>();

    // 의존성 저장 (기존 호환성 유지)
    this.selectorDependencies.set(selector, dependencies);

    // 이미 createTrackingProxy에서 정규화된 경로를 사용하므로 별도 변환 불필요
    const normalizedDependencies = Array.from(dependencies);

    // 의존성이 없는 경우 전체 구독으로 설정
    if (normalizedDependencies.length === 0) {
      normalizedDependencies.push('*');
    }

    return normalizedDependencies;
  }

  /**
   * 구독자 메타데이터를 초기화하고 설정합니다.
   * @private
   * @param subscriberId 구독자 ID
   * @param paths 의존성 경로
   */
  private setupSubscriberMetadata(subscriberId: string, paths: string[]): void {
    this.subscriberMetadata.set(subscriberId, {
      createdAt: Date.now(),
      updateCount: 0,
      lastUpdateAt: 0,
      activePathCount: paths.length,
    });
  }

  /**
   * 구독자 메타데이터를 업데이트합니다.
   * @private
   * @param subscriberId 구독자 ID
   */
  private updateSubscriberMetadata(subscriberId: string): void {
    const metadata = this.subscriberMetadata.get(subscriberId);
    if (metadata) {
      metadata.updateCount++;
      metadata.lastUpdateAt = Date.now();
    }
  }

  /**
   * 특정 상태 변경을 구독합니다.
   * SubscriptionTree와의 중복 코드를 제거하고 단순화했습니다.
   *
   * @param selector 상태에서 관심 있는 부분을 선택하는 함수
   * @param listener 선택된 상태가 변경될 때 호출될 리스너 함수
   * @param options 구독 옵션 (우선순위, 스로틀링, 메모이제이션 설정)
   * @returns 구독 해제 함수
   */
  subscribeState<T>(
    selector: (state: Readonly<TState>) => T,
    listener: (value: T, oldValue?: T) => void,
    options: {
      priority?: number;
      throttle?: number;
      memoize?: boolean;
      cacheSize?: number;
      ttl?: number;
      errorHandler?: (error: Error) => void;
    } = {},
  ): () => void {
    const { priority = 0, throttle, errorHandler } = options;

    // 고유 구독자 ID 생성
    const subscriberId = `selector-${this.nextSubscriberId++}`;

    // 셀렉터 메모이제이션 처리
    const memoizedSelector = this.getMemoizedSelector(selector, options);

    // 초기값 계산
    let currentValue: T;
    try {
      currentValue = memoizedSelector(this.getState());
    } catch (error) {
      console.error('[StateManager] Error calculating initial selector value:', error);
      // 초기값 계산 실패 시 undefined로 시작
      currentValue = undefined as unknown as T;
    }

    // 의존성 추적
    const normalizedDependencies = this.trackSelectorDependencies(memoizedSelector);

    // 상태 변경 리스너 생성
    const stateListener = () => {
      try {
        // 메모이제이션된 셀렉터로 새 값 계산
        const newValue = memoizedSelector(this.getState());

        // 참조 동일성 먼저 확인 (빠른 경로)
        if (currentValue !== newValue) {
          // 깊은 비교로 실제 변경 여부 확인
          const isEqual = deepEqual(currentValue, newValue);

          if (!isEqual) {
            const oldValue = currentValue;
            currentValue = newValue;

            try {
              // 리스너에게 알림
              listener(newValue, oldValue);
            } catch (error) {
              console.error('[StateManager] Error in state change listener:', error);

              // 사용자 정의 에러 핸들러 호출
              if (errorHandler) {
                try {
                  errorHandler(error as Error);
                } catch (handlerError) {
                  console.error('[StateManager] Error in error handler:', handlerError);
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('[StateManager] Error calculating selector value:', error);

        if (errorHandler) {
          try {
            errorHandler(error as Error);
          } catch (handlerError) {
            console.error('[StateManager] Error in error handler:', handlerError);
          }
        }
      }

      // 구독자 메타데이터 업데이트
      this.updateSubscriberMetadata(subscriberId);
    };

    // 구독 메타데이터 기록
    this.setupSubscriberMetadata(subscriberId, normalizedDependencies);

    // 구독 트리에 직접 등록
    const unsubscribe = this.subscriptionTree.subscribe(subscriberId, stateListener, normalizedDependencies, {
      priority,
      throttle,
    });

    // 구독 해제 함수 반환 - 단순화
    return () => {
      unsubscribe();
      this.selectorDependencies.delete(selector);
      this.subscriberMetadata.delete(subscriberId);
    };
  }

  /**
   * 여러 상태 항목의 변경을 구독합니다.
   * @template S 셀렉터 함수들의 반환 타입 튜플
   * @param selectors 상태에서 관심 있는 여러 부분을 선택하는 함수 배열
   * @param listener 선택된 상태 중 하나라도 변경될 때 호출될 리스너 함수
   * @returns 구독 해제 함수
   */
  /**
   * 여러 상태 항목의 변경을 구독합니다.
   * 중복 코드를 제거하고 SubscriptionTree를 직접 활용합니다.
   *
   * @template S 셀렉터 함수들의 반환 타입 튜플
   * @param selectors 상태에서 관심 있는 여러 부분을 선택하는 함수 배열
   * @param listener 선택된 상태 중 하나라도 변경될 때 호출될 리스너 함수
   * @returns 구독 해제 함수
   */
  subscribeStates<S extends unknown[]>(
    selectors: { [K in keyof S]: (state: Readonly<TState>) => S[K] },
    listener: (values: S, oldValues?: S) => void,
  ): () => void {
    const selectorsArray = selectors as Array<(state: Readonly<TState>) => unknown>;
    const subscriberId = `multi-selector-${this.nextSubscriberId++}`;

    let currentValues = selectorsArray.map((selector) => selector(this.getState())) as S;

    // 모든 선택자의 의존성 수집
    const allDependencies = new Set<string>();

    selectorsArray.forEach((selector) => {
      // 각 선택자의 의존성 추적
      const dependencies = this.trackSelectorDependencies(selector);
      // 모든 의존성 수집
      dependencies.forEach((dep) => allDependencies.add(dep));
    });

    // 정규화된 의존성 배열
    const normalizedDependencies = Array.from(allDependencies);

    // 상태 변경 리스너 생성
    const stateListener = () => {
      const newValues = selectorsArray.map((selector) => selector(this.getState())) as S;

      const changedIndexes = [];
      for (let i = 0; i < newValues.length; i++) {
        if (currentValues[i] !== newValues[i]) {
          changedIndexes.push(i);
        }
      }

      let hasChanged = false;
      for (const index of changedIndexes) {
        if (!deepEqual(currentValues[index], newValues[index])) {
          hasChanged = true;
          break;
        }
      }

      if (hasChanged) {
        const oldValues = currentValues;
        currentValues = newValues;

        try {
          listener(newValues, oldValues);
        } catch (error) {
          console.error('[StateManager] Error in subscribeStates listener:', error);
        }
      }

      // 구독자 메타데이터 업데이트
      this.updateSubscriberMetadata(subscriberId);
    };

    // 구독 메타데이터 기록
    this.setupSubscriberMetadata(subscriberId, normalizedDependencies);

    // 구독 트리에 직접 등록
    const unsubscribe = this.subscriptionTree.subscribe(subscriberId, stateListener, normalizedDependencies);

    // 구독 해제 함수 반환 - 단순화
    return () => {
      unsubscribe();
      this.subscriberMetadata.delete(subscriberId);
      selectorsArray.forEach((selector) => {
        this.selectorDependencies.delete(selector);
      });
    };
  }

  /**
   * 상태를 업데이트합니다.
   * @param newState 새 상태 객체 (부분 상태 또는 전체 상태)
   * @param options 업데이트 옵션 (우선순위, 업데이트 ID 등)
   */
  _setState(
    newState: Partial<TState>,
    options: {
      priority?: 'high' | 'normal' | 'low';
      updateId?: string;
      silent?: boolean; // 알림 없이 상태만 업데이트할지 여부
      statePath?: string; // 업데이트되는 상태 경로 (자동 계산되지만 명시적으로 제공 가능)
    } = {},
  ): void {
    // 안전한 액션으로 상태 업데이트 래핑
    return safeAction(
      'setState',
      () => {
        const {
          priority = 'normal',
          updateId = `state-update-${Date.now()}`,
          silent = false,
          statePath,
        } = options;

        const updatedKeys = Object.keys(newState);
        if (updatedKeys.length === 0) return;

        const changedKeys = new Set<string>();
        const changedPaths = new Set<string>();
        const nextState = { ...this.state };
        let hasChanges = false;
        let hasStructuralChange = false;

        // 1. 변경된 키 및 경로 감지
        for (const key of updatedKeys) {
          if (!(key in nextState)) continue;

          const currentValue = this.state[key];
          const newValue = newState[key as keyof Partial<TState>];

          // 참조 동일성 검사로 빠른 경로 제공
          if (currentValue === newValue) continue;

          // 객체의 경우 구조 변경 확인
          if (
            typeof currentValue === 'object' &&
            typeof newValue === 'object' &&
            currentValue !== null &&
            newValue !== null
          ) {
            // 객체 사이즈가 크게 다르면 구조적 변화로 간주
            const currentKeys = Object.keys(currentValue);
            const newKeys = Object.keys(newValue);

            // 구조적 변경 확인 (속성 추가/제거)
            const structuralChanged =
              detectStructuralChanges(currentValue as Record<string, any>, newValue as Record<string, any>) ||
              Math.abs(currentKeys.length - newKeys.length) > 3; // 키 개수가 크게 변경됨

            if (structuralChanged) {
              hasStructuralChange = true;
            }

            // 구조적 변경이 있거나 깊은 비교에서 차이가 있을 때만 변경으로 간주
            const valueChanged = structuralChanged || !deepEqual(currentValue, newValue);

            if (valueChanged) {
              (nextState as Record<string, any>)[key] = newValue;
              changedKeys.add(key);

              // 경로 추가
              changedPaths.add(key);

              // 객체의 경우 중첩 경로 추가
              if (typeof newValue === 'object') {
                this.addNestedPaths(key, newValue, changedPaths);

                // 이전 객체의 속성들도 변경 경로로 추가 (삭제된 속성도 추적하기 위함)
                if (structuralChanged && typeof currentValue === 'object') {
                  for (const oldKey of currentKeys) {
                    const oldPath = /^\d+$/.test(oldKey) ? `${key}[${oldKey}]` : `${key}.${oldKey}`;
                    changedPaths.add(oldPath);
                  }

                  // 특별 처리 없이 기본 로직으로만 처리
                }
              }

              hasChanges = true;
            }
          } else {
            // 원시 타입 비교 - 이미 참조 비교에서 다름이 확인됨
            (nextState as Record<string, any>)[key] = newValue;
            changedKeys.add(key);
            changedPaths.add(key);
            hasChanges = true;
          }
        }

        // 실제 변경된 것이 없으면 작업 중단
        if (!hasChanges) return;

        // 2. 상태 업데이트
        this.state = nextState;

        // 3. 영향 받는 계산된 값 업데이트
        // 구조적 변경이 있는 경우에는 특별 처리
        if (hasStructuralChange && this.computed) {
          // 구조적 변경이 있으면 모든 계산된 값의 의존성도 추가
          for (const [, dependencies] of this.computedDependencies) {
            for (const dep of dependencies) {
              changedKeys.add(dep);
            }
          }

          // 항상 모든 계산된 값 재평가가 필요함을 표시
          changedPaths.add('*');
        }

        this.updateComputedValues(changedKeys);

        // 4. 알림 처리 (silent 모드가 아닌 경우)
        if (!silent) {
          // 명시적 경로 제공된 경우 추가
          if (statePath) {
            changedPaths.add(statePath);
          }

          // 구조적 변경이 있는 경우 각 계산된 값에 대한 의존성도 변경 경로에 추가
          if (hasStructuralChange) {
            // 모든 계산된 값의 이름도 변경 경로에 추가
            for (const computedKey in this.computed) {
              if (Object.prototype.hasOwnProperty.call(this.computed, computedKey)) {
                changedPaths.add(`computed.${computedKey}`);
              }
            }
          }

          this.batchedUpdates.scheduleUpdate(
            () => {
              // 구독 트리를 통한 효율적인 알림만 사용
              this.subscriptionTree.notifySubscribers(Array.from(changedPaths));
            },
            {
              priority: hasStructuralChange ? 'high' : priority, // 구조적 변경이면 우선순위 높임
              id: updateId,
              replace: true, // 동일 ID의 이전 업데이트 대체
            },
          );
        }

        // 성능 지표 수집 (개발 모드)
        if (process.env.NODE_ENV !== 'production') {
          globalErrorBoundary.getMetrics().totalUpdates++;
        }
      },
      options.statePath || 'global',
    );
  }

  /**
   * 중첩 객체의 경로를 추가합니다.
   * 예: user.profile.name, items[0].price 등
   */
  private addNestedPaths(rootPath: string, obj: any, paths: Set<string>): void {
    if (!obj || typeof obj !== 'object') return;

    // 배열 처리
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        // 일관된 배열 인덱스 표기법 사용
        const itemPath = `${rootPath}[${i}]`;
        paths.add(itemPath);

        // 배열 아이템이 객체인 경우 재귀적으로 처리
        if (obj[i] && typeof obj[i] === 'object') {
          this.addNestedPaths(itemPath, obj[i], paths);
        }
      }
      return;
    }

    // 객체 처리
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        // 숫자 키인 경우 배열 표기법 사용, 그 외에는 점 표기법 사용
        const propPath = /^\d+$/.test(key) ? `${rootPath}[${key}]` : `${rootPath}.${key}`;
        paths.add(propPath);

        // 속성이 객체인 경우 재귀적으로 처리
        if (obj[key] && typeof obj[key] === 'object') {
          this.addNestedPaths(propPath, obj[key], paths);
        }
      }
    }
  }

  /**
   * 계산된 값에 접근합니다.
   * @param key 계산된 값의 키
   * @returns 계산된 값
   */
  getComputedValue(key: keyof TComputed) {
    return this.computedCache.get(key);
  }

  /**
   * 성능 통계 및 디버깅 정보를 반환합니다.
   * 개발 및 문제 해결에 도움이 됩니다.
   */
  getDebugInfo() {
    return {
      // 구독 관련 정보
      subscribers: {
        total: this.subscriptionTree.getStats().totalSubscribers,
        byPath: this.subscriptionTree.getPathSubscriberMap(),
        metadata: Object.fromEntries(this.subscriberMetadata.entries()),
      },

      // 상태 관련 정보
      state: {
        size: JSON.stringify(this.state).length,
        keys: Object.keys(this.state),
      },

      // 계산된 값 관련 정보
      computed: {
        count: this.computedCache.size,
        keys: Array.from(this.computedCache.keys()).map(String),
        dependencyGraph: Object.fromEntries(
          Array.from(this.computedDependencies.entries()).map(([key, deps]) => [
            String(key),
            Array.from(deps),
          ]),
        ),
      },

      // 성능 통계
      performance: {
        ...this.performanceStats,
        subscriptionTree: this.subscriptionTree.getStats(),
        errorBoundary: globalErrorBoundary.getMetrics(),
      },
    };
  }

  /**
   * 특정 상태 경로에 구독 중인 구독자 ID 목록을 반환합니다.
   * @param path 상태 경로
   */
  getSubscribersForPath(path: string): string[] {
    return this.subscriptionTree.getSubscribersForPath(path);
  }

  /**
   * 구독자를 일시적으로 비활성화합니다.
   * 알림 처리 최적화 및 디버깅에 유용합니다.
   * @param subscriberId 구독자 ID
   * @param active 활성화 여부
   */
  setSubscriberActive(subscriberId: string, active: boolean): boolean {
    return this.subscriptionTree.setSubscriberActive(subscriberId, active);
  }

  /**
   * 상태 스냅샷을 생성하고 필요시 이전 상태로 복원합니다.
   * @returns 복원 함수
   */
  createSnapshot(): () => void {
    const snapshot = { ...this.state };

    return () => {
      // 이전 상태로 복원 (알림 없이)
      this._setState(snapshot as Partial<TState>, { silent: true });
      console.log('[StateManager] State restored from snapshot');
    };
  }

  /**
   * 성능 통계를 초기화합니다.
   */
  resetPerformanceStats(): void {
    this.performanceStats = {
      lastUpdateTime: 0,
      updateCount: 0,
      totalUpdateDuration: 0,
      maxUpdateDuration: 0,
      subscriberNotificationCount: 0,
      errorCount: 0,
    };

    this.subscriptionTree.resetStats();
    globalErrorBoundary.resetMetrics();
  }

  // 성능 통계
  private performanceStats = {
    lastUpdateTime: 0,
    updateCount: 0,
    totalUpdateDuration: 0,
    maxUpdateDuration: 0,
    subscriberNotificationCount: 0,
    errorCount: 0,
  };

  /**
   * 초기 계산된 값을 설정합니다.
   * 계산된 값 함수를 메모이제이션하여 성능을 최적화합니다.
   */
  private initializeComputedValues(): void {
    if (!this.computed) {
      return;
    }

    const frozenState = Object.freeze({ ...this.state });

    for (const key in this.computed) {
      if (Object.prototype.hasOwnProperty.call(this.computed, key)) {
        const computedFn = this.computed[key];
        if (computedFn) {
          // 계산 함수 메모이제이션 (첫 실행 시에만)
          if (!this.memoizedComputedFns.has(key)) {
            const memoizedFn = memoize(computedFn, {
              cacheSize: 10, // 각 계산된 값은 최근 10개 상태에 대한 결과 캐싱
              ttl: 30000, // 30초 캐시 TTL
            });
            this.memoizedComputedFns.set(key, memoizedFn);
          }

          // 메모이제이션된 함수 사용하여 계산
          const memoizedFn = this.memoizedComputedFns.get(key);
          this.computedCache.set(key, memoizedFn(frozenState));
        }
      }
    }
  }

  // 프록시 캐시 최적화: LRU 캐시 사용
  private proxyCache = new WeakMap<object, LRUCache<string, any>>();
  private readonly PROXY_CACHE_SIZE = 10; // 객체당 최대 프록시 개수
  private readonly DEPENDENCY_CACHE_SIZE = 500; // 의존성 셋 캐시 최대 크기
  private readonly dependencySetStringCache = new LRUCache<Set<string>, string>(this.DEPENDENCY_CACHE_SIZE);

  /**
   * 의존성 셋을 문자열 키로 변환
   * @private
   * @param dependencies 의존성 집합
   * @returns 해당 의존성을 대표하는 문자열 키
   */
  private getDependencySetKey(dependencies: Set<string>): string {
    // 캐시된 키가 있으면 반환
    let depSetKey = this.dependencySetStringCache.get(dependencies);

    if (!depSetKey) {
      // 의존성을 정렬하여 일관된 문자열 생성
      depSetKey = Array.from(dependencies).sort().join('|');
      // 의존성 셋을 문자열로 변환한 결과 캐싱
      this.dependencySetStringCache.set(dependencies, depSetKey);
    }

    return depSetKey;
  }

  // 최대 프록시 재귀 깊이 - 스택 오버플로우 방지
  private readonly MAX_PROXY_DEPTH = 100;

  /**
   * 의존성 추적을 위한 프록시 생성
   * @param target 추적할 상태 객체
   * @param dependencies 의존성을 수집할 Set 객체 (선택 사항)
   * @param path 현재 객체 경로 (중첩 객체 처리용)
   * @param depth 현재 재귀 깊이 (스택 오버플로우 방지)
   * @returns 프록시 객체
   */
  // 객체 순환 참조 감지를 위한 WeakMap
  private proxyTargetMap = new WeakMap<object, Set<string>>();

  /**
   * 의존성 추적을 위한 프록시 생성
   * imported 유틸리티 함수들을 활용하여 중복 코드 제거
   *
   * @param target 추적할 상태 객체
   * @param dependencies 의존성을 수집할 Set 객체
   * @param path 현재 객체 경로
   * @param depth 현재 재귀 깊이
   * @returns 프록시 객체
   */
  private createTrackingProxy(target: any, dependencies: Set<string> = new Set(), path = '', depth = 0): any {
    // 1. null이나 원시 타입은 그대로 반환 (빠른 경로)
    if (target === null || typeof target !== 'object') {
      if (path) {
        // 원시 타입이더라도 경로가 있으면 의존성에 추가
        dependencies.add(path);
      }
      return target;
    }

    // 순환 참조 감지를 위한 프록시 맵 활용
    if (this.proxyTargetMap.has(target)) {
      const paths = this.proxyTargetMap.get(target);
      if (paths && paths.has(path)) {
        // 이미 같은 경로로 추적 중인 객체 - 순환 참조
        if (path) {
          dependencies.add(path);
        }
        return target; // 원본 객체 반환하여 무한 재귀 방지
      }
    }

    // 최대 재귀 깊이 확인 - 유틸리티 함수 사용
    if (isDepthLimitExceeded(depth, this.MAX_PROXY_DEPTH)) {
      if (path) {
        dependencies.add(path); // 현재 경로 의존성 추가

        // 객체인 경우 주요 속성들의 경로도 의존성으로 추가
        if (typeof target === 'object') {
          // 배열인 경우
          if (Array.isArray(target)) {
            // 배열 전체에 대한 의존성 추가
            dependencies.add(`${path}.length`);

            // 최대 10개 요소에 대한 경로만 의존성으로 추가 (전부 추가하면 너무 많아질 수 있음)
            const maxItems = Math.min(target.length, 10);
            for (let i = 0; i < maxItems; i++) {
              dependencies.add(`${path}[${i}]`);
            }
          }
          // 일반 객체인 경우
          else if (Object.prototype.toString.call(target) === '[object Object]') {
            // 최대 10개 속성에 대한 경로만 의존성으로 추가
            const keys = Object.keys(target);
            const maxKeys = Math.min(keys.length, 10);
            for (let i = 0; i < maxKeys; i++) {
              dependencies.add(`${path}.${keys[i]}`);
            }
          }
          // Map, Set 등 특수 객체 처리 추가
          else if (target instanceof Map || target instanceof Set) {
            dependencies.add(`${path}.size`);
          }
        }
      }

      console.warn(
        `[StateManager] Maximum proxy depth (${this.MAX_PROXY_DEPTH}) exceeded for path: ${path || 'root'}. Using raw value and adding key dependencies.`,
      );
      return target;
    }

    // 경로 추적 - 순환 참조 감지용
    // 사용 후 정리할 수 있도록 현재 대상-경로 매핑 저장
    const activePathTracking = () => {
      if (path) {
        if (!this.proxyTargetMap.has(target)) {
          this.proxyTargetMap.set(target, new Set<string>());
        }
        this.proxyTargetMap.get(target)?.add(path);
      }
    };
    activePathTracking();

    // 중첩 객체인 경우에만 현재 경로를 의존성으로 추가
    if (path) {
      dependencies.add(path);
    }

    // 2. 이미 프록시인 경우 재생성 방지
    if ((target as any).__isProxyTracker) {
      // 이미 같은 의존성 Set을 추적하는 프록시인지 확인
      if ((target as any).__dependenciesRef === dependencies) {
        return target;
      }
    }

    // 3. 기존 캐시된 프록시 확인
    if (this.proxyCache.has(target)) {
      const proxiesForTarget = this.proxyCache.get(target);
      if (proxiesForTarget) {
        // 의존성 셋을 문자열 키로 변환
        const depSetKey = this.getDependencySetKey(dependencies);

        // 캐시에서 프록시 조회
        if (proxiesForTarget.has(depSetKey)) {
          return proxiesForTarget.get(depSetKey);
        }
      }
    }

    // 4. 특수 객체는 프록시로 감싸지 않고 원본 반환 (의존성은 추가)
    // getObjectType 유틸리티 함수 활용
    const objTypeInfo = getObjectType(target);
    if (
      objTypeInfo.isSpecialObject ||
      (Array.isArray(target) && target.length > 1000) // 대용량 배열 휴리스틱
    ) {
      if (path) {
        dependencies.add(path);
      }
      return target;
    }

    // 5. 새 프록시 생성
    const proxy = new Proxy(target, {
      get: (obj, prop) => {
        // 프록시 자체 식별용 속성
        if (prop === '__isProxyTracker') {
          return true;
        }
        // 프록시가 추적하는 의존성 Set 참조용 속성
        if (prop === '__dependenciesRef') {
          return dependencies;
        }

        // console과 기본 프로토타입 속성에 대한 간소화된 처리
        if (obj === console || obj === global?.console || obj === window?.console) {
          return Reflect.get(obj, prop);
        }

        const key = String(prop); // key를 문자열로 변환

        // 심볼 속성이나 내부 시스템 속성은 추적하지 않음
        if (
          key === '__proto__' ||
          key === 'constructor' ||
          key === 'prototype' ||
          key.startsWith('__') ||
          key.startsWith('_ignoreConsole') ||
          typeof prop === ('symbol' as any)
        ) {
          return Reflect.get(obj, prop);
        }

        // 현재 접근 경로 생성 - createNormalizedPath 유틸리티 활용
        const currentPath = createNormalizedPath(path, key);

        // 항상 경로 의존성 추가 - 속성이 존재하지 않더라도 의존성으로 추적
        dependencies.add(currentPath);

        // 객체가 빈 경우 computed 함수 분석 기반 의존성 추가
        if (obj[key] && typeof obj[key] === 'object' && Object.keys(obj[key]).length === 0) {
          // 이 객체가 빈 객체라면 computed 함수들을 분석해서 어떤 속성에 접근하려고 하는지 파악
          if (this.computed) {
            // computed 함수 코드를 분석해서 currentPath와 관련된 접근 패턴 찾기
            const currentPathPattern = new RegExp(`${currentPath}\\.([\\w]+)`, 'g');
            const potentialPaths = new Set<string>();

            // 모든 computed 함수를 검사
            for (const computedKey in this.computed) {
              if (Object.prototype.hasOwnProperty.call(this.computed, computedKey)) {
                const fnStr = this.computed[computedKey as keyof TComputed]?.toString() || '';
                const matches = [...fnStr.matchAll(currentPathPattern)];

                for (const match of matches) {
                  if (match[1]) {
                    // 이 속성에 접근하려고 하면 의존성으로 등록
                    potentialPaths.add(`${currentPath}.${match[1]}`);
                  }
                }
              }
            }

            // 찾은 모든 잠재적 경로를 의존성으로 추가
            for (const potentialPath of potentialPaths) {
              dependencies.add(potentialPath);
            }
          }
        }

        // 속성 디스크립터 가져오기 - safeGetPropertyDescriptor 유틸리티 활용
        const descriptor = safeGetPropertyDescriptor(obj, key);
        const isReadOnly = descriptor && !descriptor.writable && !descriptor.get;

        // 읽기 전용 속성에 대한 처리 추가
        if (isReadOnly) {
          return Reflect.get(obj, prop);
        }

        const value = Reflect.get(obj, prop);

        // 객체가 null이거나 undefined여도 의존성 추적은 이미 이루어짐
        // 값이 객체이고 null이 아니면 재귀적으로 프록시 생성 (Lazy)
        if (typeof value === 'object' && value !== null) {
          // console 객체에 대한 특별 처리
          if (value === console || key === 'console') {
            return console;
          }

          // 중첩 객체/배열에 대한 프록시는 접근 시점에 생성하여 성능 최적화
          return this.createTrackingProxy(value, dependencies, currentPath, depth + 1);
        }

        // 객체 속성이 undefined인 경우에도 해당 경로의 의존성 추적
        if (value === undefined && obj && typeof obj === 'object') {
          // 존재하지 않는 속성에 접근하는 경우에도 의존성 등록
          dependencies.add(currentPath);
          // 추가로 부모 객체 경로에 대한 의존성도 등록
          if (path) {
            dependencies.add(path);
          }
        }

        // falsy 값이더라도 추가적인 복잡한 로직은 제거하고, 이미 위에서 currentPath에 의존성을 추가했으므로 충분함

        // 원시 값이거나 null이면 값 그대로 반환
        return value;
      },
      // 불변성 보장을 위한 메서드 트랩 추가 - 엄격 모드 호환성 개선
      set: (_target, _prop, _value) => {
        console.warn('[StateManager] Attempted to modify a proxy object during dependency tracking');
        return true; // 엄격 모드에서 TypeError 방지
      },
      deleteProperty: (_target, _prop) => {
        console.warn(
          '[StateManager] Attempted to delete property on a proxy object during dependency tracking',
        );
        return true; // 엄격 모드에서 TypeError 방지
      },
    });

    // 6. 생성된 프록시 캐싱 - LRU 캐시 활용
    if (!this.proxyCache.has(target)) {
      // 객체마다 LRU 캐시 생성 (최대 PROXY_CACHE_SIZE 개 항목 유지)
      this.proxyCache.set(target, new LRUCache<string, any>(this.PROXY_CACHE_SIZE));
    }

    const proxiesForTarget = this.proxyCache.get(target);
    if (proxiesForTarget) {
      // 의존성 셋을 문자열 키로 변환 (LRU 캐시 키로 사용)
      const depSetKey = this.getDependencySetKey(dependencies);

      // LRU 캐시에 프록시 저장 (가장 최근 사용 항목으로 설정됨)
      proxiesForTarget.set(depSetKey, proxy);
    }

    return proxy;
  }

  // 계산된 값 간의 의존성 그래프를 저장할 맵 추가
  private computedDependencyGraph: Map<keyof TComputed, Set<keyof TComputed>> = new Map();

  // 계산된 값 관련 상태
  private allComputedKeysInOrder: Array<keyof TComputed> | null = null;

  // 의존성 그래프가 변경되었는지 추적하는 플래그
  private isDependencyGraphDirty = true;

  // 역방향 의존성 맵: 상태 키 -> 해당 키에 의존하는 계산된 값 키 집합
  private _stateKeyToComputedMap: Map<string, Set<keyof TComputed>> | null = null;

  /**
   * 역방향 의존성 맵을 생성합니다: 상태 키 -> 해당 키에 의존하는 계산된 값들의 맵
   * 이를 통해 특정 상태 키가 변경되었을 때 영향받는 계산된 값들을 효율적으로 찾을 수 있습니다.
   * @private
   */
  private _buildStateKeyToComputedMap(): void {
    this._stateKeyToComputedMap = new Map<string, Set<keyof TComputed>>();

    // 모든 계산된 값의 의존성을 역방향으로 인덱싱
    for (const [computedKey, dependencies] of this.computedDependencies.entries()) {
      for (const stateKey of dependencies) {
        if (!this._stateKeyToComputedMap.has(stateKey)) {
          this._stateKeyToComputedMap.set(stateKey, new Set());
        }
        this._stateKeyToComputedMap.get(stateKey)?.add(computedKey);
      }
    }
  }

  /**
   * 계산된 값을 업데이트합니다.
   * @param changedStateKeys 변경된 상태 키 집합
   */
  private updateComputedValues(changedStateKeys: Set<string>): void {
    if (!this.computed) return;

    if (changedStateKeys.size === 0) return;

    const startTime = performance.now();

    // 의존성 그래프 구축 및 토폴로지 정렬 최소화
    if (this.isDependencyGraphDirty || this.computedDependencyGraph.size === 0) {
      this.buildComputedDependencyGraph();
      // 전체 계산된 값에 대해 토폴로지 정렬 미리 수행하여 캐시
      this.allComputedKeysInOrder = this.topologicalSort(
        Object.keys(this.computed) as Array<keyof TComputed>,
      );
      this.isDependencyGraphDirty = false;
    }

    const frozenState = Object.freeze({ ...this.state });
    const computedKeysToUpdate = new Set<keyof TComputed>();
    const processedKeys = new Set<keyof TComputed>();

    // 특별 케이스: 빈 객체 또는 undefined 처리
    // 상태가 완전히 재설정된 경우 (reset 액션 등) 모든 계산된 값을 업데이트
    let isStateReset = false;

    // 상태가 재설정되었는지 확인 - 일반적인 로직으로 체크
    if (this.state && typeof this.state === 'object') {
      // 전체 상태가 비어있는 경우나 매우 단순한 객체 구조인 경우를 재설정으로 간주
      const isEmptyOrSimpleState =
        Object.keys(this.state).length === 0 ||
        Object.keys(this.state).every((key) => {
          const value = (this.state as any)[key];
          return (
            value === undefined ||
            value === null ||
            (typeof value === 'object' && Object.keys(value).length === 0)
          );
        });

      if (isEmptyOrSimpleState) {
        isStateReset = true;
      }
    }

    // 상태가 재설정된 경우 모든 계산된 값을 업데이트
    if (isStateReset) {
      // 모든 computed 키를 업데이트 대상에 추가
      for (const key in this.computed) {
        if (Object.prototype.hasOwnProperty.call(this.computed, key)) {
          computedKeysToUpdate.add(key as keyof TComputed);
        }
      }
    } else {
      // 1단계: 역방향 인덱스 맵을 사용하여 변경된 키에 의존하는 computed 값들을 빠르게 찾음
      // stateKeyToComputedMap을 게으른 초기화로 생성
      if (!this._stateKeyToComputedMap) {
        this._buildStateKeyToComputedMap();
      }

      // 변경된 각 상태 키에 대해, 해당 키에 의존하는 계산된 값들을 모두 찾아 업데이트 대상에 추가
      for (const changedKey of changedStateKeys) {
        const affectedComputedKeys = this._stateKeyToComputedMap?.get(changedKey);
        if (affectedComputedKeys) {
          for (const computedKey of affectedComputedKeys) {
            computedKeysToUpdate.add(computedKey);
          }
        }
      }
    }

    // 2단계: 의존성 그래프를 통해 간접적으로 영향 받는 계산된 값 찾기
    const findDependents = (key: keyof TComputed) => {
      const dependents = this.computedDependencyGraph.get(key);
      if (!dependents) return;

      for (const dependent of dependents) {
        if (!computedKeysToUpdate.has(dependent)) {
          computedKeysToUpdate.add(dependent);
          findDependents(dependent);
        }
      }
    };

    if (computedKeysToUpdate.size === 0) return;

    // 직접 영향 받는 계산된 값들의 의존값들 추가
    for (const key of computedKeysToUpdate) {
      findDependents(key);
    }

    // 3단계: 캐시된 토폴로지 정렬 순서 사용
    let sortedComputedKeys: Array<keyof TComputed>;

    if (this.allComputedKeysInOrder) {
      if (computedKeysToUpdate.size === this.allComputedKeysInOrder.length) {
        // 모든 계산된 값을 업데이트하는 경우 전체 정렬 순서 재사용
        sortedComputedKeys = this.allComputedKeysInOrder;
      } else {
        // 일부만 업데이트하는 경우 필터링 (순서 유지)
        sortedComputedKeys = this.allComputedKeysInOrder.filter((key) => computedKeysToUpdate.has(key));
      }
    } else {
      // 캐시가 없는 경우 (비정상 상황) 지연 계산
      sortedComputedKeys = this.topologicalSort(Array.from(computedKeysToUpdate));
    }

    // 4단계: 정렬된 순서대로 계산된 값 업데이트
    for (const key of sortedComputedKeys) {
      if (processedKeys.has(key)) continue;

      const computedFn = this.computed[key];
      if (!computedFn) continue;

      // 메모이제이션된 계산 함수 사용
      const memoOptions = { cacheSize: 10, ttl: 30000 };
      const memoizedFn = this.memoizedComputedFns.get(key) || memoize(computedFn, memoOptions);

      // 아직 저장되지 않은 경우 저장
      if (!this.memoizedComputedFns.has(key)) {
        this.memoizedComputedFns.set(key, memoizedFn);
      }

      const dependencies = new Set<string>();
      const trackingProxy = this.createTrackingProxy(frozenState, dependencies);
      const newValue = memoizedFn(trackingProxy);

      // 의존성 업데이트 - 변경 시 그래프를 다시 빌드해야 함
      const oldDeps = this.computedDependencies.get(key);

      // 의존성이 비어있는 경우 기본적으로 전체 상태에 대한 의존성 추가
      if (dependencies.size === 0) {
        dependencies.add('*');
      }

      const depsChanged =
        !oldDeps ||
        oldDeps.size !== dependencies.size ||
        Array.from(dependencies).some((dep) => !oldDeps.has(dep));

      if (depsChanged) {
        // 의존성이 변경되면 역방향 맵에서 이전 참조 제거
        if (oldDeps && this._stateKeyToComputedMap) {
          for (const oldDep of oldDeps) {
            const computedsForDep = this._stateKeyToComputedMap.get(oldDep);
            if (computedsForDep) {
              computedsForDep.delete(key);
              // 집합이 비었으면 맵에서 제거
              if (computedsForDep.size === 0) {
                this._stateKeyToComputedMap.delete(oldDep);
              }
            }
          }
        }

        // 새 의존성 설정
        this.computedDependencies.set(key, dependencies);

        // 역방향 맵 업데이트
        if (this._stateKeyToComputedMap) {
          for (const dep of dependencies) {
            if (!this._stateKeyToComputedMap.has(dep)) {
              this._stateKeyToComputedMap.set(dep, new Set());
            }
            this._stateKeyToComputedMap.get(dep)?.add(key);
          }
        }

        this.isDependencyGraphDirty = true; // 의존성이 변경되면 그래프 재구축 필요
      }

      const prevValue = this.computedCache.get(key);
      // 참조 동일성 체크 먼저 수행 (빠른 경로)
      if (prevValue !== newValue) {
        // 깊은 비교는 비용이 크므로 필요한 경우에만 수행
        if (!deepEqual(prevValue, newValue)) {
          this.computedCache.set(key, newValue);
        }
      }

      processedKeys.add(key);
    }

    // 성능 측정 (개발 모드에서만)
    if (process.env.NODE_ENV !== 'production') {
      const duration = performance.now() - startTime;
      if (duration > 5) {
        // 5ms 이상 걸린 경우만 로그
        console.debug(
          `[StateManager] Computed values update took ${duration.toFixed(2)}ms for ${sortedComputedKeys.length} values`,
        );
      }
    }
  }

  /**
   * 계산된 값 간의 의존성 그래프를 구축합니다.
   */
  private buildComputedDependencyGraph(): void {
    if (!this.computed) return;
    // 각 계산된 값이 다른 계산된 값에 의존하는지 확인
    for (const key in this.computed) {
      // Possible iteration over unexpected... 경고 해결
      if (Object.prototype.hasOwnProperty.call(this.computed, key)) {
        const typedKey = key as keyof TComputed; // 명시적 캐스팅 추가

        const computedFn = this.computed[typedKey];
        if (!computedFn) continue;

        // 가상의 상태로 계산된 값 함수 실행하고 의존성 추적
        const dependencies = new Set<string>();

        // 계산된 값 네임스페이스를 포함한 가상 상태 생성
        const virtualState = { ...this.state };
        const computedNamespace: Record<string, any> = {};

        // 다른 계산된 값들에 대한 접근을 추적하는 프록시 생성
        const computedProxy = new Proxy(computedNamespace, {
          get: (_target, prop) => {
            const propKey = String(prop);

            if (this.computed && propKey !== typedKey && propKey in this.computed) {
              // 현재 계산된 값이 다른 계산된 값에 의존함을 기록
              if (!this.computedDependencyGraph.has(propKey as keyof TComputed)) {
                this.computedDependencyGraph.set(propKey as keyof TComputed, new Set());
              }

              this.computedDependencyGraph.get(propKey as keyof TComputed)?.add(typedKey);
            }

            // 실제 계산된 값 반환 (이미 계산된 경우)
            return this.computedCache.get(propKey as keyof TComputed);
          },
        });

        // 상태 추적 프록시에 계산된 값 네임스페이스 주입
        Object.defineProperty(virtualState, 'computed', {
          get: () => computedProxy,
          enumerable: true,
          configurable: true,
        });

        try {
          const trackingProxy = this.createTrackingProxy(virtualState, dependencies, '', 0);

          computedFn(trackingProxy);
        } catch (error) {
          // 함수 실행 중 오류 처리
          console.error(
            `[StateManager] Error building dependency graph for computed value "${String(typedKey)}":`,
            error,
          );
          // 오류가 발생하더라도 최소한의 의존성 등록 (전체 의존)
          dependencies.add('*');
        }

        // 의존성이 추가되었는지 확인하고 디버깅 로그 출력
        if (dependencies.size === 0) {
          dependencies.add('*');
        }

        this.computedDependencies.set(typedKey, dependencies);
      }
    }
  }

  /**
   * 계산된 값 키를 위상 정렬하여 올바른 계산 순서를 결정합니다.
   * 순환 의존성을 감지하고 처리합니다.
   */
  private topologicalSort(keys: Array<keyof TComputed>): Array<keyof TComputed> {
    const result: Array<keyof TComputed> = [];
    const visited = new Set<keyof TComputed>();
    const tempVisited = new Set<keyof TComputed>();
    // 순환 의존성 추적
    const cyclicDependencies = new Set<keyof TComputed>();
    // 경로를 재사용하여 메모리 할당 줄이기
    const pathArray: Array<keyof TComputed> = [];

    const visit = (key: keyof TComputed) => {
      // 이미 처리된 노드는 건너뜀
      if (visited.has(key)) return;

      // 순환 의존성 감지
      if (tempVisited.has(key)) {
        // 순환 의존성을 발견하면 관련된 모든 키를 기록
        const cycleStart = pathArray.indexOf(key);
        if (cycleStart >= 0) {
          // 배열 복사 최소화
          for (let i = cycleStart; i < pathArray.length; i++) {
            const path = pathArray[i];
            path && cyclicDependencies.add(path);
          }
          cyclicDependencies.add(key);

          if (process.env.NODE_ENV !== 'production') {
            const cycle = pathArray.slice(cycleStart).concat(key);
            console.warn(
              `[StateManager] Circular dependency detected in computed values: ${cycle.map(String).join(' -> ')}`,
            );
          }
        }
        return;
      }

      // 현재 경로에 키 추가
      pathArray.push(key);
      tempVisited.add(key);

      // 의존하는 다른 계산된 값들을 먼저 방문
      for (const [depKey, dependents] of this.computedDependencyGraph.entries()) {
        if (dependents.has(key) && keys.includes(depKey)) {
          visit(depKey);
        }
      }

      tempVisited.delete(key);
      visited.add(key);
      // 순환 의존성이 없는 경우만 결과에 추가
      if (!cyclicDependencies.has(key)) {
        result.push(key);
      }

      // 경로에서 현재 키 제거
      pathArray.pop();
    };

    // 모든 키에 대해 DFS 수행
    for (const key of keys) {
      if (!visited.has(key) && !cyclicDependencies.has(key)) {
        visit(key);
      }
    }

    // 순환 의존성이 있는 경우 추가 경고
    if (cyclicDependencies.size > 0 && process.env.NODE_ENV !== 'production') {
      console.warn(
        `[StateManager] Some computed values with circular dependencies will not update correctly: ${Array.from(
          cyclicDependencies,
        )
          .map(String)
          .join(', ')}`,
      );
    }

    return result;
  }
}
