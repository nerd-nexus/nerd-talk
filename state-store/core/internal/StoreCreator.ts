import { ActionsDef, AsyncActionsDef, ComputedDef } from '../types/public-types.ts';
import { StateManager } from './StateManager.ts';
import { AsyncActionManager } from './AsyncActionManager.ts';
import { ActionManager } from './ActionManager.ts';
import { ComputedState } from '../types/internal/state.ts';
import { StoreConfig, StoreInternal } from '../types/internal/store.ts';
import { fx } from '@fxts/core';

/**
 * 스토어 생성자 - 모든 컴포넌트를 조립하여 완전한 스토어를 생성합니다.
 * @template TState 스토어 상태 타입
 * @template TComputed 계산된 속성 정의 타입
 * @template TActions 액션 정의 타입
 * @template TAsyncActions 비동기 액션 정의 타입
 */
export class StoreCreator<
  TState extends Record<string, any>,
  TComputed extends ComputedDef<TState>,
  TActions extends ActionsDef<TState>,
  TAsyncActions extends AsyncActionsDef<TState>,
> {
  private config: StoreConfig<TState, TComputed, TActions, TAsyncActions>;
  private readonly store: StoreInternal<TState, TComputed, TActions, TAsyncActions>;
  private readonly stateManager: StateManager<TState, TComputed>;
  private asyncActionManager: AsyncActionManager<TState, TAsyncActions>;
  private actionManager: ActionManager<TState, TComputed, TActions, TAsyncActions>;

  constructor(config: StoreConfig<TState, TComputed, TActions, TAsyncActions>) {
    this.config = this.normalizeConfig(config);

    // 상태 관리자 초기화
    this.stateManager = new StateManager<TState, TComputed>(this.config.initialState, this.config.computed);

    // 스토어 객체 생성 및 기본 메서드 초기화 (ActionManager 생성 전에)
    this.store = this.createStoreBase();

    // 액션 관리자 초기화 (이제 기본 메서드가 있는 store 참조 전달)
    this.actionManager = new ActionManager<TState, TComputed, TActions, TAsyncActions>(
      this.config.actions as TActions,
      this.store,
    );

    // 비동기 액션 관리자 초기화
    this.asyncActionManager = new AsyncActionManager<TState, TAsyncActions>(
      this.config.asyncActions as TAsyncActions,
      new Set(), // 임시 빈 리스너 세트, 후에 stateManager의 리스너로 대체됨
      this.stateManager._setState.bind(this.stateManager),
    );

    // 나머지 스토어 기능 초기화 (액션, 계산된 값 등)
    this.completeStoreInitialization();
  }

  /**
   * 완전히 초기화된 스토어를 반환합니다.
   * @returns 생성된 스토어 인스턴스
   */
  createStore(): StoreInternal<TState, TComputed, TActions, TAsyncActions> {
    return this.store;
  }

  /**
   * 기본 스토어 객체를 생성합니다. (상태 관련 기본 메서드만 포함)
   * ActionManager에 전달되기 전에 호출됩니다.
   */
  private createStoreBase(): StoreInternal<TState, TComputed, TActions, TAsyncActions> {
    // 기본 스토어 객체 생성
    const storeBase = {} as StoreInternal<TState, TComputed, TActions, TAsyncActions>;

    // 기본 메서드 정의 (액션 관련 메서드 제외)
    Object.assign(storeBase, {
      getState: this.stateManager.getState.bind(this.stateManager),
      subscribe: this.stateManager.subscribe.bind(this.stateManager),
      subscribeState: this.stateManager.subscribeState.bind(this.stateManager),
      subscribeStates: this.stateManager.subscribeStates.bind(this.stateManager),
      _setState: this.stateManager._setState.bind(this.stateManager),
    });

    return storeBase;
  }

  /**
   * 스토어 객체의 나머지 부분을 초기화합니다.
   * ActionManager 생성 후에 호출됩니다.
   */
  private completeStoreInitialization(): void {
    // 디스패치 함수 생성 및 설정
    this.store.dispatch = this.actionManager.createDispatcher(
      this.stateManager._setState.bind(this.stateManager),
    );

    // 네임스페이스 객체 생성
    const computedNamespace = {} as ComputedState<TState, TComputed>;
    const actionsNamespace = this.actionManager.createActionsApi();
    const asyncActionsNamespace = this.asyncActionManager.createAsyncActionsApi();

    // 네임스페이스 속성 정의
    Object.defineProperties(this.store, {
      computed: {
        get: () => computedNamespace,
        enumerable: true,
        configurable: false,
      },
      actions: {
        get: () => actionsNamespace,
        enumerable: true,
        configurable: false,
      },
      asyncActions: {
        get: () => asyncActionsNamespace,
        enumerable: true,
        configurable: false,
      },
      asyncState: {
        get: () => this.asyncActionManager.getAsyncState(),
        enumerable: true,
        configurable: false,
      },
    });

    // 상태 속성 추가
    this.addStateProperties();

    // 계산된 값 속성 추가
    this.addComputedProperties(computedNamespace);
  }

  /**
   * 상태 속성을 스토어에 추가합니다.
   */
  private addStateProperties(): void {
    const descriptors = fx(Object.keys(this.config.initialState))
      .filter((key) => Object.prototype.hasOwnProperty.call(this.config.initialState, key))
      .reduce((acc, key) => {
        acc[key] = {
          get: () => this.stateManager.getState()[key],
          enumerable: true,
          configurable: false,
        };
        return acc;
      }, {} as PropertyDescriptorMap);

    Object.defineProperties(this.store, descriptors);
  }

  /**
   * 계산된 속성을 계산된 네임스페이스에 추가합니다.
   */
  private addComputedProperties(computedNamespace: ComputedState<TState, TComputed>): void {
    const computed = this.config.computed;
    if (!computed) return;

    const descriptors = fx(Object.keys(computed))
      .filter((key) => Object.prototype.hasOwnProperty.call(this.config.computed, key))
      .reduce((acc, key) => {
        acc[key] = {
          get: () => this.stateManager.getComputedValue(key),
          enumerable: true,
          configurable: false,
        };
        return acc;
      }, {} as PropertyDescriptorMap);

    Object.defineProperties(computedNamespace, descriptors);
  }

  /**
   * 설정 객체를 정규화합니다.
   */
  private normalizeConfig(
    config: StoreConfig<TState, TComputed, TActions, TAsyncActions>,
  ): StoreConfig<TState, TComputed, TActions, TAsyncActions> {
    return {
      ...config,
      computed: config.computed || ({} as TComputed),
      actions: config.actions || ({} as TActions),
      asyncActions: config.asyncActions || ({} as TAsyncActions),
    };
  }
}
