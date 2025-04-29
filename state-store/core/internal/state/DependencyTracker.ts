import { IDependencyTracker } from './interfaces';
import { isSymbol } from '../../../utils/isSymbol.ts';

/**
 * 프록시 관련 속성에 대한 타입 확장
 */
interface ProxyTracker {
  __isProxyTracker?: boolean;
  __dependenciesRef?: Set<string>;
}

/**
 * 의존성 추적기 - 상태 접근을 추적하여 의존성 그래프를 구축합니다.
 * @template TState 스토어 상태 타입
 */
export class DependencyTracker<TState extends Record<string, any>> implements IDependencyTracker<TState> {
  // 셀렉터 의존성
  private selectorDependencies: WeakMap<(state: Readonly<TState>) => unknown, Set<string>> = new WeakMap();

  // 최대 프록시 재귀 깊이 - 스택 오버플로우 방지
  private readonly MAX_PROXY_DEPTH = 10; // 깊이를 줄여서 불필요한 중첩 객체 프록시 생성 방지

  // 객체 순환 참조 감지를 위한 WeakMap
  private proxyTargetMap = new WeakMap<object, Set<string>>();

  /**
   * 객체의 모든 속성이 안전하게 프록시로 래핑 가능한지 확인
   * @param obj 검사할 객체
   * @returns 안전한 경우 true, 그렇지 않으면 false
   */
  private isSafeToProxy(obj: any): boolean {
    if (!obj || typeof obj !== 'object') return false;

    // 특수 객체 타입은 프록시로 감싸지 않음
    if (
      obj instanceof Date ||
      obj instanceof RegExp ||
      obj instanceof Error ||
      obj instanceof Promise ||
      obj instanceof WeakMap ||
      obj instanceof WeakSet ||
      obj instanceof Map ||
      obj instanceof Set ||
      typeof obj === 'function' ||
      (Array.isArray(obj) && obj.length > 100) // 큰 배열
    ) {
      return false;
    }

    // 기본 내장 객체도 프록시로 감싸지 않음
    const objProto = Object.getPrototypeOf(obj);
    if (objProto !== Object.prototype && objProto !== Array.prototype) {
      return false;
    }

    return true;
  }

  /**
   * 지정된 속성이 안전하게 프록시로 처리 가능한지 확인
   * @param obj 대상 객체
   * @param prop 속성 이름
   * @returns 안전한 경우 true, 그렇지 않으면 false
   */
  private isSafePropertyToProxy(obj: any, prop: string): boolean {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(obj, prop);

      // 디스크립터가 없으면 프로토타입 체인을 통해 상속된 것이므로 안전하다고 가정
      if (!descriptor) return true;

      // Proxy invariant rules 위반 가능성이 있는 속성 확인
      return !(
        descriptor.configurable === false || // non-configurable 속성
        (descriptor.writable === false && !descriptor.get) || // read-only 속성
        (descriptor.get && !descriptor.set) // getter만 있고 setter는 없는 경우
      );
    } catch (e) {
      // 디스크립터 접근 중 오류 발생 시 안전하지 않다고 간주
      return false;
    }
  }

  /**
   * 의존성 추적을 위한 프록시 생성
   * 안전한 얕은 프록시 접근법 사용
   */
  createTrackingProxy(target: any, dependencies: Set<string> = new Set(), path = '', depth = 0): any {
    // 1. null이나 원시 타입은 그대로 반환
    if (target === null || typeof target !== 'object') {
      path && dependencies.add(path);
      return target;
    }

    // 2. 최대 재귀 깊이 확인
    if (depth >= this.MAX_PROXY_DEPTH) {
      path && dependencies.add(path);
      return target;
    }

    // 3. 객체가 프록시로 래핑하기에 안전한지 확인
    if (!this.isSafeToProxy(target)) {
      path && dependencies.add(path);
      return target;
    }

    // 4. 순환 참조 감지
    if (this.proxyTargetMap.has(target)) {
      const paths = this.proxyTargetMap.get(target);
      if (paths && paths.has(path)) {
        path && dependencies.add(path);
        return target;
      }
    }

    // 5. 이미 프록시인 경우 재생성 방지
    const proxyTarget = target as ProxyTracker;
    if (proxyTarget.__isProxyTracker) {
      if (proxyTarget.__dependenciesRef === dependencies) {
        return target;
      }
    }

    // 6. 경로 추적 설정 - 순환 참조 감지용
    if (path) {
      if (!this.proxyTargetMap.has(target)) {
        this.proxyTargetMap.set(target, new Set<string>());
      }
      this.proxyTargetMap.get(target)?.add(path);
      dependencies.add(path);
    }

    // 7. 새 프록시 생성 - 안전한 get 핸들러 사용
    return new Proxy(target, {
      get: (obj, prop) => {
        // 프록시 자체 식별용 속성
        if (prop === '__isProxyTracker') return true;
        if (prop === '__dependenciesRef') return dependencies;

        // 문자열 키로 변환
        const key = String(prop);

        // 특수 프로퍼티는 직접 접근
        if (
          isSymbol(prop) ||
          key === '__proto__' ||
          key === 'constructor' ||
          key === 'prototype' ||
          key.startsWith('__') ||
          key === 'console' ||
          obj === console
        ) {
          return Reflect.get(obj, prop);
        }

        // 현재 경로 생성 및 의존성 추가
        const currentPath = path ? (key.match(/^\d+$/) ? `${path}[${key}]` : `${path}.${key}`) : key;

        dependencies.add(currentPath);

        // 속성이 안전하게 프록시로 처리 가능한지 확인
        const isSafeProp = this.isSafePropertyToProxy(obj, key);

        // 직접 값을 읽고
        const value = Reflect.get(obj, prop);

        // 안전하지 않은 속성은 값만 추적하고 직접 반환
        if (!isSafeProp) {
          return value;
        }

        // 중첩 객체만 프록시로 감싸고, 그 외에는 직접 반환
        if (value !== null && typeof value === 'object' && this.isSafeToProxy(value)) {
          return this.createTrackingProxy(value, dependencies, currentPath, depth + 1);
        }

        return value;
      },

      // 불변성 보장 - 엄격 모드 호환 설정
      set: () => true,
      deleteProperty: () => true,
    });
  }

  /**
   * 셀렉터의 의존성을 추적합니다.
   * @param selector 셀렉터 함수
   * @returns 정규화된 의존성 경로 배열
   */
  trackDependencies<T>(selector: (state: Readonly<TState>) => T): string[] {
    try {
      // 1. 의존성 추적을 위한 빈 Set
      const dependencies = new Set<string>();

      // 2. 안전하게 빈 객체로 시작하여 접근하는 경로만 추적
      const emptyState = {} as TState;
      const trackingProxy = this.createTrackingProxy(emptyState, dependencies);

      // 3. 셀렉터 실행
      try {
        selector(trackingProxy);
      } catch (e) {
        // 셀렉터 실행 실패는 정상적인 상황일 수 있음 (초기 값이 없어서)
        // 이미 추적된 의존성은 계속 사용
      }

      // 4. 의존성 저장
      this.selectorDependencies.set(selector, dependencies);

      // 5. 정규화된 의존성 경로 반환
      const normalizedDependencies = Array.from(dependencies);

      // 6. 의존성이 없는 경우 전체 구독
      if (normalizedDependencies.length === 0) {
        return ['*'];
      }

      return normalizedDependencies;
    } catch (error) {
      // 오류 발생 시 안전하게 처리
      console.error('[DependencyTracker] Error tracking dependencies:', error);
      return ['*']; // 전체 구독으로 대체
    }
  }
}
