import { ComputedDef } from '../types/public-types';
import { InternalStateManager } from './state';
import { fx } from '@fxts/core';

/**
 * 상태 관리자 - 상태 변경 및 계산된 값 캐싱 로직을 처리합니다.
 *
 * @template TState 스토어 상태 타입
 * @template TComputed 계산된 속성 정의 타입
 */
export class StateManager<TState extends Record<string, any>, TComputed extends ComputedDef<TState>> {
  /** 내부 상태 관리 인스턴스 */
  private manager: InternalStateManager<TState, TComputed>;

  /**
   * StateManager 생성자
   * @param initialState 초기 상태 객체
   * @param computed 계산된 속성 정의 객체 (선택적)
   */
  constructor(initialState: TState, computed?: TComputed) {
    this.manager = new InternalStateManager<TState, TComputed>(initialState, computed);
  }

  /**
   * 현재 상태의 읽기 전용 복사본을 반환합니다.
   * @returns 현재 상태의 읽기 전용 복사본
   */
  getState(): Readonly<TState> {
    return this.manager.getState();
  }

  /**
   * 상태 변경을 구독합니다.
   * @param listener 상태 변경 시 호출될 콜백 함수
   * @param options 구독 옵션
   * @param options.priority 리스너의 우선순위 (높을수록 먼저 실행)
   * @param options.throttle 리스너 호출 제한 시간(ms)
   * @param options.errorHandler 리스너 실행 중 오류 발생 시 처리할 함수
   * @param options.paths 특정 경로 변경만 구독할 경우 지정
   * @returns 구독 취소 함수
   */
  subscribe(
    listener: () => void,
    options: {
      priority?: number;
      throttle?: number;
      errorHandler?: (error: Error) => void;
      paths?: string[];
    } = {},
  ): () => void {
    return this.manager.subscribe(listener, options);
  }

  /**
   * 특정 선택자 함수를 통해 상태의 일부를 구독합니다.
   * 선택된 부분이 변경될 때만 리스너가 호출됩니다.
   *
   * @template T 선택된 상태 타입
   * @param selector 상태에서 관심 있는 부분을 선택하는 함수
   * @param listener 선택된 상태가 변경될 때 호출될 콜백 함수
   * @param options 구독 옵션
   * @param options.priority 리스너의 우선순위
   * @param options.throttle 리스너 호출 제한 시간(ms)
   * @param options.memoize 선택자 결과 메모이제이션 여부
   * @param options.cacheSize 메모이제이션 캐시 크기
   * @param options.ttl 캐시 항목 유효 시간(ms)
   * @param options.errorHandler 오류 처리 함수
   * @returns 구독 취소 함수
   */
  subscribeState<T>(
    selector: (state: Readonly<TState>) => T,
    listener: (value: T, oldValue?: T) => void,
    options: {
      priority?: number;
      throttle?: number;
      memoize?: boolean;
      cacheSize?: number;
      ttl?: number;
      errorHandler?: (error: Error) => void;
    } = {},
  ): () => void {
    return this.manager.subscribeState(selector, listener, options);
  }

  /**
   * 여러 선택자 함수를 동시에 구독합니다.
   * 선택된 값 중 하나라도 변경되면 리스너가 호출됩니다.
   *
   * @template S 선택된 상태 타입 배열
   * @param selectors 각 상태 부분을 선택하는 함수 배열
   * @param listener 선택된 상태가 변경될 때 호출될 콜백 함수
   * @returns 구독 취소 함수
   */
  subscribeStates<S extends unknown[]>(
    selectors: { [K in keyof S]: (state: Readonly<TState>) => S[K] },
    listener: (values: S, oldValues?: S) => void,
  ): () => void {
    return this.manager.subscribeStates(selectors, listener);
  }

  /**
   * 상태를 업데이트합니다.
   * 내부용 메서드이므로 이름에 '_'가 접두사로 붙어 있습니다.
   *
   * @param newState 업데이트할 상태의 일부
   * @param options 업데이트 옵션
   * @param options.priority 업데이트 우선순위
   * @param options.updateId 업데이트 식별자
   * @param options.silent 구독자에게 알림 없이 업데이트
   * @param options.statePath 특정 경로만 업데이트
   */
  _setState(
    newState: Partial<TState>,
    options: {
      priority?: 'high' | 'normal' | 'low';
      updateId?: string;
      silent?: boolean;
      statePath?: string;
    } = {},
  ): void {
    return this.manager._setState(newState, options);
  }

  /**
   * 계산된 속성의 현재 값을 가져옵니다.
   * @param key 계산된 속성의 키
   * @returns 계산된 속성 값
   */
  getComputedValue(key: keyof TComputed) {
    return this.manager.getComputedValue(key);
  }

  /**
   * 디버깅 목적으로 상태 관리자의 내부 정보를 가져옵니다.
   * @returns 디버깅 정보 객체
   */
  getDebugInfo() {
    return this.manager.getDebugInfo();
  }

  /**
   * 특정 경로를 구독 중인 구독자 ID 목록을 가져옵니다.
   * @param path 상태 경로
   * @returns 구독자 ID 배열
   */
  getSubscribersForPath(path: string): string[] {
    return this.manager.getSubscribersForPath(path);
  }

  /**
   * 특정 구독자의 활성 상태를 설정합니다.
   * 비활성화된 구독자는 상태 변경 알림을 받지 않습니다.
   *
   * @param subscriberId 구독자 ID
   * @param active 활성화 여부
   * @returns 설정 성공 여부
   */
  setSubscriberActive(subscriberId: string, active: boolean): boolean {
    return this.manager.setSubscriberActive(subscriberId, active);
  }

  /**
   * 현재 상태의 스냅샷을 생성합니다.
   * 스냅샷 복원을 위한 함수를 반환합니다.
   *
   * @returns 스냅샷 복원 함수
   */
  createSnapshot(): () => void {
    return this.manager.createSnapshot();
  }

  /**
   * 여러 선택자를 병렬로 계산합니다.
   * 계산 비용이 큰 선택자가 여러 개 있을 때 유용합니다.
   *
   * @template T 선택자 결과 타입
   * @param selectors 계산할 선택자 함수 배열
   * @param concurrencyLimit 동시 실행할 최대 선택자 수 (기본값: 4)
   * @returns 계산된 결과 배열을 포함하는 Promise
   */
  async computeSelectorsParallel<T>(
    selectors: Array<(state: Readonly<TState>) => Promise<T>>,
    concurrencyLimit = 4,
  ): Promise<T[]> {
    const state = this.getState();

    return fx(selectors)
      .toAsync()
      .map((selector) => selector(state))
      .concurrent(concurrencyLimit) // 병렬 실행
      .toArray();
  }
}
