import { AsyncResult } from '../core/types/public-types';
import { AsyncState } from '../core/types/internal/state';

/**
 * 비동기 액션 결과를 unwrap하는 유틸리티 함수입니다.
 * 성공 시 결과를 반환하고, 실패 시 예외를 발생시킵니다.
 *
 * @template TState 스토어 상태 타입
 * @param asyncAction 실행할 비동기 액션 Promise
 * @returns 성공 시 상태 객체를 반환
 * @throws 실패 시 에러를 throw
 */
export async function unwrap<TState>(asyncAction: Promise<AsyncResult<TState>>): Promise<Partial<TState>> {
  const result = await asyncAction;
  if (result.success) {
    return result.state;
  }
  throw result.error;
}

/**
 * 비동기 액션 상태를 사용하기 쉬운 형태로 변환합니다.
 *
 * @param asyncState 비동기 액션 상태 객체
 * @returns 더 읽기 쉬운 상태 정보 객체
 */
export function getAsyncStatus(asyncState: AsyncState) {
  return {
    isLoading: asyncState.pending,
    isError: !!asyncState.error,
    isSuccess: asyncState.loaded && !asyncState.error,
    errorMessage: asyncState.error?.message || null,
  };
}

/**
 * 여러 비동기 액션을 순차적으로 실행하는 헬퍼 함수
 *
 * @template TState 스토어 상태 타입
 * @param actions 실행할 비동기 액션 배열
 * @returns 모든 액션의 결과 배열
 */
export async function sequence<TState>(
  actions: Array<() => Promise<AsyncResult<TState>>>,
): Promise<Array<AsyncResult<TState>>> {
  const results: Array<AsyncResult<TState>> = [];

  for (const action of actions) {
    try {
      const result = await action();
      results.push(result);

      // 실패 시 나머지 액션은 실행하지 않음
      if (!result.success) {
        break;
      }
    } catch (error) {
      const errorResult: AsyncResult<TState> = {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
      results.push(errorResult);
      break;
    }
  }

  return results;
}
