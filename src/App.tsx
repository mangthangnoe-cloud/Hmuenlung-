import React, { useState, useEffect, createContext, useContext, ReactNode, Component, ErrorInfo } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  User 
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot, 
  collection, 
  query, 
  orderBy, 
  addDoc, 
  updateDoc, 
  increment, 
  deleteDoc,
  where,
  limit,
  writeBatch
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile, Post, Comment, Activity, UserRole } from './types';
import { 
  Home as HomeIcon, 
  User as UserIcon, 
  Bookmark, 
  Settings as SettingsIcon, 
  PlusCircle, 
  Heart, 
  MessageCircle, 
  LogOut, 
  Moon, 
  Sun, 
  Bell, 
  BellOff,
  Image as ImageIcon,
  X,
  Send,
  ChevronRight,
  MoreVertical,
  Hash,
  Trash2,
  Loader2,
  Lock,
  ShieldCheck,
  Link as LinkIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import Markdown from 'react-markdown';

// --- Error Boundary ---

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      try {
        if (this.state.error?.message) {
          const parsed = JSON.parse(this.state.error.message);
          if (parsed.error === "Missing or insufficient permissions.") {
            errorMessage = "You don't have permission to access this data. Please try logging in again or contact support.";
          }
        }
      } catch (e) {
        // Not a JSON error message
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
          <div className="max-w-md w-full bg-white dark:bg-zinc-900 rounded-3xl p-8 shadow-xl text-center border border-zinc-100 dark:border-zinc-800">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-display font-bold text-zinc-900 dark:text-white mb-4">Access Error</h2>
            <p className="text-zinc-600 dark:text-zinc-400 mb-8">
              {errorMessage}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-brand-500 hover:bg-brand-600 text-white rounded-2xl font-bold transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- Contexts ---

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (role: UserRole) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      try {
        if (firebaseUser) {
          setUser(firebaseUser);
          const userRef = doc(db, 'users', firebaseUser.uid);
          
          // Use onSnapshot for the profile to get cached data instantly
          unsubProfile = onSnapshot(userRef, (snap) => {
            if (snap.exists()) {
              setProfile(snap.data() as UserProfile);
            }
            setLoading(false);
          }, (err) => {
            handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
            setLoading(false);
          });
        } else {
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
      } catch (error) {
        console.error("Auth initialization error:", error);
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const signIn = async (role: UserRole) => {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const firebaseUser = result.user;

    const userRef = doc(db, 'users', firebaseUser.uid);
    let userSnap;
    try {
      userSnap = await getDoc(userRef);
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${firebaseUser.uid}`);
      return;
    }

    if (!userSnap.exists()) {
      const newProfile: UserProfile = {
        uid: firebaseUser.uid,
        name: firebaseUser.displayName || 'Anonymous',
        email: firebaseUser.email || '',
        profilePic: firebaseUser.photoURL || '',
        role: role,
        theme: 'light',
        notificationsEnabled: true,
        createdAt: Date.now(),
      };
      try {
        await setDoc(userRef, newProfile);
      } catch (e: any) {
        if (role === 'admin' && (e.code === 'permission-denied' || e.message?.includes('permission'))) {
          console.warn("Unauthorized to create admin account. Falling back to user role.");
          newProfile.role = 'user';
          try {
            await setDoc(userRef, newProfile);
          } catch (fallbackError) {
            handleFirestoreError(fallbackError, OperationType.CREATE, `users/${firebaseUser.uid}`);
            return;
          }
        } else {
          handleFirestoreError(e, OperationType.CREATE, `users/${firebaseUser.uid}`);
          return;
        }
      }
      setProfile(newProfile);
    } else {
      setProfile(userSnap.data() as UserProfile);
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  const updateProfile = async (data: Partial<UserProfile>) => {
    if (!user) return;
    const oldProfile = profile;
    setProfile(prev => prev ? { ...prev, ...data } : null);
    
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, data)
        .catch(e => handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`));
    } catch (error) {
      console.error("Error updating profile:", error);
      // Revert on error
      setProfile(oldProfile);
    }
  };

  useEffect(() => {
    const isDark = profile?.theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  }, [profile?.theme]);

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

// --- Components ---

function LoadingScreen() {
  const [message, setMessage] = useState('Initializing...');

  useEffect(() => {
    const timers = [
      setTimeout(() => setMessage('Connecting to Nix...'), 1500),
      setTimeout(() => setMessage('Almost there...'), 3500),
      setTimeout(() => setMessage('Taking a bit longer than usual...'), 7000),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#fdfcfb] dark:bg-zinc-950 z-[100]">
      <motion.div 
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative flex flex-col items-center"
      >
        <motion.div 
          animate={{ 
            scale: [1, 1.05, 1],
            rotate: [0, 2, -2, 0]
          }}
          transition={{ 
            duration: 1.5, 
            repeat: Infinity,
            ease: "easeInOut"
          }}
          className="w-20 h-20 bg-brand-500 rounded-[2rem] flex items-center justify-center shadow-2xl shadow-brand-200 dark:shadow-none mb-8"
        >
          <span className="text-4xl font-display font-bold text-white">N</span>
        </motion.div>
        
        <div className="flex flex-col items-center gap-4">
          <div className="text-center">
            <h2 className="text-xl font-display font-bold text-brand-500">Nix's Daily</h2>
            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mt-1">{message}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                animate={{ 
                  opacity: [0.3, 1, 0.3],
                  scale: [1, 1.2, 1]
                }}
                transition={{ 
                  duration: 0.6, 
                  repeat: Infinity, 
                  delay: i * 0.1 
                }}
                className="w-1.5 h-1.5 bg-brand-400 rounded-full"
              />
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function LoginScreen() {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);

  const handleSignIn = async (role: UserRole) => {
    try {
      setError(null);
      await signIn(role);
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        // Ignore user cancellation
        return;
      }
      setError(err.message);
    }
  };

  const handleAdminClick = () => {
    setShowPasswordPrompt(true);
  };

  const verifyPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'HmuenLung2010') {
      setShowPasswordPrompt(false);
      handleSignIn('admin');
    } else {
      setPasswordError(true);
      setTimeout(() => setPasswordError(false), 500);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#fdfcfb] dark:bg-zinc-950 p-6">
      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md text-center space-y-12"
      >
        <div className="flex flex-col items-center">
          <motion.div 
            whileHover={{ scale: 1.05, rotate: -2 }}
            whileTap={{ scale: 0.95 }}
            className="w-32 h-32 bg-gradient-to-br from-brand-400 to-brand-600 rounded-[2.5rem] flex items-center justify-center shadow-2xl shadow-brand-200 dark:shadow-none mb-6 cursor-pointer"
          >
            <span className="text-6xl font-display font-bold text-white">N</span>
          </motion.div>
          <h1 className="text-2xl font-display font-semibold text-brand-500 tracking-tight">Nix's Daily</h1>
          <p className="text-zinc-400 text-xs uppercase tracking-[0.2em] mt-1">Digital Journal</p>
        </div>

        <div className="space-y-6">
          <h2 className="text-5xl font-display font-bold text-zinc-900 dark:text-white tracking-tight">Welcome</h2>
          
          <div className="space-y-4 pt-4">
            <motion.button 
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleSignIn('user')}
              className="w-full flex items-center justify-between px-8 py-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl text-zinc-900 dark:text-white font-semibold hover:border-brand-400 dark:hover:border-brand-500 transition-all soft-shadow"
            >
              <UserIcon className="w-6 h-6 text-brand-500" />
              <span className="text-lg">Continue as user</span>
              <ChevronRight className="w-5 h-5 text-zinc-300" />
            </motion.button>

            <motion.button 
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleAdminClick}
              className="w-full flex items-center justify-between px-8 py-5 bg-brand-500 text-white rounded-3xl font-semibold hover:bg-brand-600 transition-all shadow-lg shadow-brand-200 dark:shadow-none"
            >
              <ShieldCheck className="w-6 h-6 text-white" />
              <span className="text-lg">Continue as admin</span>
              <ChevronRight className="w-5 h-5 text-white/50" />
            </motion.button>
          </div>
        </div>

        {error && (
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-red-500 text-sm font-medium bg-red-50 dark:bg-red-950/30 py-2 px-4 rounded-full inline-block"
          >
            {error}
          </motion.p>
        )}

        <div className="pt-12">
          <p className="text-zinc-500 text-sm">
            ©2026 All rights reserved<br />
            ThangNoeTakluem
          </p>
        </div>
      </motion.div>

      <AnimatePresence>
        {showPasswordPrompt && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/60 backdrop-blur-xl">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className={cn(
                "bg-white dark:bg-zinc-900 w-full max-w-sm rounded-[3rem] p-10 shadow-2xl space-y-8 border border-zinc-100 dark:border-zinc-800",
                passwordError && "animate-shake"
              )}
            >
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-brand-50 dark:bg-brand-900/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Lock className="w-8 h-8 text-brand-500" />
                </div>
                <h3 className="text-2xl font-display font-bold text-zinc-900 dark:text-white">Admin Access</h3>
                <p className="text-zinc-400 text-xs uppercase tracking-widest">Enter Password</p>
              </div>

              <form onSubmit={verifyPassword} className="space-y-6">
                <input 
                  autoFocus
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={cn(
                    "w-full bg-zinc-50 dark:bg-zinc-800 border-none rounded-2xl px-6 py-4 text-center text-xl tracking-[0.5em] focus:ring-2 focus:ring-brand-500 transition-all",
                    passwordError && "ring-2 ring-red-500"
                  )}
                />
                
                <div className="flex gap-3">
                  <button 
                    type="button"
                    onClick={() => {
                      setShowPasswordPrompt(false);
                      setPassword('');
                    }}
                    className="flex-1 py-4 rounded-2xl font-bold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-[2] py-4 rounded-2xl font-bold bg-brand-500 text-white shadow-xl shadow-brand-200 dark:shadow-none"
                  >
                    Verify
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PostCard({ post, onLike, onSave, isLiked, isSaved, onDelete, setPosts }: { 
  post: Post, 
  onLike: () => void, 
  onSave: () => void,
  isLiked: boolean,
  isSaved: boolean,
  onDelete?: () => void,
  setPosts: React.Dispatch<React.SetStateAction<Post[]>>
}) {
  const { profile } = useAuth();
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [commentToDelete, setCommentToDelete] = useState<string | null>(null);

  useEffect(() => {
    if (showComments) {
      const q = query(collection(db, 'posts', post.id, 'comments'), orderBy('createdAt', 'desc'));
      return onSnapshot(q, (snap) => {
        setComments(snap.docs.map(d => ({ id: d.id, ...d.data() } as Comment)));
      });
    }
  }, [showComments, post.id]);

  const handleDeleteComment = async (commentId: string) => {
    if (!profile || profile.role !== 'admin') return;

    try {
      // Optimistic UI for the comment count
      setPosts(prev => prev.map(p => 
        p.id === post.id 
          ? { ...p, commentsCount: Math.max(0, (p.commentsCount || 0) - 1) } 
          : p
      ));

      const batch = writeBatch(db);
      const commentRef = doc(db, 'posts', post.id, 'comments', commentId);
      const postRef = doc(db, 'posts', post.id);

      batch.delete(commentRef);
      batch.update(postRef, { commentsCount: increment(-1) });

      await batch.commit().catch(e => {
        // Revert on error
        setPosts(prev => prev.map(p => 
          p.id === post.id 
            ? { ...p, commentsCount: (p.commentsCount || 0) + 1 } 
            : p
        ));
        handleFirestoreError(e, OperationType.DELETE, `comment_delete_${commentId}`);
      });
    } catch (error) {
      console.error("Error deleting comment:", error);
    }
  };

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !profile || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const commentData = {
        postId: post.id,
        userId: profile.uid,
        userName: profile.name,
        userPic: profile.profilePic,
        text: newComment,
        createdAt: Date.now()
      };

      // Optimistic UI for the comment count
      setPosts(prev => prev.map(p => 
        p.id === post.id 
          ? { ...p, commentsCount: (p.commentsCount || 0) + 1 } 
          : p
      ));

      const batch = writeBatch(db);
      const commentRef = doc(collection(db, 'posts', post.id, 'comments'));
      const postRef = doc(db, 'posts', post.id);
      const activityRef = doc(collection(db, 'users', profile.uid, 'activity'));

      batch.set(commentRef, commentData);
      batch.update(postRef, { commentsCount: increment(1) });
      batch.set(activityRef, {
        userId: profile.uid,
        type: 'comment',
        targetId: post.id,
        targetText: post.text.substring(0, 50),
        createdAt: Date.now()
      });

      await batch.commit().catch(e => {
        // Revert on error
        setPosts(prev => prev.map(p => 
          p.id === post.id 
            ? { ...p, commentsCount: (p.commentsCount || 0) - 1 } 
            : p
        ));
        handleFirestoreError(e, OperationType.CREATE, `comment_action_${post.id}`);
      });

      setNewComment('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-[2rem] overflow-hidden mb-8 soft-shadow"
    >
      <div className="p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img src={post.authorPic} alt={post.authorName} className="w-11 h-11 rounded-full object-cover border-2 border-brand-100 dark:border-brand-900/30" referrerPolicy="no-referrer" />
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-brand-500 border-2 border-white dark:border-zinc-900 rounded-full" />
          </div>
          <div>
            <h3 className="font-bold text-zinc-900 dark:text-zinc-100 leading-none mb-1">{post.authorName}</h3>
            <p className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">{new Date(post.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
          </div>
        </div>
        {profile?.role === 'admin' && (
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setIsDeleteModalOpen(true)}
            className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
          >
            <Trash2 className="w-5 h-5" />
          </motion.button>
        )}
      </div>

      {post.imageUrl && (
        <div className="px-5">
          <img src={post.imageUrl} alt="Post" className="w-full aspect-[4/5] object-cover rounded-2xl shadow-inner" referrerPolicy="no-referrer" />
        </div>
      )}

      <div className="p-5 space-y-4">
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {post.tags.map(tag => (
              <span key={tag} className="text-[10px] font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 px-3 py-1 rounded-full uppercase tracking-tight border border-brand-100/50 dark:border-brand-800/50">
                #{tag}
              </span>
            ))}
          </div>
        )}

        <div className="markdown-body text-zinc-800 dark:text-zinc-200">
          <Markdown>{post.text}</Markdown>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-6">
            <motion.button 
              whileTap={{ scale: 0.8 }}
              onClick={onLike}
              className={cn(
                "flex items-center gap-2 transition-colors group",
                isLiked ? "text-red-500" : "text-zinc-400 hover:text-red-500"
              )}
            >
              <Heart className={cn("w-6 h-6 transition-transform group-hover:scale-110", isLiked && "fill-current")} />
              <span className="text-sm font-bold">{post.likesCount}</span>
            </motion.button>
            <button 
              onClick={() => setShowComments(!showComments)}
              className="flex items-center gap-2 text-zinc-400 hover:text-brand-500 transition-colors group relative left-[1cm]"
            >
              <MessageCircle className="w-6 h-6 transition-transform group-hover:scale-110" />
              <span className="text-sm font-bold">{post.commentsCount}</span>
            </button>
          </div>
          <motion.button 
            whileTap={{ scale: 0.8 }}
            onClick={onSave}
            className={cn(
              "transition-colors group",
              isSaved ? "text-brand-500" : "text-zinc-400 hover:text-brand-500"
            )}
          >
            <Bookmark className={cn("w-6 h-6 transition-transform group-hover:scale-110", isSaved && "fill-current")} />
          </motion.button>
        </div>

        <AnimatePresence>
          {showComments && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="pt-6 border-t border-zinc-100 dark:border-zinc-800 space-y-5 overflow-hidden"
            >
              <form onSubmit={handleComment} className="flex gap-3 relative">
                <input 
                  type="text" 
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Share your thoughts..."
                  className="flex-1 bg-zinc-50 dark:bg-zinc-800 border-none rounded-2xl px-5 py-3 text-sm focus:ring-2 focus:ring-brand-500 transition-all disabled:opacity-50"
                  disabled={isSubmitting}
                />
                {isSubmitting && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <Loader2 className="w-4 h-4 animate-spin text-brand-500" />
                  </div>
                )}
              </form>

              <div className="space-y-4 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                {comments.map(comment => (
                  <div key={comment.id} className="flex gap-3 items-start group/comment">
                    <img src={comment.userPic} alt={comment.userName} className="w-9 h-9 rounded-full object-cover mt-1" referrerPolicy="no-referrer" />
                    <div className="flex-1 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl p-4 relative">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">{comment.userName}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-[9px] text-zinc-400 font-medium uppercase">{new Date(comment.createdAt).toLocaleDateString()}</p>
                          {profile?.role === 'admin' && (
                            <button 
                              onClick={() => setCommentToDelete(comment.id)}
                              className="opacity-0 group-hover/comment:opacity-100 p-1 text-zinc-400 hover:text-red-500 transition-all"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{comment.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <DeleteConfirmModal 
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={() => onDelete?.()}
        title="Delete Post"
        message="Are you sure you want to remove this post? This action cannot be undone."
      />

      <DeleteConfirmModal 
        isOpen={!!commentToDelete}
        onClose={() => setCommentToDelete(null)}
        onConfirm={() => commentToDelete && handleDeleteComment(commentToDelete)}
        title="Delete Comment"
        message="Are you sure you want to remove this comment?"
      />
    </motion.div>
  );
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function AdminPostModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { profile } = useAuth();
  const [text, setText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      if (!tags.includes(tagInput.trim().toLowerCase())) {
        setTags([...tags, tagInput.trim().toLowerCase()]);
      }
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !profile) return;

    setIsSubmitting(true);
    try {
      const postData = {
        authorId: profile.uid,
        authorName: profile.name,
        authorPic: profile.profilePic,
        text,
        imageUrl: imageUrl.trim() || null,
        tags,
        likesCount: 0,
        commentsCount: 0,
        createdAt: Date.now()
      };

      await addDoc(collection(db, 'posts'), { ...postData, status: 'active' });
      
      await addDoc(collection(db, 'users', profile.uid, 'activity'), {
        userId: profile.uid,
        type: 'post',
        targetId: 'new',
        targetText: text.substring(0, 50),
        createdAt: Date.now()
      });

      setText('');
      setImageUrl('');
      setTags([]);
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'posts');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="bg-white dark:bg-zinc-900 w-full max-w-xl rounded-[3rem] overflow-hidden shadow-2xl"
          >
            <form onSubmit={handleSubmit} className="flex flex-col h-full max-h-[90vh]">
              <div className="p-8 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-display font-bold text-brand-500">Create Post</h2>
                  <p className="text-zinc-400 text-xs">Share something with the world</p>
                </div>
                <button type="button" onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-1">Content (Markdown)</label>
                  <textarea 
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="What's on your mind today?"
                    className="w-full h-40 bg-zinc-50 dark:bg-zinc-800 border-none rounded-3xl px-6 py-5 focus:ring-2 focus:ring-brand-500 transition-all resize-none text-sm"
                    required
                  />
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-1">Image URL (Optional)</label>
                  <div className="relative">
                    <input 
                      type="url" 
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      placeholder="https://example.com/image.jpg"
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border-none rounded-2xl px-6 py-4 pl-12 focus:ring-2 focus:ring-brand-500 transition-all text-sm"
                    />
                    <ImageIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-300" />
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-1">Tags (Press Enter or click Add)</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input 
                        type="text" 
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={handleAddTag}
                        placeholder="daily, life, travel..."
                        className="w-full bg-zinc-50 dark:bg-zinc-800 border-none rounded-2xl px-6 py-4 pl-12 focus:ring-2 focus:ring-brand-500 transition-all text-sm"
                      />
                      <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-300" />
                    </div>
                    <button 
                      type="button"
                      onClick={() => {
                        if (tagInput.trim()) {
                          if (!tags.includes(tagInput.trim().toLowerCase())) {
                            setTags([...tags, tagInput.trim().toLowerCase()]);
                          }
                          setTagInput('');
                        }
                      }}
                      className="px-6 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-2xl font-bold text-xs hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {tags.map(tag => (
                      <motion.span 
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        key={tag} 
                        className="inline-flex items-center gap-2 bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-tight border border-brand-100 dark:border-brand-800"
                      >
                        #{tag}
                        <button type="button" onClick={() => removeTag(tag)} className="hover:text-brand-800 dark:hover:text-brand-200">
                          <X className="w-3 h-3" />
                        </button>
                      </motion.span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-8 bg-zinc-50 dark:bg-zinc-800/50 flex gap-4">
                <button 
                  type="button" 
                  onClick={onClose} 
                  className="flex-1 py-4 rounded-2xl font-bold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                >
                  Discard
                </button>
                <button 
                  type="submit" 
                  disabled={isSubmitting || !text.trim()}
                  className="flex-[2] py-4 rounded-2xl font-bold bg-brand-500 text-white shadow-xl shadow-brand-200 dark:shadow-none disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      Publish Post
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function DeleteConfirmModal({ isOpen, onClose, onConfirm, title, message }: { 
  isOpen: boolean, 
  onClose: () => void, 
  onConfirm: () => void,
  title: string,
  message: string
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-[3rem] p-10 shadow-2xl space-y-8 text-center"
          >
            <div className="w-20 h-20 bg-red-50 dark:bg-red-950/20 rounded-[2.5rem] flex items-center justify-center mx-auto">
              <Trash2 className="w-10 h-10 text-red-500" />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-display font-bold text-zinc-900 dark:text-white">{title}</h3>
              <p className="text-zinc-400 text-sm">{message}</p>
            </div>
            <div className="flex gap-4 pt-2">
              <button 
                onClick={onClose}
                className="flex-1 py-4 rounded-2xl font-bold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
                className="flex-[2] py-4 rounded-2xl font-bold bg-red-500 text-white shadow-xl shadow-red-200 dark:shadow-none"
              >
                Delete
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// --- Main App ---

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}

function AppContent() {
  const { profile, loading, updateProfile } = useAuth();
  const [activeTab, setActiveTab] = useState('home');
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [savedPosts, setSavedPosts] = useState<Set<string>>(new Set());
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);

  useEffect(() => {
    if (!profile) return;

    const postsQuery = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(30));
    const unsubPosts = onSnapshot(postsQuery, (snap) => {
      setPosts(snap.docs.map(d => {
        const data = d.data();
        return { 
          id: d.id, 
          ...data, 
          tags: data.tags || [] 
        } as Post;
      }));
      setPostsLoading(false);
    });

    // Likes - only fetch 'like' type activity
    const likesQuery = query(
      collection(db, 'users', profile.uid, 'activity'), 
      where('type', '==', 'like')
    );
    const unsubLikes = onSnapshot(likesQuery, (snap) => {
      const likes = new Set<string>();
      snap.docs.forEach(d => {
        likes.add(d.data().targetId);
      });
      setLikedPosts(likes);
    });

    // Saved
    const unsubSaved = onSnapshot(collection(db, 'users', profile.uid, 'savedPosts'), (snap) => {
      setSavedPosts(new Set(snap.docs.map(d => d.id)));
    });

    return () => {
      unsubPosts();
      unsubLikes();
      unsubSaved();
    };
  }, [profile]);

  if (loading) return <LoadingScreen />;
  if (!profile) return <LoginScreen />;

  const handleLike = async (post: Post) => {
    const isLiked = likedPosts.has(post.id);
    const postRef = doc(db, 'posts', post.id);
    const activityRef = doc(db, 'users', profile.uid, 'activity', `like_${post.id}`);
    
    // Optimistic UI for the heart icon
    setLikedPosts(prev => {
      const next = new Set(prev);
      if (isLiked) next.delete(post.id);
      else next.add(post.id);
      return next;
    });

    // Optimistic UI for the count
    setPosts(prev => prev.map(p => 
      p.id === post.id 
        ? { ...p, likesCount: (p.likesCount || 0) + (isLiked ? -1 : 1) } 
        : p
    ));

    try {
      const batch = writeBatch(db);
      
      if (isLiked) {
        batch.update(postRef, { likesCount: increment(-1) });
        batch.delete(activityRef);
      } else {
        batch.update(postRef, { likesCount: increment(1) });
        batch.set(activityRef, {
          userId: profile.uid,
          type: 'like',
          targetId: post.id,
          targetText: post.text.substring(0, 50),
          createdAt: Date.now()
        });
      }
      
      await batch.commit().catch(e => {
        // Revert on error
        setLikedPosts(prev => {
          const next = new Set(prev);
          if (isLiked) next.add(post.id);
          else next.delete(post.id);
          return next;
        });
        setPosts(prev => prev.map(p => 
          p.id === post.id 
            ? { ...p, likesCount: (p.likesCount || 0) + (isLiked ? 1 : -1) } 
            : p
        ));
        handleFirestoreError(e, OperationType.WRITE, `like_action_${post.id}`);
      });
    } catch (error) {
      console.error("Like error:", error);
    }
  };

  const handleSave = async (post: Post) => {
    const isSaved = savedPosts.has(post.id);
    const saveRef = doc(db, 'users', profile.uid, 'savedPosts', post.id);
    
    // Optimistic UI
    setSavedPosts(prev => {
      const next = new Set(prev);
      if (isSaved) next.delete(post.id);
      else next.add(post.id);
      return next;
    });

    try {
      const batch = writeBatch(db);
      
      if (isSaved) {
        batch.delete(saveRef);
      } else {
        batch.set(saveRef, {
          postId: post.id,
          userId: profile.uid,
          createdAt: Date.now()
        });
        const activityRef = doc(collection(db, 'users', profile.uid, 'activity'));
        batch.set(activityRef, {
          userId: profile.uid,
          type: 'save',
          targetId: post.id,
          targetText: post.text.substring(0, 50),
          createdAt: Date.now()
        });
      }

      await batch.commit().catch(e => {
        // Revert on error
        setSavedPosts(prev => {
          const next = new Set(prev);
          if (isSaved) next.add(post.id);
          else next.delete(post.id);
          return next;
        });
        handleFirestoreError(e, OperationType.WRITE, `save_action_${post.id}`);
      });
    } catch (error) {
      console.error("Save error:", error);
    }
  };

  const handleDelete = async (postId: string) => {
    if (!profile || profile.role !== 'admin') return;

    try {
      // Soft delete
      await updateDoc(doc(db, 'posts', postId), { status: 'deleted' })
        .catch(e => handleFirestoreError(e, OperationType.UPDATE, `posts/${postId}`));
      
      await addDoc(collection(db, 'users', profile.uid, 'activity'), {
        userId: profile.uid,
        type: 'delete_post',
        targetId: postId,
        targetText: 'Post moved to trash',
        createdAt: Date.now()
      }).catch(e => handleFirestoreError(e, OperationType.CREATE, `users/${profile.uid}/activity`));
    } catch (error) {
      console.error("Error deleting post:", error);
    }
  };

  const handleRestore = async (postId: string) => {
    if (!profile || profile.role !== 'admin') return;
    try {
      await updateDoc(doc(db, 'posts', postId), { status: 'active' })
        .catch(e => handleFirestoreError(e, OperationType.UPDATE, `posts/${postId}`));
    } catch (error) {
      console.error("Error restoring post:", error);
    }
  };

  const handlePermanentDelete = async (postId: string) => {
    if (!profile || profile.role !== 'admin') return;
    try {
      await deleteDoc(doc(db, 'posts', postId))
        .catch(e => handleFirestoreError(e, OperationType.DELETE, `posts/${postId}`));
    } catch (error) {
      console.error("Error permanently deleting post:", error);
    }
  };

  return (
    <div className="min-h-screen bg-[#fdfcfb] dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 pb-32">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md border-b border-zinc-100 dark:border-zinc-800/50 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div 
              whileHover={{ scale: 1.05 }}
              className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center shadow-lg shadow-brand-200 dark:shadow-none"
            >
              <span className="text-xl font-display font-bold text-white">N</span>
            </motion.div>
            <div>
              <h1 className="text-lg font-display font-bold text-brand-500 leading-tight">Nix's Daily</h1>
              <p className="text-[10px] text-zinc-400">by ThangNoeTakluem</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {profile.role === 'admin' && (
              <span className="text-[9px] font-bold bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 px-2.5 py-1 rounded-full uppercase tracking-wider border border-brand-100 dark:border-brand-800">
                Admin
              </span>
            )}
            <img src={profile.profilePic} alt={profile.name} className="w-8 h-8 rounded-full border border-zinc-200 dark:border-zinc-800" referrerPolicy="no-referrer" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-6 py-10">
        <AnimatePresence mode="wait">
          {activeTab === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-2"
            >
              {postsLoading ? (
                <div className="space-y-8">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-[2rem] p-5 space-y-4 animate-pulse">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 bg-zinc-100 dark:bg-zinc-800 rounded-full" />
                        <div className="space-y-2">
                          <div className="w-24 h-3 bg-zinc-100 dark:bg-zinc-800 rounded" />
                          <div className="w-16 h-2 bg-zinc-100 dark:bg-zinc-800 rounded" />
                        </div>
                      </div>
                      <div className="w-full h-48 bg-zinc-50 dark:bg-zinc-800 rounded-2xl" />
                      <div className="space-y-2">
                        <div className="w-full h-3 bg-zinc-50 dark:bg-zinc-800 rounded" />
                        <div className="w-2/3 h-3 bg-zinc-50 dark:bg-zinc-800 rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : posts.filter(p => p.status !== 'deleted').length === 0 ? (
                <div className="text-center py-20">
                  <p className="text-zinc-400">No posts yet</p>
                </div>
              ) : (
                posts.filter(p => p.status !== 'deleted').map(post => (
                  <PostCard 
                    key={post.id} 
                    post={post} 
                    onLike={() => handleLike(post)}
                    onSave={() => handleSave(post)}
                    onDelete={() => handleDelete(post.id)}
                    isLiked={likedPosts.has(post.id)}
                    isSaved={savedPosts.has(post.id)}
                    setPosts={setPosts}
                  />
                ))
              )}
            </motion.div>
          )}

          {activeTab === 'profile' && <ProfileView key="profile" />}
          {activeTab === 'saved' && <SavedView key="saved" posts={posts} savedIds={savedPosts} handleLike={handleLike} handleSave={handleSave} likedPosts={likedPosts} setPosts={setPosts} />}
          {activeTab === 'trash' && profile.role === 'admin' && <TrashView key="trash" posts={posts} handleRestore={handleRestore} handlePermanentDelete={handlePermanentDelete} />}
          {activeTab === 'settings' && <SettingsView key="settings" />}
        </AnimatePresence>
      </main>

      {/* Admin FAB */}
      {profile.role === 'admin' && activeTab === 'home' && (
        <motion.button 
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          whileHover={{ scale: 1.1, rotate: 90 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => setIsAdminModalOpen(true)}
          className="fixed bottom-32 right-6 w-16 h-16 bg-brand-500 text-white rounded-[2rem] shadow-2xl shadow-brand-200 dark:shadow-none flex items-center justify-center z-50 transition-shadow hover:shadow-brand-300"
        >
          <PlusCircle className="w-9 h-9" />
        </motion.button>
      )}

      {/* Navigation */}
      <nav className="fixed bottom-8 left-1/2 -translate-x-1/2 w-[calc(100%-3rem)] max-w-md bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-zinc-200 dark:border-zinc-800 rounded-[2.5rem] shadow-2xl px-2 py-2 flex items-center justify-between z-40">
        <NavButton active={activeTab === 'home'} onClick={() => setActiveTab('home')} icon={<HomeIcon className="w-5 h-5" />} label="Home" />
        <NavButton active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} icon={<UserIcon className="w-5 h-5" />} label="Profile" />
        <NavButton active={activeTab === 'saved'} onClick={() => setActiveTab('saved')} icon={<Bookmark className="w-5 h-5" />} label="Saved" />
        {profile.role === 'admin' && (
          <NavButton active={activeTab === 'trash'} onClick={() => setActiveTab('trash')} icon={<Trash2 className="w-5 h-5" />} label="Trash" />
        )}
        <NavButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<SettingsIcon className="w-5 h-5" />} label="Setting" />
      </nav>

      <AdminPostModal isOpen={isAdminModalOpen} onClose={() => setIsAdminModalOpen(false)} />
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex-1 flex flex-col items-center justify-center gap-1 py-3 rounded-[2rem] transition-all relative",
        active ? "text-brand-500" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
      )}
    >
      {active && (
        <motion.div 
          layoutId="nav-active"
          className="absolute inset-0 bg-brand-50 dark:bg-brand-900/20 rounded-[2rem] -z-10"
        />
      )}
      {icon}
      <span className={cn("text-[10px] font-bold uppercase tracking-wider", active ? "opacity-100" : "opacity-0")}>{label}</span>
    </button>
  );
}

