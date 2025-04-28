import { current, isDraft } from 'immer';
import { LRUCache } from './lruCache';
import { getObjectType, detectCycle, createVisitedMap, VisitedMap } from './objectTraversal'; // 경로 확인 필요

// 비교 결과를 캐싱하기 위한 LRU 캐시 시스템
// 키: 객체 쌍의 ID를 조합한 문자열, 값: 비교 결과

// 메모리 크기 기반 동적 캐시 사이즈 계산 (TypeScript 타입 호환성 개선)
function calculateCacheSize(): number {
  // 기본값: 중간 크기
  const DEFAULT_CACHE_SIZE = 500;
  const LOW_MEMORY_CACHE_SIZE = 200;
  const HIGH_MEMORY_CACHE_SIZE = 1000;

  try {
    // 브라우저 환경 확인
    if (typeof window === 'undefined') {
      return DEFAULT_CACHE_SIZE; // 비브라우저 환경
    }

    // 모바일 장치 감지 (User-Agent 기반 휴리스틱)
    const isMobileDevice =
      typeof navigator !== 'undefined' &&
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobileDevice) {
      return LOW_MEMORY_CACHE_SIZE; // 모바일 장치는 작은 캐시 사용
    }

    // 고사양 환경 감지 (메모리, 코어 수 등 대신 화면 크기 기반 휴리스틱)
    if (typeof window !== 'undefined' && window.screen) {
      const hasLargeScreen = window.screen.width > 1920 || window.screen.height > 1080;
      if (hasLargeScreen) {
        return HIGH_MEMORY_CACHE_SIZE; // 대형 화면은 고사양으로 간주
      }
    }
  } catch (e) {
    // 오류가 발생하면 기본값 사용
    console.debug('[Store] Error detecting environment, using default cache size');
  }

  // 기본값: 중간 크기
  return DEFAULT_CACHE_SIZE;
}

const COMPARE_CACHE_SIZE = calculateCacheSize();
const COMPARE_CACHE_TTL = 60000; // 캐시 유효 시간 (1분)

// LRU 캐시 인스턴스 생성 (자동 계산된 크기, 1분 TTL)
const compareCache = new LRUCache<string, boolean>(COMPARE_CACHE_SIZE, COMPARE_CACHE_TTL);

// 로깅 (개발 모드에서만)
if (process.env.NODE_ENV === 'development') {
  console.debug(`[Store] Compare cache initialized with size ${COMPARE_CACHE_SIZE}`);
}

// 객체 ID 맵을 생성하기 위한 WeakMap
const objectIdMap = new WeakMap<object, number>();
let nextObjectId = 1;

// 객체의 고유 ID 가져오기
function getObjectId(obj: object): number {
  if (!objectIdMap.has(obj)) {
    objectIdMap.set(obj, nextObjectId++);
  }
  return objectIdMap.get(obj) as number;
}

// 두 객체의 비교를 위한 캐시 키 생성
function createCacheKey(a: object, b: object): string {
  const idA = getObjectId(a);
  const idB = getObjectId(b);
  // ID 순서를 보장하여 캐시 키 일관성 유지
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
}

// 비교 깊이 제한으로 순환 참조 등에서 무한 재귀 방지
const MAX_COMPARE_DEPTH = 100;

/**
 * 객체의 모든 값을 비교하는 헬퍼 함수
 */
function compareObjectValues(
  objA: Record<string, unknown>,
  objB: Record<string, unknown>,
  keys: string[],
  depth: number,
  visited: VisitedMap, // VisitedMap 타입 사용
): boolean {
  for (const key of keys) {
    const valueA = objA[key];
    const valueB = objB[key];

    // 참조가 같으면 다음으로
    if (valueA === valueB) continue;

    // 재귀 호출 시 visited 전달
    if (!deepEqual(valueA, valueB, depth + 1, visited)) {
      return false;
    }
  }

  return true;
}

/**
 * 두 값의 깊은 동등성을 검사합니다.
 * 객체, 배열, 원시 타입, Date, Map, Set 등을 지원합니다.
 * Immer draft 객체 및 순환 참조를 처리합니다.
 * LRU 캐시를 사용하여 이전 비교 결과를 재활용합니다.
 * objectTraversal 유틸리티를 활용합니다.
 *
 * @param a 비교할 첫 번째 값
 * @param b 비교할 두 번째 값
 * @param depth 현재 비교 깊이 (내부용)
 * @param visited 이미 방문한 객체 쌍 (순환 참조 감지용) - VisitedMap 타입 사용
 * @returns 두 값이 동등하면 true, 그렇지 않으면 false
 */
