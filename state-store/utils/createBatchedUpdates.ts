import { isServer } from './env';

/**
 * 상태 업데이트를 우선순위 기반으로 일괄 처리하는 유틸리티를 생성합니다.
 * 짧은 시간 내에 여러 업데이트가 발생하면 하나의 렌더링 주기에 합쳐서 처리합니다.
 *
 * 서버와 클라이언트 환경 모두에서 동작하도록 설계되었습니다.
 * 서버 환경에서는 동기적으로 즉시 실행됩니다.
 *
 * @returns 배치 업데이트 관리 객체
 */
export function createBatchedUpdates() {
  // 타이머 타입 정의 (Node.js와 브라우저 환경 모두 호환)
  type Timer = ReturnType<typeof setTimeout> | number;

  // 내부 상태
  const state = {
    // 보류 중인 업데이트 큐 (우선순위별로 구분)
    pendingUpdates: {
      high: [] as Array<{ id?: string; fn: () => void }>,
      normal: [] as Array<{ id?: string; fn: () => void }>,
      low: [] as Array<{ id?: string; fn: () => void }>,
    },
    rafId: null as Timer | null,
    lastUpdateTime: 0,
    isProcessing: false,
    performanceSupported: typeof performance !== 'undefined' && typeof performance.now === 'function',
  };

  const getNow = state.performanceSupported ? () => performance.now() : () => Date.now();

  /**
   * 예약된 모든 업데이트를 실행하는 함수
   */
  const flushUpdates = (): void => {
    // 이미 처리 중이면 중복 실행 방지
    if (state.isProcessing) return;

    state.isProcessing = true;

    // 상태 초기화를 먼저 수행
    if (state.rafId !== null) {
      clearTimeout(state.rafId);
      state.rafId = null;
    }

    state.lastUpdateTime = getNow();

    // 큐에서 업데이트 가져오기 (우선순위 순서로)
    const updates = [
      ...state.pendingUpdates.high,
      ...state.pendingUpdates.normal,
      ...state.pendingUpdates.low,
    ];

    // 큐 초기화
    state.pendingUpdates.high = [];
    state.pendingUpdates.normal = [];
    state.pendingUpdates.low = [];

    // 업데이트 중에 에러가 발생하더라도 다음 업데이트가 진행되도록 보장
    for (let i = 0; i < updates.length; i++) {
      const update = updates[i];
      if (update) {
        try {
          update.fn();
        } catch (error) {
          console.error('[Store] Update function failed:', error);
        }
      }
    }

    state.isProcessing = false;

    // 업데이트 중에 새로운 업데이트가 추가되었으면 재처리
    const hasNewUpdates =
      state.pendingUpdates.high.length > 0 ||
      state.pendingUpdates.normal.length > 0 ||
      state.pendingUpdates.low.length > 0;

    if (hasNewUpdates) {
      scheduleFlush();
    }
  };

  /**
   * 업데이트 실행을 예약하는 함수
   * 우선순위에 따라 다른 스케줄링 전략 사용
   * 서버 환경에서는 즉시 실행됨
   */
  // requestAnimationFrame의 사용 가능 여부 확인
  const hasRequestAnimationFrame = typeof requestAnimationFrame === 'function';

  const scheduleFlush = (): void => {
    // 서버 환경에서는 즉시 실행
    if (isServer) {
      flushUpdates();
      return;
    }

    // 이미 예약된 업데이트가 있으면 새로 예약하지 않음
    if (state.rafId !== null) return;

    // 고우선순위 업데이트가 있는지 확인
    const hasHighPriorityUpdates = state.pendingUpdates.high.length > 0;

    if (hasHighPriorityUpdates) {
      // 고우선순위 업데이트가 있으면 setTimeout(0)을 사용하여 즉시 실행 큐에 넣음
      // 이는 requestAnimationFrame보다 빠르게 실행됨
      state.rafId = setTimeout(flushUpdates, 0) as unknown as number;
    } else {
      // 일반 또는 저우선순위 업데이트 스케줄링
      // requestAnimationFrame이 사용 가능한 환경에서만 사용, 그렇지 않으면 setTimeout 사용
      if (hasRequestAnimationFrame) {
        state.rafId = requestAnimationFrame(flushUpdates);
      } else {
        // 폴백: 브라우저 환경이지만 requestAnimationFrame이 없는 경우
        state.rafId = setTimeout(flushUpdates, 16) as unknown as number; // 약 60fps에 해당하는 시간
      }
    }
  };

  /**
   * 업데이트 중복 여부 확인 함수
   */
  const isDuplicateUpdate = (id: string): boolean => {
    if (!id) return false;

    // 모든 우선순위 큐에서 동일 ID의 업데이트 검색
    return [state.pendingUpdates.high, state.pendingUpdates.normal, state.pendingUpdates.low].some((queue) =>
      queue.some((update) => update.id === id),
    );
  };

  /**
   * 동일 ID의 기존 업데이트 제거 함수
   */
  const removeExistingUpdate = (id: string): void => {
    if (!id) return;

    // 모든 우선순위 큐에서 동일 ID의 업데이트 제거
    ['high', 'normal', 'low'].forEach((priority) => {
      const queue = state.pendingUpdates[priority as keyof typeof state.pendingUpdates];
      const index = queue.findIndex((update) => update.id === id);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    });
  };

  return {
    /**
     * 업데이트 함수를 예약합니다.
     * 짧은 시간 내에 여러 업데이트가 예약되면 한 번에 처리됩니다.
     *
     * @param update 실행할 업데이트 함수
     * @param options 업데이트 옵션 (우선순위, ID 등)
     */
    scheduleUpdate(
      update: () => void,
      options: {
        priority?: 'high' | 'normal' | 'low';
        id?: string;
        replace?: boolean;
      } = {},
    ): void {
      const { priority = 'normal', id, replace = true } = options;

      // 동일 ID의 업데이트가 이미 있는지 확인
      if (id) {
        // 동일 ID 업데이트 중복 처리
        if (isDuplicateUpdate(id)) {
          // 대체 옵션이 활성화된 경우 기존 업데이트 제거
          if (replace) {
            removeExistingUpdate(id);
          } else {
            // 대체하지 않는 경우 새 업데이트는 무시
            return;
          }
        }
      }

      // 업데이트 큐에 추가
      state.pendingUpdates[priority].push({ id, fn: update });

      // 업데이트 예약
      scheduleFlush();
    },

    /**
     * 특정 ID의 업데이트가 예약되어 있는지 확인합니다.
     *
     * @param id 확인할 업데이트 ID
     * @returns 해당 ID의 업데이트가 예약되어 있으면 true
     */
    hasScheduledUpdate(id: string): boolean {
      return isDuplicateUpdate(id);
    },

    /**
     * 특정 ID의 예약된 업데이트를 취소합니다.
     *
     * @param id 취소할 업데이트 ID
     * @returns 업데이트가 취소되었으면 true
     */
    cancelUpdate(id: string): boolean {
      if (!id || !isDuplicateUpdate(id)) return false;

      removeExistingUpdate(id);
      return true;
    },

    /**
     * 모든 예약된 업데이트를 즉시 실행합니다.
     * 테스트나 긴급 상황에서 사용할 수 있습니다.
     */
    flushUpdatesImmediately(): void {
      if (state.rafId !== null) {
        // setTimeout으로 예약된 경우
        clearTimeout(state.rafId);
        state.rafId = null;
      }

      flushUpdates();
    },
  };
}
