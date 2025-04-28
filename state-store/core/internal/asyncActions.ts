import { AsyncActionsDef, AsyncResult } from '../types/public-types.ts';
import { AsyncState } from '../types/internal/state.ts';

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

  constructor(
    asyncActions: TAsyncActions,
    listeners: Set<() => void>,
    setState: (newState: Partial<TState>) => void,
  ) {
    this.asyncActions = asyncActions;
    this.listeners = listeners;
    this.setState = setState;
    this.asyncStateMap = this.initializeAsyncState(asyncActions);
    this.abortControllers = new Map();
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

    for (const key in this.asyncActions) {
      if (Object.prototype.hasOwnProperty.call(this.asyncActions, key)) {
        const asyncActionFn = this.asyncActions[key];
        if (asyncActionFn) {
          api[key as keyof TAsyncActions] = this.createAsyncActionWrapper(
            key as keyof TAsyncActions,
            asyncActionFn,
          );
        }
      }
    }

    return api;
  }

  // 현재 실행 중인 액션 ID를 추적
  private activeActionRequests = new Map<keyof TAsyncActions, string>();

  /**
   * 개별 비동기 액션 래퍼 함수를 생성합니다.
   * @param key 액션 키
   * @param asyncActionFn 원본 비동기 액션 함수
   * @returns 래핑된 비동기 액션 함수
   */
  // 요청 취소 이벤트 수신을 위한 맵
  private abortControllers = new Map<string, AbortController>();

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
      }
      
      // 새 요청을 위한 AbortController 생성
      const abortController = new AbortController();
      this.abortControllers.set(requestId, abortController);
      
      // 이 액션에 대한 현재 요청 ID 저장
      this.activeActionRequests.set(key, requestId);
      
      this.asyncStateMap[key] = {
        pending: true,
        error: null,
        loaded: false,
      };

      this.notifyListeners();

      try {
        const result = await asyncActionFn(...args);

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
        // 리소스 정리
        this.abortControllers.delete(requestId);
        
        // 이 요청이 여전히 활성 요청인 경우에만 활성 요청 맵에서 제거
        if (this.activeActionRequests.get(key) === requestId) {
          this.activeActionRequests.delete(key);
        }
        
        // 비동기 액션이 1분 이상 대기 상태로 남아있는 경우 감지
        const asyncState = this.asyncStateMap[key];
        if (asyncState.pending) {
          const timeoutId = setTimeout(() => {
            // 1분 후에도 여전히 pending 상태이면 상태 정리
            if (this.asyncStateMap[key].pending) {
              console.warn(`[AsyncActionManager] Async action ${String(key)} has been pending for over 1 minute. Cleaning up.`);
              this.asyncStateMap[key] = {
                pending: false,
                error: new Error('Request timed out after 1 minute'),
                loaded: false,
              };
              this.notifyListeners();
            }
          }, 60000); // 1분 타임아웃
          
          // 타임아웃 ID 정리를 위해 브라우저 환경에서는 추가 처리가 필요할 수 있습니다.
          // 여기서는 간단하게 구현합니다.
          if (typeof window !== 'undefined') {
            (window as any).__asyncActionTimeouts = (window as any).__asyncActionTimeouts || {};
            // 이전 타임아웃 존재하면 정리
            if ((window as any).__asyncActionTimeouts[String(key)]) {
              clearTimeout((window as any).__asyncActionTimeouts[String(key)]);
            }
            (window as any).__asyncActionTimeouts[String(key)] = timeoutId;
          }
        }
      }
    };
  }

  /**
   * 비동기 액션 상태를 초기화합니다.
   */
  private initializeAsyncState(asyncActions: TAsyncActions): Record<keyof TAsyncActions, AsyncState> {
    const stateMap = {} as Record<keyof TAsyncActions, AsyncState>;

    for (const key in asyncActions) {
      if (Object.prototype.hasOwnProperty.call(asyncActions, key)) {
        stateMap[key as keyof TAsyncActions] = {
          pending: false,
          error: null,
          loaded: false,
        };
      }
    }

    return stateMap;
  }

  /**
   * 모든 리스너에게 상태 변경을 알립니다.
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.error('[Store] Error in async state listener execution:', error);
      }
    });
  }
}
