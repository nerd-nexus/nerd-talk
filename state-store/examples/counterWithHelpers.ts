import { counterStore } from './counter';
import { unwrap, getAsyncStatus } from '../utils/asyncHelpers';

// unwrap 사용 - 성공과 실패 단순화
async function fetchCountWithUnwrap() {
  try {
    // 성공 시 바로 state 객체를 받을 수 있음, 실패 시 예외 발생
    const state = await unwrap(counterStore.asyncActions.syncFromServerCount());
    console.log('서버에서 가져온 카운트:', state.count);
  } catch (error) {
    console.error('카운트 가져오기 실패:', error);
  }
}

// getAsyncStatus 사용 - 읽기 쉬운 비동기 상태
function renderCounterWithStatus() {
  const { isLoading, isError, isSuccess, errorMessage } = getAsyncStatus(
    counterStore.asyncState.syncFromServerCount,
  );

  if (isLoading) {
    return '로딩 중...';
  }

  if (isError) {
    return `오류 발생: ${errorMessage}`;
  }

  if (isSuccess) {
    return `카운트: ${counterStore.count}`;
  }

  return '데이터를 불러오지 않았습니다.';
}

// 모든 헬퍼 함수를 사용하는 예제 프로세스
async function runCompleteProcess() {
  console.log('초기 카운트:', counterStore.count);

  // 서버에서 카운트 가져오기 - unwrap 사용
  await fetchCountWithUnwrap();

  // 현재 상태 확인
  console.log(renderCounterWithStatus());
}

export { fetchCountWithUnwrap, renderCounterWithStatus, runCompleteProcess };
