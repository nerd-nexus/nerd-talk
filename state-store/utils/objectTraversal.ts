/**
 * 객체 순회 및 처리를 위한 공통 유틸리티 함수들
 * 다양한 컴포넌트에서 객체 비교, 의존성 추적 등에 활용
 */

/**
 * 객체 순환 참조 감지를 위한 방문 기록 맵 타입
 * WeakMap을 사용하여 메모리 누수 방지
 */
export type VisitedMap = WeakMap<object, WeakMap<object, boolean>>;

/**
 * 새로운 방문 기록 맵 생성
 */
export function createVisitedMap(): VisitedMap {
  return new WeakMap<object, WeakMap<object, boolean>>();
}

/**
 * 객체 사이클(순환 참조) 감지
 * @param obj1 첫 번째 객체
 * @param obj2 두 번째 객체
 * @param visited 방문 기록 맵
 * @returns 순환 참조 감지 여부
 */
export function detectCycle(obj1: object, obj2: object, visited: VisitedMap): boolean {
  // 방문 맵 초기화
  if (!visited.has(obj1)) {
    visited.set(obj1, new WeakMap<object, boolean>());
  }

  const innerMap = visited.get(obj1);
  if (!innerMap) return false;

  // 이미 방문한 쌍인지 확인
  if (innerMap.has(obj2)) {
    return true;
  }

  // 현재 경로 기록
  innerMap.set(obj2, true);
  return false;
}

/**
 * 객체 타입 확인 - 특수한 객체 타입 감지
 * @param obj 확인할 객체
 * @returns 객체 타입 정보
 */
export function getObjectType(obj: any): {
  isSpecialObject: boolean;
  type: string;
} {
  if (obj === null || typeof obj !== 'object') {
    return { isSpecialObject: false, type: typeof obj };
  }

  // 특수 객체 타입 확인
  if (obj instanceof Date) return { isSpecialObject: true, type: 'date' };
  if (obj instanceof RegExp) return { isSpecialObject: true, type: 'regexp' };
  if (obj instanceof Error) return { isSpecialObject: true, type: 'error' };
  if (obj instanceof Promise) return { isSpecialObject: true, type: 'promise' };
  if (obj instanceof Map) return { isSpecialObject: true, type: 'map' };
  if (obj instanceof Set) return { isSpecialObject: true, type: 'set' };
  if (obj instanceof WeakMap) return { isSpecialObject: true, type: 'weakmap' };
  if (obj instanceof WeakSet) return { isSpecialObject: true, type: 'weakset' };
  if (Array.isArray(obj)) return { isSpecialObject: true, type: 'array' };

  // 일반 객체
  return { isSpecialObject: false, type: 'object' };
}
