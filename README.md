# Nerd Talk

간단한 실시간 채팅 애플리케이션입니다. React와 TypeScript를 사용하여 개발되었으며, Supabase를 백엔드로 활용합니다.

## 설치 및 설정

1. 저장소 클론:
```bash
git clone https://github.com/yourusername/nerd-talk.git
cd nerd-talk
```

2. 의존성 설치:
```bash
npm install
```

3. Supabase 프로젝트 설정:
   - Supabase 계정 생성 및 새 프로젝트 만들기: [https://app.supabase.io](https://app.supabase.io)
   - `database.sql` 파일의 SQL을 Supabase SQL 편집기에 붙여넣고 실행
   - 프로젝트 URL과 익명 API 키 복사

4. 환경 변수 설정:
   - `src/services/supabase.ts` 파일에서 `supabaseUrl`과 `supabaseAnonKey`를 복사한 값으로 변경

5. 개발 서버 실행:
```bash
npm start
```

## 주요 기능

- 사용자 인증 (회원가입 및 로그인)
- 실시간 메시지 전송 및 수신
- 간단한 사용자 프로필

## 기술 스택

- React
- TypeScript
- Supabase (인증, 데이터베이스, 실시간 기능)
- CSS (스타일링)

## 데이터 모델

- `profiles`: 사용자 프로필 정보 저장
- `messages`: 채팅 메시지 저장

## 프로젝트 구조

```
/src
  /components        # UI 컴포넌트
  /services          # Supabase 연결 및 API 호출
  /types             # TypeScript 타입 정의
  /context           # React Context (인증 관리)
  App.tsx            # 메인 애플리케이션 컴포넌트
  App.css            # 전역 스타일
  index.tsx          # 애플리케이션 진입점
```

## Supabase 설정

프로젝트에 필요한 Supabase 설정:

1. 인증: 이메일/비밀번호 인증 활성화
2. 데이터베이스: `database.sql` 파일의 스키마 적용
3. 실시간 API: 'messages' 테이블에 대한 실시간 업데이트 활성화