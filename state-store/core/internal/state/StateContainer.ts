import { IStateContainer, UpdateOptions } from './interfaces';
import { detectStructuralChanges } from '../../../utils/compare';
import { fx } from '@fxts/core';

/**
 * 상태 컨테이너 - 순수한 상태 관리만 담당합니다.
 * @template TState 스토어 상태 타입
 */
export class StateContainer<TState extends Record<string, any>> implements IStateContainer<TState> {
  protected state: TState;

  constructor(initialState: TState) {
    this.state = { ...initialState };
  }

  /**
   * 현재 상태의 읽기 전용 사본을 반환합니다.
   */
  getState(): Readonly<TState> {
    return Object.freeze({ ...this.state });
  }

  /**
   * 상태를 업데이트합니다.
   * @param newState 새 상태 객체 (부분 상태 또는 전체 상태)
   * @param options 업데이트 옵션
   * @returns 변경된 키와 경로 정보
   */
  updateState(
    newState: Partial<TState>,
    options: UpdateOptions = {},
  ): { changedKeys: Set<string>; changedPaths: Set<string>; hasStructuralChange: boolean } {
    const updatedKeys = Object.keys(newState);
    if (updatedKeys.length === 0) {
      return { changedKeys: new Set(), changedPaths: new Set(), hasStructuralChange: false };
    }

    const changedKeys = new Set<string>();
    const changedPaths = new Set<string>();
    const nextState = { ...this.state };
    let hasChanges = false;
    let hasStructuralChange = false;

    // 변경된 키 및 경로 감지
    fx(updatedKeys)
      .filter((key) => key in nextState)
      .each((key) => {
        const currentValue = this.state[key];
        const newValue = newState[key as keyof Partial<TState>];

        // 참조 동일성 검사로 빠른 경로 제공
        if (currentValue === newValue) return;

        // 객체의 경우 구조 변경 확인
        if (
          typeof currentValue === 'object' &&
          typeof newValue === 'object' &&
          currentValue !== null &&
          newValue !== null
        ) {
          // 객체 사이즈가 크게 다르면 구조적 변화로 간주
          const currentKeys = Object.keys(currentValue);
          const newKeys = Object.keys(newValue);

          // 구조적 변경 확인 (속성 추가/제거)
          const structuralChanged =
            detectStructuralChanges(currentValue as Record<string, any>, newValue as Record<string, any>) ||
            Math.abs(currentKeys.length - newKeys.length) > 3; // 키 개수가 크게 변경됨

          if (structuralChanged) {
            hasStructuralChange = true;
          }

          // 어쨌든 값이 다르므로 업데이트
          (nextState as Record<string, any>)[key] = newValue;
          changedKeys.add(key);
          changedPaths.add(key);

          // 객체의 경우 중첩 경로 추가
          if (typeof newValue === 'object') {
            this.addNestedPaths(key, newValue, changedPaths);

            // 이전 객체의 속성들도 변경 경로로 추가 (삭제된 속성도 추적하기 위함)
            if (structuralChanged && typeof currentValue === 'object') {
              fx(currentKeys).each((oldKey) => {
                const oldPath = /^\d+$/.test(oldKey) ? `${key}[${oldKey}]` : `${key}.${oldKey}`;
                changedPaths.add(oldPath);
              });
            }
          }

          hasChanges = true;
        } else {
          // 원시 타입 비교 - 이미 참조 비교에서 다름이 확인됨
          (nextState as Record<string, any>)[key] = newValue;
          changedKeys.add(key);
          changedPaths.add(key);
          hasChanges = true;
        }
      });

    // 실제 변경된 것이 없으면 빈 결과 반환
    if (!hasChanges) {
      return { changedKeys: new Set(), changedPaths: new Set(), hasStructuralChange: false };
    }

    // 상태 업데이트
    this.state = nextState;

    // 명시적 경로 제공된 경우 추가
    if (options.statePath) {
      changedPaths.add(options.statePath);
    }

    return { changedKeys, changedPaths, hasStructuralChange };
  }

  /**
   * 중첩 객체의 경로를 추가합니다.
   * 예: user.profile.name, items[0].price 등
   */
  private addNestedPaths(rootPath: string, obj: any, paths: Set<string>): void {
    if (!obj || typeof obj !== 'object') return;

    // 배열 처리
    if (Array.isArray(obj)) {
      fx(obj.entries()).each(([i, item]) => {
        // 일관된 배열 인덱스 표기법 사용
        const itemPath = `${rootPath}[${i}]`;
        paths.add(itemPath);

        // 배열 아이템이 객체인 경우 재귀적으로 처리
        if (item && typeof item === 'object') {
          this.addNestedPaths(itemPath, item, paths);
        }
      });
      return;
    }

    // 객체 처리
    fx(Object.entries(obj))
      .filter(([key]) => Object.hasOwn(obj, key))
      .each(([key, value]) => {
        // 숫자 키인 경우 배열 표기법 사용, 그 외에는 점 표기법 사용
        const propPath = /^\d+$/.test(key) ? `${rootPath}[${key}]` : `${rootPath}.${key}`;
        paths.add(propPath);

        // 속성이 객체인 경우 재귀적으로 처리
        if (value && typeof value === 'object') {
          this.addNestedPaths(propPath, value, paths);
        }
      });
  }
}
