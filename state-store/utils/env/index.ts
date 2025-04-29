/**
 * 환경 감지 유틸리티 함수 모음
 * 서버/클라이언트 환경 구분, 브라우저 특성 감지 등
 */

/**
 * 서버 환경인지 확인합니다.
 * @returns 서버 환경이면 true, 클라이언트(브라우저) 환경이면 false
 */
export const isServer = typeof window === 'undefined';

/**
 * 클라이언트(브라우저) 환경인지 확인합니다.
 * @returns 클라이언트 환경이면 true, 서버 환경이면 false
 */
export const isClient = !isServer;

/**
 * 개발 모드인지 확인합니다.
 * @returns 개발 모드면 true, 프로덕션 모드면 false
 */
export const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * 모바일 장치인지 감지합니다 (내부 사용).
 * @private
 * @returns 모바일 장치면 true, 아니면 false, 서버에서는 false
 */
export const isMobileDevice = (): boolean => {
  if (isServer) return false;

  // User Agent 기반 모바일 감지
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

/**
 * 저사양 장치인지 추정합니다 (내부 사용).
 * @private
 * @returns 저사양으로 추정되면 true, 아니면 false
 */
export const isLowEndDevice = (): boolean => {
  if (isServer) return false;

  try {
    // 하드웨어 성능 감지 시도 (하드웨어 동시성 수준)
    if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
      // 2코어 이하를 저사양으로 간주
      if (navigator.hardwareConcurrency <= 2) return true;
    }

    // 모바일 장치는 기본적으로 저사양으로 간주
    if (isMobileDevice()) return true;

    // 화면 크기 휴리스틱
    return window.screen && (window.screen.width < 1024 || window.screen.height < 768);
  } catch {
    // 오류 발생 시 안전한 기본값으로 폴백
    return false;
  }
};

/**
 * 고사양 장치인지 추정합니다 (내부 사용).
 * @private
 * @returns 고사양으로 추정되면 true, 아니면 false
 */
export const isHighEndDevice = (): boolean => {
  if (isServer) return false;

  try {
    // 하드웨어 성능 감지 (하드웨어 동시성 수준)
    if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
      // 8코어 이상을 고사양으로 간주
      if (navigator.hardwareConcurrency >= 8) return true;
    }

    // 모바일 장치는 기본적으로 고사양이 아님
    if (isMobileDevice()) return false;

    // 화면 크기 휴리스틱 - 대형 화면
    return window.screen && (window.screen.width >= 1920 || window.screen.height >= 1080);
  } catch {
    // 오류 발생 시 안전한 기본값으로 폴백
    return false;
  }
};

/**
 * 환경에 최적화된 캐시 크기를 계산합니다.
 * 장치 성능에 따라 다른 캐시 크기를 반환합니다.
 *
 * @param options 캐시 크기 옵션
 * @returns 계산된 캐시 크기
 */
export const calculateCacheSizeByDevice = (
  options: {
    defaultSize?: number;
    lowEndSize?: number;
    highEndSize?: number;
  } = {},
): number => {
  const { defaultSize = 500, lowEndSize = 200, highEndSize = 1000 } = options;

  // 서버 환경에서는 기본 크기 사용
  if (isServer) return defaultSize;

  try {
    // 메모리 기반 캐시 크기 결정 시도 (navigator.deviceMemory가 있는 경우)
    if (typeof navigator !== 'undefined' && 'deviceMemory' in navigator) {
      const deviceMemory = navigator.deviceMemory as number;

      if (deviceMemory <= 2) return lowEndSize; // 2GB 이하 메모리
      if (deviceMemory >= 8) return highEndSize; // 8GB 이상 메모리
    }

    // 장치 휴리스틱 기반 결정
    if (isLowEndDevice()) return lowEndSize;
    if (isHighEndDevice()) return highEndSize;

    return defaultSize;
  } catch {
    // 오류 발생 시 안전한 기본값 사용
    return defaultSize;
  }
};
