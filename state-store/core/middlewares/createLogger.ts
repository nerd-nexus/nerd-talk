import { Action } from '../types/internal/action.ts';

import { Middleware } from '../types/internal/store.ts';

/**
 * 콘솔 로거 미들웨어를 생성합니다.
 * 액션과 상태 변화를 콘솔에 로깅합니다.
 *
 * @template TState 스토어 상태 타입
 * @returns 생성된 로거 미들웨어
 */
export function createLogger<TState extends Record<string, any>>(): Middleware<TState> {
  return (store) => {
    return (next) => (action: Action) => {
      try {
        // 시간 측정 시작
        const startTime = performance.now();

        // 액션 타입 결정
        const actionType =
          action.type === '[State Update]' && action.meta?.originalActionType
            ? action.meta.originalActionType
            : action.type;

        // 액션 그룹 시작
        console.group(`[Logger] Action: ${actionType}`);

        // 이전 상태 로깅
        console.log('%c Prev State:', 'color: #9E9E9E; font-weight: bold;', store.getState());

        // 페이로드 로깅 - 원본 페이로드 사용 (가능한 경우)
        const payloadToLog =
          action.type === '[State Update]' && action.meta?.originalActionPayload
            ? action.meta.originalActionPayload
            : action.payload;
        console.log('%c Payload:', 'color: #03A9F4; font-weight: bold;', payloadToLog);

        // 다음 미들웨어/리듀서로 액션 전달
        const result = next(action);

        // 실행 시간 계산
        const executionTime = performance.now() - startTime;

        // 다음 상태 로깅
        console.log('%c Next State:', 'color: #4CAF50; font-weight: bold;', store.getState());
        console.log(
          '%c Execution time:',
          'color: #FF5722; font-weight: bold;',
          `${executionTime.toFixed(2)}ms`,
        );

        // 액션 그룹 종료
        console.groupEnd();

        return result;
      } catch (error) {
        console.error('[Logger] Error in logger middleware:', error);
        // 오류가 발생해도 액션은 처리되도록 함
        return next(action);
      }
    };
  };
}
