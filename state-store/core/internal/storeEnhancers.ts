import { ActionsDef, AsyncActionsDef, ComputedDef } from '../types/public-types.ts';
import { Action } from '../types/internal/action.ts';

import { Middleware, StoreInternal } from '../types/internal/store.ts';

/**
 * 액션 히스토리 항목 인터페이스
 */
interface ActionHistoryItem {
  action: Action;
  timestamp: number;
  state: NonNullable<unknown>;
  id: number;
}

/**
 * Redux DevTools 확장 프로그램 인터페이스
 */
declare global {
  interface Window {
    __REDUX_DEVTOOLS_EXTENSION__?: {
      connect(options: NonNullable<unknown>): {
        init(state: NonNullable<unknown>): void;
        send(action: NonNullable<unknown>, state: NonNullable<unknown>): void;
        subscribe(listener: (message: NonNullable<unknown>) => void): void;
      };
    };
  }
}

/**
 * 미들웨어를 스토어에 적용합니다.
 * @template TState 스토어 상태 타입
 * @template TComputed 계산된 속성 정의 타입
 * @template TActions 액션 정의 타입
 * @template TAsyncActions 비동기 액션 정의 타입
 * @param store 미들웨어를 적용할 스토어
 * @param middlewares 적용할 미들웨어 배열
 * @returns 미들웨어가 적용된 스토어
 */
export function applyMiddlewares<
  TState extends Record<string, NonNullable<unknown>>,
  TComputed extends ComputedDef<TState>,
  TActions extends ActionsDef<TState>,
  TAsyncActions extends AsyncActionsDef<TState>,
>(
  store: StoreInternal<TState, TComputed, TActions, TAsyncActions>,
  middlewares: Middleware<TState>[],
): StoreInternal<TState, TComputed, TActions, TAsyncActions> {
  if (middlewares.length === 0) {
    return store;
  }

  try {
    // 원본 디스패치 함수 저장
    const originalDispatch = store.dispatch;

    // 미들웨어 체인 구성
    const chain = middlewares.map((middleware) => middleware(store));

    // 합성된 디스패치 함수 생성 및 설정
    store.dispatch = chain.reduceRight((composed, middleware) => middleware(composed), originalDispatch);

    return store;
  } catch (error) {
    return store; // 오류가 있어도 원본 스토어 반환
  }
}

/**
 * 스토어를 Redux DevTools에 연결하고 시간 여행 디버깅을 강화합니다.
 * @template TState 스토어 상태 타입
 * @template TComputed 계산된 속성 정의 타입
 * @template TActions 액션 정의 타입
 * @template TAsyncActions 비동기 액션 정의 타입
 * @param store DevTools에 연결할 스토어
 * @param name DevTools에 표시될 스토어 이름
 * @returns DevTools에 연결된 스토어
 */
export function connectDevTools<
  TState extends Record<string, NonNullable<unknown>>,
  TComputed extends ComputedDef<TState>,
  TActions extends ActionsDef<TState>,
  TAsyncActions extends AsyncActionsDef<TState>,
