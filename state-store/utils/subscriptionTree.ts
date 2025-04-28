/**
 * 경로 기반 구독 트리 시스템
 *
 * 이 시스템은 상태 경로를 기준으로 구독을 구성하여
 * 정확한 알림과 효율적인 업데이트 라우팅을 제공합니다.
 */

// 구독자 유형 정의
export type Subscriber = {
  id: string; // 구독자 고유 ID
  callback: () => void; // 호출될 콜백 함수
  priority: number; // 실행 우선순위 (높을수록 먼저 실행)
  throttle?: number; // 스로틀링 시간 (밀리초)
  lastExecuted?: number; // 마지막 실행 시간
  active: boolean; // 활성 상태 여부
  dependencyPaths: Set<string>; // 의존하는 상태 경로 목록
};

// 와일드카드 유형 구분을 위한 상수
const SINGLE_LEVEL_WILDCARD = 1; // '*'
const MULTI_LEVEL_WILDCARD = 2; // '**'

// 트리 노드 인터페이스 - 와일드카드 분리
interface TreeNode {
  subscribers: Map<string, Subscriber>; // 현재 경로에 직접 구독한 구독자들
  children: Map<string, TreeNode>; // 하위 경로 노드
  singleLevelWildcardNode?: TreeNode; // 단일 레벨 와일드카드 ('*')
  multiLevelWildcardNode?: TreeNode; // 다중 레벨 와일드카드 ('**')
}

/**
 * 구독 트리 관리자 클래스
 */
export class SubscriptionTree {
  private readonly root: TreeNode;
  private subscriberRegistry: Map<string, Subscriber>; // 전체 구독자 레지스트리
  private pathSubscriberMap: Map<string, Set<string>>; // 경로별 구독자 ID 매핑

  // 와일드카드 구독 맵 - 직접 참조용 (성능 최적화)
  private wildcardSubscriberMap: Map<
    string,
    {
      type: typeof SINGLE_LEVEL_WILDCARD | typeof MULTI_LEVEL_WILDCARD;
      parentPath: string;
    }
  >;

  // 성능 통계용 카운터
  private notificationCounter = 0;
  private skippedNotificationCounter = 0;

  constructor() {
    this.root = this.createNode();
    this.subscriberRegistry = new Map();
    this.pathSubscriberMap = new Map();
    this.wildcardSubscriberMap = new Map();
  }
  
  /**
   * 경로 접두사 일치 여부 확인
   * 첫 번째 경로가 두 번째 경로의 접두사인지 확인합니다.
   * @param prefix 접두사 경로 세그먼트 배열
   * @param path 전체 경로 세그먼트 배열
   * @returns prefix가 path의 접두사이면 true
   */
  private isPathPrefixMatch(prefix: string[], path: string[]): boolean {
    if (prefix.length > path.length) return false;
    
    for (let i = 0; i < prefix.length; i++) {
      if (prefix[i] !== path[i]) return false;
    }
    
    return true;
  }

  /**
   * 새 트리 노드 생성
   */
  private createNode(): TreeNode {
    return {
      subscribers: new Map(),
      children: new Map(),
    };
  }

  /**
   * 경로 분해 - 경로 문자열을 세그먼트로 분할
   * @param path 경로 (예: 'users.0.profile.name' 또는 'cart.items[2].price')
   */
  private parsePath(path: string): string[] {
    if (!path) return [];

    // 배열 인덱스 구문(items[2])을 점 구문(items.2)으로 정규화
    const normalizedPath = path.replace(/\[(\d+)]/g, '.$1');

    // 경로 세그먼트 분할
    return normalizedPath.split('.');
  }

  /**
   * 구독자 추가
   * @param subscriberId 구독자 ID
   * @param callback 호출할 콜백 함수
   * @param paths 구독할 상태 경로 배열
   * @param options 구독 옵션
   */
  subscribe(
    subscriberId: string,
    callback: () => void,
    paths: string[],
    options: {
      priority?: number;
      throttle?: number;
    } = {},
  ): () => void {
    // 알림 중일 때는 구독 변경을 지연시킴
    if (this.isNotifying) {
      // 구독 작업을 지연시키기 위해 큐에 추가
      const addSubscriptionLater = () => {
        return this.performSubscribe(subscriberId, callback, paths, options);
      };

      this.pendingSubscriptionChanges.push(addSubscriptionLater);

      // 구독 해제 함수 반환 (지연된 구독 해제 포함)
      return () => {
        if (this.isNotifying) {
          this.pendingSubscriptionChanges.push(() => this.unsubscribe(subscriberId));
        } else {
          this.unsubscribe(subscriberId);
        }
      };
    }

    // 알림 중이 아닐 때는 즉시 구독 처리
    return this.performSubscribe(subscriberId, callback, paths, options);
  }

