import { SubscriptionTree } from '../../../utils/subscriptionTree';
import { ISubscriptionManager } from './interfaces';
import { deepEqual } from '../../../utils/compare';
import { fx } from '@fxts/core';

/**
 * 구독 관리자 - 상태 변경 구독 및 알림 관리를 담당합니다.
 */
export class SubscriptionManager implements ISubscriptionManager {
  private subscriptionTree: SubscriptionTree = new SubscriptionTree();
  private nextSubscriberId = 1;
  private subscriberMetadata = new Map<
    string,
    {
      createdAt: number;
      updateCount: number;
      lastUpdateAt: number;
      activePathCount: number;
    }
  >();

  // 구독자 메타데이터 초기화
  setupSubscriberMetadata(subscriberId: string, paths: string[]): void {
    this.subscriberMetadata.set(subscriberId, {
      createdAt: Date.now(),
      updateCount: 0,
      lastUpdateAt: 0,
      activePathCount: paths.length,
    });
  }

  // 구독자 메타데이터 업데이트
  updateSubscriberMetadata(subscriberId: string): void {
    const metadata = this.subscriberMetadata.get(subscriberId);
    if (metadata) {
      metadata.updateCount++;
      metadata.lastUpdateAt = Date.now();
    }
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
        console.error('[SubscriptionManager] Error in subscriber:', error);

        // 사용자 정의 에러 핸들러 호출
        if (errorHandler) {
          try {
            errorHandler(error as Error);
          } catch (handlerError) {
            console.error('[SubscriptionManager] Error in subscriber error handler:', handlerError);
          }
        }
      }
    };

    // 구독 메타데이터 기록
    this.setupSubscriberMetadata(subscriberId, paths);

    // 구독 트리에 직접 등록
    const unsubscribe = this.subscriptionTree.subscribe(subscriberId, safeListener, paths, {
      priority,
      throttle,
    });

    // 구독 해제 함수 반환
    return () => {
      unsubscribe();
      this.subscriberMetadata.delete(subscriberId);
    };
  }

  /**
   * 특정 상태 변경을 구독합니다.
   * @param selector 상태에서 관심 있는 부분을 선택하는 함수
   * @param listener 선택된 상태가 변경될 때 호출될 리스너 함수
   * @param options 구독 옵션
   * @returns 구독 해제 함수
   */
  subscribeState<TState extends Record<string, any>, T>(
    selector: (state: Readonly<TState>) => T,
    listener: (value: T, oldValue?: T) => void,
    options: {
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
    } = {},
  ): () => void {
    const {
      priority = 0,
      throttle,
      errorHandler,
      getState,
      trackDependencies,
      getMemoizedSelector,
    } = options;

    if (!getState || !trackDependencies || !getMemoizedSelector) {
      throw new Error(
        '[SubscriptionManager] Required options missing: getState, trackDependencies, or getMemoizedSelector',
      );
    }

    // 고유 구독자 ID 생성
    const subscriberId = `selector-${this.nextSubscriberId++}`;

    // 셀렉터 메모이제이션 처리
    const memoizedSelector = getMemoizedSelector(selector, options);

    // 안전한 오류 처리를 위한 유틸리티 함수
    const safeErrorHandler = (error: any, context: string) => {
      console.error(`[SubscriptionManager] ${context}:`, error);
      if (errorHandler) {
        try {
          errorHandler(error instanceof Error ? error : new Error(String(error)));
        } catch (handlerError) {
          console.error('[SubscriptionManager] Error in error handler:', handlerError);
        }
      }
    };

    // 의존성 추적 - 안전하게 수행
    let normalizedDependencies: string[];
    try {
      normalizedDependencies = trackDependencies(memoizedSelector);
    } catch (error) {
      safeErrorHandler(error, 'Error tracking dependencies');
      normalizedDependencies = ['*']; // 전체 구독으로 안전하게 대체
    }

    // 초기값 계산 - 안전하게 수행
    let currentValue: T;
    try {
      currentValue = memoizedSelector(getState());
    } catch (error) {
      safeErrorHandler(error, 'Error calculating initial selector value');
      currentValue = undefined as unknown as T;
    }

    // 상태 변경 리스너 생성
    const stateListener = () => {
      try {
        // 메모이제이션된 셀렉터로 새 값 계산
        let newValue: T;
        try {
          newValue = memoizedSelector(getState());
        } catch (error) {
          safeErrorHandler(error, 'Error calculating selector value');
          return; // 선택기 실행 실패 시 이전 상태 유지
        }

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
              safeErrorHandler(error, 'Error in state change listener');
            }
          }
        }
      } finally {
        // 구독자 메타데이터 업데이트 - 항상 실행
        this.updateSubscriberMetadata(subscriberId);
      }
    };

    // 구독 메타데이터 기록
    this.setupSubscriberMetadata(subscriberId, normalizedDependencies);

    // 구독 트리에 직접 등록
    const unsubscribe = this.subscriptionTree.subscribe(subscriberId, stateListener, normalizedDependencies, {
      priority,
      throttle,
    });

    // 구독 해제 함수 반환
    return () => {
      unsubscribe();
      this.subscriberMetadata.delete(subscriberId);
    };
  }

  /**
   * 여러 상태 항목의 변경을 구독합니다.
   * @param selectors 상태에서 관심 있는 여러 부분을 선택하는 함수 배열
   * @param listener 선택된 상태 중 하나라도 변경될 때 호출될 리스너 함수
   * @param getState 현재 상태를 가져오는 함수
   * @param trackDependencies 선택기의 의존성을 추적하는 함수
   * @returns 구독 해제 함수
   */
  subscribeStates<TState extends Record<string, any>, S extends unknown[]>(
    selectors: { [K in keyof S]: (state: Readonly<TState>) => S[K] },
    listener: (values: S, oldValues?: S) => void,
    getState?: () => Readonly<TState>,
    trackDependencies?: (selector: (state: Readonly<TState>) => unknown) => string[],
  ): () => void {
    if (!getState || !trackDependencies) {
      throw new Error('[SubscriptionManager] Required parameters missing: getState or trackDependencies');
    }

    const selectorsArray = selectors as Array<(state: Readonly<any>) => unknown>;
    const subscriberId = `multi-selector-${this.nextSubscriberId++}`;

    let currentValues = fx(selectorsArray)
      .map((selector) => selector(getState()))
      .toArray() as S;

    // 모든 선택자의 의존성 수집
    const normalizedDependencies = fx(selectorsArray)
      .flatMap((selector) => trackDependencies(selector))
      .toArray()
      .filter((dep, index, self) => self.indexOf(dep) === index); // 중복 제거

    // 상태 변경 리스너 생성
    const stateListener = () => {
      const newValues = fx(selectorsArray)
        .map((selector) => selector(getState()))
        .toArray() as S;

      // 변경된 인덱스 찾기
      const changedIndexes = fx(newValues.entries())
        .filter(([i, val]) => currentValues[i] !== val)
        .map(([i]) => i)
        .toArray();

      // 실제 변경 여부 확인
      const hasChanged = fx(changedIndexes).some(
        (index) => !deepEqual(currentValues[index], newValues[index]),
      );

      if (hasChanged) {
        const oldValues = currentValues;
        currentValues = newValues;

        try {
          listener(newValues, oldValues);
        } catch (error) {
          console.error('[SubscriptionManager] Error in subscribeStates listener:', error);
        }
      }

      // 구독자 메타데이터 업데이트
      this.updateSubscriberMetadata(subscriberId);
    };

    // 구독 메타데이터 기록
    this.setupSubscriberMetadata(subscriberId, normalizedDependencies);

    // 구독 트리에 직접 등록
    const unsubscribe = this.subscriptionTree.subscribe(subscriberId, stateListener, normalizedDependencies);

    // 구독 해제 함수 반환
    return () => {
      unsubscribe();
      this.subscriberMetadata.delete(subscriberId);
    };
  }

  /**
   * 구독자에게 상태 변경을 알립니다.
   * @param changedPaths 변경된 상태 경로 배열
   */
  notifySubscribers(changedPaths: string[]): void {
    this.subscriptionTree.notifySubscribers(changedPaths);
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
   * @param subscriberId 구독자 ID
   * @param active 활성화 여부
   */
  setSubscriberActive(subscriberId: string, active: boolean): boolean {
    return this.subscriptionTree.setSubscriberActive(subscriberId, active);
  }

  /**
   * 구독 관련 통계 정보를 반환합니다.
   */
  getStats() {
    return {
      totalSubscribers: this.subscriptionTree.getStats().totalSubscribers,
      subscriberMetadata: Object.fromEntries(this.subscriberMetadata.entries()),
      pathSubscriberMap: this.subscriptionTree.getPathSubscriberMap(),
    };
  }
}
