## 목적

- 바닐라 기반
- 타입스크립트 학습
- 패키지 배포 학습
- 모노레포 학습

## 요구사항

### 유틸성 함수 제작

### 간단한 디자인 시스템 제작

- 참고 레포: https://chakra-ui.com/getting-started
- 시스템을 구성한다 라는 느낌보단, 컴포넌트를 만든다는 느낌으로
- 구현해야 할 것들 
  - input
  - textarea
  - selectbox
  - modal
  - button
  - radio
  - icon
  - slider
  - switch
  - badge
  - tag
  - table
  - progress
  - spinner
  - skeleton
  - toast
  - dialog
  - tooltip
  - popover
- css를 어떻게 관리할 것인가 고민이 필요함
  - 예시: shadow-dom(https://developer.mozilla.org/ko/docs/Web/API/Web_components/Using_shadow_DOM)
  - 웹 컴포넌트

### 채팅 제작

- 채널톡 처럼 만들기 ( 붙일 수 있게 )
- 필요한 기능들
  - 1:n 채팅
  - 채팅방
  - sdk로 제공
  - FE + BE (풀스택)
  - 사진 업로드
  - 관리자 페이지

## 그라운드 룰

- 코드 리뷰 기반으로
- 코드리뷰를 할 때
  - 어떤 기능을 왜 추가 했는지
  - before, after 사진
- 티켓 기반으로 작업을 나눠보기
- 한 개의 티켓에 대한 PR 올리기
- 티켓을 부작업으로 나눌 수 있으면 나눠보기
- 티켓 관리는 github project 기반으로
- 코드리뷰는 48시간 이내로
- 이해 안 되는 부분은 디스코드로 바로 이야기 하기
- 테스트 코드를 작성할 수 있는 형태로 만들어보기
- 디자인 시스템은 스토리북으로 관리하기
- 순수 함수를 최대한 발라내서, 단위테스트 작성하기 
- swc-jest 써보기
- 백엔드는 e2e 테스트
- db는 도커로 관리
- db와 엮여있는 테스트를 하는 경우에는 테스트 db를 만들어서 실행해보기
- ci/cd 구축하기
  - PR올릴 때, tsc, lint, test, build 다 돌려보기
- 배포는 나중에 생각해보기