function ProfileView() {
  const { profile, updateProfile } = useAuth();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState(profile?.name || '');
  const [newPic, setNewPic] = useState(profile?.profilePic || '');

  useEffect(() => {
    if (!profile) return;
    const q = query(collection(db, 'users', profile.uid, 'activity'), orderBy('createdAt', 'desc'), limit(20));
    return onSnapshot(q, (snap) => {
      setActivities(snap.docs.map(d => ({ id: d.id, ...d.data() } as Activity)));
    });
  }, [profile]);

  const handleUpdate = async () => {
    await updateProfile({ name: newName, profilePic: newPic });
    setIsEditing(false);
  };

  return (
    <div className="space-y-12">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-[3rem] p-10 text-center soft-shadow">
        <div className="relative inline-block mb-6">
          <motion.img 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            src={profile?.profilePic} 
            alt={profile?.name} 
            className="w-40 h-40 rounded-[3rem] object-cover border-4 border-brand-50 dark:border-brand-900/20 p-1.5 shadow-inner" 
            referrerPolicy="no-referrer" 
          />
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setIsEditing(true)}
            className="absolute -bottom-2 -right-2 w-12 h-12 bg-brand-500 text-white rounded-2xl flex items-center justify-center border-4 border-white dark:border-zinc-900 shadow-lg"
          >
            <SettingsIcon className="w-6 h-6" />
          </motion.button>
        </div>
        <h2 className="text-3xl font-display font-bold tracking-tight">{profile?.name}</h2>
        <p className="text-zinc-400 text-sm font-medium mt-1">{profile?.email}</p>
        <div className="mt-6 inline-flex items-center gap-2 bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-400 px-5 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-[0.2em] border border-brand-100 dark:border-brand-800">
          <div className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-pulse" />
          {profile?.role}
        </div>
      </div>

      <div className="space-y-6">
        <h3 className="text-xl font-display font-bold flex items-center gap-3 px-2">
          <div className="w-8 h-8 bg-brand-100 dark:bg-brand-900/30 rounded-lg flex items-center justify-center">
            <ChevronRight className="w-5 h-5 text-brand-500" />
          </div>
          Recent Activity
        </h3>
        <div className="space-y-4">
          {activities.map((activity, idx) => (
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              key={activity.id} 
              className="flex items-center gap-5 bg-white dark:bg-zinc-900 p-5 rounded-[2rem] border border-zinc-100 dark:border-zinc-800 soft-shadow"
            >
              <div className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                activity.type === 'like' ? "bg-red-50 text-red-500 dark:bg-red-950/20" :
                activity.type === 'comment' ? "bg-blue-50 text-blue-500 dark:bg-blue-950/20" :
                activity.type === 'post' ? "bg-green-50 text-green-500 dark:bg-green-950/20" :
                "bg-brand-50 text-brand-500 dark:bg-brand-950/20"
              )}>
                {activity.type === 'like' && <Heart className="w-6 h-6 fill-current" />}
                {activity.type === 'comment' && <MessageCircle className="w-6 h-6" />}
                {activity.type === 'post' && <PlusCircle className="w-6 h-6" />}
                {activity.type === 'save' && <Bookmark className="w-6 h-6 fill-current" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  You {activity.type}d a post
                </p>
                <p className="text-xs text-zinc-400 truncate mt-0.5 italic">"{activity.targetText}..."</p>
                <p className="text-[9px] text-zinc-300 dark:text-zinc-600 font-bold uppercase tracking-tighter mt-2">{new Date(activity.createdAt).toLocaleString()}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {isEditing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white dark:bg-zinc-900 w-full max-w-md rounded-[3rem] p-10 space-y-8 shadow-2xl"
            >
              <div className="space-y-2">
                <h2 className="text-2xl font-display font-bold text-brand-500">Edit Profile</h2>
                <p className="text-zinc-400 text-xs">Update your digital identity</p>
              </div>
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-1">Display Name</label>
                    <input 
                      type="text" 
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-brand-500 transition-all font-medium"
                    />
                  </div>

                  <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-[2.5rem] p-6 space-y-4 border border-zinc-100 dark:border-zinc-800">
                    <div className="flex items-center gap-4">
                      <div className="relative shrink-0">
                        <img 
                          src={newPic || 'https://picsum.photos/seed/avatar/200/200'} 
                          alt="Preview" 
                          className="w-16 h-16 rounded-2xl object-cover border-2 border-white dark:border-zinc-800 shadow-sm"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/error/200/200';
                          }}
                        />
                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-brand-500 rounded-full flex items-center justify-center border-2 border-white dark:border-zinc-900">
                          <ImageIcon className="w-2.5 h-2.5 text-white" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Profile Picture</p>
                        <p className="text-[10px] text-zinc-400 truncate">Update your photo via URL</p>
                      </div>
                    </div>
                    
                    <div className="relative">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400">
                        <LinkIcon className="w-3.5 h-3.5" />
                      </div>
                      <input 
                        type="url" 
                        value={newPic}
                        onChange={(e) => setNewPic(e.target.value)}
                        placeholder="Paste image link here..."
                        className="w-full bg-white dark:bg-zinc-900 border-none rounded-xl pl-10 pr-4 py-2.5 text-xs focus:ring-2 focus:ring-brand-500 transition-all"
                      />
                    </div>
                    <p className="text-[9px] text-zinc-400 text-center italic">Right-click image & select "Copy image address"</p>
                  </div>
                </div>
              <div className="flex gap-4 pt-2">
                <button onClick={() => setIsEditing(false)} className="flex-1 py-4 rounded-2xl font-bold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">Cancel</button>
                <button onClick={handleUpdate} className="flex-1 py-4 rounded-2xl font-bold bg-brand-500 text-white shadow-xl shadow-brand-200 dark:shadow-none">Save</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SavedView({ posts, savedIds, handleLike, handleSave, likedPosts, setPosts }: { 
  posts: Post[], 
  savedIds: Set<string>,
  handleLike: (p: Post) => void,
  handleSave: (p: Post) => void,
  likedPosts: Set<string>,
  setPosts: React.Dispatch<React.SetStateAction<Post[]>>
}) {
  const savedList = posts.filter(p => savedIds.has(p.id) && p.status !== 'deleted');

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-3xl font-display font-bold tracking-tight">Saved</h2>
        <div className="w-12 h-12 bg-brand-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-brand-100 dark:shadow-none">
          <Bookmark className="w-6 h-6 fill-current" />
        </div>
      </div>
      
      {savedList.length === 0 ? (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-24 bg-white dark:bg-zinc-900 rounded-[3rem] border-2 border-dashed border-zinc-100 dark:border-zinc-800"
        >
          <div className="w-20 h-20 bg-zinc-50 dark:bg-zinc-800 rounded-[2rem] flex items-center justify-center mx-auto mb-6">
            <Bookmark className="w-10 h-10 text-zinc-200 dark:text-zinc-700" />
          </div>
          <p className="text-zinc-400 font-medium">Your collection is empty</p>
          <p className="text-zinc-300 dark:text-zinc-600 text-xs mt-2">Save posts to see them here</p>
        </motion.div>
      ) : (
        <div className="space-y-2">
          {savedList.map(post => (
            <PostCard 
              key={post.id} 
              post={post} 
              onLike={() => handleLike(post)}
              onSave={() => handleSave(post)}
              isLiked={likedPosts.has(post.id)}
              isSaved={true}
              setPosts={setPosts}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TrashView({ posts, handleRestore, handlePermanentDelete }: { 
  posts: Post[], 
  handleRestore: (id: string) => void,
  handlePermanentDelete: (id: string) => void
}) {
  const trashList = posts.filter(p => p.status === 'deleted');

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-3xl font-display font-bold tracking-tight">Trash</h2>
        <div className="w-12 h-12 bg-red-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-red-100 dark:shadow-none">
          <Trash2 className="w-6 h-6" />
        </div>
      </div>
      
      {trashList.length === 0 ? (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-24 bg-white dark:bg-zinc-900 rounded-[3rem] border-2 border-dashed border-zinc-100 dark:border-zinc-800"
        >
          <div className="w-20 h-20 bg-zinc-50 dark:bg-zinc-800 rounded-[2rem] flex items-center justify-center mx-auto mb-6">
            <Trash2 className="w-10 h-10 text-zinc-200 dark:text-zinc-700" />
          </div>
          <p className="text-zinc-400 font-medium">Trash is empty</p>
          <p className="text-zinc-300 dark:text-zinc-600 text-xs mt-2">Deleted posts will appear here</p>
        </motion.div>
      ) : (
        <div className="space-y-4">
          {trashList.map(post => (
            <motion.div 
              key={post.id}
              layout
              className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-[2rem] p-6 soft-shadow"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <img src={post.authorPic} alt={post.authorName} className="w-10 h-10 rounded-full object-cover" referrerPolicy="no-referrer" />
                  <div>
                    <p className="font-bold text-sm">{post.authorName}</p>
                    <p className="text-[10px] text-zinc-400 uppercase tracking-wider">{new Date(post.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleRestore(post.id)}
                    className="p-2 text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-xl transition-colors"
                  >
                    Restore
                  </button>
                  <button 
                    onClick={() => handlePermanentDelete(post.id)}
                    className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-xl transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2">{post.text}</p>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsView() {
  const { profile, updateProfile, logout } = useAuth();

  return (
    <div className="space-y-8">
      <h2 className="text-3xl font-display font-bold tracking-tight px-2">Setting</h2>
      
      <div className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-[3rem] overflow-hidden soft-shadow">
        <div className="p-8 space-y-8">
          <a 
            href="https://t.me/Fimtty?text=Hello!%20I%20am%20contacting%20you%20from%20the%20app." 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center justify-between group cursor-pointer"
          >
            <div className="flex items-center gap-5">
              <div className="w-12 h-12 bg-zinc-50 dark:bg-zinc-800 rounded-2xl flex items-center justify-center text-zinc-500 group-hover:text-brand-500 transition-colors">
                <MessageCircle className="w-6 h-6" />
              </div>
              <div>
                <p className="font-bold text-zinc-900 dark:text-white group-hover:text-brand-500 transition-colors">Contact Support</p>
                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">@Fimtty on Telegram</p>
              </div>
            </div>
            <div className="w-10 h-10 rounded-full bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 group-hover:bg-brand-50 dark:group-hover:bg-brand-900/20 group-hover:text-brand-500 transition-all">
              <ChevronRight className="w-5 h-5" />
            </div>
          </a>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-5">
              <div className="w-12 h-12 bg-zinc-50 dark:bg-zinc-800 rounded-2xl flex items-center justify-center text-zinc-500">
                {profile?.notificationsEnabled ? <Bell className="w-6 h-6" /> : <BellOff className="w-6 h-6" />}
              </div>
              <div>
                <p className="font-bold text-zinc-900 dark:text-white">Notifications</p>
                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Alerts & Updates</p>
              </div>
            </div>
            <button 
              onClick={() => updateProfile({ notificationsEnabled: !profile?.notificationsEnabled })}
              className={cn(
                "w-14 h-7 rounded-full transition-all relative p-1",
                profile?.notificationsEnabled ? "bg-brand-500" : "bg-zinc-200 dark:bg-zinc-700"
              )}
            >
              <motion.div 
                animate={{ x: profile?.notificationsEnabled ? 28 : 0 }}
                className="w-5 h-5 bg-white rounded-full shadow-md"
              />
            </button>
          </div>
        </div>

        <button 
          onClick={logout}
          className="w-full p-8 flex items-center gap-5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-all border-t border-zinc-50 dark:border-zinc-800 group"
        >
          <div className="w-12 h-12 bg-red-50 dark:bg-red-950/30 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
            <LogOut className="w-6 h-6" />
          </div>
          <div className="text-left">
            <p className="font-bold">Sign Out</p>
            <p className="text-[10px] text-red-400 font-bold uppercase tracking-wider">End Session</p>
          </div>
        </button>
      </div>

      <div className="text-center pt-12">
        <div className="w-12 h-1 bg-zinc-100 dark:bg-zinc-800 mx-auto rounded-full mb-6" />
      </div>
    </div>
  );
}
