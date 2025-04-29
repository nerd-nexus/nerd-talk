import { memoize } from '@fxts/core';
import { isSymbol } from './isSymbol.ts';

/**
 * 추가적인 메서드를 가진 메모이제이션된 셀렉터 인터페이스
 */
export interface EnhancedSelector<State, Result> {
  (state: State, ...args: any[]): Result;
  getDependencies(state: object): Set<string>;
  dependsOn(state: object, changedKeys: Set<string> | string[]): boolean;
}

/**
 * 상태 셀렉터 메모이제이션
 * 상태 셀렉터 함수의 결과를 캐싱하고, 의존성을 자동으로 추적합니다.
 *
 * @param selector 메모이제이션할 셀렉터 함수
 * @returns 메모이제이션된 셀렉터 함수
 */
export function createSelector<State, Result>(
  selector: (state: State, ...args: any[]) => Result,
): EnhancedSelector<State, Result> {
  // 의존성 추적 맵
  const dependencyMap = new WeakMap<object, Set<string>>();

  // 프록시 캐시: 동일한 객체에 대한 프록시 재생성 방지
  const proxyCache = new WeakMap<object, any>();

  // 미리 계산된 의존성 경로 확인 결과 캐시
  const pathRelationCache = new Map<string, boolean>();

  // 메모이제이션된 셀렉터
  const memoizedSelectorFn = memoize(function (state: State, ...args: any[]): Result {
    // 의존성 추적이 활성화된 경우
    if (typeof state === 'object' && state !== null) {
      // 의존성 추적을 위한 프록시 생성 (StateManager에서 사용하는 방식과 유사)
      const dependencies = new Set<string>();

      // 깊은 객체 추적을 위한 프록시 생성 함수
      const createDeepTrackingProxy = (target: any, path = ''): any => {
        // null이나 기본 자료형은 프록시로 감싸지 않음
        if (!target || typeof target !== 'object') {
          return target;
        }

        // Date, RegExp 등의 특수 객체 타입은 프록시로 감싸지 않음
        if (
          target instanceof Date ||
          target instanceof RegExp ||
          target instanceof Error ||
          ArrayBuffer.isView(target) ||
          typeof target === 'function' ||
          (target.constructor && target.constructor.name !== 'Object' && target.constructor.name !== 'Array')
        ) {
          return target;
        }

        // 캐시된 프록시가 있으면 재사용 (최적화)
        if (proxyCache.has(target)) {
          return proxyCache.get(target);
        }

        const proxy = new Proxy(target, {
          get(obj, prop: string | symbol) {
            // 시스템 속성은 직접 접근
            if (isSymbol(prop) || prop === '__proto__' || prop === 'constructor' || prop === 'prototype') {
              return Reflect.get(obj, prop);
            }

            // 문자열로 변환
            const key = String(prop);

            // 현재 경로 추적
            const currentPath = path ? (key.match(/^\d+$/) ? `${path}[${key}]` : `${path}.${key}`) : key;

            // 의존성에 추가
            dependencies.add(currentPath);
            if (path) {
              dependencies.add(path);
            }

            try {
              // 읽기 전용 속성 확인
              const descriptor = Object.getOwnPropertyDescriptor(obj, key);

              // 읽기 전용 속성이거나 설정 불가능한 속성은 직접 값 반환
              if (
                descriptor &&
                (descriptor.configurable === false ||
                  (descriptor.writable === false && !descriptor.get) ||
                  (descriptor.get && !descriptor.set))
              ) {
                return Reflect.get(obj, prop);
              }
            } catch (e) {
              // 디스크립터 접근 오류 무시
            }

            // 정상적인 값 접근
            const value = Reflect.get(obj, prop);

            // 중첩 객체 처리 (안전한 경우에만)
            if (
              value &&
              typeof value === 'object' &&
              !(value instanceof Date) &&
              !(value instanceof RegExp) &&
              !(value instanceof Error) &&
              !ArrayBuffer.isView(value) &&
              value.constructor &&
              (value.constructor.name === 'Object' || value.constructor.name === 'Array')
            ) {
              return createDeepTrackingProxy(value, currentPath);
            }

            return value;
          },
        });

        // 현재 레벨의 프록시 캐싱
        if (path === '') {
          proxyCache.set(target, proxy);
        }

        return proxy;
      };

      // 전체 상태에 대한 깊은 추적 프록시 생성
      const trackedState = createDeepTrackingProxy(state as object);

      // 셀렉터 실행
      const result = selector(trackedState as State, ...args);

      // 의존성 저장
      dependencyMap.set(state as object, dependencies);

      // 사용 후 최상위 프록시 캐시 정리 (메모리 누수 방지)
      proxyCache.delete(state as object);

      return result;
    }

    // 일반 실행 (의존성 추적 없음)
    return selector(state, ...args);
  });

  // 메모이제이션된 셀렉터에 추가 메서드를 가진 새로운 객체 생성
  const enhancedSelector = function (state: State, ...args: any[]): Result {
    return memoizedSelectorFn(state, ...args);
  } as EnhancedSelector<State, Result>;

  // 의존성 관련 메서드 추가
  enhancedSelector.getDependencies = (state: object): Set<string> => {
    return dependencyMap.get(state) || new Set<string>();
  };

  // 특정 상태 변경에 대해 이 셀렉터가 영향을 받는지 확인하는 메서드
  enhancedSelector.dependsOn = (state: object, changedKeys: Set<string> | string[]): boolean => {
    const deps = dependencyMap.get(state);
    if (!deps) return false;

    const keysSet = changedKeys instanceof Set ? changedKeys : new Set(changedKeys);

    // 특별한 와일드카드 의존성 확인
    if (deps.has('*') || keysSet.has('*')) return true;

    // 효율적인 의존성 경로 체크 함수
    const isDependentPath = (dep: string, changedKey: string): boolean => {
      // 캐시키 생성
      const cacheKey = `${dep}:${changedKey}`;

      // 캐시 확인
      if (pathRelationCache.has(cacheKey)) {
        return pathRelationCache.get(cacheKey) ?? false;
      }

      // 정확히 일치하는 경우
      if (dep === changedKey) {
        pathRelationCache.set(cacheKey, true);
        return true;
      }

      // 중첩 객체 의존성 확인
      const isDependent = changedKey.startsWith(`${dep}.`) || dep.startsWith(`${changedKey}.`);

      // 결과 캐싱 (캐시 크기 관리)
      pathRelationCache.set(cacheKey, isDependent);
      if (pathRelationCache.size > 1000) {
        // 캐시가 너무 커지면 초기 항목 제거
        const iterator = pathRelationCache.keys();
        let count = 0;
        while (count < 200) {
          const key = iterator.next().value;
          if (!key) break;
          pathRelationCache.delete(key);
          count++;
        }
      }

      return isDependent;
    };

    // 의존성 검사 최적화: 먼저 정확한 일치 검사 후 관계 검사
    for (const dep of deps) {
      if (keysSet.has(dep)) return true;
    }

    // 경로 관계 체크
    for (const dep of deps) {
      for (const changedKey of keysSet) {
        if (isDependentPath(dep, changedKey)) return true;
      }
    }

    return false;
  };

  return enhancedSelector;
}