  /**
   * 실제 구독 처리 로직
   * @private
   */
  private performSubscribe(
    subscriberId: string,
    callback: () => void,
    paths: string[],
    options: {
      priority?: number;
      throttle?: number;
    } = {},
  ): () => void {
    const { priority = 0, throttle } = options;

    // 이미 등록된 구독자라면 업데이트
    if (this.subscriberRegistry.has(subscriberId)) {
      this.unsubscribe(subscriberId);
    }

    // 새 구독자 생성
    const subscriber: Subscriber = {
      id: subscriberId,
      callback,
      priority,
      throttle,
      active: true,
      dependencyPaths: new Set(paths),
    };

    // 전역 레지스트리에 구독자 추가
    this.subscriberRegistry.set(subscriberId, subscriber);

    // 각 경로에 구독자 추가
    for (const path of paths) {
      this.addSubscriberToPath(path, subscriber);

      // 경로-구독자 매핑 업데이트
      if (!this.pathSubscriberMap.has(path)) {
        this.pathSubscriberMap.set(path, new Set());
      }

      // null 단언 대신 안전한 접근 사용
      const subscribers = this.pathSubscriberMap.get(path);
      if (subscribers) {
        subscribers.add(subscriberId);
      }
    }

    // 구독 해제 함수 반환
    return () => {
      if (this.isNotifying) {
        this.pendingSubscriptionChanges.push(() => this.unsubscribe(subscriberId));
      } else {
        this.unsubscribe(subscriberId);
      }
    };
  }

  /**
   * 특정 경로에 구독자 추가 (성능 최적화)
   * @param path 상태 경로
   * @param subscriber 구독자 객체
   */
  private addSubscriberToPath(path: string, subscriber: Subscriber): void {
    const segments = this.parsePath(path);

    // 빈 경로는 루트 노드에 추가
    if (segments.length === 0) {
      this.root.subscribers.set(subscriber.id, subscriber);
      return;
    }

    // 와일드카드 구독 확인 ('*' 또는 '**' 패턴)
    const lastSegment = segments[segments.length - 1];

    if (lastSegment === '*' || lastSegment === '**') {
      // 와일드카드 부모 경로 계산
      const parentSegments = segments.slice(0, -1);
      const parentPath = parentSegments.join('.');
      const node = this.navigateToNode(parentSegments, true);

      if (lastSegment === '*') {
        // 단일 레벨 와일드카드
        if (!node.singleLevelWildcardNode) {
          node.singleLevelWildcardNode = this.createNode();
        }
        node.singleLevelWildcardNode.subscribers.set(subscriber.id, subscriber);

        // 와일드카드 맵에 추가 (조회 성능 최적화)
        this.wildcardSubscriberMap.set(subscriber.id, {
          type: SINGLE_LEVEL_WILDCARD,
          parentPath,
        });
      } else {
        // 다중 레벨 와일드카드 (모든 하위 경로)
        if (!node.multiLevelWildcardNode) {
          node.multiLevelWildcardNode = this.createNode();
        }
        node.multiLevelWildcardNode.subscribers.set(subscriber.id, subscriber);

        // 와일드카드 맵에 추가 (조회 성능 최적화)
        this.wildcardSubscriberMap.set(subscriber.id, {
          type: MULTI_LEVEL_WILDCARD,
          parentPath,
        });
      }
    } else {
      // 일반 경로 구독
      const node = this.navigateToNode(segments, true);
      node.subscribers.set(subscriber.id, subscriber);
    }
  }