>(
  store: StoreInternal<TState, TComputed, TActions, TAsyncActions>,
  name: string,
): StoreInternal<TState, TComputed, TActions, TAsyncActions> {
  // 서버 환경이거나 DevTools가 설치되어 있지 않으면 원래 스토어 반환
  if (typeof window === 'undefined' || !window.__REDUX_DEVTOOLS_EXTENSION__) {
    return store;
  }

  try {
    // 액션 히스토리 관리를 위한 변수들
    let actionHistory: ActionHistoryItem[] = [];
    let nextActionId = 1;
    let isTimeTraveling = false;
    let currentActionId: number | null = null;

    // Redux DevTools 설정
    const devToolsConfig = {
      name,
      features: {
        jump: true,
        skip: true,
        reorder: true,
        dispatch: true,
        persist: true,
        trace: true,
        traceLimit: 50,
      },
      maxAge: 500,
      latency: 500,
    };

    // 연결 및 초기화
    let devTools;
    try {
      // Redux DevTools 인스턴스 생성
      devTools = window.__REDUX_DEVTOOLS_EXTENSION__.connect(devToolsConfig);

      // 초기 상태를 DevTools에 전송
      const initialState = store.getState();

      // 초기화 호출
      devTools.init(initialState);

      // 새로 추가: 초기 상태를 액션 히스토리에 추가
      const initialActionId = 0; // 초기 상태를 위한 특별한 ID 사용
      // 초기 상태 액션 생성
      const initialAction: Action = {
        type: '@@INIT',
        payload: undefined,
        meta: {
          timestamp: Date.now(),
          initialState: true,
        },
      };

      // 초기 상태를 히스토리에 추가
      const initialHistoryItem: ActionHistoryItem = {
        action: initialAction,
        timestamp: Date.now(),
        state: structuredClone(initialState),
        id: initialActionId,
      };

      // 액션 히스토리에 추가
      actionHistory = [initialHistoryItem];
      currentActionId = initialActionId;
    } catch (connectError) {
      throw new Error('Failed to connect to Redux DevTools: ' + (connectError as Error).message);
    }

    // 원래 dispatch 함수 저장
    const originalDispatch = store.dispatch;

    // 원본 setState 함수를 저장
    const originalSetState = store._setState;

    // 액션 히스토리에 액션 추가 함수
    const addToActionHistory = (action: Action, state: TState): void => {
      // 타임트래블 중이거나 타임트래블 액션인 경우 히스토리에 추가하지 않음
      if (isTimeTraveling || action.type === '[DevTools Time Travel]') {
        return;
      }

      const actionId = nextActionId++;
      currentActionId = actionId;

      let stateCopy;
      try {
        // structuredClone API는 JS 객체의 모든 타입을 완벽하게 복제
        stateCopy = structuredClone(state);
      } catch (err) {
        // 첫번째 폴백: JSON 직렬화/역직렬화
        try {
          const stateJson = JSON.stringify(state);
          stateCopy = JSON.parse(stateJson);
        } catch (jsonErr) {
          // 마지막 방법: 얕은 복사
          stateCopy = { ...state };
        }
      }

      const historyItem: ActionHistoryItem = {
        action,
        timestamp: Date.now(),
        state: stateCopy,
        id: actionId,
      };

      // 히스토리 상태 업데이트 (immutability 보장을 위해 새 배열 생성)
      actionHistory = [...actionHistory, historyItem];

      // 최대 500개 항목으로 제한
      if (actionHistory.length > 500) {
        actionHistory = actionHistory.slice(1);
      }
    };

    // dispatch 함수를 오버라이드하여 액션 감시 및 히스토리 저장
    store.dispatch = (action: Action): NonNullable<unknown> => {
      try {
        // 시간 측정 시작
        const startTime = performance.now();

        // 타임트래블 액션은 처리하되 히스토리에 기록하지 않음
        if (action.type === '[DevTools Time Travel]') {
          // 타임트래블 액션만 처리하고 결과 반환
          return originalDispatch(action);
        }

        // 일반 액션 처리 (타임트래블이 아닌 경우)
        const result = originalDispatch(action);

        // 디스패치 시간 계산
        const dispatchTime = performance.now() - startTime;

        // 현재 상태 가져오기
        const currentState = store.getState();

        // DevTools에 전송할 액션 준비 (간소화된 로직)
        const actionToSend = {
          ...action,
          meta: {
            ...(action.meta || {}),
            timestamp: Date.now(),
            dispatchTime,
          },
        };

        // 개발 환경에서 스택 트레이스 추가
        if (process.env.NODE_ENV === 'development') {
          try {
            // 타입 확장을 통해 stackTrace 속성 추가
            (actionToSend.meta as any).stackTrace = new Error().stack?.split('\n').slice(2).join('\n');
          } catch (e) {
            // 스택 트레이스 캡처 실패 무시
          }
        }

        // 액션 히스토리에 저장
        addToActionHistory(actionToSend, currentState);

        // DevTools에 액션 전송
        try {
          devTools.send(actionToSend, currentState);
        } catch (error) {
          // DevTools 전송 실패 무시
        }

        return result;
      } catch (error) {
        // 오류가 발생해도 원래 디스패치 함수 호출 보장
        return originalDispatch(action);
      }
    };

    // 특정 액션 ID로 이동하는 함수
    const jumpToAction = (actionId: number) => {
      // 이전 타임 트래블 상태 저장 (중첩 호출 처리용)
      const previousTimeTraveingState = isTimeTraveling;

      try {
        // 타임 트래블 모드 활성화
        isTimeTraveling = true;

        // 초기 상태 특별 처리 (actionId가 0인 경우)
        if (actionId === 0) {
          // 초기 상태 항목 찾기
          const initialHistoryItem = actionHistory.find((item) => item.id === 0);
          if (initialHistoryItem) {
            // 현재 액션 ID 업데이트
            currentActionId = 0;

            // 초기 상태 복원
            try {
              const initialState = structuredClone(initialHistoryItem.state);
              originalSetState(initialState);
              return; // 초기 상태 복원 성공시 종료
            } catch (initialError) {
              // 복원 실패시 계속 진행 (아래 일반 로직으로)
            }
          }
        }

        // 히스토리에서 해당 액션 찾기
        const historyItem = actionHistory.find((item) => item.id === actionId);
        if (!historyItem) {
          // 히스토리에 없는 경우 처리
          return;
        }

        // 현재 액션 ID 업데이트
        currentActionId = actionId;

        let stateToRestore;

        try {
          // 1. 구조적 클론 API 시도 (가장 안전하고 완전한 복사)
          stateToRestore = structuredClone(historyItem.state);
        } catch (cloneError) {
          try {
            // 2. JSON 직렬화/역직렬화 시도
            stateToRestore = JSON.parse(JSON.stringify(historyItem.state));
          } catch (jsonError) {
            // 3. 마지막 수단: 얕은 복사라도 시도
            stateToRestore = { ...historyItem.state };
          }
        }

        // 액션의 저장된 상태로 복원 (전체 상태를 한번에 업데이트)
        originalSetState(stateToRestore);
      } catch (error) {
        // 타임 트래블 오류 무시
      } finally {
        // 타임 트래블 플래그를 이전 상태로 복원 (중첩 호출 처리용)
        isTimeTraveling = previousTimeTraveingState;
      }
    };

    const deserializeState = (serializedState: string): TState => {
      if (!serializedState) {
        throw new Error('Invalid serialized state format: empty string');
      }

      const parsedState = JSON.parse(serializedState);

      if (!parsedState || typeof parsedState !== 'object') {
        throw new Error('Deserialized state is not an object');
      }

      return parsedState as TState;
    };

    // DevTools 메시지 구독
    devTools.subscribe((message: any) => {
      if (message.type === 'DISPATCH') {
        // 타임 트래블 명령 처리
        if (message.payload?.type === 'JUMP_TO_STATE' && message.state) {
          const previousTimeTraveingState = isTimeTraveling;
          try {
            isTimeTraveling = true;

            // Redux DevTools에서 제공한 JSON 문자열을 객체로 파싱
            let newState;
            try {
              newState = deserializeState(message.state);
            } catch (parseError) {
              throw new Error(`State parsing failed: ${(parseError as Error).message}`);
            }

            originalSetState(newState);
          } catch (error) {
          } finally {
            isTimeTraveling = previousTimeTraveingState;
          }
        } else if (message.payload?.type === 'JUMP_TO_ACTION') {
          const previousTimeTraveingState = isTimeTraveling;
          try {
            isTimeTraveling = true;

            const actionId = parseInt(message.payload.actionId, 10);

            if (!isNaN(actionId)) {
              jumpToAction(actionId);
            } else if (message.state) {
              const newState = deserializeState(message.state);
              originalSetState(newState);
            }
          } catch (error) {
          } finally {
            isTimeTraveling = previousTimeTraveingState;
          }
        } else if (message.payload?.type === 'DISPATCH' && message.payload.action) {
          try {
            const action = JSON.parse(message.payload.action);
            originalDispatch(action);
          } catch (error) {}
        }
      }
    });

    // 스토어에 디버깅 유틸리티 추가 (개발 환경에서만)
    if (process.env.NODE_ENV === 'development') {
      (store as any).__DEVTOOLS__ = {
        getActionHistory: () => [...actionHistory],
        jumpToAction,
        getCurrentActionId: () => currentActionId,
      };
    }
  } catch (error) {}

  return store;
}
