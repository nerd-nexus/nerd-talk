/**
 * LRU(Least Recently Used) 캐시 구현
 * 메모리 사용을 효율적으로 관리하면서 자주 접근하는 항목에 빠른 접근을 제공합니다.
 */

/**
 * LRU 캐시 항목을 표현하는 연결 리스트 노드 인터페이스
 */
interface ILRUNode<K, V> {
  key: K;
  value: V;
  next: ILRUNode<K, V> | null;
  prev: ILRUNode<K, V> | null;
}

/**
 * LRU 캐시 항목을 표현하는 연결 리스트 노드
 */
class LRUNode<K, V> implements ILRUNode<K, V> {
  key: K;
  value: V;
  next: ILRUNode<K, V> | null = null;
  prev: ILRUNode<K, V> | null = null;

  constructor(key: K, value: V) {
    this.key = key;
    this.value = value;
  }
}

/**
 * LRU 캐시 구현
 * @template K - 키 타입
 * @template V - 값 타입
 */
export class LRUCache<K, V> {
  private capacity: number;
  private cache: Map<K, LRUNode<K, V>> = new Map();
  private head: LRUNode<K, V> | null = null; // 가장 최근에 사용됨
  private tail: LRUNode<K, V> | null = null; // 가장 오래 전에 사용됨
  private ttl: number | null = null; // Time To Live (밀리초)
  private timestamps: Map<K, number> = new Map(); // 각 키의 마지막 접근 시간

  /**
   * @param capacity 최대 항목 개수
   * @param ttl 항목의 수명 (밀리초, 선택적)
   */
  constructor(capacity: number, ttl?: number) {
    if (capacity <= 0) {
      throw new Error('Capacity must be a positive number');
    }
    this.capacity = capacity;
    if (ttl !== undefined) {
      this.ttl = ttl;
    }
  }

  /**
   * 캐시에서 키에 해당하는 값을 가져옵니다.
   * 키가 존재하면 해당 노드를 가장 최근에 사용된 위치로 이동합니다.
   * @param key 찾을 키
   * @returns 값 또는 undefined (키가 없거나 만료된 경우)
   */
  get(key: K): V | undefined {
    // 캐시에 키가 없으면 undefined 반환
    if (!this.cache.has(key)) {
      return undefined;
    }

    // TTL 체크 - 만료된 경우 제거하고 undefined 반환
    if (this.ttl !== null) {
      const timestamp = this.timestamps.get(key) || 0;
      const now = Date.now();
      if (now - timestamp > this.ttl) {
        this.delete(key);
        return undefined;
      }
      this.timestamps.set(key, now);
    }

    // 노드를 찾아서 가장 최근 사용 위치로 이동
    const node = this.cache.get(key);
    if (node) {
      this.moveToHead(node);
    }

    return node?.value;
  }

  /**
   * 새로운 키-값 쌍을 캐시에 추가합니다.
   * 캐시가 가득 찼다면 가장 오래 사용되지 않은 항목을 제거합니다.
   * @param key 키
   * @param value 값
   */
  set(key: K, value: V): void {
    // 이미 존재하는 키라면 값 업데이트하고 최근 사용 위치로 이동
    if (this.cache.has(key)) {
      const node = this.cache.get(key);

      if (node) {
        node.value = value;
        this.moveToHead(node);
      }

      if (this.ttl !== null) {
        this.timestamps.set(key, Date.now());
      }
      return;
    }

    // 캐시가 가득 찼다면 가장 오래된 항목 제거
    if (this.cache.size >= this.capacity) {
      this.removeTail();
    }

    // 새 노드 생성 및 맨 앞에 추가
    const newNode = new LRUNode(key, value);

    if (!this.head) {
      // 첫 항목인 경우
      this.head = newNode;
      this.tail = newNode;
    } else {
      // 기존 head 앞에 새 노드 삽입
      newNode.next = this.head;
      this.head.prev = newNode;
      this.head = newNode;
    }

    // 캐시 맵에 노드 추가
    this.cache.set(key, newNode);

    if (this.ttl !== null) {
      this.timestamps.set(key, Date.now());
    }
  }

