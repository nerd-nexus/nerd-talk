import React, { useEffect, useState, useRef } from 'react';
import { supabase, getMessages, sendMessage, subscribeToMessages, createOrGetProfile } from './services/supabase';
import './App.css';
import { Message, Profile } from './types';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [username, setUsername] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isChangingUsername, setIsChangingUsername] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // UUID v4 생성 함수
  const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  // 익명 사용자 생성
  useEffect(() => {
    const createAnonymousUser = async () => {
      try {
        // 랜덤 사용자 이름 생성
        const randomUsername = `익명${Math.floor(Math.random() * 10000)}`;
        
        // UUID 형식의 임시 사용자 ID 생성
        const tempUserId = generateUUID();
        
        // 프로필 생성 또는 가져오기
        const userProfile = await createOrGetProfile(tempUserId, randomUsername);
        
        if (userProfile) {
          setUserId(tempUserId);
          setUsername(randomUsername);
          setNewUsername(randomUsername);
          setProfile(userProfile);
          
          // 로컬 스토리지에 사용자 정보 저장 (세션 유지용)
          localStorage.setItem('anonymousUserId', tempUserId);
          localStorage.setItem('anonymousUsername', randomUsername);
        }
        
        setLoading(false);
        fetchMessages();
        subscribeToNewMessages();
      } catch (error) {
        setLoading(false);
      }
    };

    // 로컬 스토리지에서 기존 사용자 정보 확인
    const savedUserId = localStorage.getItem('anonymousUserId');
    const savedUsername = localStorage.getItem('anonymousUsername');
    
    if (savedUserId && savedUsername) {
      // 기존 프로필 확인
      createOrGetProfile(savedUserId, savedUsername)
        .then(userProfile => {
          if (userProfile) {
            setUserId(savedUserId);
            setUsername(savedUsername);
            setNewUsername(savedUsername);
            setProfile(userProfile);
            setLoading(false);
            fetchMessages();
            subscribeToNewMessages();
          } else {
            createAnonymousUser();
          }
        })
        .catch(() => {
          createAnonymousUser();
        });
    } else {
      createAnonymousUser();
    }
  }, []);

  // 메시지 가져오기
  const fetchMessages = async () => {
    try {
      const data = await getMessages();
      if (data) {
        setMessages(data);
        setTimeout(() => {
          scrollToBottom();
        }, 100);
      }
    } catch (error) {
      // 오류 처리
    }
  };

  // 실시간 메시지 업데이트 구독
  const subscribeToNewMessages = () => {
    const channel = subscribeToMessages((newMessage: Message) => {
      setMessages(prevMessages => {
        // 이미 해당 ID의 메시지가 있는지 확인
        const messageExists = prevMessages.some(msg => msg.id === newMessage.id);
        if (messageExists) {
          return prevMessages;
        }
        const updatedMessages = [...prevMessages, newMessage];
        setTimeout(() => {
          scrollToBottom();
        }, 100);
        return updatedMessages;
      });
    });

    // 채널 리소스 정리
    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  };

  // 스크롤을 맨 아래로 이동
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 메시지 전송
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newMessage.trim() || !userId) return;
    
    try {
      // 로컬에 즉시 표시 (옵티미스틱 UI)
      const optimisticMessage: Message = {
        id: `temp-${Date.now()}`,
        user_id: userId,
        content: newMessage,
        created_at: new Date().toISOString(),
        username
      };
      
      setMessages(prevMessages => [...prevMessages, optimisticMessage]);
      scrollToBottom();
      
      // 메시지 복사 후 입력창 비우기
      const messageToSend = newMessage;
      setNewMessage('');
      
      // 실제 전송
      await sendMessage(userId, messageToSend, username);
    } catch (error) {
      // 오류 발생 시 다시 메시지 입력창에 복원
      setNewMessage(newMessage);
    }
  };

  // 닉네임 변경 (로컬에서만 변경)
  const handleChangeUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newUsername.trim()) return;
    
    try {
      // 로컬 스토리지와 상태만 업데이트
      setUsername(newUsername);
      localStorage.setItem('anonymousUsername', newUsername);
      setIsChangingUsername(false);
    } catch (error) {
      // 오류 처리
    }
  };

  // 메시지 목록이 업데이트될 때마다 스크롤을 맨 아래로 이동
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 로딩 중일 때 표시
  if (loading) {
    return <div className="loading">채팅방에 입장하는 중...</div>;
  }

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>너드 톡</h1>
        <div className="user-info">
          {isChangingUsername ? (
            <form onSubmit={handleChangeUsername} className="username-form">
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="새 닉네임 입력"
                className="username-input"
                autoFocus
              />
              <button type="submit" className="username-save-button">저장</button>
              <button 
                type="button" 
                className="username-cancel-button"
                onClick={() => {
                  setNewUsername(username);
                  setIsChangingUsername(false);
                }}
              >
                취소
              </button>
            </form>
          ) : (
            <>
              <span>{username}</span>
              <button 
                className="change-username-button"
                onClick={() => setIsChangingUsername(true)}
              >
                닉네임 변경
              </button>
            </>
          )}
        </div>
      </header>
      
      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="no-messages">아직 메시지가 없습니다. 첫 메시지를 남겨보세요!</div>
        ) : (
          messages.map(message => (
            <div
              key={message.id}
              className={`message ${message.user_id === userId ? 'my-message' : 'other-message'}`}
            >
              <div className="message-info">
                <span className="message-username">
                  {message.username || (message.profile?.username) || `익명${message.user_id.substring(0, 4)}`}
                </span>
                <span className="message-time">
                  {new Date(message.created_at).toLocaleTimeString()}
                </span>
              </div>
              <div className="message-content">{message.content}</div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      
      <form className="message-form" onSubmit={handleSendMessage}>
        <input
          type="text"
          value={newMessage}
          onChange={e => setNewMessage(e.target.value)}
          placeholder="메시지를 입력하세요..."
          className="message-input"
        />
        <button type="submit" className="send-button">전송</button>
      </form>
    </div>
  );
};

export default App;