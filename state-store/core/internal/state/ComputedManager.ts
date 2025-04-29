import { ComputedDef } from '../../types/public-types';
import { IComputedManager } from './interfaces';
import { deepEqual } from '../../../utils/compare';
import { entries, fx, memoize } from '@fxts/core';
import { isDevelopment } from '../../../utils/env';

/**
 * 계산된 값 관리자 - 계산된 값의 캐싱 및 의존성 관리를 담당합니다.
 * @template TState 스토어 상태 타입
 * @template TComputed 계산된 속성 정의 타입
 */
export class ComputedManager<TState extends Record<string, any>, TComputed extends ComputedDef<TState>>
  implements IComputedManager<TState, TComputed>
{
  private readonly computed?: TComputed;
  private computedCache: Map<keyof TComputed, any> = new Map();
  private memoizedComputedFns = new Map<keyof TComputed, any>();
  private computedDependencies: Map<keyof TComputed, Set<string>> = new Map();

  // 계산된 값 간의 의존성 그래프
  private computedDependencyGraph: Map<keyof TComputed, Set<keyof TComputed>> = new Map();

  // 의존성 그래프가 변경되었는지 추적하는 플래그
  private isDependencyGraphDirty = true;

  // 계산된 값 순서 캐시
  private allComputedKeysInOrder: Array<keyof TComputed> | null = null;

  // 역방향 의존성 맵: 상태 키 -> 해당 키에 의존하는 계산된 값 키 집합
  private stateKeyToComputedMap: Map<string, Set<keyof TComputed>> | null = null;

  // 의존성 추적자 참조
  private readonly getTrackingProxy: (
    target: any,
    dependencies: Set<string>,
    path?: string,
    depth?: number,
  ) => any;

  constructor(
    initialState: TState,
    computed: TComputed | undefined,
    getTrackingProxy: (target: any, dependencies: Set<string>, path?: string, depth?: number) => any,
  ) {
    this.computed = computed;
    this.getTrackingProxy = getTrackingProxy;

    if (computed) {
      this.initializeComputedValues(initialState);
    }
  }

  /**
   * 계산된 값에 접근합니다.
   * @param key 계산된 값의 키
   * @returns 계산된 값
   */
  getComputedValue(key: keyof TComputed) {
    return this.computedCache.get(key);
  }

  /**
   * 초기 계산된 값을 설정합니다.
   * @private
   */
  private initializeComputedValues(state: TState): void {
    this.computed &&
      fx(entries(this.computed)).each(([key, computedFn]) => {
        const memoizedFn = memoize(computedFn);
        this.memoizedComputedFns.set(key, memoizedFn);
        this.computedCache.set(key, memoizedFn(Object.freeze({ ...state })));
      });
  }

  /**
   * 계산된 값 간의 의존성 그래프를 구축합니다.
   */
  buildDependencyGraph(): void {
    this.buildComputedDependencyGraph();
    // 전체 계산된 값에 대해 토폴로지 정렬 미리 수행하여 캐시
    this.allComputedKeysInOrder = this.topologicalSort(Object.keys(this.computed || {}));
    this.isDependencyGraphDirty = false;
  }

  /**
   * 계산된 값 간의 의존성 그래프를 구축합니다.
   * @private
   */
  private buildComputedDependencyGraph(): void {
    const computed = this.computed;

    computed &&
      fx(entries(this.computed))
        .filter(([key, computedFn]) => Object.hasOwn(computed, key) && computedFn)
        .each(([key, computedFn]) => {
          // 가상의 상태로 계산된 값 함수 실행하고 의존성 추적
          const dependencies = new Set<string>();

          // 계산된 값 네임스페이스를 포함한 가상 상태 생성
          const virtualState = {}; // 빈 객체로 시작 (실제 상태는 필요하지 않음)
          const computedNamespace: Record<string, any> = {};

          // 다른 계산된 값들에 대한 접근을 추적하는 프록시 생성
          const computedProxy = new Proxy(computedNamespace, {
            get: (_target, prop) => {
              const propKey = String(prop);

              if (this.computed && propKey !== key && propKey in this.computed) {
                // 현재 계산된 값이 다른 계산된 값에 의존함을 기록
                if (!this.computedDependencyGraph.has(propKey as keyof TComputed)) {
                  this.computedDependencyGraph.set(propKey as keyof TComputed, new Set());
                }

                this.computedDependencyGraph.get(propKey as keyof TComputed)?.add(key);
              }

              // 실제 계산된 값 반환 (이미 계산된 경우)
              return this.computedCache.get(propKey as keyof TComputed);
            },
          });

          // 상태 추적 프록시에 계산된 값 네임스페이스 주입
          Object.defineProperty(virtualState, 'computed', {
            get: () => computedProxy,
            enumerable: true,
            configurable: true,
          });

          try {
            const trackingProxy = this.getTrackingProxy(virtualState, dependencies, '', 0);
            computedFn(trackingProxy);
          } catch (error) {
            // 함수 실행 중 오류 처리 - 개발 모드에서만 자세히 로깅
            if (isDevelopment) {
              // 일반적인 undefined 프로퍼티 에러는 조용히 처리
              if (
                !(error instanceof TypeError) ||
                !String(error).includes('Cannot read properties of undefined')
              ) {
                console.warn(
                  `[ComputedManager] Notice: dependency tracking for "${String(key)}" using fallback.`,
                );
              }
            }

            // 오류가 발생하더라도 최소한의 의존성 등록 (전체 의존)
            dependencies.add('*');
          }

          // 의존성이 추가되었는지 확인하고 디버깅 로그 출력
          if (dependencies.size === 0) {
            dependencies.add('*');
          }

          this.computedDependencies.set(key, dependencies);
        });
  }

  /**
   * 역방향 의존성 맵을 구축합니다.
   * @private
   */
  private buildStateKeyToComputedMap(): void {
    this.stateKeyToComputedMap = new Map<string, Set<keyof TComputed>>();

    // 모든 계산된 값의 의존성을 역방향으로 인덱싱
    for (const [computedKey, dependencies] of this.computedDependencies.entries()) {
      for (const stateKey of dependencies) {
        if (!this.stateKeyToComputedMap.has(stateKey)) {
          this.stateKeyToComputedMap.set(stateKey, new Set());
        }
        this.stateKeyToComputedMap.get(stateKey)?.add(computedKey);
      }
    }
  }

  /**
   * 계산된 값 키를 위상 정렬하여 올바른 계산 순서를 결정합니다.
   * @private
   */
  private topologicalSort(keys: Array<keyof TComputed>): Array<keyof TComputed> {
    const result: Array<keyof TComputed> = [];
    const visited = new Set<keyof TComputed>();
    const tempVisited = new Set<keyof TComputed>();
    // 순환 의존성 추적
    const cyclicDependencies = new Set<keyof TComputed>();
    // 경로를 재사용하여 메모리 할당 줄이기
    const pathArray: Array<keyof TComputed> = [];

    const visit = (key: keyof TComputed) => {
      // 이미 처리된 노드는 건너뜀
      if (visited.has(key)) return;

      // 순환 의존성 감지
      if (tempVisited.has(key)) {
        // 순환 의존성을 발견하면 관련된 모든 키를 기록
        const cycleStart = pathArray.indexOf(key);
        if (cycleStart >= 0) {
          // 배열 복사 최소화
          for (let i = cycleStart; i < pathArray.length; i++) {
            const path = pathArray[i];
            path && cyclicDependencies.add(path);
          }
          cyclicDependencies.add(key);

          if (isDevelopment) {
            const cycle = pathArray.slice(cycleStart).concat(key);
            console.warn(
              `[ComputedManager] Circular dependency detected in computed values: ${cycle.map(String).join(' -> ')}`,
            );
          }
        }
        return;
      }

      // 현재 경로에 키 추가
      pathArray.push(key);
      tempVisited.add(key);

      // 의존하는 다른 계산된 값들을 먼저 방문
      for (const [depKey, dependents] of this.computedDependencyGraph.entries()) {
        if (dependents.has(key) && keys.includes(depKey)) {
          visit(depKey);
        }
      }

      tempVisited.delete(key);
      visited.add(key);
      // 순환 의존성이 없는 경우만 결과에 추가
      if (!cyclicDependencies.has(key)) {
        result.push(key);
      }

      // 경로에서 현재 키 제거
      pathArray.pop();
    };

    // 모든 키에 대해 DFS 수행
    for (const key of keys) {
      if (!visited.has(key) && !cyclicDependencies.has(key)) {
        visit(key);
      }
    }

    // 순환 의존성이 있는 경우 추가 경고
    if (cyclicDependencies.size > 0 && isDevelopment) {
      console.warn(
        `[ComputedManager] Some computed values with circular dependencies will not update correctly: ${Array.from(
          cyclicDependencies,
        )
          .map(String)
          .join(', ')}`,
      );
    }

    return result;
  }

  /**
   * 계산된 값을 업데이트합니다.
   * @param changedStateKeys 변경된 상태 키 집합
   * @param currentState 현재 전체 상태
   */
  updateComputedValues(changedStateKeys: Set<string>, currentState: TState): void {
    if (!this.computed) return;
    if (changedStateKeys.size === 0) return;

    const startTime = performance.now();

    // 의존성 그래프 구축 및 토폴로지 정렬 최소화
    if (this.isDependencyGraphDirty || this.computedDependencyGraph.size === 0) {
      this.buildDependencyGraph();
    }

    const frozenState = Object.freeze({ ...currentState });
    const computedKeysToUpdate = new Set<keyof TComputed>();
    const processedKeys = new Set<keyof TComputed>();

    // 특별 케이스 판단을 위한 변수들
    let forceFullUpdate = false;
    let hasObjectStructureChanges = false;

    // 1. 상태가 재설정되었는지 확인 (reset 액션 등)
    const isStateEmpty =
      !currentState ||
      Object.keys(currentState).length === 0 ||
      Object.keys(currentState).every((key) => {
        const value = currentState[key];
        return (
          value === undefined ||
          value === null ||
          (typeof value === 'object' && (!value || Object.keys(value).length === 0))
        );
      });

    if (isStateEmpty) {
      forceFullUpdate = true;
    }

    // 2. 객체 구조 변경 감지 - 빈 객체에서 데이터가 있는 객체로의 변경 감지
    // 주로 빈 객체에서 채워진 객체로 변경되는 경우를 처리
    for (const changedKey of changedStateKeys) {
      const pathParts = changedKey.split('.');
      if (pathParts.length > 1) {
        // 중첩된 객체 변경
        const rootKey = pathParts[0];

        // 객체가 빈 객체에서 채워진 객체로 바뀌었는지 확인
        if ((rootKey && changedStateKeys.has(rootKey)) || changedStateKeys.has('*')) {
          hasObjectStructureChanges = true;
          break;
        }
      } else if (changedKey === '*') {
        // 전체 상태 변경
        hasObjectStructureChanges = true;
        break;
      } else {
        // 상위 수준 필드의 객체 구조 변경 (예: item이 빈 객체 → 데이터 객체)
        const value = currentState[changedKey];
        if (value !== null && typeof value === 'object' && Object.keys(value).length > 0) {
          hasObjectStructureChanges = true;
          break;
        }
      }
    }

    if (forceFullUpdate || hasObjectStructureChanges) {
      // 상태 구조 변경 감지 시 모든 computed 값 업데이트
      for (const key in this.computed) {
        if (Object.hasOwn(this.computed, key)) {
          computedKeysToUpdate.add(key as keyof TComputed);
        }
      }
    } else {
      // 일반적인 케이스: 역방향 인덱스 맵 사용
      if (!this.stateKeyToComputedMap) {
        this.buildStateKeyToComputedMap();
      }

      // '*' 키가 변경된 경우 모든 계산된 값 업데이트
      if (changedStateKeys.has('*')) {
        for (const key in this.computed) {
          if (Object.hasOwn(this.computed, key)) {
            computedKeysToUpdate.add(key as keyof TComputed);
          }
        }
      } else {
        // 변경된 각 상태 키에 의존하는 계산된 값 찾기
        for (const changedKey of changedStateKeys) {
          const wildcard = '*';

          // 직접 매핑된 키 처리
          const affectedComputedKeys = this.stateKeyToComputedMap?.get(changedKey);
          if (affectedComputedKeys) {
            for (const computedKey of affectedComputedKeys) {
              computedKeysToUpdate.add(computedKey);
            }
          }

          // 와일드카드 의존성 처리
          const wildcardDependents = this.stateKeyToComputedMap?.get(wildcard);
          if (wildcardDependents) {
            for (const computedKey of wildcardDependents) {
              computedKeysToUpdate.add(computedKey);
            }
          }
        }
      }
    }

    // 2단계: 의존성 그래프를 통해 간접적으로 영향 받는 계산된 값 찾기
    const findDependents = (key: keyof TComputed) => {
      const dependents = this.computedDependencyGraph.get(key);
      if (!dependents) return;

      for (const dependent of dependents) {
        if (!computedKeysToUpdate.has(dependent)) {
          computedKeysToUpdate.add(dependent);
          findDependents(dependent);
        }
      }
    };

    if (computedKeysToUpdate.size === 0) return;

    // 직접 영향 받는 계산된 값들의 의존값들 추가
    for (const key of computedKeysToUpdate) {
      findDependents(key);
    }

    // 3단계: 캐시된 토폴로지 정렬 순서 사용
    let sortedComputedKeys: Array<keyof TComputed>;

    if (this.allComputedKeysInOrder) {
      if (computedKeysToUpdate.size === this.allComputedKeysInOrder.length) {
        // 모든 계산된 값을 업데이트하는 경우 전체 정렬 순서 재사용
        sortedComputedKeys = this.allComputedKeysInOrder;
      } else {
        // 일부만 업데이트하는 경우 필터링 (순서 유지)
        sortedComputedKeys = this.allComputedKeysInOrder.filter((key) => computedKeysToUpdate.has(key));
      }
    } else {
      // 캐시가 없는 경우 (비정상 상황) 지연 계산
      sortedComputedKeys = this.topologicalSort(Array.from(computedKeysToUpdate));
    }

    // 4단계: 정렬된 순서대로 계산된 값 업데이트
    for (const key of sortedComputedKeys) {
      if (processedKeys.has(key)) continue;

      const computedFn = this.computed[key];
      if (!computedFn) continue;

      const memoizedFn = this.memoizedComputedFns.get(key) || memoize(computedFn);

      // 아직 저장되지 않은 경우 저장
      if (!this.memoizedComputedFns.has(key)) {
        this.memoizedComputedFns.set(key, memoizedFn);
      }

      const dependencies = new Set<string>();
      const trackingProxy = this.getTrackingProxy(frozenState, dependencies);
      const newValue = memoizedFn(trackingProxy);

      // 의존성 업데이트 - 변경 시 그래프를 다시 빌드해야 함
      const oldDeps = this.computedDependencies.get(key);

      // 의존성이 비어있는 경우 기본적으로 전체 상태에 대한 의존성 추가
      if (dependencies.size === 0) {
        dependencies.add('*');
      }

      const depsChanged =
        !oldDeps ||
        oldDeps.size !== dependencies.size ||
        Array.from(dependencies).some((dep) => !oldDeps.has(dep));

      if (depsChanged) {
        // 의존성이 변경되면 역방향 맵에서 이전 참조 제거
        if (oldDeps && this.stateKeyToComputedMap) {
          for (const oldDep of oldDeps) {
            const computedsForDep = this.stateKeyToComputedMap.get(oldDep);
            if (computedsForDep) {
              computedsForDep.delete(key);
              // 집합이 비었으면 맵에서 제거
              if (computedsForDep.size === 0) {
                this.stateKeyToComputedMap.delete(oldDep);
              }
            }
          }
        }

        // 새 의존성 설정
        this.computedDependencies.set(key, dependencies);

        // 역방향 맵 업데이트
        if (this.stateKeyToComputedMap) {
          for (const dep of dependencies) {
            if (!this.stateKeyToComputedMap.has(dep)) {
              this.stateKeyToComputedMap.set(dep, new Set());
            }
            this.stateKeyToComputedMap.get(dep)?.add(key);
          }
        }

        this.isDependencyGraphDirty = true; // 의존성이 변경되면 그래프 재구축 필요
      }

      const prevValue = this.computedCache.get(key);
      // 참조 동일성 체크 먼저 수행 (빠른 경로)
      if (prevValue !== newValue) {
        // 깊은 비교는 비용이 크므로 필요한 경우에만 수행
        if (!deepEqual(prevValue, newValue)) {
          this.computedCache.set(key, newValue);
        }
      }

      processedKeys.add(key);
    }

    // 성능 측정
    if (isDevelopment) {
      const duration = performance.now() - startTime;
      if (duration > 5) {
        // 5ms 이상 걸린 경우만 로그
        console.debug(
          `[ComputedManager] Computed values update took ${duration.toFixed(2)}ms for ${sortedComputedKeys.length} values`,
        );
      }
    }
  }

  /**
   * 디버깅 정보를 반환합니다.
   */
  getDebugInfo() {
    return {
      count: this.computedCache.size,
      keys: Array.from(this.computedCache.keys()).map(String),
      dependencyGraph: Object.fromEntries(
        Array.from(this.computedDependencies.entries()).map(([key, deps]) => [String(key), Array.from(deps)]),
      ),
    };
  }
}
