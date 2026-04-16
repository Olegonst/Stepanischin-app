/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { onAuthStateChanged, User as FirebaseUser, RecaptchaVerifier, signInWithPhoneNumber, ConfirmationResult } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, orderBy, limit, Timestamp, addDoc, serverTimestamp } from 'firebase/firestore';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from './components/ui/avatar';
import { ScrollArea } from './components/ui/scroll-area';
import { Separator } from './components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Badge } from './components/ui/badge';
import { MessageSquare, Video, Image as ImageIcon, Users, User as UserIcon, Search, Settings, Plus, Send, Phone, MoreVertical, Heart, Play, LogOut, Shield, EyeOff, X, Trash2, Ban, ShieldAlert } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster } from './components/ui/sonner';
import { toast } from 'sonner';
import Peer from 'peerjs';

// --- Types ---
interface UserProfile {
  uid: string;
  phoneNumber: string;
  displayName: string;
  photoURL: string;
  backgroundURL?: string;
  nickname: string;
  bio: string;
  status: string;
  isPrivate: boolean;
  isIncognito: boolean;
  isPremium?: boolean;
  isAdmin?: boolean;
  isBlocked?: boolean;
  lastSeen: any;
  createdAt: any;
}

interface Chat {
  id: string;
  type: 'private' | 'group' | 'channel';
  name?: string;
  members: string[];
  lastMessage?: any;
}

interface Message {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  type: 'text' | 'file' | 'video_call';
  createdAt: any;
}

// --- Constants ---
const ADMIN_PHONE = '+79250257141';
const ADMIN_PASSWORD = 'Deceased070707';
const LOGO_URL = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj48cGF0aCBmaWxsPSIjQzVBMDU5IiBkPSJNMjU2IDhDMTE5IDggOCAxMTkgOCAyNTZzMTExIDI0OCAyNDggMjQ4IDI0OC0xMTEgMjQ4LTI0OFMxOTMgOCAyNTYgOHptMCA0NDhjLTExMCAwLTIwMC05MC0yMDAtMjAwUzE0NiA1NiAyNTYgNTZzMjAwIDkwIDIwMCAyMDBzLTkwIDIwMC0yMDAgMjAweiIvPjxwYXRoIGZpbGw9IiNDNUEwNTkiIGQ9Ik0yNTYgOTZjLTcwIDAtMTI4IDU4LTEyOCAxMjh2NjRjMCA3MCA1OCAxMjggMTI4IDEyOHMxMjgtNTggMTI4LTEyOHYtNjRjMC03MC01OC0xMjgtMTI4LTEyOHptNjQgMTI4YzAgMTgtMTQgMzItMzIgMzJzLTMyLTE0LTMyLTMyczE0LTMyIDMyLTMyczMyIDE0IDMyIDMyem0tMTI4IDBjMCAxOC0xNCAzMi0zMiAzMnMtMzItMTQtMzItMzJzMTQtMzIgMzItMzJzMzIgMTQgMzIgMzJ6bTY0IDEyOGMtMzUgMC02NC0yOS02NC02NGgxMjhjMCAzNS0yOSA2NC02NCA2NHoiLz48L3N2Zz4=';

// --- Helpers ---
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

// --- Components ---

