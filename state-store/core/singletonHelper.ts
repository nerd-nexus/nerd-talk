import { isClient } from '../utils/env';

const SINGLETON_INSTANCES_HELPER = isClient ? new Map<string, any>() : null;

/**
 * 특정 스토어 정의에 대한 싱글톤 인스턴스를 가져옵니다.
 * 클라이언트에서는 캐시된 인스턴스를 반환하거나, 없으면 createInstanceFn을 실행하여 생성 후 캐시합니다.
 * 서버에서는 매번 createInstanceFn을 실행하여 새 인스턴스를 반환합니다.
 *
 * @param key 이 싱글톤 인스턴스를 식별할 고유한 문자열 키 (앱 전체에서 유일해야 함)
 * @param createInstanceFn 캐시에 인스턴스가 없을 때 호출될, 스토어 인스턴스를 생성하는 함수
 * @returns 해당 키에 대한 싱글톤 (또는 서버측 새) 스토어 인스턴스
 */
export function getSingletonStore<TStoreInstance>(
  key: string,
  createInstanceFn: () => TStoreInstance, // 인스턴스를 생성하는 함수를 인자로 받음
): TStoreInstance {
  // 서버 환경인 경우 (캐시 사용 안 함)
  if (!SINGLETON_INSTANCES_HELPER) {
    return createInstanceFn(); // 서버에서는 매번 새 인스턴스 생성
  }

  // 클라이언트 환경
  if (!SINGLETON_INSTANCES_HELPER.has(key)) {
    const instance = createInstanceFn(); // 캐시에 없으면 생성 함수 실행
    SINGLETON_INSTANCES_HELPER.set(key, instance); // 캐시에 저장

    if (typeof instance === 'object' && instance !== null) {
      Object.defineProperty(instance, '__singletonHelperId', { value: key, enumerable: false });
    }
  }

  // 캐시된 인스턴스 반환
  return SINGLETON_INSTANCES_HELPER.get(key) as TStoreInstance;
}

/**
 * 특정 싱글톤 스토어 인스턴스를 캐시에서 제거합니다. (메모리 관리 용이성)
 * @param key 제거할 싱글톤 인스턴스의 키
 */
export function cleanupSingletonStoreHelper(key: string): void {
  if (SINGLETON_INSTANCES_HELPER) {
    SINGLETON_INSTANCES_HELPER.delete(key);
  }
}

/**
 * 모든 싱글톤 스토어 인스턴스를 캐시에서 제거합니다. (전역 정리)
 */
export function cleanupAllSingletonStoresHelper(): void {
  if (SINGLETON_INSTANCES_HELPER) {
    SINGLETON_INSTANCES_HELPER.clear();
  }
}