  /**
   * 지정된 경로로 트리 노드 탐색 (필요시 생성)
   * @param segments 경로 세그먼트 배열
   * @param createIfMissing 누락된 노드 자동 생성 여부
   */
  private navigateToNode(segments: string[], createIfMissing = false): TreeNode {
    let current = this.root;

    for (const segment of segments) {
      if (!segment) continue; // 빈 세그먼트는 건너뜀

      if (!current.children.has(segment)) {
        if (!createIfMissing) {
          return current; // 노드가 없고 생성하지 않는 경우
        }
        current.children.set(segment, this.createNode());
      }

      const nextNode = current.children.get(segment);
      if (nextNode) {
        current = nextNode;
      }
    }

    return current;
  }

  /**
   * 구독 해제
   * @param subscriberId 구독자 ID
   */
  unsubscribe(subscriberId: string): void {
    // 알림 중일 때는 구독 해제 지연
    if (this.isNotifying) {
      this.pendingSubscriptionChanges.push(() => this.performUnsubscribe(subscriberId));
      return;
    }

    this.performUnsubscribe(subscriberId);
  }

  /**
   * 실제 구독 해제 로직
   * @private
   */
  private performUnsubscribe(subscriberId: string): void {
    const subscriber = this.subscriberRegistry.get(subscriberId);
    if (!subscriber) return;

    // 각 경로에서 구독자 제거
    for (const path of subscriber.dependencyPaths) {
      this.removeSubscriberFromPath(path, subscriberId);

      // 경로-구독자 매핑 업데이트
      const pathSubscribers = this.pathSubscriberMap.get(path);
      if (pathSubscribers) {
        pathSubscribers.delete(subscriberId);
        if (pathSubscribers.size === 0) {
          this.pathSubscriberMap.delete(path);
        }
      }
    }

    // 전역 레지스트리에서 구독자 제거
    this.subscriberRegistry.delete(subscriberId);
  }

  /**
   * 특정 경로에서 구독자 제거 (최적화 버전)
   * @param path 상태 경로
   * @param subscriberId 구독자 ID
   */
  private removeSubscriberFromPath(path: string, subscriberId: string): void {
    // 와일드카드 맵 확인 (O(1) 접근 가능)
    if (this.wildcardSubscriberMap.has(subscriberId)) {
      const wildcard = this.wildcardSubscriberMap.get(subscriberId);
      if (wildcard) {
        const { type, parentPath } = wildcard;
        const parentSegments = this.parsePath(parentPath);
        const node = this.navigateToNode(parentSegments);

        if (node) {
          if (type === SINGLE_LEVEL_WILDCARD && node.singleLevelWildcardNode) {
            node.singleLevelWildcardNode.subscribers.delete(subscriberId);
          } else if (type === MULTI_LEVEL_WILDCARD && node.multiLevelWildcardNode) {
            node.multiLevelWildcardNode.subscribers.delete(subscriberId);
          }
        }

        // 와일드카드 맵에서 제거
        this.wildcardSubscriberMap.delete(subscriberId);
        return;
      }
    }

    const segments = this.parsePath(path);

    // 와일드카드 구독 확인
    const lastSegment = segments[segments.length - 1];
    if (lastSegment === '*' || lastSegment === '**') {
      const parentSegments = segments.slice(0, -1);
      const node = this.navigateToNode(parentSegments);

      if (!node) return;

      if (lastSegment === '*' && node.singleLevelWildcardNode) {
        node.singleLevelWildcardNode.subscribers.delete(subscriberId);
      } else if (lastSegment === '**' && node.multiLevelWildcardNode) {
        node.multiLevelWildcardNode.subscribers.delete(subscriberId);
      }
      return;
    }

    // 일반 경로 구독 제거
    const node = this.navigateToNode(segments);
    if (node) {
      node.subscribers.delete(subscriberId);
    }
  }

  /**
   * 경로 변경에 영향받는 구독자들에게 알림 (성능 최적화 버전)
   * @param changedPaths 변경된 상태 경로 배열
   */
  private notifyingCounter = 0; // 알림 중첩 레벨 추적
  private pendingSubscriptionChanges: Array<() => void> = []; // 보류된 구독 변경

  // 알림 중인지 확인
  private get isNotifying(): boolean {
    return this.notifyingCounter > 0;
  }

