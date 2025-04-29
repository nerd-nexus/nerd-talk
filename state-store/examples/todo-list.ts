import { ActionResult, ActionsDef, ComputedDef } from '../core/types/public-types';
import { createLogger } from '../core/middlewares/createLogger';
import { createStore } from '../core/createStore';
import { fx } from '@fxts/core';

// Todo 아이템 타입
interface Todo {
  id: number;
  text: string;
  completed: boolean;
  createdAt: Date;
}

// 필터 아이템 타입
interface FilterItem {
  id: string;
  name: string;
  predicate: (todo: Todo) => boolean;
}

// 할 일 목록 스토어 상태 타입
interface TodoState {
  todos: Todo[];
  filters: FilterItem[];
  currentFilter: string;
  nextId: number;
}

// 할 일 목록 스토어 계산된 상태 타입
interface TodoComputedDef extends Omit<ComputedDef<TodoState>, 'currentFilterItem'> {
  filteredTodos: (state: TodoState) => Todo[];
  activeCount: (state: TodoState) => number;
  completedCount: (state: TodoState) => number;
  totalCount: (state: TodoState) => number;
  allCompleted: (state: TodoState) => boolean;
  summary: (state: TodoState) => string;
  availableFilters: (state: TodoState) => string[];
}

// 할 일 목록 스토어 액션 타입
interface TodoActionsDef extends ActionsDef<TodoState> {
  addTodo: (text: string) => ActionResult<TodoState>;
  removeTodo: (id: number) => ActionResult<TodoState>;
  updateTodoText: (id: number, text: string) => ActionResult<TodoState>;
  toggleTodo: (id: number) => ActionResult<TodoState>;
  toggleAll: () => ActionResult<TodoState>;
  clearCompleted: () => ActionResult<TodoState>;
  setFilter: (filterId: string) => ActionResult<TodoState>;
  addFilter: (id: string, name: string, predicate: (todo: Todo) => boolean) => ActionResult<TodoState>;
  removeFilter: (id: string) => ActionResult<TodoState>;
}

// 초기 상태 로드
const loadInitialState = (): TodoState => {
  return {
    todos: [],
    filters: [
      { id: 'all', name: '전체', predicate: () => true },
      { id: 'active', name: '미완료', predicate: (todo: Todo) => !todo.completed },
      { id: 'completed', name: '완료', predicate: (todo: Todo) => todo.completed },
    ],
    currentFilter: 'all',
    nextId: 1,
  };
};

// 할 일 목록 스토어 예제
// 할 일 목록의 추가, 변경, 삭제 기능을 제공하는 스토어입니다.
export const todoStore = createStore<TodoState>()
  .initialState(loadInitialState())
  .computed<TodoComputedDef>({
    // 사용 가능한 필터 목록
    availableFilters: (state) => {
      return fx(state.filters)
        .map((filter) => filter.id)
        .toArray();
    },

    // 필터링된 할 일 목록
    filteredTodos: (state) => {
      // 현재 필터 찾기
      const currentFilter = state.filters.find((f) => f.id === state.currentFilter);
      // 필터가 없으면 모든 할 일 반환
      if (!currentFilter) return state.todos;

      // 필터 조건 적용
      return fx(state.todos).filter(currentFilter.predicate).toArray();
    },

    // 활성(미완료) 할 일 개수
    activeCount: (state) =>
      fx(state.todos)
        .filter((todo) => !todo.completed)
        .toArray().length,

    // 완료된 할 일 개수
    completedCount: (state) =>
      fx(state.todos)
        .filter((todo) => todo.completed)
        .toArray().length,

    // 총 할 일 개수
    totalCount: (state) => state.todos.length,

    // 모든 할 일이 완료되었는지 여부
    allCompleted: (state) => state.todos.length > 0 && fx(state.todos).every((todo) => todo.completed),

    // 요약 정보
    summary: (state) => {
      const active = fx(state.todos)
        .filter((todo) => !todo.completed)
        .toArray().length;
      const total = state.todos.length;
      return `${active} 항목 남음 / 총 ${total} 항목`;
    },
  })
  .actions<TodoActionsDef>({
    // 할 일 추가
    addTodo: (text: string) => (state) => {
      if (!text.trim()) return {}; // 빈 텍스트는 무시

      const newTodo: Todo = {
        id: state.nextId,
        text: text.trim(),
        completed: false,
        createdAt: new Date(),
      };

      return {
        todos: [...state.todos, newTodo],
        nextId: state.nextId + 1,
      };
    },

    // 할 일 제거
    removeTodo: (id: number) => (state) => ({
      todos: state.todos.filter((todo) => todo.id !== id),
    }),

    // 할 일 내용 수정
    updateTodoText: (id: number, text: string) => (state) => ({
      todos: state.todos.map((todo) => (todo.id === id ? { ...todo, text: text.trim() } : todo)),
    }),

    // 할 일 완료 상태 토글
    toggleTodo: (id: number) => (state) => ({
      todos: state.todos.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo)),
    }),

    // 모든 할 일 완료 상태 토글
    toggleAll: () => (state) => {
      const allCompleted = state.todos.every((todo) => todo.completed);
      return {
        todos: state.todos.map((todo) => ({
          ...todo,
          completed: !allCompleted,
        })),
      };
    },

    // 완료된 할 일 모두 제거
    clearCompleted: () => (state) => ({
      todos: state.todos.filter((todo) => !todo.completed),
    }),

    // 필터 변경
    setFilter: (filterId: string) => (state) => {
      // 존재하는 필터인지 확인
      if (!state.filters.some((filter) => filter.id === filterId)) {
        return {}; // 존재하지 않는 필터는 무시
      }

      return {
        currentFilter: filterId,
      };
    },

    // 새 필터 추가
    addFilter: (id: string, name: string, predicate: (todo: Todo) => boolean) => (state) => {
      // 이미 존재하는 ID면 추가하지 않음
      if (state.filters.some((filter) => filter.id === id)) {
        return {};
      }

      return {
        filters: [...state.filters, { id, name, predicate }],
      };
    },

    // 필터 제거
    removeFilter: (id: string) => (state) => {
      // 기본 필터('all', 'active', 'completed')는 제거할 수 없음
      if (['all', 'active', 'completed'].includes(id)) {
        return {};
      }

      // 현재 선택된 필터를 제거하는 경우, 'all' 필터로 변경
      const newState: Partial<TodoState> = {
        filters: state.filters.filter((filter) => filter.id !== id),
      };

      if (state.currentFilter === id) {
        newState.currentFilter = 'all';
      }

      return newState;
    },
  })
  .middleware([createLogger()])
  .devTool('Todo List Example')
  .build();

