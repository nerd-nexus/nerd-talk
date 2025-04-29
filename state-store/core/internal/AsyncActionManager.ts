import { AsyncActionsDef, AsyncResult } from '../types/public-types.ts';
import { AsyncState } from '../types/internal/state.ts';
import { fx, keys } from '@fxts/core';

/**
 * 비동기 액션 관리자 - 비동기 액션의 상태를 추적하고 관리합니다.
 * @template TState 스토어 상태 타입
 * @template TAsyncActions 비동기 액션 정의 타입
 */
export class AsyncActionManager<
  TState extends Record<string, any>,
  TAsyncActions extends AsyncActionsDef<TState>,
> {
  private readonly asyncStateMap: { [K in keyof TAsyncActions]: AsyncState };
  private readonly asyncActions: TAsyncActions;
  private readonly setState: (newState: Partial<TState>) => void;
  private listeners: Set<() => void>;
  // 요청 취소 이벤트 수신을 위한 맵
  private abortControllers = new Map<string, AbortController>();
  // 현재 실행 중인 액션 ID를 추적
  private activeActionRequests = new Map<keyof TAsyncActions, string>();
  // 타임아웃 관리를 위한 맵 추가
  private timeoutIds = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    asyncActions: TAsyncActions,
    listeners: Set<() => void>,
    setState: (newState: Partial<TState>) => void,
  ) {
    this.asyncActions = asyncActions;
    this.listeners = listeners;
    this.setState = setState;
    this.asyncStateMap = this.initializeAsyncState(asyncActions);
  }

  /**
   * 비동기 액션 상태 맵을 반환합니다.
   */
  getAsyncState(): Record<keyof TAsyncActions, AsyncState> {
    return { ...this.asyncStateMap };
  }

  /**
   * 비동기 액션 API를 생성합니다.
   * @returns 비동기 액션 API 객체
   */
  createAsyncActionsApi(): Record<
    keyof TAsyncActions,
    <K extends keyof TAsyncActions>(
      ...args: Parameters<TAsyncActions[K]>
    ) => Promise<AsyncResult<Partial<TState>>>
  > {
    type AsyncActionApi = <K extends keyof TAsyncActions>(
      ...args: Parameters<TAsyncActions[K]>
    ) => Promise<AsyncResult<Partial<TState>>>;

    const api = {} as Record<keyof TAsyncActions, AsyncActionApi>;

    fx(keys(this.asyncActions))
      .filter((key) => Object.hasOwn(this.asyncActions, key) && !!this.asyncActions[key])
      .each((key) => {
        const actionKey = key as keyof TAsyncActions;
        const actionFn = this.asyncActions[actionKey];
        api[actionKey] = this.createAsyncActionWrapper(actionKey, actionFn);
      });

    return api;
  }

  /**
   * 개별 비동기 액션 래퍼 함수를 생성합니다.
   * @param key 액션 키
   * @param asyncActionFn 원본 비동기 액션 함수
   * @returns 래핑된 비동기 액션 함수
   */
  private createAsyncActionWrapper<K extends keyof TAsyncActions>(key: K, asyncActionFn: TAsyncActions[K]) {
    return async (...args: Parameters<TAsyncActions[K]>): Promise<AsyncResult<Partial<TState>>> => {
      // 각 요청마다 고유 ID 생성
      const requestId = `${String(key)}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      // 이전 진행 중인 요청이 있으면 취소
      const prevRequestId = this.activeActionRequests.get(key);
      if (prevRequestId) {
        const prevController = this.abortControllers.get(prevRequestId);
        if (prevController) {
          try {
            prevController.abort(); // 이전 요청 취소
          } catch (e) {
            console.debug(`[AsyncActionManager] Error aborting previous request: ${e}`);
          }
          this.abortControllers.delete(prevRequestId);
        }
        // 이전 타임아웃이 있다면 취소
        const prevTimeout = this.timeoutIds.get(prevRequestId);
        if (prevTimeout) {
          clearTimeout(prevTimeout);
          this.timeoutIds.delete(prevRequestId);
        }
      }

      // 새 요청을 위한 AbortController 생성
      const abortController = new AbortController();
      this.abortControllers.set(requestId, abortController);

      // 이 액션에 대한 현재 요청 ID 저장
      this.activeActionRequests.set(key, requestId);

      // 액션 함수 실행 시 컨텍스트 제공
      const actionContext = {
        signal: abortController.signal, // AbortController의 signal 전달
        requestId, // 고유 요청 ID 전달
        key: key as string, // 액션 키 전달
      };

      this.asyncStateMap[key] = {
        pending: true,
        error: null,
        loaded: false,
      };

      this.notifyListeners();

      try {
        // 타임아웃 설정 - 맵에 저장하여 관리
        const timeoutId = setTimeout(() => {
          // 1분 후에도 여전히 pending 상태이면 상태 정리
          if (this.asyncStateMap[key].pending && this.activeActionRequests.get(key) === requestId) {
            console.warn(
              `[AsyncActionManager] Async action ${String(key)} has been pending for over 1 minute. Cleaning up.`,
            );
            // 이 요청이 아직 활성 요청인지 확인 후 취소
            if (this.activeActionRequests.get(key) === requestId) {
              this.abortControllers.get(requestId)?.abort(new Error('Request timed out after 1 minute'));
              this.abortControllers.delete(requestId);
              this.activeActionRequests.delete(key);
              // 타임아웃 ID 맵에서 제거
              this.timeoutIds.delete(requestId);
            }
          }
        }, 60000); // 1분 타임아웃

        // 타임아웃 ID를 맵에 저장
        this.timeoutIds.set(requestId, timeoutId);

        // 액션 함수에 추가 컨텍스트와 함께 인자 전달
        const result = await asyncActionFn(...args, actionContext);

        // 요청이 이미 다른 요청으로 대체되었는지 확인
        if (this.activeActionRequests.get(key) !== requestId) {
          // 이 요청이 더 이상 활성 요청이 아니면 결과 무시
          console.debug(`[AsyncActionManager] Ignoring outdated async result for ${String(key)}`);
          return result; // 결과 자체는 반환 (UI 상태 업데이트 없음)
        }

        if (result.success) {
          // 성공 시 상태 업데이트
          this.asyncStateMap[key] = {
            pending: false,
            error: null,
            loaded: true,
          };

          this.setState(result.state);
          return result;
        } else {
          // 실패 시 에러 상태로 업데이트
          this.asyncStateMap[key] = {
            pending: false,
            error: result.error,
            loaded: false,
          };

          this.notifyListeners();
          return result;
        }
      } catch (error) {
        // AbortError인 경우 특별 처리 (이미 취소된 요청)
        if (error instanceof DOMException && error.name === 'AbortError') {
          console.debug(`[AsyncActionManager] Request ${requestId} for ${String(key)} was aborted.`);
          // 타임아웃에 의한 취소일 경우 에러 상태 반영
          if (String(error.message).includes('timed out')) {
            this.asyncStateMap[key] = {
              pending: false,
              error,
              loaded: false,
            };
            this.notifyListeners();
            return { success: false, error };
          }
          // 다른 이유로 취소된 경우 (예: 새 요청 발생) 상태 변경 없음
          return { success: false, error };
        }

        // 요청이 이미 다른 요청으로 대체되었는지 확인
        if (this.activeActionRequests.get(key) !== requestId) {
          // 이 요청이 더 이상 활성 요청이 아니면 상태 업데이트 건너뛰기
          return {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }

        // 예외 발생 시 에러 상태로 업데이트
        this.asyncStateMap[key] = {
          pending: false,
          error: error instanceof Error ? error : new Error(String(error)),
          loaded: false,
        };

        // 상태 변경을 리스너에게 알림
        this.notifyListeners();

        // 에러 결과 반환
        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      } finally {
        // 성공적으로 완료된 경우에만 타임아웃 취소
        if (!this.asyncStateMap[key].pending) {
          const timeoutId = this.timeoutIds.get(requestId);
          if (timeoutId) {
            clearTimeout(timeoutId);
            this.timeoutIds.delete(requestId);
          }
        }
        // pending이 true인 경우 타임아웃은 계속 실행

        // 리소스 정리
        this.abortControllers.delete(requestId);

        // 이 요청이 여전히 활성 요청인 경우에만 활성 요청 맵에서 제거
        if (this.activeActionRequests.get(key) === requestId) {
          this.activeActionRequests.delete(key);
        }
      }
    };
  }

  /**
   * 비동기 액션 상태를 초기화합니다.
   */
  private initializeAsyncState(asyncActions: TAsyncActions): Record<keyof TAsyncActions, AsyncState> {
    const stateMap = {} as Record<keyof TAsyncActions, AsyncState>;

    fx(Object.keys(asyncActions))
      .filter((key) => Object.hasOwn(asyncActions, key))
      .each((key) => {
        stateMap[key as keyof TAsyncActions] = {
          pending: false,
          error: null,
          loaded: false,
        };
      });

    return stateMap;
  }

  /**
   * 모든 리스너에게 상태 변경을 알립니다.
   */
  private notifyListeners(): void {
    fx(this.listeners).each((listener) => {
      try {
        listener();
      } catch (error) {
        console.error('[Store] Error in async state listener execution:', error);
      }
    });
  }

  /**
   * 여러 비동기 액션을 병렬로 실행합니다.
   * @param actions 실행할 액션과 파라미터의 배열
   * @param concurrencyLimit 동시 실행 가능한 최대 액션 수 (기본값 3)
   * @returns 각 액션의 결과 배열
   */
  async executeParallel<K extends keyof TAsyncActions>(
    actions: Array<{
      key: K;
      args: Parameters<TAsyncActions[K]>;
    }>,
    concurrencyLimit = 3,
  ): Promise<Array<{ key: K; result: AsyncResult<Partial<TState>> }>> {
    const asyncActionsApi = this.createAsyncActionsApi();

    return await fx(actions)
      .toAsync()
      .map(async ({ key, args }) => {
        const result = await (asyncActionsApi[key] as any)(...args);
        return { key, result };
      })
      .concurrent(concurrencyLimit) // 지정된 수만큼 병렬 실행
      .toArray();
  }
}