  notifySubscribers(changedPaths: string[]): void {
    if (changedPaths.length === 0) return;

    const startTime = performance.now();
    const notifiedSubscribers = new Set<string>();

    // 알림 프로세스 시작 표시 - 카운터 증가
    this.notifyingCounter++;

    try {
      // 일괄 알림을 위한 대상 수집
      const subscribersToNotify = new Map<string, Subscriber>();

      // 각 변경 경로에 대해
      for (const path of changedPaths) {
        const segments = this.parsePath(path);

        // 경로 추적을 위한 변수
        let currentPath = '';

        // 루트 노드 구독자 추가 (스냅샷 생성 - 복사본 만들기)
        const rootSubscribers = Array.from(this.root.subscribers.values());
        for (const subscriber of rootSubscribers) {
          if (subscriber.active && !notifiedSubscribers.has(subscriber.id)) {
            subscribersToNotify.set(subscriber.id, subscriber);
          }
        }

        // 와일드카드 맵을 활용하여 관련 와일드카드 구독자 추가
        for (const [subscriberId, wildcardInfo] of this.wildcardSubscriberMap.entries()) {
          const subscriber = this.subscriberRegistry.get(subscriberId);
          if (!subscriber || !subscriber.active || notifiedSubscribers.has(subscriberId)) continue;

          const { type, parentPath } = wildcardInfo;
          const parentSegments = this.parsePath(parentPath);
          
          // 현재 변경 경로가 와일드카드 구독 패턴과 일치하는지 확인
          if (type === SINGLE_LEVEL_WILDCARD) {
            // 단일 레벨 와일드카드의 경우, 부모 경로에 하나의 추가 세그먼트가 있는지 확인
            if (segments.length === parentSegments.length + 1 && 
                this.isPathPrefixMatch(parentSegments, segments)) {
              subscribersToNotify.set(subscriberId, subscriber);
            }
          } else if (type === MULTI_LEVEL_WILDCARD) {
            // 다중 레벨 와일드카드의 경우, 부모 경로가 현재 경로의 접두사인지 확인
            if (segments.length >= parentSegments.length && 
                this.isPathPrefixMatch(parentSegments, segments)) {
              subscribersToNotify.set(subscriberId, subscriber);
            }
          }
        }
        
        // 기존 트리 순회 방식도 유지 (완전한 마이그레이션을 위한 점진적 접근)
        let currentNode = this.root;

        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          if (!segment) continue; // 빈 세그먼트 건너뛰기

          // 현재 경로 문자열 업데이트
          currentPath = segment ? (currentPath ? `${currentPath}.${segment}` : segment) : currentPath;

          // 단일 레벨 와일드카드 구독자 추가 (스냅샷으로)
          if (currentNode.singleLevelWildcardNode) {
            const wildcardSubscribers = Array.from(currentNode.singleLevelWildcardNode.subscribers.values());
            for (const subscriber of wildcardSubscribers) {
              if (subscriber.active && !notifiedSubscribers.has(subscriber.id)) {
                subscribersToNotify.set(subscriber.id, subscriber);
              }
            }
          }

          // 다중 레벨 와일드카드 구독자 추가 (스냅샷으로)
          if (currentNode.multiLevelWildcardNode) {
            const multiWildcardSubscribers = Array.from(
              currentNode.multiLevelWildcardNode.subscribers.values(),
            );
            for (const subscriber of multiWildcardSubscribers) {
              if (subscriber.active && !notifiedSubscribers.has(subscriber.id)) {
                subscribersToNotify.set(subscriber.id, subscriber);
              }
            }
          }

          // 다음 노드로 이동
          const nextNode = currentNode.children.get(segment);
          if (!nextNode) {
            // 노드가 없으면 새로 생성하지 않고 중단
            break;
          }

          currentNode = nextNode;

          // 현재 노드 구독자 추가 (스냅샷으로)
          const currentSubscribers = Array.from(currentNode.subscribers.values());
          for (const subscriber of currentSubscribers) {
            if (subscriber.active && !notifiedSubscribers.has(subscriber.id)) {
              subscribersToNotify.set(subscriber.id, subscriber);
            }
          }
        }
      }

      // 우선순위에 따라 구독자 정렬
      const sortedSubscribers = Array.from(subscribersToNotify.values()).sort(
        (a, b) => b.priority - a.priority,
      );

      // 현재 시간
      const now = performance.now();

      // 한 번에 구독자 알림 (우선순위별로 정렬된 상태)
      for (const subscriber of sortedSubscribers) {
        // 스로틀링 체크
        if (subscriber.throttle && subscriber.lastExecuted) {
          const elapsed = now - subscriber.lastExecuted;
          if (elapsed < subscriber.throttle) {
            this.skippedNotificationCounter++;
            continue;
          }
        }

        try {
          // 콜백 실행
          subscriber.callback();
          // 실행 시간 기록
          subscriber.lastExecuted = now;
          // 알림 받은 구독자로 표시
          notifiedSubscribers.add(subscriber.id);
        } catch (error) {
          console.error(`[SubscriptionTree] Error in subscriber ${subscriber.id}:`, error);
        }
      }

      // 성능 측정 갱신
      this.notificationCounter += notifiedSubscribers.size;

      // 성능 측정 (개발 모드에서만)
      if (process.env.NODE_ENV !== 'production') {
        const duration = performance.now() - startTime;
        if (duration > 5 || subscribersToNotify.size > 10) {
          // 성능 임계값
          console.debug(
            `[SubscriptionTree] Notification took ${duration.toFixed(2)}ms for ${
              subscribersToNotify.size
            } subscribers (${changedPaths.length} paths)`,
          );
        }
      }
    } finally {
      // 알림 프로세스 종료 표시 - 카운터 감소
      this.notifyingCounter--;

      // 최상위 알림 사이클이 종료된 경우에만 보류된 변경 적용
      if (this.notifyingCounter === 0 && this.pendingSubscriptionChanges.length > 0) {
        const changes = [...this.pendingSubscriptionChanges];
        this.pendingSubscriptionChanges = [];

        // 각 보류된 변경 실행
        for (const change of changes) {
          try {
            change();
          } catch (error) {
            console.error('[SubscriptionTree] Error applying pending subscription change:', error);
          }
        }
      }
    }
  }

  /**
   * 특정 경로에 의존하는 구독자 ID 목록 반환
   * @param path 상태 경로
   */
  getSubscribersForPath(path: string): string[] {
    const result = new Set<string>();
    const segments = this.parsePath(path);

    // 루트 노드부터 시작
    let currentNode = this.root;
    for (const subscriber of currentNode.subscribers.values()) {
      result.add(subscriber.id);
    }

    // 경로를 따라가며 구독자 수집
    let currentPath = '';
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment) continue; // 빈 세그먼트 건너뛰기

      // 현재 노드에 와일드카드 구독이 있는지 확인 (단일 및 다중 레벨)
      if (currentNode.singleLevelWildcardNode) {
        for (const subscriber of currentNode.singleLevelWildcardNode.subscribers.values()) {
          result.add(subscriber.id);
        }
      }

      if (currentNode.multiLevelWildcardNode) {
        for (const subscriber of currentNode.multiLevelWildcardNode.subscribers.values()) {
          result.add(subscriber.id);
        }
      }

      // 다음 노드로 이동
      currentPath = segment ? (currentPath ? `${currentPath}.${segment}` : segment) : currentPath;

      if (!currentNode.children.has(segment)) break;

      const nextNode = currentNode.children.get(segment);
      if (!nextNode) break;

      currentNode = nextNode;

      for (const subscriber of currentNode.subscribers.values()) {
        result.add(subscriber.id);
      }
    }

    return Array.from(result);
  }

  /**
   * 전체 가상 경로별 구독자 맵 생성 (디버깅용)
   */
  getPathSubscriberMap(): Record<string, string[]> {
    const result: Record<string, string[]> = {};

    for (const [path, subscriberIds] of this.pathSubscriberMap.entries()) {
      result[path] = Array.from(subscriberIds);
    }

    return result;
  }

  /**
   * 특정 구독자의 활성 상태 변경
   * @param subscriberId 구독자 ID
   * @param active 활성화 여부
   */
  setSubscriberActive(subscriberId: string, active: boolean): boolean {
    const subscriber = this.subscriberRegistry.get(subscriberId);
    if (!subscriber) return false;

    subscriber.active = active;
    return true;
  }

  /**
   * 성능 통계 정보 반환
   */
  getStats() {
    return {
      totalSubscribers: this.subscriberRegistry.size,
      totalPaths: this.pathSubscriberMap.size,
      notifications: this.notificationCounter,
      skippedNotifications: this.skippedNotificationCounter,
    };
  }

  /**
   * 통계 카운터 초기화
   */
  resetStats() {
    this.notificationCounter = 0;
    this.skippedNotificationCounter = 0;
  }
}
