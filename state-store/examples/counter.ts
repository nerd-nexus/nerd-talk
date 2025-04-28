import {
  ActionResult,
  ActionsDef,
  AsyncActionsDef,
  AsyncResult,
  ComputedDef,
} from '../core/types/public-types';
import { createLogger } from '../core/middlewares/createLogger';
import { createStore } from '../core/createStore';

// 카운터 스토어 상태 타입 정의
interface CounterState {
  count: number;
}

// 카운터 스토어의 계산된 상태 타입 정의
interface CounterComputedDef extends ComputedDef<CounterState> {
  doubled: (state: CounterState) => number;
  isEven: (state: CounterState) => boolean;
  isPositive: (state: CounterState) => boolean;
  displayText: (state: CounterState) => string;
}

// 카운터 스토어의 액션 타입 정의
interface CounterActionsDef extends ActionsDef<CounterState> {
  increment: (amount?: number) => ActionResult<CounterState>;
  decrement: (amount?: number) => ActionResult<CounterState>;
  setValue: (value: number) => ActionResult<CounterState>;
  reset: () => ActionResult<CounterState>;
  double: () => ActionResult<CounterState>;
}

// 카운터 스토어의 비동기 액션 타입 정의
interface CounterAsyncActionsDef extends AsyncActionsDef<CounterState> {
  syncFromServerCount: (delay?: number) => Promise<AsyncResult<CounterState>>;
  saveCountToServer: (count?: number) => Promise<AsyncResult<CounterState>>;
  incrementAsync: (amount?: number) => Promise<AsyncResult<CounterState>>;
}

// 초기 상태 로드 함수 (실제로는 localStorage나 API 등에서 불러올 수 있음)
const loadInitialState = (): CounterState => {
  return { count: 0 };
};

// 카운터 스토어 예제
// 가장 기본적인 예제로, 카운터 값을 관리하는 스토어입니다.
export const counterStore = createStore<CounterState>()
  .initialState(loadInitialState())
  .computed<CounterComputedDef>({
    // 2배 값
    doubled: (state) => state.count * 2,

    // 짝수인지 여부
    isEven: (state) => state.count % 2 === 0,

    // 양수인지 여부
    isPositive: (state) => state.count > 0,

    // 표시용 텍스트
    displayText: (state) => `현재 카운트: ${state.count}`,
  })
  .actions<CounterActionsDef>({
    // 증가
    increment:
      (amount = 1) =>
      (state) => ({
        count: state.count + amount,
      }),

    // 감소
    decrement:
      (amount = 1) =>
      (state) => ({
        count: state.count - amount,
      }),

    // 특정 값으로 설정
    setValue: (value: number) => ({
      count: value,
    }),

    // 초기화
    reset: () => ({
      count: 0,
    }),

    // 두 배로 만들기
    double: () => (state) => ({
      count: state.count * 2,
    }),
  })
  .asyncActions<CounterAsyncActionsDef>({
    // 서버에서 카운트 값 동기화 (서버 API를 모방)
    async syncFromServerCount(delay = 1000): Promise<AsyncResult<CounterState>> {
      try {
        // 서버 통신을 시뮬레이션
        const serverCount = await new Promise<number>((resolve) => {
          setTimeout(() => {
            // 서버에서는 랜덤한 카운트 값을 반환한다고 가정
            resolve(Math.floor(Math.random() * 100));
          }, delay);
        });

        // 성공 시 상태 업데이트
        return {
          success: true,
          state: { count: serverCount },
        };
      } catch (error) {
        // 실패 시 에러 반환
        return {
          success: false,
          error:
            error instanceof Error ? error : new Error('서버에서 카운트를 가져오는 중 오류가 발생했습니다.'),
        };
      }
    },

    // 카운트 값을 서버에 저장 (서버 API를 모방)
    async saveCountToServer(count?: number): Promise<AsyncResult<CounterState>> {
      try {
        // 현재 상태를 사용하거나 인자로 받은 값을 사용
        const valueToSave = count !== undefined ? count : counterStore.count;

        // 서버 통신을 시뮬레이션
        const savedCount = await new Promise<number>((resolve, reject) => {
          setTimeout(() => {
            // 90% 확률로 성공, 10% 확률로 실패 시뮬레이션
            if (Math.random() > 0.1) {
              resolve(valueToSave);
            } else {
              reject(new Error('서버 오류가 발생했습니다.'));
            }
          }, 800);
        });

        console.log(savedCount);
        // 성공 시 상태는 바꾸지 않고 성공만 반환
        return {
          success: true,
          state: {}, // 상태는 변경하지 않음
        };
      } catch (error) {
        // 실패 시 에러 반환
        return {
          success: false,
          error:
            error instanceof Error ? error : new Error('카운트를 서버에 저장하는 중 오류가 발생했습니다.'),
        };
      }
    },

    // 비동기 증가 (지연 후 증가)
    async incrementAsync(amount = 1): Promise<AsyncResult<CounterState>> {
      try {
        // 지연 시뮬레이션
        await new Promise((resolve) => setTimeout(resolve, 500));

        // 성공 시 상태 업데이트
        return {
          success: true,
          state: { count: counterStore.count + amount },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error : new Error('비동기 증가 중 오류가 발생했습니다.'),
        };
      }
    },
  })
  .middleware([createLogger()])
  .devTool('Counter Example')
  .build();

