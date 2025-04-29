import { ComputedDef } from '../../types/public-types';
import { createBatchedUpdates } from '../../../utils/createBatchedUpdates';
import { createSelector } from '../../../utils/selectorMemoization';
import { safeAction } from '../../../utils/errorBoundary';
import { StateContainer } from './StateContainer';
import { SubscriptionManager } from './SubscriptionManager';
import { ComputedManager } from './ComputedManager';
import { DependencyTracker } from './DependencyTracker';
import { UpdateOptions } from './interfaces';

/**
 * 상태 관리자 - 상태 변경 및 계산된 값 캐싱 로직을 처리합니다.
 *
 * @template TState 스토어 상태 타입
 * @template TComputed 계산된 속성 정의 타입
 */
export class InternalStateManager<TState extends Record<string, any>, TComputed extends ComputedDef<TState>> {
  private stateContainer: StateContainer<TState>;
  private subscriptionManager: SubscriptionManager;
  private computedManager: ComputedManager<TState, TComputed>;
  private readonly dependencyTracker: DependencyTracker<TState>;

  // 기타 필요한 유틸리티
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

  // 메모이제이션된 셀렉터 캐시
  private memoizedSelectors = new WeakMap<
    (state: Readonly<TState>) => unknown,
    (state: Readonly<TState>) => unknown
  >();

  constructor(initialState: TState, computed?: TComputed) {
    // 각 컴포넌트 초기화
    this.stateContainer = new StateContainer<TState>(initialState);
    this.subscriptionManager = new SubscriptionManager();
    this.dependencyTracker = new DependencyTracker<TState>();

    // 의존성 추적기 참조가 필요한 컴포넌트 마지막에 초기화
    this.computedManager = new ComputedManager<TState, TComputed>(
      initialState,
      computed,
      this.dependencyTracker.createTrackingProxy.bind(this.dependencyTracker),
    );
  }

  /**
   * 현재 상태의 읽기 전용 사본을 반환합니다.
   */
  getState(): Readonly<TState> {
    return this.stateContainer.getState();
  }

  /**
   * 계산된 값에 접근합니다.
   * @param key 계산된 값의 키
   */
  getComputedValue(key: keyof TComputed) {
    return this.computedManager.getComputedValue(key);
  }

  /**
   * 상태 변경 구독을 추가합니다.
   * @param listener 상태 변경 시 호출될 리스너 함수
   * @param options 구독 옵션
   * @returns 구독 해제 함수
   */
  subscribe(
    listener: () => void,
    options: {
      priority?: number;
      throttle?: number;
      errorHandler?: (error: Error) => void;
      paths?: string[];
    } = {},
  ): () => void {
    return this.subscriptionManager.subscribe(listener, options);
  }

  /**
   * 특정 상태 변경을 구독합니다.
   * @param selector 상태에서 관심 있는 부분을 선택하는 함수
   * @param listener 선택된 상태가 변경될 때 호출될 리스너 함수
   * @param options 구독 옵션
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
    // 구독 옵션 확장
    const extendedOptions = {
      ...options,
      getState: this.getState.bind(this),
      trackDependencies: this.trackSelectorDependencies.bind(this),
      getMemoizedSelector: this.getMemoizedSelector.bind(this),
    };

    return this.subscriptionManager.subscribeState<TState, T>(selector, listener, extendedOptions);
  }

  /**
   * 여러 상태 항목의 변경을 구독합니다.
   * @param selectors 상태에서 관심 있는 여러 부분을 선택하는 함수 배열
   * @param listener 선택된 상태 중 하나라도 변경될 때 호출될 리스너 함수
   * @returns 구독 해제 함수
   */
  subscribeStates<S extends unknown[]>(
    selectors: { [K in keyof S]: (state: Readonly<TState>) => S[K] },
    listener: (values: S, oldValues?: S) => void,
  ): () => void {
    return this.subscriptionManager.subscribeStates<TState, S>(
      selectors,
      listener,
      this.getState.bind(this),
      this.trackSelectorDependencies.bind(this),
    );
  }

