/**
 * 상태 업데이트를 우선순위 기반으로 일괄 처리하는 유틸리티를 생성합니다.
 * 짧은 시간 내에 여러 업데이트가 발생하면 하나의 렌더링 주기에 합쳐서 처리합니다.
 *
 * @returns 배치 업데이트 관리 객체
 */
export function createBatchedUpdates() {
  // 내부 상태
  const state = {
    // 보류 중인 업데이트 큐 (우선순위별로 구분)
    pendingUpdates: {
      high: [] as Array<{ id?: string; fn: () => void }>,
      normal: [] as Array<{ id?: string; fn: () => void }>,
      low: [] as Array<{ id?: string; fn: () => void }>,
    },
    rafId: null as number | null,
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
    state.rafId = null;
    // timeoutId 관련 코드 제거
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
   * 일관된 성능을 위해 requestAnimationFrame만 사용하도록 최적화
   */
  const scheduleFlush = (): void => {
    // 이미 예약된 업데이트가 있으면 새로 예약하지 않음
    if (state.rafId !== null) return;

    // 모든 경우에 requestAnimationFrame 사용
    state.rafId = requestAnimationFrame(flushUpdates);
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
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }

      // timeoutId는 더 이상 사용하지 않음

      flushUpdates();
    },
  };
}