export function deepEqual(
  a: unknown,
  b: unknown,
  depth = 0,
  visited: VisitedMap = createVisitedMap(), // 기본값으로 VisitedMap 생성
): boolean {
  // 1. 동일 참조인 경우 즉시 true 반환 (최적화된 early exit)
  if (a === b) return true;

  // 2. null이나 undefined 처리 (===에서 걸러지지 않은 경우)
  if (a == null || b == null) return false;

  // 3. 원시 타입이거나 타입이 다른 경우는 즉시 false 반환 (최적화된 early exit)
  const typeA = typeof a;
  const typeB = typeof b;

  // 둘 다 객체가 아니면 비교 (타입이 다르면 false)
  if (typeA !== 'object' || typeB !== 'object') return a === b;

  // 4. 깊이 제한을 초과한 경우 (무한 재귀 방지)
  if (depth > MAX_COMPARE_DEPTH) {
    console.warn('[Store] Max compare depth exceeded. Assuming objects are different.');
    return false; // 깊이 제한 초과시 다르다고 간주
  }

  // 5. Immer draft 객체인 경우 현재 상태로 추출
  const unwrappedA = isDraft(a) ? current(a) : a;
  const unwrappedB = isDraft(b) ? current(b) : b;

  // 6. Immer draft 해제 후 참조가 같은지 다시 확인
  if (unwrappedA === unwrappedB) return true;

  // 7. 객체 타입인데 해제 후 null이 된 경우
  if (unwrappedA == null || unwrappedB == null) return false;

  // 8. 순환 참조 감지 - objectTraversal 유틸리티 사용
  if (detectCycle(unwrappedA as object, unwrappedB as object, visited)) {
    // 순환 참조가 감지되면 이미 비교 중이거나 비교 완료된 쌍으로 간주
    // 현재 로직에서는 순환을 만나면 같다고 가정 (구현에 따라 다를 수 있음)
    // 또는 이전 비교 결과를 visited 맵에서 가져올 수도 있음 (detectCycle 수정 필요)
    return true;
  }

  // 캐시 확인 (LRU 캐시 사용) - 순환 참조 감지 후에 수행
  const cacheKey = createCacheKey(unwrappedA as object, unwrappedB as object);
  if (compareCache.has(cacheKey)) {
    return compareCache.get(cacheKey) as boolean;
  }

  let result: boolean; // 비교 결과를 저장할 변수

  // 9. 실제 비교 로직 - getObjectType 유틸리티 활용
  const objTypeA = getObjectType(unwrappedA);
  const objTypeB = getObjectType(unwrappedB);

  // 타입이 다르면 false
  if (objTypeA.type !== objTypeB.type) {
    result = false;
  } else {
    // 타입별 비교 로직
    switch (objTypeA.type) {
      case 'date':
        result = (unwrappedA as Date).getTime() === (unwrappedB as Date).getTime();
        break;
      case 'regexp':
        result = (unwrappedA as RegExp).toString() === (unwrappedB as RegExp).toString();
        break;
      case 'map': {
        const mapA = unwrappedA as Map<any, any>;
        const mapB = unwrappedB as Map<any, any>;
        if (mapA.size !== mapB.size) {
          result = false;
        } else {
          result = true; // 기본적으로는 같다고 가정
          for (const [key, valueA] of mapA.entries()) {
            if (!mapB.has(key) || !deepEqual(valueA, mapB.get(key), depth + 1, visited)) {
              result = false;
              break;
            }
          }
        }
        break;
      }
      case 'set': {
        const setA = unwrappedA as Set<any>;
        const setB = unwrappedB as Set<any>;
        if (setA.size !== setB.size) {
          result = false;
        } else {
          result = true; // 기본적으로는 같다고 가정
          if (setA.size === 0) {
            result = true; // 빈 Set은 항상 같음
          } else {
            // 모든 요소가 다른 Set에 deepEqual한지 확인
            // 효율성을 위해 Set B의 요소를 임시 배열이나 Map으로 변환 고려 가능
            const tempBValues = Array.from(setB);
            for (const itemA of setA) {
              const foundMatch = tempBValues.some((itemB) => deepEqual(itemA, itemB, depth + 1, visited));
              if (!foundMatch) {
                result = false;
                break;
              }
            }
          }
        }
        break;
      }
      case 'array': {
        const arrA = unwrappedA as any[];
        const arrB = unwrappedB as any[];
        if (arrA.length !== arrB.length) {
          result = false;
        } else {
          result = true; // 기본값
          if (arrA.length === 0) {
            result = true; // 빈 배열은 같음
          } else if (arrA.length < 20) {
            // 작은 배열 최적화
            for (let i = 0; i < arrA.length; i++) {
              if (!deepEqual(arrA[i], arrB[i], depth + 1, visited)) {
                result = false;
                break;
              }
            }
          } else if (
            // 원시 타입 배열 최적화
            arrA.every((item) => item === null || typeof item !== 'object') &&
            arrB.every((item) => item === null || typeof item !== 'object')
          ) {
            result = JSON.stringify(arrA) === JSON.stringify(arrB);
          } else {
            // 일반 배열 비교
            for (let i = 0; i < arrA.length; i++) {
              if (arrA[i] === arrB[i]) continue; // 참조 같으면 스킵
              if (!deepEqual(arrA[i], arrB[i], depth + 1, visited)) {
                result = false;
                break;
              }
            }
          }
        }
        break;
      }
      case 'object': {
        // 일반 객체 비교 (Plain Object)
        const objA = unwrappedA as Record<string, any>;
        const objB = unwrappedB as Record<string, any>;
        const keysA = Object.keys(objA);
        const keysB = Object.keys(objB);

        if (keysA.length !== keysB.length) {
          result = false;
        } else {
          if (keysA.length === 0) {
            result = true; // 빈 객체는 같음
          } else if (keysA.length < 10) {
            result = true;
            for (const key of keysA) {
              if (!Object.prototype.hasOwnProperty.call(objB, key)) {
                result = false;
                break;
              }
              if (!deepEqual(objA[key], objB[key], depth + 1, visited)) {
                result = false;
                break;
              }
            }
          } else {
            // 큰 객체 비교
            const keySetB = new Set(keysB);
            result = keysA.every((key) => keySetB.has(key));

            if (result) {
              result = compareObjectValues(objA, objB, keysA, depth, visited);
            }
          }
        }
        break;
      }
      default:
        // 에러, 프라미스, WeakMap, WeakSet 등 기타 특수 객체나 비교 불가능한 타입
        // 기본적으로 참조가 다르면 다른 것으로 간주
        result = false;
        break;
    }
  }

  // 10. 결과 캐싱 (LRU 캐시 사용)
  compareCache.set(cacheKey, result);

  // 순환 참조 감지 맵에서 현재 비교 쌍 제거 (다음 비교에 영향 없도록)
  // detectCycle 함수 내부에서 처리되므로 여기서는 필요 없을 수 있음 (구현 확인 필요)
  // visited.get(unwrappedA as object)?.delete(unwrappedB as object);

  return result;
}

