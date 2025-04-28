import { StoreBuilder } from './internal/StoreBuilder.ts';

/**
 * 스토어 생성을 시작하는 함수 (빌더 패턴 진입점)
 * @template TState 스토어의 상태(State) 타입 (객체여야 함)
 *
 * @warning 서버 사이드 렌더링(SSR) 환경에서 사용 시 주의사항:
 * 이 스토어를 서버에서 싱글톤으로 사용하지 마세요.
 * 서버에서 생성된 스토어를 다수의 요청에서 공유하면 상태가 요청 간에 섞여서
 * 데이터 유출이나 예기치 않은 동작이 발생할 수 있습니다.
 *
 * @example
 * // ❌ 잘못된 사용법 (서버에서 위험한 싱글톤 패턴):
 * // appStore.ts
 * let storeInstance: Store<AppState> | null = null;
 *
 * export function getAppStore() {
 *   if (!storeInstance) {
 *     storeInstance = createStore<AppState>()
 *       .initialState({ count: 0, user: null })
 *       .build();
 *   }
 *   return storeInstance;
 * }
 *
 * // ✅ 올바른 사용법 (서버 환경 감지하여 방어 코딩):
 * // appStore.ts
 * const isServer = typeof window === 'undefined';
 * let clientStoreInstance: Store<AppState> | null = null;
 *
 * export function getAppStore(initialData?: Partial<AppState>) {
 *   // 서버 환경에서는 항상 새 인스턴스 생성
 *   if (isServer) {
 *     return createStore<AppState>()
 *       .initialState({
 *         count: 0,
 *         user: null,
 *         ...initialData
 *       })
 *       .build();
 *   }
 *
 *   // 클라이언트에서만 싱글톤 패턴 사용
 *   if (!clientStoreInstance) {
 *     clientStoreInstance = createStore<AppState>()
 *       .initialState({
 *         count: 0,
 *         user: null,
 *         ...initialData
 *       })
 *       .build();
 *   }
 *
 *   return clientStoreInstance;
 * }
 *
 * // 사용 예시:
 * // 서버 측 API 핸들러
 * function handleApiRequest(req, res) {
 *   const userStore = getAppStore({ user: req.user }); // 매번 새 인스턴스 생성
 *   // ...로직 처리 후 응답
 * }
 */
export function createStore<TState extends Record<string, any>>(): StoreBuilder<TState> {
  return new StoreBuilder<TState>();
}