  /**
   * 캐시에서 키의 존재 여부를 확인합니다.
   * TTL이 설정된 경우 만료 여부도 검사합니다.
   * @param key 확인할 키
   * @returns 키 존재 여부
   */
  has(key: K): boolean {
    if (!this.cache.has(key)) {
      return false;
    }

    // TTL 체크
    if (this.ttl !== null) {
      const timestamp = this.timestamps.get(key) || 0;
      const now = Date.now();
      if (now - timestamp > this.ttl) {
        this.delete(key);
        return false;
      }
    }

    return true;
  }

  /**
   * 캐시에서 키를 제거합니다.
   * @param key 제거할 키
   * @returns 제거 성공 여부
   */
  delete(key: K): boolean {
    if (!this.cache.has(key)) {
      return false;
    }

    const node = this.cache.get(key);

    // 연결 리스트에서 노드 제거
    if (node?.prev) {
      node.prev.next = node.next;
    } else {
      // 노드가 head인 경우
      if (node) {
        this.head = node.next;
      }
    }

    if (node?.next) {
      node.next.prev = node.prev;
    } else {
      // 노드가 tail인 경우
      if (node) {
        this.tail = node.prev;
      }
    }

    // 캐시 맵에서 제거
    this.cache.delete(key);
    this.timestamps.delete(key);

    return true;
  }

  /**
   * 모든 캐시 항목을 제거합니다.
   */
  clear(): void {
    this.cache.clear();
    this.timestamps.clear();
    this.head = null;
    this.tail = null;
  }

  /**
   * 현재 캐시 크기를 반환합니다.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * 캐시의 최대 용량을 반환합니다.
   */
  get maxSize(): number {
    return this.capacity;
  }

  /**
   * 오래된 항목들을 정리합니다.
   * TTL이 설정된 경우 만료된 모든 항목을 제거합니다.
   * @returns 제거된 항목 수
   */
  purgeExpired(): number {
    if (this.ttl === null) {
      return 0;
    }

    const now = Date.now();
    let count = 0;

    // 현재 캐시의 모든 키를 배열로 가져옴
    const keys = Array.from(this.cache.keys());

    for (const key of keys) {
      const timestamp = this.timestamps.get(key) || 0;
      if (now - timestamp > this.ttl) {
        this.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * 지정된 노드를 연결 리스트의 맨 앞으로 이동합니다.
   * @param node 이동할 노드
   */
  private moveToHead(node: LRUNode<K, V>): void {
    if (node === this.head) {
      return; // 이미 맨 앞에 있음
    }

    // 기존 위치에서 노드 제거
    if (node.prev) {
      node.prev.next = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    }
    if (node === this.tail) {
      this.tail = node.prev;
    }

    // 맨 앞에 노드 추가
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    // tail이 없는 경우 (캐시가 비어있었을 때)
    if (!this.tail) {
      this.tail = node;
    }
  }

  /**
   * 가장 오래된 항목(tail)을 제거합니다.
   */
  private removeTail(): void {
    if (!this.tail) return;

    // 캐시 맵에서 제거
    this.cache.delete(this.tail.key);
    this.timestamps.delete(this.tail.key);

    // tail 노드 갱신
    this.tail = this.tail.prev;
    if (this.tail) {
      this.tail.next = null;
    } else {
      // 캐시가 비어있게 됨
      this.head = null;
    }
  }

  /**
   * 캐시의 모든 키를 배열로 반환합니다.
   * (가장 최근 사용된 순서로 정렬됨)
   */
  keys(): K[] {
    const result: K[] = [];
    let current = this.head;

    while (current) {
      result.push(current.key);
      current = current.next;
    }

    return result;
  }

  /**
   * 캐시의 모든 값을 배열로 반환합니다.
   * (가장 최근 사용된 순서로 정렬됨)
   */
  values(): V[] {
    const result: V[] = [];
    let current = this.head;

    while (current) {
      result.push(current.value);
      current = current.next;
    }

    return result;
  }

  /**
   * 캐시의 모든 항목을 [키, 값] 쌍의 배열로 반환합니다.
   * (가장 최근 사용된 순서로 정렬됨)
   */
  entries(): [K, V][] {
    const result: [K, V][] = [];
    let current = this.head;

    while (current) {
      result.push([current.key, current.value]);
      current = current.next;
    }

    return result;
  }
}
