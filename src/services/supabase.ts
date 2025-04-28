import { createClient } from '@supabase/supabase-js';
import { Message, Profile } from '../types';

// Supabase 설정
const supabaseUrl = 'https://wkfhsxptngkvdualktgu.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndrZmhzeHB0bmdrdmR1YWxrdGd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQxNjcwMjQsImV4cCI6MjA1OTc0MzAyNH0.okgaGSM5civ7UPcBLPeUdapVVybSh73kMS5lgMDX03E';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 익명 프로필 생성 또는 가져오기
export const createOrGetProfile = async (userId: string, username: string): Promise<Profile | null> => {
  try {
    // 먼저 프로필이 이미 존재하는지 확인
    const { data: existingProfile, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') {
      // PGRST116는 결과가 없음을 의미 (정상적인 경우)
      throw fetchError;
    }
    
    if (existingProfile) {
      return existingProfile as Profile;
    }
    
    // 프로필이 없으면 새로 생성
    const { data: newProfile, error: insertError } = await supabase
      .from('profiles')
      .insert([{ id: userId, username }])
      .select()
      .single();
    
    if (insertError) {
      throw insertError;
    }
    
    return newProfile as Profile;
  } catch (error) {
    return null;
  }
};

// 프로필 업데이트 (닉네임 변경)
export const updateProfile = async (userId: string, username: string): Promise<Profile | null> => {
  try {
    // 1. 기존 프로필 삭제
    const { error: deleteError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);
    
    if (deleteError) {
      throw deleteError;
    }
    
    // 2. 새 프로필 생성
    const { data: newProfile, error: insertError } = await supabase
      .from('profiles')
      .insert([{ id: userId, username }])
      .select()
      .single();
    
    if (insertError) {
      throw insertError;
    }
    
    return newProfile as Profile;
  } catch (error) {
    return null;
  }
};

// 메시지 가져오기
export const getMessages = async () => {
  const { data, error } = await supabase
    .from('messages')
    .select(`
      *,
      profile:profiles(username, avatar_url)
    `)
    .order('created_at', { ascending: true });
  
  if (error) throw error;
  return data;
};

// 메시지 전송
export const sendMessage = async (userId: string, content: string, username: string) => {
  // 먼저 프로필이 있는지 확인하고 없으면 생성
  const profile = await createOrGetProfile(userId, username);
  
  if (!profile) {
    throw new Error('프로필을 생성할 수 없습니다.');
  }
  
  const { data, error } = await supabase
    .from('messages')
    .insert([{ 
      user_id: userId, 
      content,
      username 
    }]);
  
  if (error) throw error;
  return data;
};

// 실시간 메시지 구독
export const subscribeToMessages = (callback: Function) => {
  return supabase
    .channel('public:messages')
    .on('postgres_changes', { 
      event: 'INSERT', 
      schema: 'public', 
      table: 'messages' 
    }, payload => {
      callback(payload.new);
    })
    .subscribe();
};