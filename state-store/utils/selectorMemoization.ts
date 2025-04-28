import { LRUCache } from './lruCache';
import { deepEqual } from './compare';

/**
 * 메모이제이션 옵션 인터페이스
 */
export interface MemoizationOptions {
  /** 캐시 최대 크기 */
  cacheSize?: number;
  /** 캐시 유효 시간 (밀리초) */
  ttl?: number;
  /** 비교 함수를 커스터마이즈할 수 있음 */
  equalityFn?: <T>(a: T, b: T) => boolean;
  /** 인수 변환 함수 (복잡한 인수를 캐시 키로 변환) */
  keySelector?: (...args: any[]) => string;
}

/**
 * 제너릭 메모이제이션 구현
 * 함수 호출 결과를 캐싱하여 성능을 최적화합니다.
 *
 * @param fn 메모이제이션할 함수
 * @param options 메모이제이션 옵션
 * @returns 메모이제이션된 함수
 */
export function memoize<T extends (...args: any[]) => any>(fn: T, options: MemoizationOptions = {}): T {
  const { cacheSize = 100, ttl, equalityFn = deepEqual, keySelector } = options;

  // LRU 캐시 생성
  const cache = new LRUCache<
    string,
    {
      result: ReturnType<T>;
      args: Parameters<T>;
    }
  >(cacheSize, ttl);

  // 메모이제이션된 함수
  const memoized = function (this: any, ...args: Parameters<T>): ReturnType<T> {
    // 1. 캐시 키 생성
    const cacheKey = keySelector ? keySelector(...args) : generateCacheKey(args);

    // 2. 캐시된 결과 확인
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey)!;

      // 3. 인수가 동일한지 확인 (깊은 비교)
      if (args.length === cached.args.length) {
        let argsEqual = true;

        for (let i = 0; i < args.length; i++) {
          if (!equalityFn(args[i], cached.args[i])) {
            argsEqual = false;
            break;
          }
        }

        if (argsEqual) {
          return cached.result;
        }
      }
    }

    // 4. 캐시 미스: 함수 실행 및 결과 캐싱
    const result = fn.apply(this, args);
    cache.set(cacheKey, {
      result,
      args: args as unknown as Parameters<T>, // 타입 단언으로 타입 오류 해결
    });
    return result;
  };

  // 원본 함수의 속성 보존
  Object.defineProperties(memoized, {
    length: { value: fn.length },
    name: { value: `memoized(${fn.name || 'anonymous'})` },
  });

  // 캐시 관리 메서드 추가
  (memoized as any).clearCache = () => cache.clear();
  (memoized as any).getCacheSize = () => cache.size;
  (memoized as any).isMemoized = true;

  return memoized as T;
}

/**
 * 셀렉터 메모이제이션 옵션 인터페이스
 */
export interface SelectorOptions extends MemoizationOptions {
  /** 종속성 추적 여부 */
  trackDependencies?: boolean;
}

/**
 * 상태 셀렉터 메모이제이션
 * 상태 셀렉터 함수의 결과를 캐싱하고, 의존성을 자동으로 추적합니다.
 *
 * @param selector 메모이제이션할 셀렉터 함수
 * @param options 셀렉터 메모이제이션 옵션
 * @returns 메모이제이션된 셀렉터 함수
 */