// 사용 예시:

// 스토어 변경 구독 예제
const unsubscribe = counterStore.subscribe(() => {
  console.log('상태가 변경되었습니다:', counterStore.count);
});

// 특정 상태 변경 구독 예제
const unsubscribeCount = counterStore.subscribeState(
  (state) => state.count,
  (newCount, oldCount) => {
    console.log(`카운트가 ${oldCount} → ${newCount}로 변경되었습니다.`);
  },
);

// 증가/감소
counterStore.actions.increment(); // 0 -> 1
counterStore.actions.increment(5); // 1 -> 6
counterStore.actions.decrement(); // 6 -> 5
counterStore.actions.decrement(2); // 5 -> 3

// 값 설정
counterStore.actions.setValue(10); // 3 -> 10
counterStore.actions.double(); // 10 -> 20
counterStore.actions.reset(); // 20 -> 0

// 계산된 값 접근
const doubled = counterStore.computed.doubled; // count의 2배 값
const isEven = counterStore.computed.isEven; // 짝수인지 여부
const isPositive = counterStore.computed.isPositive; // 양수인지 여부
const displayText = counterStore.computed.displayText; // 표시용 텍스트

// 기본 값 접근
const count = counterStore.count; // 현재 카운트 값

console.log(doubled, isEven, isPositive, displayText, count);

// 구독 해제
unsubscribe();
unsubscribeCount();

// ===== 비동기 액션 사용 예시 =====

// 비동기 액션 실행 - 서버에서 카운트 값 가져오기
async function fetchCountFromServer() {
  console.log('서버에서 카운트 값을 가져오는 중...');

  // 비동기 액션 실행 전 상태 확인
  const syncState = counterStore.asyncState.syncFromServerCount;
  console.log('로딩 상태:', {
    pending: syncState.pending,
    error: syncState.error,
    loaded: syncState.loaded,
  });

  // 비동기 액션 실행
  const result = await counterStore.asyncActions.syncFromServerCount();
  // 결과 처리
  if (result.success) {
    console.log('서버에서 카운트 값을 성공적으로 가져왔습니다:', counterStore.count);
  } else {
    console.error('카운트 값을 가져오는 중 오류 발생:', result.error);
  }

  // 비동기 액션 실행 후 상태 확인
  const newState = counterStore.asyncState.syncFromServerCount;
  console.log('로딩 완료 상태:', {
    pending: newState.pending,
    error: newState.error,
    loaded: newState.loaded,
  });
}

// 비동기 액션 실행 - 서버에 카운트 값 저장하기
async function saveCountToServer() {
  console.log('현재 카운트 값을 서버에 저장하는 중...');

  // 비동기 액션 실행
  const result = await counterStore.asyncActions.saveCountToServer();

  // 결과 처리
  if (result.success) {
    console.log('카운트 값이 성공적으로 저장되었습니다.');
  } else {
    console.error('카운트 값을 저장하는 중 오류 발생:', result.error);
  }
}

// 비동기 증가 액션 예시
async function incrementAsyncExample() {
  console.log('비동기 증가 전 카운트:', counterStore.count);

  // 로딩 상태 구독
  const unsubscribePending = counterStore.subscribeState(
    () => counterStore.asyncState.incrementAsync.pending,
    (isPending) => {
      if (isPending) {
        console.log('증가 작업이 진행 중입니다...');
      } else {
        console.log('증가 작업이 완료되었습니다.');
      }
    },
  );

  // 비동기 액션 실행
  const result = await counterStore.asyncActions.incrementAsync(5);

  // 구독 해제
  unsubscribePending();

  // 결과 처리
  if (result.success) {
    console.log('비동기 증가 후 카운트:', counterStore.count);
  } else {
    console.error('비동기 증가 중 오류 발생:', result.error);
  }
}

// 비동기 작업을 순차적으로 실행하는 예시
export async function runAsyncExample() {
  try {
    // 초기화
    counterStore.actions.reset();
    console.log('초기화된 카운트:', counterStore.count);

    // 서버에서 카운트 가져오기
    await fetchCountFromServer();

    // 로컬에서 증가
    counterStore.actions.increment(10);
    console.log('로컬에서 증가 후 카운트:', counterStore.count);

    // 비동기 증가
    await incrementAsyncExample();

    // 서버에 저장
    await saveCountToServer();

    console.log('모든 비동기 작업이 완료되었습니다. 최종 카운트:', counterStore.count);
  } catch (error) {
    console.error('비동기 작업 중 오류 발생:', error);
  }
}