function Auth({ onAuthSuccess, appLogo }: { onAuthSuccess: (user: FirebaseUser) => void; appLogo: string }) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAdminLogin, setIsAdminLogin] = useState(false);
  const [isIframe, setIsIframe] = useState(false);

  useEffect(() => {
    setIsIframe(window.self !== window.top);
  }, []);

  useEffect(() => {
    const normalized = phoneNumber.replace(/\D/g, '');
    const adminNormalized = ADMIN_PHONE.replace(/\D/g, '');
    setIsAdminLogin(normalized === adminNormalized && normalized.length > 0);
  }, [phoneNumber]);

  const recaptchaRef = useRef<HTMLDivElement>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    if (recaptchaRef.current && !recaptchaVerifierRef.current) {
      console.log('Initializing reCAPTCHA on ref...');
      try {
        const verifier = new RecaptchaVerifier(auth, recaptchaRef.current, {
          size: 'normal',
          callback: (response: any) => {
            console.log('reCAPTCHA solved successfully');
          },
          'expired-callback': () => {
            console.log('reCAPTCHA expired');
          }
        });
        recaptchaVerifierRef.current = verifier;
        verifier.render().then((widgetId) => {
          console.log('reCAPTCHA rendered, widgetId:', widgetId);
        });
      } catch (error) {
        console.error('reCAPTCHA init error:', error);
      }
    }
    
    return () => {
      if (recaptchaVerifierRef.current) {
        try {
          recaptchaVerifierRef.current.clear();
          recaptchaVerifierRef.current = null;
        } catch (e) {
          console.error('Cleanup error:', e);
        }
      }
    };
  }, []);

  const handleSendCode = async () => {
    let normalized = phoneNumber.replace(/\D/g, '');
    if (normalized.startsWith('8') && normalized.length === 11) {
      normalized = '+7' + normalized.substring(1);
    } else if (!normalized.startsWith('+')) {
      normalized = '+' + normalized;
    }
    
    console.log('Button clicked. Normalized number:', normalized);
    
    if (isAdminLogin && (!adminPassword || adminPassword !== ADMIN_PASSWORD)) {
      toast.error('Invalid admin credentials');
      return;
    }

    setLoading(true);
    try {
      console.log('Accessing verifier...');
      const appVerifier = recaptchaVerifierRef.current;
      if (!appVerifier) {
        console.error('Verifier is null!');
        throw new Error('reCAPTCHA not ready. Please refresh the page.');
      }
      
      console.log('Calling signInWithPhoneNumber now...');
      const result = await signInWithPhoneNumber(auth, normalized, appVerifier);
      console.log('Success! Result received.');
      setConfirmationResult(result);
      toast.success('Code sent!');
    } catch (error: any) {
      console.error('Auth Error Details:', error);
      toast.error(error.message || 'Authentication failed');
      
      if (recaptchaVerifierRef.current && (window as any).grecaptcha) {
        try {
          const id = await recaptchaVerifierRef.current.render();
          (window as any).grecaptcha.reset(id);
          console.log('reCAPTCHA reset after error');
        } catch (e) {
          console.error('Reset error:', e);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!confirmationResult) return;
    setLoading(true);
    try {
      const result = await confirmationResult.confirm(verificationCode);
      onAuthSuccess(result.user);
    } catch (error) {
      console.error(error);
      toast.error('Invalid verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    try {
      const { clearIndexedDbPersistence } = await import('firebase/firestore');
      await clearIndexedDbPersistence(db);
      toast.success('Connection reset. Reloading...');
      setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
      console.error('Reset error:', error);
      window.location.reload();
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0A0A0A] p-4">
      <Card className="w-full max-w-md bg-[#121214] border-white/10">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-24 h-24 rounded-full bg-[#1C1C1E] border border-[#C5A059]/30 p-1 shadow-[0_0_30px_rgba(197,160,89,0.15)] overflow-hidden">
              <img 
                src={appLogo} 
                alt="Logo" 
                className="w-full h-full object-cover rounded-full"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
          <CardTitle className="text-3xl font-gothic text-[#C5A059] tracking-tight">St.messenger</CardTitle>
          <CardDescription className="text-[#A1A1AA]">
            {confirmationResult ? 'Enter verification code' : 'Enter your phone number to continue'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isIframe && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-2 text-[10px] text-amber-500 flex items-start gap-2">
              <ShieldAlert size={14} className="shrink-0 mt-0.5" />
              <p>Phone Auth may fail in preview. If it doesn't work, click "Open in new tab" in the top right corner.</p>
            </div>
          )}

          {!confirmationResult ? (
            <>
              <Input
                className="bg-[#1C1C1E] border-white/10 text-white placeholder:text-[#A1A1AA]/50"
                placeholder="+7 900 000 0000"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
              {isAdminLogin && (
                <Input
                  type="password"
                  className="bg-[#1C1C1E] border-white/10 text-white placeholder:text-[#A1A1AA]/50"
                  placeholder="Admin Password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                />
              )}
              <Button 
                className="w-full bg-[#C5A059] text-black hover:bg-[#C5A059]/90 font-bold" 
                onClick={handleSendCode} 
                disabled={loading}
              >
                {loading ? 'Sending...' : 'Send Verification Code'}
              </Button>

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/5"></div></div>
                <div className="relative flex justify-center text-[10px] uppercase tracking-widest text-[#A1A1AA] bg-[#121214] px-2">Or</div>
              </div>

              <Button 
                variant="outline"
                className="w-full border-white/10 hover:bg-white/5 h-10 flex items-center justify-center gap-2 text-xs"
                onClick={async () => {
                  try {
                    const { signInWithPopup } = await import('firebase/auth');
                    const { googleProvider } = await import('./lib/firebase');
                    const result = await signInWithPopup(auth, googleProvider);
                    onAuthSuccess(result.user);
                  } catch (error: any) {
                    toast.error(error.message || 'Google login failed');
                  }
                }}
              >
                <img src="https://www.gstatic.com/firebase/anonymous-scan.png" className="w-4 h-4 invert" alt="" />
                Sign in with Google
              </Button>
            </>
          ) : (
            <>
              <Input
                className="bg-[#1C1C1E] border-white/10 text-white placeholder:text-[#A1A1AA]/50"
                placeholder="Verification Code"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
              />
              <Button 
                className="w-full bg-[#C5A059] text-black hover:bg-[#C5A059]/90 font-bold" 
                onClick={handleVerifyCode} 
                disabled={loading}
              >
                {loading ? 'Verifying...' : 'Verify Code'}
              </Button>
            </>
          )}
          <div ref={recaptchaRef} className="flex justify-center my-2 min-h-[80px]"></div>
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full mt-4 text-gray-400 hover:text-white"
            onClick={handleReset}
          >
            Reset Connection
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SetupProfile({ user, onComplete, appLogo }: { user: FirebaseUser; onComplete: () => void; appLogo: string }) {
  const [nickname, setNickname] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!nickname) return toast.error('Nickname is required');
    setLoading(true);
    try {
      const profile: UserProfile = {
        uid: user.uid,
        phoneNumber: user.phoneNumber || '',
        displayName: displayName || user.phoneNumber || 'User',
        photoURL: appLogo,
        nickname: nickname.toLowerCase(),
        bio: '',
        status: 'Hey there! I am using Messenger.',
        isPrivate: false,
        isIncognito: false,
        lastSeen: serverTimestamp(),
        createdAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'users', user.uid), profile);
      onComplete();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0A0A0A] p-4">
      <Card className="w-full max-w-md bg-[#121214] border-white/10">
        <CardHeader>
          <CardTitle className="text-2xl font-gothic text-[#C5A059]">Complete your profile</CardTitle>
          <CardDescription className="text-[#A1A1AA]">Choose a unique nickname and display name</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            className="bg-[#1C1C1E] border-white/10 text-white placeholder:text-[#A1A1AA]/50"
            placeholder="Nickname (e.g. john_doe)"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          <Input
            className="bg-[#1C1C1E] border-white/10 text-white placeholder:text-[#A1A1AA]/50"
            placeholder="Display Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Button 
            className="w-full bg-[#C5A059] text-black hover:bg-[#C5A059]/90 font-bold" 
            onClick={handleSave} 
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Start Messaging'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [appLogo, setAppLogo] = useState(LOGO_URL);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('chats');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editForm, setEditForm] = useState({
    displayName: '',
    nickname: '',
    bio: '',
    photoURL: '',
    backgroundURL: '',
    globalLogo: ''
  });

  // Listen for Global Config
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'config', 'general'), (doc) => {
      if (doc.exists() && doc.data().appLogo) {
        setAppLogo(doc.data().appLogo);
      }
    });
    return unsubscribe;
  }, []);

  // Load profile into edit form when opening
  useEffect(() => {
    if (profile && isEditingProfile) {
      setEditForm({
        displayName: profile.displayName || '',
        nickname: profile.nickname || '',
        bio: profile.bio || '',
        photoURL: profile.photoURL || '',
        backgroundURL: profile.backgroundURL || '',
        globalLogo: appLogo
      });
    }
  }, [profile, isEditingProfile, appLogo]);

  const handleUpdateProfile = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Update User Profile
      await updateDoc(doc(db, 'users', user.uid), {
        displayName: editForm.displayName,
        nickname: editForm.nickname,
        bio: editForm.bio,
        photoURL: editForm.photoURL,
        backgroundURL: editForm.backgroundURL,
        updatedAt: serverTimestamp()
      });

      // Update Global Logo if Admin
      if (profile?.isAdmin && editForm.globalLogo !== appLogo) {
        await setDoc(doc(db, 'config', 'general'), { 
          appLogo: editForm.globalLogo,
          updatedBy: user.uid,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }

      toast.success('Cabinet updated successfully');
      setIsEditingProfile(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setLoading(false);
    }
  };

  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatProfile, setSelectedChatProfile] = useState<UserProfile | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);

  // PeerJS for Video Calls
  const [peer, setPeer] = useState<Peer | null>(null);
  const [myStream, setMyStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCalling, setIsCalling] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        const docRef = doc(db, 'users', u.uid);
        const unsubscribeProfile = onSnapshot(docRef, async (docSnap) => {
          if (docSnap.exists()) {
            setProfile(docSnap.data() as UserProfile);
          } else {
            const newProfile: UserProfile = {
              uid: u.uid,
              phoneNumber: u.phoneNumber || '',
              displayName: u.displayName || 'User',
              photoURL: LOGO_URL,
              nickname: u.phoneNumber?.slice(-4) || 'user',
              status: 'online',
              lastSeen: Timestamp.now(),
              createdAt: serverTimestamp(),
              bio: 'Hey there! I am using St.messenger',
              isPrivate: false,
              isIncognito: false,
              isPremium: false,
              isAdmin: u.phoneNumber === ADMIN_PHONE
            };
            await setDoc(docRef, newProfile);
          }
          setLoading(false);
        }, (error) => {
          handleFirestoreError(error, OperationType.GET, `users/${u.uid}`);
          setLoading(false);
        });

        const newPeer = new Peer(u.uid);
        setPeer(newPeer);
        newPeer.on('call', (call) => {
          navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
            setMyStream(stream);
            call.answer(stream);
            call.on('stream', (remote) => {
              setRemoteStream(remote);
              setIsCalling(true);
            });
          });
        });

        return () => {
          unsubscribeProfile();
          newPeer.destroy();
        };
      } else {
        setProfile(null);
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  // Listen for Chats
  useEffect(() => {
    if (!user) return;
    const isAdmin = user.phoneNumber === ADMIN_PHONE;
    const q = isAdmin 
      ? query(collection(db, 'chats')) 
      : query(collection(db, 'chats'), where('members', 'array-contains', user.uid));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Chat));
      setChats(chatList);
    });
    return unsubscribe;
  }, [user]);

  // Listen for Selected Chat Profile
  useEffect(() => {
    if (!selectedChat || !user) return;
    const otherMemberId = selectedChat.members.find(m => m !== user.uid);
    if (!otherMemberId) {
      setSelectedChatProfile(null);
      return;
    }
    const unsubscribe = onSnapshot(doc(db, 'users', otherMemberId), (doc) => {
      setSelectedChatProfile(doc.data() as UserProfile);
    });
    return unsubscribe;
  }, [selectedChat, user]);

  // Listen for Messages
  useEffect(() => {
    if (!selectedChat) return;
    const q = query(collection(db, `chats/${selectedChat.id}/messages`), orderBy('createdAt', 'asc'), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      setMessages(msgList);
    });
    return unsubscribe;
  }, [selectedChat]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedChat || !user) return;
    const msg = newMessage;
    setNewMessage('');
    try {
      await addDoc(collection(db, `chats/${selectedChat.id}/messages`), {
        chatId: selectedChat.id,
        senderId: user.uid,
        text: msg,
        type: 'text',
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `chats/${selectedChat.id}/messages`);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    const q = query(
      collection(db, 'users'), 
      where('nickname', '>=', searchQuery.toLowerCase()), 
      where('nickname', '<=', searchQuery.toLowerCase() + '\uf8ff')
    );
    const unsubscribe = onSnapshot(q, (s) => {
      const results = s.docs
        .map(d => d.data() as UserProfile)
        .filter(u => u.phoneNumber !== ADMIN_PHONE && u.uid !== user?.uid); // Filter out admin and self
      setSearchResults(results);
    });
    return () => unsubscribe();
  };

  const startVideoCall = (targetUid: string) => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
      setMyStream(stream);
      const call = peer?.call(targetUid, stream);
      call?.on('stream', (remote) => {
        setRemoteStream(remote);
        setIsCalling(true);
      });
    });
  };

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  if (!user) return <Auth onAuthSuccess={setUser} appLogo={appLogo} />;

  if (!profile) return <SetupProfile user={user} onComplete={() => window.location.reload()} appLogo={appLogo} />;

  if (profile.isBlocked) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0A0A0A] p-4 text-center">
        <Card className="w-full max-w-md bg-[#121214] border-red-500/30">
          <CardHeader>
            <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <CardTitle className="text-2xl font-gothic text-red-500">Access Denied</CardTitle>
            <CardDescription className="text-[#A1A1AA]">
              Your account has been blocked by an administrator.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full border-white/10" onClick={() => auth.signOut()}>
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#0A0A0A] text-white overflow-hidden font-sans">
      <Toaster />
      
      {/* Sidebar Navigation (Navigation Rail) */}
      <div className="w-[72px] border-r border-white/10 flex flex-col items-center py-6 space-y-8 bg-[#121214]">
        <div className="w-10 h-10 rounded-lg bg-[#1C1C1E] border border-[#C5A059]/20 p-0.5 shadow-[0_0_15px_rgba(197,160,89,0.1)] overflow-hidden">
          <img 
            src={appLogo} 
            alt="Logo" 
            className="w-full h-full object-cover rounded-md"
            referrerPolicy="no-referrer"
          />
        </div>
        <nav className="flex-1 flex flex-col space-y-6">
          {[
            { id: 'chats', icon: MessageSquare, label: 'Chats' },
            { id: 'stories', icon: ImageIcon, label: 'Stories' },
            { id: 'reels', icon: Play, label: 'Reels' },
            { id: 'search', icon: Search, label: 'Search' },
            { id: 'settings', icon: Settings, label: 'Settings' },
            ...(profile.isAdmin ? [{ id: 'admin', icon: Shield, label: 'Admin' }] : []),
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`p-3 rounded-xl transition-all relative group ${
                activeTab === item.id ? 'bg-[#1C1C1E] text-[#C5A059] shadow-[0_0_15px_rgba(197,160,89,0.2)]' : 'text-[#A1A1AA] hover:bg-[#1C1C1E]'
              }`}
            >
              <item.icon size={22} />
              <span className="absolute left-full ml-4 px-2 py-1 bg-[#1C1C1E] text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 uppercase tracking-widest">
                {item.label}
              </span>
            </button>
          ))}
        </nav>
        <div className="flex flex-col items-center space-y-6">
           <button onClick={() => auth.signOut()} className="p-3 text-[#A1A1AA] hover:text-red-500 transition-colors">
            <LogOut size={22} />
          </button>
          <button 
            onClick={() => setIsEditingProfile(true)}
            className="w-10 h-10 rounded-full border border-[#C5A059] p-0.5 cursor-pointer hover:scale-110 transition-transform overflow-hidden"
          >
            <Avatar className="w-full h-full">
              <AvatarImage src={profile.photoURL} className="rounded-full" />
              <AvatarFallback>{profile.displayName?.[0] || '?'}</AvatarFallback>
            </Avatar>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div 
        className="flex-1 flex overflow-hidden relative"
        style={{ 
          backgroundImage: profile.backgroundURL ? `linear-gradient(rgba(10, 10, 10, 0.85), rgba(10, 10, 10, 0.85)), url(${profile.backgroundURL})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
      >
        {/* Profile Edit Modal */}
        <AnimatePresence>
          {isEditingProfile && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="bg-[#121214] border border-white/10 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl"
              >
                <div className="p-6 border-b border-white/10 flex justify-between items-center bg-[#1C1C1E]">
                  <h2 className="text-xl font-serif italic text-[#C5A059]">Edit Cabinet</h2>
                  <Button variant="ghost" size="icon" onClick={() => setIsEditingProfile(false)} className="text-[#A1A1AA]">
                    <X size={20} />
                  </Button>
                </div>
                <ScrollArea className="max-h-[70vh] p-6">
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-[#A1A1AA]">Avatar Image</label>
                      <div className="flex gap-4 items-center">
                        <Avatar className="w-16 h-16 border border-[#C5A059]">
                          <AvatarImage src={editForm.photoURL} />
                          <AvatarFallback>?</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 space-y-2">
                          <Input 
                            type="file"
                            accept="image/*"
                            className="bg-[#1C1C1E] border-white/10 text-xs" 
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const base64 = await fileToBase64(file);
                                setEditForm({...editForm, photoURL: base64});
                              }
                            }}
                          />
                          <Input 
                            className="bg-[#1C1C1E] border-white/10 text-xs" 
                            placeholder="Or paste image URL..." 
                            value={editForm.photoURL}
                            onChange={e => setEditForm({...editForm, photoURL: e.target.value})}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-[#A1A1AA]">Background Image (Cabinet Wall)</label>
                      <div className="space-y-2">
                        <Input 
                          type="file"
                          accept="image/*"
                          className="bg-[#1C1C1E] border-white/10 text-xs" 
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const base64 = await fileToBase64(file);
                              setEditForm({...editForm, backgroundURL: base64});
                            }
                          }}
                        />
                        <Input 
                          className="bg-[#1C1C1E] border-white/10 text-xs" 
                          placeholder="Or paste background URL..." 
                          value={editForm.backgroundURL}
                          onChange={e => setEditForm({...editForm, backgroundURL: e.target.value})}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest text-[#A1A1AA]">Display Name</label>
                        <Input 
                          className="bg-[#1C1C1E] border-white/10" 
                          value={editForm.displayName}
                          onChange={e => setEditForm({...editForm, displayName: e.target.value})}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest text-[#A1A1AA]">Nickname</label>
                        <Input 
                          className="bg-[#1C1C1E] border-white/10" 
                          value={editForm.nickname}
                          onChange={e => setEditForm({...editForm, nickname: e.target.value})}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest text-[#A1A1AA]">Bio / Cabinet Description</label>
                      <textarea 
                        className="w-full bg-[#1C1C1E] border border-white/10 rounded-lg p-3 text-sm min-h-[100px] focus:outline-none focus:ring-1 focus:ring-[#C5A059]/50"
                        placeholder="Describe your cabinet..."
                        value={editForm.bio}
                        onChange={e => setEditForm({...editForm, bio: e.target.value})}
                      />
                    </div>

                    {profile?.isAdmin && (
                      <div className="space-y-2 pt-4 border-t border-white/5">
                        <label className="text-[10px] uppercase tracking-widest text-[#C5A059] font-bold">Global App Logo (Admin Only)</label>
                        <div className="space-y-2">
                          <Input 
                            type="file"
                            accept="image/*"
                            className="bg-[#1C1C1E] border-[#C5A059]/20 text-xs" 
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const base64 = await fileToBase64(file);
                                setEditForm({...editForm, globalLogo: base64});
                              }
                            }}
                          />
                          <Input 
                            className="bg-[#1C1C1E] border-[#C5A059]/20 text-xs" 
                            placeholder="Or paste global logo URL..." 
                            value={editForm.globalLogo}
                            onChange={e => setEditForm({...editForm, globalLogo: e.target.value})}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>
                <div className="p-6 border-t border-white/10 bg-[#1C1C1E] flex gap-3">
                  <Button variant="outline" className="flex-1 border-white/10" onClick={() => setIsEditingProfile(false)}>Cancel</Button>
                  <Button className="flex-1 bg-[#C5A059] text-black hover:bg-[#C5A059]/90" onClick={handleUpdateProfile} disabled={loading}>
                    {loading ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* List Column (Sidebar) */}
        <div className="w-[320px] border-r border-white/10 flex flex-col bg-[#121214]">
          <div className="p-6 border-b border-white/10">
            <div className="flex justify-between items-center mb-6">
              <h1 className="text-xl font-medium tracking-tight font-serif italic">{activeTab}</h1>
              {activeTab === 'chats' && (
                <Button variant="ghost" size="icon" className="rounded-full hover:bg-[#1C1C1E] text-[#A1A1AA]">
                  <Plus size={18} />
                </Button>
              )}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA]" size={14} />
              <Input 
                className="pl-9 bg-[#1C1C1E] border border-white/5 h-10 rounded-lg text-xs focus-visible:ring-1 focus-visible:ring-[#C5A059]/30" 
                placeholder="Search @nickname or number..." 
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (activeTab === 'search') handleSearch();
                }}
              />
            </div>
          </div>
          
          <ScrollArea className="flex-1">
            {activeTab === 'chats' && (
              <div className="p-3 space-y-1">
                <div className="text-[10px] uppercase tracking-[0.1em] text-[#A1A1AA] px-3 py-2">Pinned Chats</div>
                {chats.length === 0 ? (
                  <div className="text-center py-10 text-[#A1A1AA]">
                    <p className="text-xs">No conversations yet</p>
                  </div>
                ) : (
                  chats.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => setSelectedChat(chat)}
                      className={`w-full flex items-center p-3 rounded-xl transition-all ${
                        selectedChat?.id === chat.id ? 'bg-[#1C1C1E]' : 'hover:bg-[#1C1C1E]/50'
                      }`}
                    >
                      <div className="relative">
                        <Avatar className="w-12 h-12">
                          <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${chat.id}`} />
                          <AvatarFallback>C</AvatarFallback>
                        </Avatar>
                        <div className="absolute bottom-0.5 right-0.5 w-3 h-3 bg-[#4ADE80] border-2 border-[#121214] rounded-full" />
                      </div>
                      <div className="ml-3 flex-1 text-left">
                        <div className="flex justify-between items-center">
                          <span className="font-medium text-sm text-white">{chat.name || 'Conversation'}</span>
                          <span className="text-[10px] text-[#A1A1AA] opacity-50">12:45</span>
                        </div>
                        <p className="text-xs text-[#A1A1AA] truncate mt-1">
                          {chat.lastMessage?.text || 'Can you send those architectural files?'}
                        </p>
                      </div>
                    </button>
                  ))
                )}
                <div className="text-[10px] uppercase tracking-[0.1em] text-[#A1A1AA] px-3 py-2 mt-4">Channels & Rooms</div>
                <div className="w-full flex items-center p-3 rounded-xl hover:bg-[#1C1C1E]/50 cursor-pointer">
                  <div className="w-12 h-12 bg-[#2D2D30] rounded-xl flex items-center justify-center text-xs text-[#A1A1AA]">TN</div>
                  <div className="ml-3 flex-1 text-left">
                    <div className="font-medium text-sm text-white">Tech Noir [HQ]</div>
                    <p className="text-xs text-[#A1A1AA] mt-1">8.4k members online</p>
                  </div>
                </div>
              </div>
            )}
            
            {activeTab === 'search' && (
              <div className="p-3 space-y-1">
                {searchResults.map((res) => (
                  <div 
                    key={res.uid} 
                    className="flex items-center p-3 rounded-xl hover:bg-[#1C1C1E] transition-colors cursor-pointer"
                    onClick={() => setSelectedChatProfile(res)}
                  >
                    <Avatar className="w-12 h-12">
                      <AvatarImage src={res.photoURL} />
                      <AvatarFallback>{res.displayName?.[0] || '?'}</AvatarFallback>
                    </Avatar>
                    <div className="ml-3 flex-1">
                      <h4 className="font-medium text-sm">{res.displayName}</h4>
                      <p className="text-[10px] text-[#C5A059]">@{res.nickname}</p>
                    </div>
                    <Button size="sm" variant="outline" className="rounded-full h-7 text-[10px] border-white/10 hover:bg-[#1C1C1E]">View</Button>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'admin' && (
              <div className="p-3 space-y-1">
                <div className="text-[10px] uppercase tracking-[0.1em] text-[#A1A1AA] px-3 py-2">User Management</div>
                {searchResults.length === 0 ? (
                  <div className="p-6 text-center text-[10px] text-[#A1A1AA]">Search for users to manage them</div>
                ) : (
                  searchResults.map((res) => (
                    <div key={res.uid} className="flex items-center p-3 rounded-xl bg-[#1C1C1E]/30 mb-2 border border-white/5">
                      <Avatar className="w-10 h-10">
                        <AvatarImage src={res.photoURL} />
                        <AvatarFallback>{res.displayName?.[0] || '?'}</AvatarFallback>
                      </Avatar>
                      <div className="ml-3 flex-1">
                        <div className="text-xs font-medium text-white">{res.displayName}</div>
                        <div className="text-[9px] text-[#A1A1AA]">{res.phoneNumber}</div>
                      </div>
                      <div className="flex gap-1">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className={`h-8 w-8 ${res.isBlocked ? 'text-red-500' : 'text-gray-500'}`}
                          onClick={async () => {
                            await updateDoc(doc(db, 'users', res.uid), { isBlocked: !res.isBlocked });
                            toast.success(res.isBlocked ? 'User unblocked' : 'User blocked');
                            handleSearch();
                          }}
                        >
                          <Ban size={14} />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-red-500"
                          onClick={async () => {
                            if (confirm(`Delete user ${res.displayName}?`)) {
                              await updateDoc(doc(db, 'users', res.uid), { isBlocked: true, displayName: '[DELETED]' });
                              toast.success('User marked as deleted');
                              handleSearch();
                            }
                          }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'stories' && (
              <div className="p-6 grid grid-cols-2 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <motion.div 
                    whileHover={{ scale: 1.02 }}
                    key={i} 
                    className="aspect-[9/16] bg-[#1C1C1E] rounded-2xl overflow-hidden relative group cursor-pointer border border-white/5"
                  >
                    <img src={`https://picsum.photos/seed/story-${i}/400/700`} className="w-full h-full object-cover transition-transform group-hover:scale-110 duration-700" referrerPolicy="no-referrer" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent" />
                    <div className="absolute bottom-3 left-3 flex items-center space-x-2">
                      <div className="p-0.5 bg-gradient-to-tr from-[#C5A059] to-white rounded-full">
                        <Avatar className="w-7 h-7 border-2 border-[#0A0A0A]">
                          <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=u-${i}`} />
                        </Avatar>
                      </div>
                      <span className="text-white text-[10px] font-medium tracking-wide">User {i}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {activeTab === 'reels' && (
              <div className="p-6 space-y-8">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="aspect-[9/16] bg-black rounded-3xl overflow-hidden relative shadow-2xl border border-white/10">
                    <img src={`https://picsum.photos/seed/reel-${i}/400/700`} className="w-full h-full object-cover opacity-80" referrerPolicy="no-referrer" />
                    <div className="absolute inset-0 flex flex-col justify-end p-6 text-white bg-gradient-to-t from-black/95 via-transparent to-transparent">
                      <div className="flex items-center space-x-3 mb-4">
                        <Avatar className="w-10 h-10 border border-[#C5A059] p-0.5">
                          <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=u-${i}`} className="rounded-full" />
                        </Avatar>
                        <div>
                          <span className="font-medium text-sm block">@user_{i}</span>
                          <span className="text-[9px] text-[#A1A1AA] uppercase tracking-widest">Original Audio</span>
                        </div>
                        <Button size="sm" variant="secondary" className="rounded-full h-6 text-[9px] font-bold px-3 ml-auto bg-white text-black hover:bg-white/90">Follow</Button>
                      </div>
                      <p className="text-xs mb-6 line-clamp-2 text-[#A1A1AA]">Check out this amazing view! Life is beautiful. #nature #vibes #messenger</p>
                      <div className="flex items-center space-x-6">
                        <button className="flex items-center space-x-2 group">
                          <Heart size={18} className="text-[#C5A059]" />
                          <span className="text-[10px] font-bold">1.2k</span>
                        </button>
                        <button className="flex items-center space-x-2 group">
                          <MessageSquare size={18} className="text-[#A1A1AA]" />
                          <span className="text-[10px] font-bold">45</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="p-6 space-y-8">
                <div className="space-y-4">
                  <h3 className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-[0.2em]">Privacy & Security</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-4 bg-[#1C1C1E] rounded-xl border border-white/5">
                      <div className="flex items-center space-x-3">
                        <Shield size={18} className="text-[#C5A059]" />
                        <span className="text-sm font-medium">Private Profile</span>
                      </div>
                      <div className="w-9 h-5 bg-[#C5A059] rounded-full relative cursor-pointer">
                        <div className="absolute right-1 top-1 w-3 h-3 bg-black rounded-full shadow-sm" />
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-[#1C1C1E] rounded-xl border border-white/5">
                      <div className="flex items-center space-x-3">
                        <EyeOff size={18} className="text-[#A1A1AA]" />
                        <span className="text-sm font-medium">Incognito Mode</span>
                      </div>
                      <div className="w-9 h-5 bg-[#2D2D30] rounded-full relative cursor-pointer">
                        <div className="absolute left-1 top-1 w-3 h-3 bg-white/20 rounded-full shadow-sm" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Chat/Content Window (Main View) */}
        <div className="flex-1 flex flex-col bg-[#0A0A0A] relative">
          {selectedChat ? (
            <>
              {/* Stories Bar in Main View */}
              <div className="h-[110px] border-b border-white/10 px-6 flex items-center space-x-5 overflow-x-hidden">
                <div className="flex flex-col items-center space-y-1.5 cursor-pointer">
                  <div className="w-14 h-14 rounded-full p-[2px] bg-gradient-to-tr from-[#C5A059] to-white">
                    <div className="w-full h-full rounded-full bg-[#2D2D30] border-2 border-[#0A0A0A]" />
                  </div>
                  <span className="text-[10px] text-[#A1A1AA]">My Story</span>
                </div>
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex flex-col items-center space-y-1.5 cursor-pointer">
                    <div className="w-14 h-14 rounded-full p-[2px] bg-gradient-to-tr from-[#C5A059] to-white">
                      <div className="w-full h-full rounded-full bg-[#2D2D30] border-2 border-[#0A0A0A]" />
                    </div>
                    <span className="text-[10px] text-[#A1A1AA]">Julian</span>
                  </div>
                ))}
              </div>

              {/* Chat Header */}
              <div className="h-[72px] border-b border-white/10 px-6 flex items-center justify-between bg-[#0A0A0A]">
                <div>
                  <h2 className="font-medium text-white">{selectedChatProfile?.displayName || selectedChat.name || 'Conversation'}</h2>
                  <span className="text-[11px] text-[#C5A059]">{selectedChatProfile?.status || 'Active now'}</span>
                </div>
                <div className="flex items-center space-x-6 text-xs text-[#A1A1AA]">
                  <button className="flex items-center space-x-2 hover:text-white transition-colors" onClick={() => startVideoCall(selectedChatProfile?.uid || '')}>
                    <Video size={16} />
                    <span>Video</span>
                  </button>
                  <button className="flex items-center space-x-2 hover:text-white transition-colors">
                    <Phone size={16} />
                    <span>Call</span>
                  </button>
                  <button className="hover:text-white transition-colors">
                    <MoreVertical size={16} />
                  </button>
                </div>
              </div>

              {/* Messages Area */}
              <ScrollArea className="flex-1 p-8">
                <div className="space-y-8 max-w-3xl mx-auto">
                  {messages.map((msg) => (
                    <div key={msg.id} className={`flex gap-3 ${msg.senderId === user.uid ? 'justify-end flex-row-reverse' : 'justify-start'}`}>
                      {msg.senderId !== user.uid && (
                        <Avatar className="w-8 h-8 mt-auto">
                          <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${msg.senderId}`} />
                          <AvatarFallback>U</AvatarFallback>
                        </Avatar>
                      )}
                      <div className={`max-w-[80%] group relative`}>
                        <div className={`px-[18px] py-3 rounded-2xl text-sm leading-relaxed ${
                          msg.senderId === user.uid 
                            ? 'bg-[#C5A059] text-black rounded-br-none' 
                            : 'bg-[#1C1C1E] text-white rounded-bl-none'
                        }`}>
                          <p>{msg.text}</p>
                        </div>
                        <span className={`text-[9px] text-[#A1A1AA] mt-2 block opacity-40 ${
                          msg.senderId === user.uid ? 'text-right' : 'text-left'
                        }`}>
                          {msg.createdAt?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Input Area */}
              <div className="p-6 bg-[#0A0A0A]">
                <div className="max-w-3xl mx-auto flex items-center space-x-4">
                  <span className="text-xl text-[#A1A1AA] cursor-pointer hover:text-white transition-colors">+</span>
                  <Input 
                    className="flex-1 bg-[#1C1C1E] border-none h-12 rounded-xl px-5 text-sm text-white placeholder:text-[#A1A1AA]/50 focus-visible:ring-1 focus-visible:ring-[#C5A059]/20" 
                    placeholder="Type a message..." 
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  />
                  <span className="text-xl text-[#A1A1AA] cursor-pointer hover:text-white transition-colors">🎙️</span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[#A1A1AA] px-6 text-center">
              <div className="w-24 h-24 bg-[#1C1C1E] rounded-full flex items-center justify-center mb-8 border border-[#C5A059]/20 p-1 shadow-[0_0_30px_rgba(197,160,89,0.1)] overflow-hidden">
                <img 
                  src={appLogo} 
                  alt="Logo" 
                  className="w-full h-full object-cover rounded-full"
                  referrerPolicy="no-referrer"
                />
              </div>
              <h3 className="text-3xl font-gothic text-white tracking-tight">St.messenger</h3>
              <p className="mt-3 max-w-xs text-xs leading-relaxed opacity-60">Select a conversation to begin your secure experience.</p>
            </div>
          )}
        </div>

        {/* Info Panel (Right Sidebar) */}
        {selectedChat && (
          <div className="w-[280px] border-l border-white/10 bg-[#121214] flex flex-col items-center py-10 px-6">
            <div className="text-center mb-10">
              <div className="w-[120px] h-[120px] rounded-full border border-[#C5A059] p-1 mb-5 mx-auto">
                <Avatar className="w-full h-full">
                  <AvatarImage src={selectedChatProfile?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedChat.id}`} className="rounded-full" />
                  <AvatarFallback>{selectedChatProfile?.displayName?.[0] || 'C'}</AvatarFallback>
                </Avatar>
              </div>
              <h2 className="font-serif italic text-2xl text-white mb-1">{selectedChatProfile?.displayName || 'Conversation'}</h2>
              <div className="text-[#C5A059] text-xs mb-3">@{selectedChatProfile?.nickname || 'chat'}</div>
              {selectedChatProfile?.isPrivate && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#C5A059]/10 text-[#C5A059] rounded-full text-[10px] uppercase tracking-wider font-bold">
                  ✧ Private Profile
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 w-full mb-10">
              {['Gallery', 'Files', 'Links', 'Settings'].map(action => (
                <button key={action} className="bg-[#1C1C1E] border border-white/5 py-3 rounded-xl text-[11px] text-white hover:bg-[#1C1C1E]/80 transition-colors">
                  {action}
                </button>
              ))}
            </div>

            <div className="text-center space-y-2 mb-10">
              <div className="text-[10px] text-[#A1A1AA] uppercase tracking-widest">Registered Phone</div>
              <div className="text-xs font-mono text-white">+7 (999) ••• •• 42</div>
            </div>

            <div className="mt-auto w-full">
              <button className="w-full py-3 border border-[#442222] text-[#FF4444] rounded-xl text-[11px] hover:bg-[#442222]/20 transition-colors">
                Block User
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Video Call Overlay */}
      <AnimatePresence>
        {isCalling && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center"
          >
            <div className="absolute inset-0 opacity-40">
              <video 
                ref={(el) => { if (el && remoteStream) el.srcObject = remoteStream; }} 
                autoPlay 
                className="w-full h-full object-cover"
              />
            </div>
            <div className="relative z-10 flex flex-col items-center">
              <div className="w-32 h-32 rounded-full border-4 border-white overflow-hidden mb-8 shadow-2xl">
                <video 
                  ref={(el) => { if (el && myStream) el.srcObject = myStream; }} 
                  autoPlay 
                  muted 
                  className="w-full h-full object-cover"
                />
              </div>
              <h2 className="text-3xl font-bold text-white mb-2">Video Call</h2>
              <p className="text-zinc-400 mb-12">Connected</p>
              <div className="flex space-x-6">
                <Button variant="destructive" size="icon" className="w-16 h-16 rounded-full shadow-2xl" onClick={() => {
                  myStream?.getTracks().forEach(t => t.stop());
                  setIsCalling(false);
                  setRemoteStream(null);
                }}>
                  <Phone size={32} className="rotate-[135deg]" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
