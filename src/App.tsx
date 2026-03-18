import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  limit, 
  doc, 
  getDoc, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  Timestamp,
  getDocFromServer
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db, signIn, logout } from './firebase';
import { VaultItem, UserProfile, FirestoreErrorInfo, VaultItemType, VaultItemStatus } from './types';
import { 
  LayoutDashboard, 
  FolderOpen, 
  CheckCircle2, 
  Settings, 
  LogOut, 
  Plus, 
  Search, 
  FileText, 
  AlertCircle,
  TrendingUp,
  MessageSquare,
  DollarSign,
  Briefcase,
  ChevronRight,
  Loader2,
  BrainCircuit,
  Sun,
  Moon,
  Mic,
  MicOff,
  Link as LinkIcon
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format } from 'date-fns';
import { generateCEOBriefing, processVaultItem } from './services/geminiService';

// Utility for Tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Error Boundary Component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        errorMessage = `Firestore Error: ${parsed.error} during ${parsed.operationType} on ${parsed.path}`;
      } catch (e) {
        errorMessage = this.state.error.message || errorMessage;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-zinc-100 p-8">
          <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
          <p className="text-zinc-400 text-center max-w-md mb-6">{errorMessage}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-zinc-100 text-zinc-950 rounded-lg font-medium hover:bg-zinc-200 transition-colors"
          >
            Reload Application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Firestore Error Handler
function handleFirestoreError(error: unknown, operationType: FirestoreErrorInfo['operationType'], path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
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

// Main App Component
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [vaultItems, setVaultItems] = useState<VaultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'vault' | 'approvals' | 'settings'>('dashboard');
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [generatingBriefing, setGeneratingBriefing] = useState(false);

  // Theme Effect
  useEffect(() => {
    if (profile?.theme === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  }, [profile?.theme]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setLoading(false);
        setProfile(null);
        setVaultItems([]);
      }
    });
    return unsubscribe;
  }, []);

  // Profile & Vault Listener
  useEffect(() => {
    if (!user) return;

    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Firebase configuration error: client is offline.");
        }
      }
    };
    testConnection();

    // Fetch Profile
    const profileRef = doc(db, 'users', user.uid);
    const unsubProfile = onSnapshot(profileRef, (docSnap) => {
      if (docSnap.exists()) {
        setProfile(docSnap.data() as UserProfile);
      } else {
        const newProfile: UserProfile = {
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || '',
          businessGoals: '# Q1 2026 Goals\n- Reach $10k MRR\n- Automate email triage',
          rulesOfEngagement: '# Rules of Engagement\n- Always be professional\n- Flag payments > $500',
          theme: 'dark'
        };
        setDoc(profileRef, newProfile).catch(e => handleFirestoreError(e, 'write', `users/${user.uid}`));
      }
    }, (e) => handleFirestoreError(e, 'get', `users/${user.uid}`));

    // Fetch Vault
    const vaultQuery = query(
      collection(db, 'vault'),
      where('uid', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );
    const unsubVault = onSnapshot(vaultQuery, (snapshot) => {
      const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as VaultItem));
      setVaultItems(items);
      setLoading(false);
    }, (e) => handleFirestoreError(e, 'list', 'vault'));

    return () => {
      unsubProfile();
      unsubVault();
    };
  }, [user]);

  const handleGenerateBriefing = async () => {
    if (!profile || vaultItems.length === 0) return;
    setGeneratingBriefing(true);
    const result = await generateCEOBriefing(vaultItems, profile);
    setBriefing(result);
    setGeneratingBriefing(false);
  };

  const handleSaveItem = async (item: Partial<VaultItem>) => {
    if (!user) return;

    // Dependency check
    if (item.status === 'done' || item.status === 'approved') {
      const currentItem = vaultItems.find(i => i.id === item.id);
      const dependencies = item.dependencies || currentItem?.dependencies;
      if (dependencies && dependencies.length > 0) {
        const incompleteDeps = vaultItems.filter(i => dependencies.includes(i.id!) && i.status !== 'done');
        if (incompleteDeps.length > 0) {
          alert(`Cannot mark as ${item.status}. The following dependencies are incomplete: ${incompleteDeps.map(d => d.title).join(', ')}`);
          return;
        }
      }
    }

    const now = Timestamp.now();
    try {
      if (item.id) {
        await updateDoc(doc(db, 'vault', item.id), {
          ...item,
          updatedAt: now
        });
      } else {
        await addDoc(collection(db, 'vault'), {
          ...item,
          uid: user.uid,
          createdAt: now,
          updatedAt: now,
          status: item.status || 'pending',
          dependencies: item.dependencies || []
        });
      }
      setIsEditing(false);
      setSelectedItem(null);
    } catch (e) {
      handleFirestoreError(e, 'write', 'vault');
    }
  };

  const handleDeleteItem = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'vault', id));
      setSelectedItem(null);
    } catch (e) {
      handleFirestoreError(e, 'delete', `vault/${id}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 p-4">
        <div className="w-full max-w-md space-y-8 text-center">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-emerald-500/10 rounded-3xl flex items-center justify-center border border-emerald-500/20">
              <BrainCircuit className="w-12 h-12 text-emerald-500" />
            </div>
          </div>
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Digital FTE</h1>
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">Your life and business on autopilot.</p>
          </div>
          <button 
            onClick={signIn}
            className="w-full py-4 bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-950 rounded-2xl font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-emerald-500/5"
          >
            Sign in with Google
          </button>
          <p className="text-xs text-zinc-500">
            Secure, local-first, and autonomous.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans">
        {/* Sidebar */}
        <aside className="w-72 border-r border-zinc-200 dark:border-zinc-800 flex flex-col bg-zinc-50/50 dark:bg-zinc-900/50 backdrop-blur-xl">
          <div className="p-6 flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <BrainCircuit className="w-6 h-6 text-zinc-950 dark:text-zinc-950" />
            </div>
            <span className="font-bold text-lg tracking-tight">Digital FTE</span>
          </div>

          <nav className="flex-1 px-4 space-y-2 mt-4">
            <NavItem 
              icon={<LayoutDashboard className="w-5 h-5" />} 
              label="Dashboard" 
              active={activeTab === 'dashboard'} 
              onClick={() => setActiveTab('dashboard')} 
            />
            <NavItem 
              icon={<FolderOpen className="w-5 h-5" />} 
              label="Vault" 
              active={activeTab === 'vault'} 
              onClick={() => setActiveTab('vault')} 
            />
            <NavItem 
              icon={<CheckCircle2 className="w-5 h-5" />} 
              label="Approvals" 
              active={activeTab === 'approvals'} 
              onClick={() => setActiveTab('approvals')} 
              badge={vaultItems.filter(i => i.status === 'pending' && i.type === 'plan').length}
            />
            <NavItem 
              icon={<Settings className="w-5 h-5" />} 
              label="Settings" 
              active={activeTab === 'settings'} 
              onClick={() => setActiveTab('settings')} 
            />
          </nav>

          <div className="p-4 border-t border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/50">
              <img 
                src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} 
                alt="Profile" 
                className="w-10 h-10 rounded-full border border-zinc-200 dark:border-zinc-600"
                referrerPolicy="no-referrer"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.displayName}</p>
                <p className="text-xs text-zinc-500 truncate">{user.email}</p>
              </div>
              <button 
                onClick={logout}
                className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto relative">
          <div className="max-w-6xl mx-auto p-8">
            {activeTab === 'dashboard' && (
              <Dashboard 
                vaultItems={vaultItems} 
                briefing={briefing} 
                onGenerateBriefing={handleGenerateBriefing} 
                generating={generatingBriefing}
              />
            )}
            {activeTab === 'vault' && (
              <Vault 
                items={vaultItems} 
                onSelect={setSelectedItem} 
                onAdd={() => { setSelectedItem(null); setIsEditing(true); }}
              />
            )}
            {activeTab === 'approvals' && (
              <Approvals 
                items={vaultItems.filter(i => i.status === 'pending')} 
                onApprove={(id) => handleSaveItem({ id, status: 'approved' })}
                onReject={(id) => handleSaveItem({ id, status: 'rejected' })}
              />
            )}
            {activeTab === 'settings' && (
              <SettingsTab 
                profile={profile} 
                onSave={(p) => setDoc(doc(db, 'users', user.uid), p)} 
              />
            )}
          </div>

          {/* Editor Overlay */}
          {(selectedItem || isEditing) && (
            <div className="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <div className="bg-zinc-900 w-full max-w-4xl max-h-[90vh] rounded-3xl border border-zinc-800 shadow-2xl flex flex-col overflow-hidden">
                <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                  <h2 className="text-xl font-bold">{selectedItem ? 'Edit Item' : 'New Vault Item'}</h2>
                  <button 
                    onClick={() => { setSelectedItem(null); setIsEditing(false); }}
                    className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
                  >
                    <Plus className="w-6 h-6 rotate-45" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-8">
                  <ItemEditor 
                    item={selectedItem} 
                    onSave={handleSaveItem} 
                    onDelete={selectedItem?.id ? () => handleDeleteItem(selectedItem.id!) : undefined}
                    profile={profile}
                    vaultItems={vaultItems}
                  />
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </ErrorBoundary>
  );
}

// Sub-components
function NavItem({ icon, label, active, onClick, badge }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, badge?: number }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group relative",
        active ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50"
      )}
    >
      {icon}
      <span className="font-medium">{label}</span>
      {badge ? (
        <span className="ml-auto bg-emerald-500 text-zinc-950 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
          {badge}
        </span>
      ) : null}
      {active && <div className="absolute left-0 w-1 h-6 bg-emerald-500 rounded-r-full" />}
    </button>
  );
}

function Dashboard({ vaultItems, briefing, onGenerateBriefing, generating }: { vaultItems: VaultItem[], briefing: string | null, onGenerateBriefing: () => void, generating: boolean }) {
  const stats = useMemo(() => {
    const done = vaultItems.filter(i => i.status === 'done').length;
    const pending = vaultItems.filter(i => i.status === 'pending').length;
    const emails = vaultItems.filter(i => i.type === 'email').length;
    return { done, pending, emails };
  }, [vaultItems]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Monday Morning Briefing</h1>
          <p className="text-zinc-400 mt-1">Status report for {format(new Date(), 'MMMM do, yyyy')}</p>
        </div>
        <button 
          onClick={onGenerateBriefing}
          disabled={generating}
          className="flex items-center gap-2 px-6 py-3 bg-emerald-500 text-zinc-950 rounded-2xl font-bold hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
        >
          {generating ? <Loader2 className="w-5 h-5 animate-spin" /> : <BrainCircuit className="w-5 h-5" />}
          Refresh Briefing
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard icon={<CheckCircle2 className="text-emerald-500" />} label="Tasks Completed" value={stats.done} color="emerald" />
        <StatCard icon={<AlertCircle className="text-amber-500" />} label="Pending Actions" value={stats.pending} color="amber" />
        <StatCard icon={<MessageSquare className="text-blue-500" />} label="Communications" value={stats.emails} color="blue" />
      </div>

      <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-8 min-h-[400px]">
        {briefing ? (
          <div className="prose dark:prose-invert max-w-none">
            <ReactMarkdown>{briefing}</ReactMarkdown>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-zinc-400 dark:text-zinc-500 space-y-4">
            <BrainCircuit className="w-16 h-16 opacity-20" />
            <p className="text-lg">Click "Refresh Briefing" to generate your AI report.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode, label: string, value: number, color: string }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl flex items-center gap-4 shadow-sm">
      <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center", `bg-${color}-500/10`)}>
        {icon}
      </div>
      <div>
        <p className="text-sm text-zinc-500 font-medium">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </div>
    </div>
  );
}

function Vault({ items, onSelect, onAdd }: { items: VaultItem[], onSelect: (i: VaultItem) => void, onAdd: () => void }) {
  const [search, setSearch] = useState('');
  const filtered = items.filter(i => i.title.toLowerCase().includes(search.toLowerCase()) || i.content.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Vault</h1>
        <button 
          onClick={onAdd}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-100 text-zinc-950 rounded-xl font-bold hover:bg-zinc-200 transition-all"
        >
          <Plus className="w-5 h-5" />
          Add Item
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
        <input 
          type="text" 
          placeholder="Search your vault..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map(item => (
          <button 
            key={item.id} 
            onClick={() => onSelect(item)}
            className="flex flex-col p-6 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl text-left hover:border-zinc-300 dark:hover:border-zinc-700 transition-all group shadow-sm"
          >
            <div className="flex items-center justify-between w-full mb-3">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md",
                  item.type === 'email' ? "bg-blue-500/10 text-blue-500" :
                  item.type === 'whatsapp' ? "bg-emerald-500/10 text-emerald-500" :
                  item.type === 'finance' ? "bg-amber-500/10 text-amber-500" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                )}>
                  {item.type}
                </span>
                {item.dependencies && item.dependencies.length > 0 && (
                  <LinkIcon className="w-3 h-3 text-zinc-400" />
                )}
              </div>
              <span className="text-xs text-zinc-500">{format(item.updatedAt.toDate(), 'MMM d, h:mm a')}</span>
            </div>
            <h3 className="text-lg font-bold mb-2 group-hover:text-emerald-500 transition-colors">{item.title}</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2">{item.content}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function Approvals({ items, onApprove, onReject }: { items: VaultItem[], onApprove: (id: string) => void, onReject: (id: string) => void }) {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <h1 className="text-3xl font-bold">Pending Approvals</h1>
      {items.length === 0 ? (
        <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-12 text-center text-zinc-500">
          <CheckCircle2 className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg">All clear! No pending approvals.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map(item => (
            <div key={item.id} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-3xl flex items-center justify-between gap-6 shadow-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-amber-500/10 text-amber-500">
                    {item.type}
                  </span>
                  <h3 className="font-bold truncate">{item.title}</h3>
                </div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 line-clamp-1">{item.content}</p>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => onReject(item.id!)}
                  className="px-4 py-2 text-zinc-500 dark:text-zinc-400 hover:text-red-500 transition-colors font-medium"
                >
                  Reject
                </button>
                <button 
                  onClick={() => onApprove(item.id!)}
                  className="px-6 py-2 bg-emerald-500 text-zinc-950 rounded-xl font-bold hover:bg-emerald-400 transition-all"
                >
                  Approve
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsTab({ profile, onSave }: { profile: UserProfile | null, onSave: (p: UserProfile) => void }) {
  const [data, setData] = useState<UserProfile | null>(profile);

  useEffect(() => { setData(profile); }, [profile]);

  if (!data) return null;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <h1 className="text-3xl font-bold">Settings</h1>
      
      <div className="space-y-6">
        <div className="space-y-4 p-6 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Settings className="w-5 h-5 text-emerald-500" />
            Appearance
          </h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Theme</p>
              <p className="text-sm text-zinc-500">Switch between light and dark mode</p>
            </div>
            <div className="flex bg-zinc-200 dark:bg-zinc-800 p-1 rounded-xl">
              <button 
                onClick={() => setData({ ...data, theme: 'light' })}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg transition-all",
                  data.theme === 'light' ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                )}
              >
                <Sun className="w-4 h-4" />
                Light
              </button>
              <button 
                onClick={() => setData({ ...data, theme: 'dark' })}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg transition-all",
                  data.theme === 'dark' ? "bg-zinc-700 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-400"
                )}
              >
                <Moon className="w-4 h-4" />
                Dark
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Display Name</label>
          <input 
            type="text" 
            value={data.displayName} 
            onChange={(e) => setData({ ...data, displayName: e.target.value })}
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Business Goals (Markdown)</label>
          <textarea 
            rows={6}
            value={data.businessGoals} 
            onChange={(e) => setData({ ...data, businessGoals: e.target.value })}
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 font-mono text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Rules of Engagement (Markdown)</label>
          <textarea 
            rows={6}
            value={data.rulesOfEngagement} 
            onChange={(e) => setData({ ...data, rulesOfEngagement: e.target.value })}
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 font-mono text-sm"
          />
        </div>

        <button 
          onClick={() => onSave(data)}
          className="px-8 py-3 bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-950 rounded-2xl font-bold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all"
        >
          Save Settings
        </button>
      </div>
    </div>
  );
}

function ItemEditor({ item, onSave, onDelete, profile, vaultItems }: { item: VaultItem | null, onSave: (i: Partial<VaultItem>) => void, onDelete?: () => void, profile: UserProfile | null, vaultItems: VaultItem[] }) {
  const [title, setTitle] = useState(item?.title || '');
  const [content, setContent] = useState(item?.content || '');
  const [type, setType] = useState<VaultItemType>(item?.type || 'email');
  const [status, setStatus] = useState<VaultItemStatus>(item?.status || 'pending');
  const [dependencies, setDependencies] = useState<string[]>(item?.dependencies || []);
  const [processing, setProcessing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  const toggleDependency = (id: string) => {
    setDependencies(prev => 
      prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]
    );
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Your browser does not support speech recognition.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setContent(prev => prev + (prev ? ' ' : '') + transcript);
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  const handleProcess = async () => {
    if (!profile) return;
    setProcessing(true);
    const result = await processVaultItem({ title, content, type, status } as VaultItem, profile);
    setAnalysis(result);
    setProcessing(false);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Title</label>
          <input 
            type="text" 
            value={title} 
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl py-2 px-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Type</label>
          <select 
            value={type} 
            onChange={(e) => setType(e.target.value as VaultItemType)}
            className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl py-2 px-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          >
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="finance">Finance</option>
            <option value="plan">Plan</option>
            <option value="log">Log</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Dependencies</label>
        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl">
          {vaultItems.filter(i => i.id !== item?.id).map(i => (
            <button
              key={i.id}
              onClick={() => toggleDependency(i.id!)}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-medium transition-all",
                dependencies.includes(i.id!) 
                  ? "bg-emerald-500 text-zinc-950" 
                  : "bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600"
              )}
            >
              {i.title}
            </button>
          ))}
          {vaultItems.filter(i => i.id !== item?.id).length === 0 && (
            <p className="text-xs text-zinc-500 italic">No other items available</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Content</label>
          <button 
            onClick={startListening}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
              isListening ? "bg-red-500/10 text-red-500 animate-pulse" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-emerald-500"
            )}
          >
            {isListening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
            {isListening ? 'Listening...' : 'Voice to Text'}
          </button>
        </div>
        <textarea 
          rows={10}
          value={content} 
          onChange={(e) => setContent(e.target.value)}
          className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 font-mono text-sm"
        />
      </div>

      {analysis && (
        <div className="p-6 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl prose dark:prose-invert max-w-none">
          <h4 className="text-emerald-500 font-bold mb-2 flex items-center gap-2">
            <BrainCircuit className="w-4 h-4" />
            AI Analysis & Plan
          </h4>
          <ReactMarkdown>{analysis}</ReactMarkdown>
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <button 
            onClick={handleProcess}
            disabled={processing}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-500 rounded-xl font-bold hover:bg-emerald-500/20 transition-all disabled:opacity-50"
          >
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <BrainCircuit className="w-4 h-4" />}
            AI Process
          </button>
          {onDelete && (
            <button 
              onClick={onDelete}
              className="px-4 py-2 text-zinc-500 hover:text-red-400 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
        <button 
          onClick={() => onSave({ id: item?.id, title, content, type, status, dependencies, path: `/${type}/${title.replace(/\s+/g, '_')}.md` })}
          className="px-8 py-2 bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-950 rounded-xl font-bold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all"
        >
          Save Item
        </button>
      </div>
    </div>
  );
}
