# Nerd Talk 설정 가이드

이 문서는 Nerd Talk 채팅 앱을 Supabase와 연결하고 실행하는 방법을 상세히 설명합니다.

## 1. Supabase 프로젝트 설정

1. [Supabase](https://app.supabase.io)에 로그인하거나 계정을 생성합니다.
2. 새 프로젝트를 생성합니다 (무료 플랜으로 충분합니다).
3. 프로젝트가 생성되면 SQL 편집기로 이동합니다.
4. `database.sql` 파일의 내용을 복사하여 SQL 편집기에 붙여넣고 실행합니다.
5. 프로젝트 설정에서 다음 정보를 가져옵니다:
   - 프로젝트 URL (Settings > API > Project URL)
   - anon public API 키 (Settings > API > anon public)

## 2. 애플리케이션 구성

1. `src/services/supabase.ts` 파일을 열고 다음 값을 변경합니다:
   ```typescript
   const supabaseUrl = 'YOUR_SUPABASE_URL'; // Supabase 프로젝트 URL로 변경
   const supabaseAnonKey = 'YOUR_SUPABASE_ANON_KEY'; // Supabase anon 키로 변경
   ```

2. Supabase 인증 설정:
   - Supabase 대시보드에서 Authentication > Settings으로 이동
   - Email Auth를 활성화하고 필요한 경우 설정을 조정
   - Site URL이 올바르게 설정되어 있는지 확인

3. 실시간 기능 활성화:
   - Supabase 대시보드에서 Database > Replication으로 이동
   - "Source" 탭에서 "messages" 테이블에 대한 실시간 이벤트를 활성화
   - Insert, Update, Delete 이벤트를 모두 활성화

## 3. 애플리케이션 실행

1. 프로젝트 디렉토리에서 다음 명령어를 실행하여 의존성을 설치합니다:
   ```bash
   npm install
   ```

2. 개발 서버를 시작합니다:
   ```bash
   npm start
   ```

3. 브라우저에서 [http://localhost:3000](http://localhost:3000)으로 접속하여 애플리케이션을 확인합니다.

## 4. 테스트 및 사용

1. 회원가입 및 로그인:
   - 회원가입 양식을 사용하여 새 계정을 생성합니다.
   - 로그인 양식을 사용하여 생성한 계정으로 로그인합니다.

2. 메시지 전송:
   - 로그인 후 채팅방에서 메시지를 입력하고 "전송" 버튼을 클릭합니다.
   - 메시지가 실시간으로 표시되는지 확인합니다.

3. 다중 사용자 테스트:
   - 다른 브라우저나 시크릿 창을 열어 다른 계정으로 로그인합니다.
   - 두 계정 간에 메시지가 실시간으로 동기화되는지 확인합니다.

## 5. 문제 해결

- **인증 오류**: Supabase 인증 설정이 올바르게 구성되어 있는지 확인합니다.
- **실시간 메시지가 작동하지 않음**: Supabase에서 실시간 기능이 활성화되어 있는지 확인합니다.
- **데이터베이스 오류**: SQL 스크립트가 오류 없이 실행되었는지 확인합니다.

## 6. 다음 단계 및 개선 아이디어

- 채팅방 생성 및 관리 기능 추가
- 파일 및 이미지 공유 기능
- 읽음 확인 및 타이핑 표시기
- 푸시 알림 연동
- 사용자 프로필 편집 기능