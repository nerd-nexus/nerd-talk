/**
 * 상태 스토어를 위한 오류 경계 및 안정성 기능 모음
 *
 * 이 유틸리티는 상태 업데이트 중 오류 처리, 성능 모니터링,
 * 자가 복구 메커니즘을 제공합니다.
 */

/**
 * 성능 측정 관련 유형 정의
 */
export interface PerformanceMetrics {
  lastUpdateDuration: number; // 마지막 업데이트 소요 시간 (ms)
  averageUpdateDuration: number; // 평균 업데이트 소요 시간 (ms)
  peakUpdateDuration: number; // 최대 업데이트 소요 시간 (ms)
  totalUpdates: number; // 총 업데이트 횟수
  errorCount: number; // 오류 발생 횟수
  recoveryCount: number; // 자가 복구 횟수
  lastUpdateTimestamp: number; // 마지막 업데이트 시간
}

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

  /**
   * 성능 로그 기록 간격 (ms) (기본: 0, 사용 안함)
   */
  performanceLoggingInterval?: number;
}

// 기본 옵션 값
const DEFAULT_OPTIONS: ErrorBoundaryOptions = {
  enabled: true,
  enablePerformanceMonitoring: process.env.NODE_ENV !== 'production',
  enableRecovery: true,
  maxRecoveryAttempts: 3,
  recoveryDelayMs: 100,
  performanceWarningThreshold: 16,
  performanceLoggingInterval: 0,
};

/**
 * 오류 경계 및 성능 모니터링 관리자
 */
export class ErrorBoundary {
  private options: Required<ErrorBoundaryOptions>;
  private metrics: PerformanceMetrics;
  private recoveryAttempts: Map<string, number>;
  private performanceLogTimer: number | null = null;

  constructor(options: ErrorBoundaryOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options } as Required<ErrorBoundaryOptions>;

    this.metrics = {
      lastUpdateDuration: 0,
      averageUpdateDuration: 0,
      peakUpdateDuration: 0,
      totalUpdates: 0,
      errorCount: 0,
      recoveryCount: 0,
      lastUpdateTimestamp: 0,
    };

    this.recoveryAttempts = new Map();

    // 성능 로깅 타이머 설정
    if (this.options.enablePerformanceMonitoring && this.options.performanceLoggingInterval > 0) {
      this.startPerformanceLogging();
    }
  }

  /**
   * 안전한 함수 실행 래퍼
   * @param fn 실행할 함수
   * @param context 오류 컨텍스트
   * @param fallback 오류 발생 시 대체 반환값
   */
  safeExecute<T>(fn: () => T, context: { actionType?: string; statePath?: string } = {}, fallback?: T): T {
    if (!this.options.enabled) {
      return fn();
    }

    // 성능 모니터링
    let startTime: number | undefined;
    if (this.options.enablePerformanceMonitoring) {
      startTime = performance.now();
    }

    try {
      const result = fn();

      // 성능 지표 업데이트
      if (this.options.enablePerformanceMonitoring && startTime !== undefined) {
        this.updatePerformanceMetrics(performance.now() - startTime);
      }

      return result;
    } catch (error) {
      this.metrics.errorCount++;

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

    // 복구 횟수 지표 업데이트
    this.metrics.recoveryCount++;

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

  /**
   * 성능 지표 업데이트
   */
  private updatePerformanceMetrics(duration: number): void {
    this.metrics.lastUpdateDuration = duration;
    this.metrics.lastUpdateTimestamp = Date.now();
    this.metrics.totalUpdates++;

    // 평균 업데이트 시간 계산 (가중 평균)
    this.metrics.averageUpdateDuration =
      (this.metrics.averageUpdateDuration * (this.metrics.totalUpdates - 1) + duration) /
      this.metrics.totalUpdates;

    // 최대 소요 시간 업데이트
    if (duration > this.metrics.peakUpdateDuration) {
      this.metrics.peakUpdateDuration = duration;
    }

    // 성능 경고
    if (duration > this.options.performanceWarningThreshold) {
      console.warn(
        `[ErrorBoundary] Performance warning: update took ${duration.toFixed(2)}ms, ` +
          `exceeding threshold of ${this.options.performanceWarningThreshold}ms`,
      );
    }
  }

  /**
   * 성능 로깅 시작
   */
  private startPerformanceLogging(): void {
    if (this.performanceLogTimer !== null) {
      clearInterval(this.performanceLogTimer);
    }

    this.performanceLogTimer = window.setInterval(() => {
      console.log('[ErrorBoundary] Performance metrics:', this.getMetrics());
    }, this.options.performanceLoggingInterval);
  }

  /**
   * 성능 로깅 중지
   */
  stopPerformanceLogging(): void {
    if (this.performanceLogTimer !== null) {
      clearInterval(this.performanceLogTimer);
      this.performanceLogTimer = null;
    }
  }

  /**
   * 현재 성능 지표 반환
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * 성능 지표 초기화
   */
  resetMetrics(): void {
    this.metrics = {
      lastUpdateDuration: 0,
      averageUpdateDuration: 0,
      peakUpdateDuration: 0,
      totalUpdates: 0,
      errorCount: 0,
      recoveryCount: 0,
      lastUpdateTimestamp: 0,
    };

    this.recoveryAttempts.clear();
  }

  /**
   * 옵션 업데이트
   */
  updateOptions(options: Partial<ErrorBoundaryOptions>): void {
    const prevOptions = { ...this.options };
    this.options = { ...this.options, ...options } as Required<ErrorBoundaryOptions>;

    // 성능 로깅 상태 업데이트
    const loggingWasEnabled =
      prevOptions.enablePerformanceMonitoring && prevOptions.performanceLoggingInterval > 0;

    const loggingNowEnabled =
      this.options.enablePerformanceMonitoring && this.options.performanceLoggingInterval > 0;

    if (!loggingWasEnabled && loggingNowEnabled) {
      this.startPerformanceLogging();
    } else if (loggingWasEnabled && !loggingNowEnabled) {
      this.stopPerformanceLogging();
    } else if (
      loggingWasEnabled &&
      loggingNowEnabled &&
      prevOptions.performanceLoggingInterval !== this.options.performanceLoggingInterval
    ) {
      // 로깅 간격 변경 시 재시작
      this.stopPerformanceLogging();
      this.startPerformanceLogging();
    }
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