  /**
   * 셀렉터의 의존성을 추적합니다.
   * @private
   */
  private trackSelectorDependencies<T>(selector: (state: Readonly<TState>) => T): string[] {
    try {
      return this.dependencyTracker.trackDependencies(selector);
    } catch (error) {
      // 예상치 못한 오류에 대한 추가 안전 장치
      console.error('[StateManager] Unexpected error in dependency tracking:', error);
      return ['*']; // 전체 구독으로 안전하게 대체
    }
  }

  /**
   * 단일 셀렉터를 메모이제이션하여 반환합니다.
   * @private
   */
  private getMemoizedSelector<T>(
    selector: (state: Readonly<TState>) => T,
    options: {
      memoize?: boolean;
      cacheSize?: number;
      ttl?: number;
    } = {},
  ): (state: Readonly<TState>) => T {
    const { memoize = true } = options;

    // 메모이제이션 옵션이 비활성화된 경우, 원본 셀렉터 반환
    if (!memoize) {
      return selector;
    }

    // 이미 메모이제이션된 셀렉터가 있는지 확인
    if (this.memoizedSelectors.has(selector)) {
      return this.memoizedSelectors.get(selector) as (state: Readonly<TState>) => T;
    }

    // 새로운 메모이제이션된 셀렉터 생성
    const memoizedSelector = createSelector(selector);

    // 메모이제이션된 셀렉터 저장
    this.memoizedSelectors.set(selector, memoizedSelector);
    return memoizedSelector;
  }

  /**
   * 상태를 업데이트합니다.
   * @param newState 새 상태 객체 (부분 상태 또는 전체 상태)
   * @param options 업데이트 옵션
   */
  _setState(newState: Partial<TState>, options: UpdateOptions = {}): void {
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

        // 상태 업데이트 실행
        const { changedKeys, changedPaths, hasStructuralChange } = this.stateContainer.updateState(newState, {
          statePath,
        });

        // 변경된 것이 없으면 작업 중단
        if (changedKeys.size === 0) return;

        // 영향 받는 계산된 값 업데이트
        this.computedManager.updateComputedValues(changedKeys, this.getState());

        // 구조적 변경이 있는 경우 계산된 값 경로 추가
        if (hasStructuralChange) {
          // 모든 계산된 값에 대한 의존성 경로 추가
          changedPaths.add('*');
        }

        // 알림 처리 (silent 모드가 아닌 경우)
        if (!silent) {
          this.batchedUpdates.scheduleUpdate(
            () => {
              // 구독 트리를 통한 효율적인 알림
              this.subscriptionManager.notifySubscribers(Array.from(changedPaths));
            },
            {
              priority: hasStructuralChange ? 'high' : priority, // 구조적 변경이면 우선순위 높임
              id: updateId,
              replace: true, // 동일 ID의 이전 업데이트 대체
            },
          );
        }
      },
      options.statePath || 'global',
    );
  }

  /**
   * 성능 통계 및 디버깅 정보를 반환합니다.
   */
  getDebugInfo() {
    return {
      // 구독 관련 정보
      subscribers: this.subscriptionManager.getStats(),

      // 상태 관련 정보
      state: {
        size: JSON.stringify(this.getState()).length,
        keys: Object.keys(this.getState()),
      },

      // 계산된 값 관련 정보
      computed: this.computedManager.getDebugInfo(),
    };
  }

  /**
   * 특정 상태 경로에 구독 중인 구독자 ID 목록을 반환합니다.
   * @param path 상태 경로
   */
  getSubscribersForPath(path: string): string[] {
    return this.subscriptionManager.getSubscribersForPath(path);
  }

  /**
   * 구독자를 일시적으로 비활성화합니다.
   * @param subscriberId 구독자 ID
   * @param active 활성화 여부
   */
  setSubscriberActive(subscriberId: string, active: boolean): boolean {
    return this.subscriptionManager.setSubscriberActive(subscriberId, active);
  }

  /**
   * 상태 스냅샷을 생성하고 필요시 이전 상태로 복원합니다.
   * @returns 복원 함수
   */
  createSnapshot(): () => void {
    const snapshot = this.getState();

    return () => {
      // 이전 상태로 복원 (알림 없이)
      this._setState(snapshot as Partial<TState>, { silent: true });
      console.log('[StateManager] State restored from snapshot');
    };
  }
}
