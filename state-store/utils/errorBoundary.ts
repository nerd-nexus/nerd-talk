import { isDevelopment } from './env';

/**
 * 상태 스토어를 위한 오류 경계 및 안정성 기능 모음
 */

/**
 * 예외 핸들러 타입 정의
 */
export type ErrorHandler = (
  error: Error,
  context: {
    actionType?: string;
    statePath?: string;
    recoverable: boolean;
  },
) => void;

/**
 * 오류 경계 구성 옵션
 */
export interface ErrorBoundaryOptions {
  /**
   * 활성화 여부 (기본: true)
   */
  enabled?: boolean;

  /**
   * 성능 모니터링 여부 (기본: 개발 모드에서만 true)
   */
  enablePerformanceMonitoring?: boolean;

  /**
   * 자가 복구 시도 여부 (기본: true)
   */
  enableRecovery?: boolean;

  /**
   * 최대 복구 시도 횟수 (기본: 3)
   */
  maxRecoveryAttempts?: number;

  /**
   * 복구 시도 간 대기 시간 (ms) (기본: 100)
   */
  recoveryDelayMs?: number;

  /**
   * 성능 경고 임계값 (ms) (기본: 16, 1프레임)
   */
  performanceWarningThreshold?: number;

  /**
   * 오류 보고 처리 함수
   */
  onError?: ErrorHandler;
}

// 기본 옵션 값
const DEFAULT_OPTIONS: ErrorBoundaryOptions = {
  enabled: true,
  enablePerformanceMonitoring: isDevelopment,
  enableRecovery: true,
  maxRecoveryAttempts: 3,
  recoveryDelayMs: 100,
  performanceWarningThreshold: 16,
};

/**
 * 오류 경계 및 성능 모니터링 관리자
 */

export class ErrorBoundary {
  private options: Required<ErrorBoundaryOptions>;
  private recoveryAttempts: Map<string, number>;

  constructor(options: ErrorBoundaryOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options } as Required<ErrorBoundaryOptions>;

    this.recoveryAttempts = new Map();
  }

  /**
   * 안전한 함수 실행 래퍼
   * @param fn 실행할 함수
   * @param context 오류 컨텍스트
   * @param fallback 오류 발생 시 대체 반환값
   */
  safeExecute<T>(fn: () => T, context: { actionType?: string; statePath?: string } = {}, fallback?: T): T {
    try {
      return fn();
    } catch (error) {
      // 오류 정보 구성
      const errorContext = {
        ...context,
        recoverable: this.options.enableRecovery && this.canRecover(context),
      };

      // 오류 핸들러 호출
      if (this.options.onError) {
        try {
          this.options.onError(error as Error, errorContext);
        } catch (handlerError) {
          console.error('[ErrorBoundary] Error in error handler:', handlerError);
        }
      }

      // 콘솔에 오류 로깅
      console.error(
        `[ErrorBoundary] Error in ${context.actionType || 'operation'}` +
          `${context.statePath ? ` for path ${context.statePath}` : ''}:`,
        error,
      );

      // 복구 시도
      if (errorContext.recoverable) {
        return this.attemptRecovery(fn, context, fallback);
      }

      // 복구 불가능한 경우 대체값 반환
      return fallback as T;
    }
  }

  /**
   * 특정 컨텍스트에서 복구 가능 여부 확인
   */
  private canRecover(context: { actionType?: string; statePath?: string }): boolean {
    // 고유 식별자 생성
    const id = this.getContextId(context);

    // 현재 복구 시도 횟수 확인
    const attempts = this.recoveryAttempts.get(id) || 0;

    // 최대 시도 횟수 미만인 경우 복구 가능
    return attempts < this.options.maxRecoveryAttempts;
  }

  /**
   * 복구 시도 수행
   */
  private attemptRecovery<T>(
    fn: () => T,
    context: { actionType?: string; statePath?: string },
    fallback?: T,
  ): T {
    const id = this.getContextId(context);

    // 복구 시도 횟수 증가
    const attempts = (this.recoveryAttempts.get(id) || 0) + 1;
    this.recoveryAttempts.set(id, attempts);

    console.warn(
      `[ErrorBoundary] Recovery attempt ${attempts}/${this.options.maxRecoveryAttempts}` +
        ` for ${context.actionType || 'operation'}` +
        `${context.statePath ? ` on path ${context.statePath}` : ''}`,
    );

    // 딜레이 후 재시도
    return new Promise<T>((resolve) => {
      setTimeout(() => {
        try {
          // 재시도
          const result = fn();

          // 성공 시 복구 시도 카운터 리셋
          this.recoveryAttempts.delete(id);

          resolve(result);
        } catch (error) {
          console.error(`[ErrorBoundary] Recovery attempt ${attempts} failed:`, error);

          // 복구 실패 시 대체값 반환
          resolve(fallback as T);
        }
      }, this.options.recoveryDelayMs);
    }) as unknown as T;
  }

  /**
   * 컨텍스트 고유 ID 생성
   */
  private getContextId(context: { actionType?: string; statePath?: string }): string {
    return `${context.actionType || 'unknown'}_${context.statePath || 'global'}`;
  }
}

/**
 * 글로벌 오류 경계 인스턴스
 */
export const globalErrorBoundary = new ErrorBoundary();

/**
 * 상태 스토어를 위한 안전한 액션 실행기
 * @param actionName 액션 이름
 * @param fn 실행할 함수
 * @param statePath 상태 경로
 * @param fallback 실패 시 반환할 대체 값
 */
export function safeAction<T>(actionName: string, fn: () => T, statePath?: string, fallback?: T): T {
  return globalErrorBoundary.safeExecute(fn, { actionType: actionName, statePath }, fallback);
}
