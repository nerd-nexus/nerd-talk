import { supabase } from './supabase';

/**
 * 메시지 테이블에 username 컬럼을 추가하고 RLS 정책을 업데이트하는 함수
 */
export const updateSupabaseSchema = async () => {
  try {
    console.log('Supabase 스키마 업데이트 시작...');
    
    // 1. 메시지 테이블에 username 컬럼 추가
    console.log('메시지 테이블에 username 컬럼 추가 시도...');
    const { data: alterTableData, error: alterTableError } = await supabase.rpc(
      'execute_sql', 
      { 
        query: 'ALTER TABLE messages ADD COLUMN IF NOT EXISTS username TEXT;' 
      }
    );
    
    if (alterTableError) {
      console.error('테이블 변경 오류:', alterTableError);
      throw alterTableError;
    }
    
    console.log('username 컬럼 추가 성공:', alterTableData);
    
    // 2. 기존 RLS 정책 삭제
    console.log('기존 RLS 정책 삭제 시도...');
    const { data: dropPolicyData, error: dropPolicyError } = await supabase.rpc(
      'execute_sql',
      {
        query: `
          DROP POLICY IF EXISTS "인증된 사용자만 메시지를 보낼 수 있습니다." ON messages;
        `
      }
    );
    
    if (dropPolicyError) {
      console.error('정책 삭제 오류:', dropPolicyError);
      throw dropPolicyError;
    }
    
    console.log('정책 삭제 성공:', dropPolicyData);
    
    // 3. 새 RLS 정책 생성
    console.log('새 RLS 정책 생성 시도...');
    const { data: createPolicyData, error: createPolicyError } = await supabase.rpc(
      'execute_sql',
      {
        query: `
          CREATE POLICY "모든 사용자가 메시지를 보낼 수 있습니다." 
            ON messages FOR INSERT 
            TO anon
            WITH CHECK (true);
        `
      }
    );
    
    if (createPolicyError) {
      console.error('정책 생성 오류:', createPolicyError);
      throw createPolicyError;
    }
    
    console.log('정책 생성 성공:', createPolicyData);
    
    // 4. 프로필 테이블의 RLS 정책도 업데이트
    console.log('프로필 테이블 정책 업데이트 시도...');
    const { data: profilePolicyData, error: profilePolicyError } = await supabase.rpc(
      'execute_sql',
      {
        query: `
          DROP POLICY IF EXISTS "익명 사용자도 프로필을 생성할 수 있습니다." ON profiles;
          CREATE POLICY "익명 사용자도 프로필을 생성할 수 있습니다." 
            ON profiles FOR INSERT 
            TO anon
            WITH CHECK (true);
        `
      }
    );
    
    if (profilePolicyError) {
      console.error('프로필 정책 업데이트 오류:', profilePolicyError);
      throw profilePolicyError;
    }
    
    console.log('프로필 정책 업데이트 성공:', profilePolicyData);
    
    return { success: true, message: 'Supabase 스키마 및 정책 업데이트가 완료되었습니다.' };
  } catch (error) {
    console.error('Supabase 업데이트 중 오류 발생:', error);
    return { success: false, error };
  }
};
