import { current, isDraft } from 'immer';
import { LRUCache } from './lruCache';
import { getObjectType, detectCycle, createVisitedMap, VisitedMap } from './objectTraversal'; // 경로 확인 필요
import { calculateCacheSizeByDevice, isDevelopment } from './env';

function calculateCacheSize(): number {
  // 환경 감지 유틸리티 사용
  return calculateCacheSizeByDevice({
    defaultSize: 500,
    lowEndSize: 200,
    highEndSize: 1000,
  });
}

const COMPARE_CACHE_SIZE = calculateCacheSize();
const COMPARE_CACHE_TTL = 60000; // 캐시 유효 시간 (1분)

// LRU 캐시 인스턴스 생성 (자동 계산된 크기, 1분 TTL)
const compareCache = new LRUCache<string, boolean>(COMPARE_CACHE_SIZE, COMPARE_CACHE_TTL);

// 로깅 (개발 모드에서만)
if (isDevelopment) {
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
  // null이 아님이 보장되므로 기본값 제공
  return objectIdMap.get(obj) ?? nextObjectId++;
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

  // unwrapped 값이 객체임을 확인하고 타입 단언
  const objectA = unwrappedA as object;
  const objectB = unwrappedB as object;

  // 8. 순환 참조 감지 - objectTraversal 유틸리티 사용
  if (detectCycle(objectA, objectB, visited)) {
    // 순환 참조가 감지되면 이미 비교 중이거나 비교 완료된 쌍으로 간주
    // 현재 로직에서는 순환을 만나면 같다고 가정 (구현에 따라 다를 수 있음)
    // 또는 이전 비교 결과를 visited 맵에서 가져올 수도 있음 (detectCycle 수정 필요)
    return true;
  }

  // 캐시 확인 (LRU 캐시 사용) - 순환 참조 감지 후에 수행
  const cacheKey = createCacheKey(objectA, objectB);
  if (compareCache.has(cacheKey)) {
    // null이 아님이 보장됨 - 기본값으로 false 제공
    return compareCache.get(cacheKey) ?? false;
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
        const mapA = unwrappedA as Map<unknown, unknown>;
        const mapB = unwrappedB as Map<unknown, unknown>;
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
        const setA = unwrappedA as Set<unknown>;
        const setB = unwrappedB as Set<unknown>;

        // 크기가 다르면 빠르게 false 반환
        if (setA.size !== setB.size) {
          result = false;
          break;
        }

        // 빈 Set은 항상 같음
        if (setA.size === 0) {
          result = true;
          break;
        }

        // 원시 타입만 있는지 확인 (최적화를 위함)
        let allPrimitives = true;
        // 작은 샘플로 원시 타입만 있는지 빠르게 확인
        const sampleA = Array.from(setA).slice(0, 3);
        for (const item of sampleA) {
          if (item !== null && typeof item === 'object') {
            allPrimitives = false;
            break;
          }
        }

        if (allPrimitives) {
          // 원시 타입만 있다면 String 변환 후 간단히 비교할 수 있음
          // (모든 항목이 원시 타입이면 이 방법이 훨씬 빠름)
          const stringSetB = new Set(Array.from(setB).map((item) => String(item)));
          result = Array.from(setA).every((item) => stringSetB.has(String(item)));
        } else {
          const bValues = Array.from(setB);
          const matchedIndices = new Set<number>();

          result = true;
          for (const itemA of setA) {
            let matched = false; // 매치 여부 플래그

            if (itemA === null || typeof itemA !== 'object') {
              for (let i = 0; i < bValues.length; i++) {
                if (matchedIndices.has(i)) continue;
                if (bValues[i] === itemA) {
                  matchedIndices.add(i);
                  matched = true;
                  break;
                }
              }
            } else {
              for (let i = 0; i < bValues.length; i++) {
                if (matchedIndices.has(i)) continue;

                const itemB = bValues[i];
                if (itemB === null || typeof itemA !== typeof itemB) {
                  continue;
                }

                if (deepEqual(itemA, itemB, depth + 1, visited)) {
                  matchedIndices.add(i);
                  matched = true;
                  break;
                }
              }
            }

            if (!matched) {
              result = false;
              break;
            }
          }
        }

        break;
      }
      case 'array': {
        const arrA = unwrappedA as unknown[];
        const arrB = unwrappedB as unknown[];
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
        const objA = unwrappedA as Record<string, unknown>;
        const objB = unwrappedB as Record<string, unknown>;
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
              if (!Object.hasOwn(objB, key)) {
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

  return result;
}

/**
 * 두 객체 간의 구조적 변경을 빠르게 감지하는 유틸리티 함수
 * 키의 존재 여부와 객체 구조 변경에 초점을 맞추며 값 비교는 하지 않음
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

  // 단일 깊이 구조 검사를 위한 최적화된 함수
  return hasStructuralDifferences(currentState, nextState);
}

/**
 * 두 객체 간의 구조적 차이를 검사하는 내부 헬퍼 함수
 * 성능을 위해 최적화되었으며 값 비교는 수행하지 않음
 *
 * @param current 현재 객체
 * @param next 다음 객체
 * @returns 구조적 차이가 있으면 true, 없으면 false
 */
function hasStructuralDifferences(current: unknown, next: unknown): boolean {
  // 기본 타입 체크
  const currentType = getObjectType(current);
  const nextType = getObjectType(next);

  // 타입이 다르면 구조적 차이 있음
  if (currentType.type !== nextType.type) {
    return true;
  }

  // 객체 타입별 처리
  switch (currentType.type) {
    case 'array':
      // 배열은 길이만 비교
      return (current as unknown[]).length !== (next as unknown[]).length;

    case 'object': {
      // 객체는 키 비교
      const currentKeys = Object.keys(current as Record<string, unknown>);
      const nextKeys = Object.keys(next as Record<string, unknown>);

      // 키 개수가 다르면 구조적 차이 있음
      if (currentKeys.length !== nextKeys.length) {
        return true;
      }

      // 키 존재 여부 검사 (최적화)
      if (currentKeys.length > 10) {
        const nextKeySet = new Set(nextKeys);
        return currentKeys.some((key) => !nextKeySet.has(key));
      } else {
        return currentKeys.some((key) => !Object.hasOwn(next as object, key));
      }
    }

    case 'map':
      // Map은 크기만 비교
      return (current as Map<unknown, unknown>).size !== (next as Map<unknown, unknown>).size;

    case 'set':
      // Set은 크기만 비교
      return (current as Set<unknown>).size !== (next as Set<unknown>).size;

    default:
      // 다른 타입(Date, RegExp 등)은 인스턴스 비교만 수행
      return false; // 이미 타입 체크를 통과했으므로 구조적으로는 같다고 간주
  }
}