// 사용 예시:

// 스토어 변경 구독 예제
const unsubscribe = todoStore.subscribe(() => {
  console.log('할 일 목록이 변경되었습니다:', todoStore.todos);
});

// 특정 상태 변경 구독 예제
const unsubscribeFilter = todoStore.subscribeState(
  (state) => state.currentFilter,
  (newFilter, oldFilter) => {
    console.log(`필터가 ${oldFilter} → ${newFilter}로 변경되었습니다.`);
  },
);

// 할 일 추가
todoStore.actions.addTodo('우유 사기');
todoStore.actions.addTodo('이메일 확인하기');
todoStore.actions.addTodo('보고서 작성하기');

// 할 일 완료 표시
todoStore.actions.toggleTodo(1); // '우유 사기' 완료됨

// 할 일 수정
todoStore.actions.updateTodoText(2, '급한 이메일 확인하기');

// 필터 변경
todoStore.actions.setFilter('active');
console.log(todoStore.computed.filteredTodos);

// 커스텀 필터 추가 예시
todoStore.actions.addFilter('high-priority', '우선순위 높음', (todo) => todo.text.includes('급한'));

// 커스텀 필터 적용
todoStore.actions.setFilter('high-priority');
console.log(todoStore.computed.filteredTodos); // "급한"이 포함된 할 일만 표시

// 요약 정보 확인
console.log(todoStore.computed.summary); // "2 항목 남음 / 총 3 항목"

// 모든 항목 완료로 표시
todoStore.actions.toggleAll();
console.log(todoStore.computed.allCompleted); // true

// 완료된 항목 모두 제거
todoStore.actions.clearCompleted();
console.log(todoStore.computed.totalCount); // 0

const processBatchedTodos = async (todos: Todo[], concurrencyLimit = 3) => {
  // 각 할 일 항목을 비동기적으로 처리하는 예제 (실제로는 서버 API 호출 등을 수행)
  const processTodoAsync = async (todo: Todo): Promise<Todo> => {
    // 실제 비동기 처리를 시뮬레이션 (1초 지연)
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return { ...todo, text: `처리됨: ${todo.text}` };
  };

  console.log('병렬 처리 시작 (최대 동시 실행 수:', concurrencyLimit, ')');
  const startTime = Date.now();

  // fx와 concurrent를 사용한 병렬 처리
  const processedTodos = await fx(todos)
    .toAsync()
    .map(processTodoAsync)
    .concurrent(concurrencyLimit) // 최대 concurrencyLimit개의 작업 동시 실행
    .toArray();

  console.log('병렬 처리 완료, 소요 시간:', (Date.now() - startTime) / 1000, '초');
  return processedTodos;
};

// 테스트용 할 일 목록 생성
const testTodos = Array.from({ length: 10 }, (_, i) => ({
  id: i + 100,
  text: `테스트 할일 ${i + 1}`,
  completed: false,
  createdAt: new Date(),
}));

processBatchedTodos(testTodos, 3).then((result) => console.log('처리 결과:', result));

// 구독 해제
unsubscribe();
unsubscribeFilter();
