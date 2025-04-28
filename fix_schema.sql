-- 이 SQL 스크립트는 익명 채팅을 위한 데이터베이스 스키마를 수정합니다.

-- 1. profiles 테이블의 외래 키 제약 조건 수정
-- 기존 profiles 테이블의 auth.users 참조를 제거합니다.
ALTER TABLE profiles
DROP CONSTRAINT profiles_id_fkey;

-- 2. messages 테이블의 외래 키 제약 조건 변경
-- 기존 user_id -> profiles.id 참조를 잠시 제거
ALTER TABLE messages
DROP CONSTRAINT messages_user_id_fkey;

-- 3. messages 테이블에 username 열 추가 (이미 있다면 무시)
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS username TEXT;

-- 4. profiles 테이블에 익명 사용자 생성 가능하도록 RLS 정책 변경
DROP POLICY IF EXISTS "사용자는 자신의 프로필을 볼 수 있습니다." ON profiles;
DROP POLICY IF EXISTS "사용자는 자신의 프로필만 업데이트할 수 있습니다." ON profiles;
DROP POLICY IF EXISTS "익명 사용자도 프로필을 생성할 수 있습니다." ON profiles;

CREATE POLICY "누구나 모든 프로필을 볼 수 있습니다." 
  ON profiles FOR SELECT 
  USING (true);

CREATE POLICY "누구나 프로필을 생성할 수 있습니다." 
  ON profiles FOR INSERT 
  TO anon
  WITH CHECK (true);

-- 5. messages 테이블 RLS 정책 변경
DROP POLICY IF EXISTS "메시지는 누구나 볼 수 있습니다." ON messages;
DROP POLICY IF EXISTS "인증된 사용자만 메시지를 보낼 수 있습니다." ON messages;
DROP POLICY IF EXISTS "익명 사용자도 메시지를 보낼 수 있습니다." ON messages;

CREATE POLICY "메시지는 누구나 볼 수 있습니다." 
  ON messages FOR SELECT 
  USING (true);

CREATE POLICY "누구나 메시지를 보낼 수 있습니다." 
  ON messages FOR INSERT 
  TO anon
  WITH CHECK (true);

-- 6. messages 테이블에 다시 외래 키 제약 조건 추가 (CASCADE 옵션 포함)
ALTER TABLE messages
ADD CONSTRAINT messages_user_id_fkey
FOREIGN KEY (user_id) REFERENCES profiles(id)
ON DELETE CASCADE;
