-- 프로필 테이블에 대한 정책 업데이트
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제
DROP POLICY IF EXISTS "사용자는 자신의 프로필을 볼 수 있습니다." ON profiles;
DROP POLICY IF EXISTS "사용자는 자신의 프로필만 업데이트할 수 있습니다." ON profiles;
DROP POLICY IF EXISTS "익명 사용자도 프로필을 생성할 수 있습니다." ON profiles;

-- 새 정책 생성
CREATE POLICY "모든 사용자가 모든 프로필을 볼 수 있습니다." 
  ON profiles FOR SELECT 
  USING (true);

CREATE POLICY "익명 사용자도 프로필을 생성할 수 있습니다." 
  ON profiles FOR INSERT 
  TO anon
  WITH CHECK (true);

-- 메시지 테이블에 대한 정책 업데이트
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- 기존 정책 삭제
DROP POLICY IF EXISTS "메시지는 누구나 볼 수 있습니다." ON messages;
DROP POLICY IF EXISTS "인증된 사용자만 메시지를 보낼 수 있습니다." ON messages;

-- 새 정책 생성
CREATE POLICY "메시지는 누구나 볼 수 있습니다." 
  ON messages FOR SELECT 
  USING (true);

CREATE POLICY "익명 사용자도 메시지를 보낼 수 있습니다." 
  ON messages FOR INSERT 
  TO anon
  WITH CHECK (true);

-- 프로필 트리거 삭제 (익명 채팅에서는 필요하지 않음)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