/**
 * 두 객체 간의 구조적 변경을 빠르게 감지하는 유틸리티 함수
 * 키의 존재 여부와 객체 구조 변경에 초점을 맞춤
 * 이 함수는 objectTraversal 유틸리티를 직접 사용하지는 않음.
 *
 * @param currentState 현재 상태 객체
 * @param nextState 다음 상태 객체
 * @returns 구조적 변경이 있으면 true, 없으면 false
 */
export function detectStructuralChanges<T extends Record<string, any>>(
  currentState: T,
  nextState: Partial<T>,
): boolean {
  // 객체가 아니거나 null인 경우 즉시 처리
  if (
    currentState === null ||
    nextState === null ||
    typeof currentState !== 'object' ||
    typeof nextState !== 'object'
  ) {
    // 타입이 다르거나, 둘 중 하나만 null/객체가 아닌 경우 구조 변경으로 간주
    return typeof currentState !== typeof nextState || currentState !== nextState;
  }

  // 키 수 먼저 비교 (빠른 경로)
  const currentKeys = Object.keys(currentState);
  const nextKeys = Object.keys(nextState);

  if (currentKeys.length !== nextKeys.length) {
    return true;
  }

  // Map을 사용한 고속 키 존재 여부 확인 (키 수가 많은 경우)
  if (currentKeys.length > 10) {
    const nextKeySet = new Set(nextKeys);
    for (const key of currentKeys) {
      if (!nextKeySet.has(key)) {
        return true;
      }
    }
  } else {
    // 키 수가 적은 경우 직접 순회
    for (const key of currentKeys) {
      // nextState에 키가 없는 경우 구조 변경
      if (!Object.prototype.hasOwnProperty.call(nextState, key)) {
        return true;
      }
    }
  }

  // 중첩 객체 구조 비교 (1단계 깊이만)
  for (const key of currentKeys) {
    // nextState에 키가 없으면 위에서 이미 걸렀으므로 항상 존재한다고 가정 가능
    const currentValue = currentState[key];
    const nextValue = nextState[key as keyof typeof nextState]; // nextState는 Partial<T>일 수 있음

    const currentTypeInfo = getObjectType(currentValue);
    const nextTypeInfo = getObjectType(nextValue);

    // 타입이 다르면 구조 변경 (예: 객체 -> 배열)
    if (currentTypeInfo.type !== nextTypeInfo.type) {
      return true;
    }

    // 둘 다 배열인 경우 길이 비교
    if (currentTypeInfo.type === 'array') {
      if ((currentValue as any[]).length !== (nextValue as any[]).length) {
        return true;
      }
      // 배열 내용은 deepEqual에서 비교하므로 여기서는 길이만 확인
      continue;
    }

    if (currentTypeInfo.type === 'object') {
      const oldInnerKeys = Object.keys(currentValue as object);
      const newInnerKeys = Object.keys(nextValue as object);

      if (oldInnerKeys.length !== newInnerKeys.length) {
        return true;
      }

      if (oldInnerKeys.length > 10) {
        const newInnerKeySet = new Set(newInnerKeys);
        if (oldInnerKeys.some((k) => !newInnerKeySet.has(k))) {
          return true;
        }
      } else {
        if (oldInnerKeys.some((k) => !Object.prototype.hasOwnProperty.call(nextValue, k))) {
          return true;
        }
      }
    }
    // 다른 타입(Map, Set 등)은 값 비교는 deepEqual에 맡기고 여기서는 구조(타입)만 확인
  }

  // 위 모든 검사를 통과하면 구조적 변경 없음
  return false;
}
