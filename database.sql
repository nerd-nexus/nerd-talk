-- 사용자 프로필 테이블 (auth.users 확장)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users NOT NULL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- RLS(Row Level Security) 정책 설정
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "사용자는 자신의 프로필을 볼 수 있습니다." 
  ON profiles FOR SELECT 
  USING (true);
CREATE POLICY "사용자는 자신의 프로필만 업데이트할 수 있습니다." 
  ON profiles FOR UPDATE 
  USING (auth.uid() = id);

-- 메시지 테이블
CREATE TABLE messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- RLS 정책 설정
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "메시지는 누구나 볼 수 있습니다." 
  ON messages FOR SELECT 
  USING (true);
CREATE POLICY "인증된 사용자만 메시지를 보낼 수 있습니다." 
  ON messages FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- 새 사용자가 생성될 때 프로필 자동 생성을 위한 트리거
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();