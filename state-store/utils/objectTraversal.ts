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

/**
 * 객체를 안전하게 경로로 변환
 * @param basePath 기본 경로
 * @param key 현재 키
 * @returns 정규화된 경로 문자열
 */
export function createNormalizedPath(basePath: string, key: string): string {
  // 숫자 키인 경우 배열 인덱스 표기법 사용
  const isNumericKey = /^\d+$/.test(key);

  if (!basePath) {
    // 루트 레벨에서는 숫자 키도 그대로 사용
    return key;
  }

  if (isNumericKey) {
    // 배열 인덱스 표기법 사용: 'items.0' -> 'items[0]'
    return `${basePath}[${key}]`;
  } else {
    // 일반 속성은 점 표기법 사용
    return `${basePath}.${key}`;
  }
}

/**
 * 안전한 속성 디스크립터 가져오기
 * @param obj 대상 객체
 * @param key 속성 키
 * @returns 속성 디스크립터 (없으면 undefined)
 */
export function safeGetPropertyDescriptor(obj: any, key: string): PropertyDescriptor | undefined {
  if (obj === null || typeof obj !== 'object') return undefined;

  return Object.getOwnPropertyDescriptor(obj, key);
}

/**
 * 안전한 객체 깊이 제한 적용
 * @param depth 현재 깊이
 * @param maxDepth 최대 깊이
 * @returns 깊이 제한 초과 여부
 */
export function isDepthLimitExceeded(depth: number, maxDepth: number): boolean {
  return depth > maxDepth;
}