export function createSelector<State, Result>(
  selector: (state: State, ...args: any[]) => Result,
  options: SelectorOptions = {},
): (state: State, ...args: any[]) => Result {
  const { cacheSize = 100, ttl, equalityFn = deepEqual, trackDependencies = true } = options;

  // 의존성 추적 맵
  const dependencyMap = new WeakMap<object, Set<string>>();

  // 메모이제이션된 셀렉터
  const memoizedSelector = memoize(
    function (state: State, ...args: any[]): Result {
      // 의존성 추적이 활성화된 경우
      if (trackDependencies && typeof state === 'object' && state !== null) {
        // 의존성 추적을 위한 프록시 생성 (StateManager에서 사용하는 방식과 유사)
        const dependencies = new Set<string>();

        // 의존성 트래킹 함수 구현 (간소화된 버전, 실제 구현은 더 복잡할 수 있음)
        const trackedState = new Proxy(state as object, {
          get(target: any, prop: string | symbol) {
            if (typeof prop === 'string') {
              dependencies.add(prop);
            }
            return target[prop];
          },
        });

        // 셀렉터 실행
        const result = selector(trackedState as State, ...args);

        // 의존성 저장
        dependencyMap.set(state as object, dependencies);

        return result;
      }

      // 일반 실행 (의존성 추적 없음)
      return selector(state, ...args);
    },
    {
      cacheSize,
      ttl,
      equalityFn,
    },
  );

  // 의존성 관련 메서드 추가
  (memoizedSelector as any).getDependencies = (state: object) => {
    return dependencyMap.get(state) || new Set<string>();
  };

  // 특정 상태 변경에 대해 이 셀렉터가 영향을 받는지 확인하는 메서드
  (memoizedSelector as any).dependsOn = (state: object, changedKeys: Set<string> | string[]) => {
    const deps = dependencyMap.get(state);
    if (!deps) return false;

    const keysSet = changedKeys instanceof Set ? changedKeys : new Set(changedKeys);

    // 의존성 중 하나라도 변경된 키에 포함되어 있으면 true
    for (const dep of deps) {
      if (keysSet.has(dep)) return true;
    }

    return false;
  };

  return memoizedSelector as (state: State, ...args: any[]) => Result;
}

// 캐시 키 ID 생성을 위한 WeakMap 캐시 추가
const objectKeyCache = new WeakMap<object, string>();
let nextObjectKeyId = 1;

/**
 * 캐시 키를 생성하는 유틸리티 함수 (최적화 버전)
 * 호출 빈도가 높기 때문에 성능에 중요한 영향을 미침
 * 
 * @param args 인수 배열
 * @returns 캐시 키 문자열
 */
function generateCacheKey(args: any[]): string {
  // 빠른 경로: 인수가 없는 경우
  if (args.length === 0) return '__empty__';
  // 빠른 경로: 인수가 하나인 경우
  if (args.length === 1) return generateSingleArgKey(args[0]);
  
  // 빠른 경로: 원시 타입만 있는 간단한 인수의 경우 JSON 문자열로 변환
  let allPrimitives = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg !== null && arg !== undefined && typeof arg === 'object') {
      allPrimitives = false;
      break;
    }
  }
  
  if (allPrimitives) {
    return JSON.stringify(args);
  }

  // 결합된 키 생성을 위한 배열
  const keyParts: string[] = new Array(args.length);
  
  // 각 인수에 대한 키 부분 생성
  for (let i = 0; i < args.length; i++) {
    keyParts[i] = generateSingleArgKey(args[i]);
  }
  
  // 모든 키 부분을 결합하여 최종 키 생성
  return keyParts.join('||');
}

/**
 * 단일 인수에 대한 캐시 키를 생성
 * @param arg 단일 인수
 * @returns 캐시 키 문자열
 */
function generateSingleArgKey(arg: any): string {
  // null/undefined 처리
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  
  // 원시 타입은 직접 문자열화
  if (typeof arg !== 'object') return String(arg);
  
  // 객체의 경우 메모이제이션된 키 ID 사용
  if (objectKeyCache.has(arg)) {
    return objectKeyCache.get(arg) as string;
  }
  
  // 새 객체에 대한 키 생성
  let keyString: string;
  
  // 배열 처리
  if (Array.isArray(arg)) {
    if (arg.length === 0) {
      keyString = '[]';
    } else if (arg.length < 3) {
      // 작은 배열은 길이만 포함
      keyString = `[len:${arg.length}]`;
    } else {
      // 큰 배열은 길이와 해시 포함
      keyString = `[len:${arg.length}#${nextObjectKeyId++}]`;
    }
  } 
  // Date 객체 처리
  else if (arg instanceof Date) {
    keyString = `Date:${arg.getTime()}`;
  }
  // Map, Set 등 특수 객체 처리
  else if (arg instanceof Map || arg instanceof Set || 
           arg instanceof WeakMap || arg instanceof WeakSet) {
    keyString = `${arg.constructor.name}:${nextObjectKeyId++}`;
  }
  // 일반 객체 처리
  else {
    const keyCount = Object.keys(arg).length;
    keyString = `{keys:${keyCount}#${nextObjectKeyId++}}`;
  }
  
  // 생성된 키 캐싱
  objectKeyCache.set(arg, keyString);
  
  return keyString;
}
