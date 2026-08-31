import { useEffect, useMemo, useRef, useState, createContext, useContext, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  healthCheck,
  getHealthCheckQueryKey,
  getGetRuntimeStatusQueryKey,
  getGetRuntimeEventsQueryKey,
  getGetChatThreadQueryKey,
  getGetOccupancyQueryKey,
  getGetMemoryQueryKey,
  getGetColabCommandsQueryKey,
  useHealthCheck,
  useGetRuntimeStatus,
  useGetRuntimeEvents,
  useGetChatThread,
  useGetOccupancy,
  useGetMemory,
  useCreateRuntimeBootstrap,
  useDisconnectRuntime,
  useExecuteRuntimeCode,
  useInterruptRuntime,
  useConnectColabRuntime,
  usePostColabEvent,
  useGetColabCommands,
  useSendAssistantMessage,
  useAddPlanItem,
  useClearPlan,
  useTogglePlanItem,
  useAddPoint,
  useAddDecision,
  useSaveProject,
  type RuntimeStatus,
  type RuntimeEvent,
  type ChatMessage,
} from '@workspace/api-client-react';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import {
  Activity, ArrowUpRight, BrainCircuit, Check, CircleHelp, Cloud, Code2,
  Copy, Cpu, FileCode2, Gauge, GitBranch, KeyRound, Laptop, Loader2, Menu,
  Play, PlugZap, RefreshCw, RotateCcw, Send, Settings2, ShieldCheck, Square, Terminal,
  Unplug, X, Zap,
} from 'lucide-react';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

type Preference = 'ensemble' | 'primary' | 'fast';
type Prefs = {
  preference: Preference;
  safeMode: boolean;
  confirmExecution: boolean;
  setPreference: (value: Preference) => void;
  setSafeMode: (value: boolean) => void;
  setConfirmExecution: (value: boolean) => void;
};
const PrefsContext = createContext<Prefs | null>(null);
const usePrefs = () => useContext(PrefsContext)!;

const formatTime = (date?: string | null) => date ? new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(date)) : '—';
const formatDateTime = (date?: string | null) => date ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date)) : '—';
const stateLabel = (state?: RuntimeStatus['state']) => state === 'connected' ? 'Connected' : state === 'busy' ? 'Executing' : state === 'waiting' ? 'Waiting for connector' : state === 'error' ? 'Attention needed' : 'Offline';
const targetLabel = (target?: string | null) => target === 'kaggle' ? 'Kaggle' : 'Colab';

function App() {
  const [preference, setPreferenceState] = useState<Preference>(() => (localStorage.getItem('ccc-preference') as Preference) || 'ensemble');
  const [safeMode, setSafeModeState] = useState(() => localStorage.getItem('ccc-safe-mode') !== 'false');
  const [confirmExecution, setConfirmState] = useState(() => localStorage.getItem('ccc-confirm') !== 'false');
  const setPreference = (value: Preference) => { setPreferenceState(value); localStorage.setItem('ccc-preference', value); };
  const setSafeMode = (value: boolean) => { setSafeModeState(value); localStorage.setItem('ccc-safe-mode', String(value)); };
  const setConfirmExecution = (value: boolean) => { setConfirmState(value); localStorage.setItem('ccc-confirm', String(value)); };
  return (
    <QueryClientProvider client={queryClient}>
      <PrefsContext.Provider value={{ preference, safeMode, confirmExecution, setPreference, setSafeMode, setConfirmExecution }}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <RoutedErrorBoundary><Shell /></RoutedErrorBoundary>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </PrefsContext.Provider>
    </QueryClientProvider>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Shell() {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: health } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30000 } });
  const { data: occupancy } = useGetOccupancy({ query: { queryKey: getGetOccupancyQueryKey(), refetchInterval: 5000 } });
  if (occupancy?.busy && occupancy.allowed === false) return <BusyScreen />;
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-300 md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-3 px-6 pb-7 pt-7">
          <div className="relative grid size-9 place-items-center rounded-xl bg-accent text-sidebar-primary-foreground shadow-[0_0_0_5px_hsl(var(--accent)/.12)]"><BrainCircuit size={18} strokeWidth={2.5}/></div>
          <div><div className="font-display text-[17px] font-bold tracking-tight text-sidebar-accent-foreground">CC<span className="text-accent">+</span></div><div className="mono mt-0.5 text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/55">Colab-Command-Center</div></div>
        </div>
        <div className="mx-4 mb-6 rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-3">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-sidebar-foreground/55"><span className={`size-1.5 rounded-full ${health?.status === 'ok' ? 'bg-emerald-400' : 'bg-accent'}`}/> control plane</div>
          <div className="mt-2 flex items-center justify-between text-xs"><span className="text-sidebar-foreground/75">{health?.status === 'ok' ? 'API operational' : 'Checking service'}</span><span className="mono text-sidebar-foreground/45">v1.0.0</span></div>
        </div>
        <nav className="space-y-1 px-3">
          <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[.18em] text-sidebar-foreground/35">Workspace</div>
          <SideLink href="/" active={location === '/'} icon={<Gauge size={17}/>} label="Command center" testId="link-command-center"/>
          <SideLink href="/setup" active={location === '/setup'} icon={<PlugZap size={17}/>} label="Connect runtime" testId="link-setup"/>
          <SideLink href="/settings" active={location === '/settings'} icon={<Settings2 size={17}/>} label="Settings" testId="link-settings"/>
        </nav>
        <div className="mt-auto p-4">
          <div className="rounded-xl border border-sidebar-border p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-sidebar-accent-foreground"><ShieldCheck size={15} className="text-accent"/> Safety defaults on</div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-sidebar-foreground/55">Single-user · session memory · keys server-side.</p>
          </div>
          <div className="mt-5 flex items-center justify-between px-2 text-[10px] text-sidebar-foreground/35"><span>POWERED BY CC R2</span><CircleHelp size={13}/></div>
        </div>
      </aside>
      {mobileOpen && <button aria-label="Close menu" data-testid="button-close-menu" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-sidebar/30 md:hidden"/>}
      <div className="md:pl-[252px]">
        <header className="sticky top-0 z-20 flex h-[70px] items-center justify-between border-b border-border/70 bg-background/90 px-5 backdrop-blur-xl md:px-9">
          <button onClick={() => setMobileOpen(true)} data-testid="button-open-menu" className="rounded-lg p-2 hover:bg-muted md:hidden"><Menu size={20}/></button>
          <div className="hidden text-xs text-muted-foreground md:block"><span className="mono text-[10px] tracking-[.12em] text-primary">LOCAL /</span> {location === '/' ? 'command center' : location.slice(1)}</div>
          <div className="ml-auto flex items-center gap-2.5">
            <Link href="/setup" data-testid="link-header-connect" className="hidden items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:border-primary/50 hover:bg-secondary sm:flex"><PlugZap size={14} className="text-primary"/> Connect runtime</Link>
            <Link href="/settings" data-testid="link-header-settings" className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground"><Settings2 size={16}/></Link>
            <div className="grid size-9 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">CC</div>
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-4 py-6 md:px-9 md:py-8"><Switch><Route path="/" component={CommandCenter}/><Route path="/setup" component={SetupPage}/><Route path="/settings" component={SettingsPage}/><Route component={NotFound}/></Switch></main>
      </div>
    </div>
  );
}

function SideLink({ href, active, icon, label, testId }: { href: string; active: boolean; icon: ReactNode; label: string; testId: string }) {
  return <Link href={href} data-testid={testId} className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold ${active ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`}>{icon}<span>{label}</span>{active && <ArrowUpRight size={14} className="ml-auto opacity-60"/>}</Link>;
}

function CommandCenter() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { safeMode, confirmExecution, preference } = usePrefs();
  const { data: status, isLoading: statusLoading, isError: statusError, refetch: refetchStatus } = useGetRuntimeStatus({ query: { queryKey: getGetRuntimeStatusQueryKey(), refetchInterval: 5000 } });
  const sessionId = status?.sessionId ?? '';
  const eventParams = useMemo(() => ({ sessionId }), [sessionId]);
  const { data: eventResponse, isLoading: eventsLoading, isError: eventsError } = useGetRuntimeEvents(eventParams, { query: { queryKey: getGetRuntimeEventsQueryKey(eventParams), enabled: Boolean(sessionId), refetchInterval: 3500 } });
  const events = eventResponse?.events ?? [];
  const { data: threadResponse, isLoading: messagesLoading, isError: messagesError } = useGetChatThread({ query: { queryKey: getGetChatThreadQueryKey(), refetchInterval: 4000 } });
  const messages = threadResponse?.messages ?? [];
  const { data: memory, isLoading: memoryLoading, isError: memoryError } = useGetMemory({ query: { queryKey: getGetMemoryQueryKey(), refetchInterval: 4000 } });
  const { data: occupancy } = useGetOccupancy({ query: { queryKey: getGetOccupancyQueryKey(), refetchInterval: 5000 } });
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('import os\\n\\nprint(os.getcwd())');
  const [activeTab, setActiveTab] = useState<'chat' | 'code'>('chat');
  const [toast, setToast] = useState('');
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [showCodeConfirm, setShowCodeConfirm] = useState(false);
  const assistant = useSendAssistantMessage();
  const execute = useExecuteRuntimeCode();
  const interrupt = useInterruptRuntime();
  const disconnect = useDisconnectRuntime();
  const saveProject = useSaveProject();
  const addPlan = useAddPlanItem();
  const clearPlan = useClearPlan();
  const togglePlan = useTogglePlanItem();
  const addPoint = useAddPoint();
  const addDecision = useAddDecision();
  const threadRef = useRef<HTMLDivElement>(null);

  // The single-user seat is owned by whoever holds the connected sessionId.
  // If someone else owns the seat, we show a busy lock screen.
  const seatOwner = occupancy?.ownerId ?? null;
  const amOwner = !seatOwner || seatOwner === sessionId;
  const lockedOut = Boolean(occupancy?.busy) && !amOwner;

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, assistant.isPending]);

  const runAssistant = () => {
    if (!message.trim() || assistant.isPending) return;
    const text = message.trim();
    assistant.mutate({ data: { sessionId: sessionId || null, message: text, preference, execute: safeMode ? false : true } }, {
      onSuccess: (response) => {
        if (response.code) setCode(response.code);
        setMessage('');
        const r = response as { keyDetected?: { kind: string; masked: string } | null };
        if (r.keyDetected) setToast(`${r.keyDetected.kind} key saved: ${r.keyDetected.masked} · session only`);
        qc.invalidateQueries({ queryKey: getGetChatThreadQueryKey() });
        qc.invalidateQueries({ queryKey: getGetMemoryQueryKey() });
        qc.invalidateQueries({ queryKey: getGetRuntimeEventsQueryKey(eventParams) });
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'The assistant could not complete that request.';
        setToast(msg);
      },
    });
  };
  const executeCode = () => {
    if (!sessionId || !code.trim()) return;
    setShowCodeConfirm(false);
    execute.mutate({ data: { sessionId, code, description: 'Manual command from command center' } }, { onSuccess: (result) => setToast(result.message), onError: () => setToast('Command was not accepted by the runtime.') });
  };
  const runCode = () => { if (confirmExecution) setShowCodeConfirm(true); else executeCode(); };
  const disconnectRuntime = () => { if (!sessionId) return; disconnect.mutate({ data: { sessionId } }, { onSuccess: () => { setShowDisconnect(false); refetchStatus(); setToast('Runtime disconnected. Session memory cleared.'); qc.invalidateQueries({ queryKey: getGetMemoryQueryKey() }); qc.invalidateQueries({ queryKey: getGetChatThreadQueryKey() }); qc.invalidateQueries({ queryKey: getGetOccupancyQueryKey() }); } }); };
  const interruptRuntime = () => { if (sessionId) interrupt.mutate({ data: { sessionId } }, { onSuccess: (r) => setToast(r.message) }); };
  const doSaveProject = (name: string) => saveProject.mutate({ data: { name } }, { onSuccess: (r) => { setToast(`Saved to GitHub: ${r.repo}`); qc.invalidateQueries({ queryKey: getGetMemoryQueryKey() }); }, onError: (e: unknown) => setToast(e instanceof Error ? e.message : 'GitHub save failed.') });
  const refreshMemory = () => qc.invalidateQueries({ queryKey: getGetMemoryQueryKey() });
  const addMemory = (kind: 'plan' | 'point' | 'decision', text: string) => {
    const mutation = kind === 'plan' ? addPlan : kind === 'point' ? addPoint : addDecision;
    mutation.mutate({ data: { text } }, {
      onSuccess: () => { refreshMemory(); setToast(`${kind === 'plan' ? 'Plan item' : kind === 'point' ? 'Point' : 'Decision'} recorded.`); },
      onError: () => setToast('Memory could not be updated.'),
    });
  };
  const clearMemoryPlan = () => {
    if (!window.confirm('Clear every item in the current plan?')) return;
    clearPlan.mutate(undefined, { onSuccess: () => { refreshMemory(); setToast('Plan cleared.'); }, onError: () => setToast('Plan could not be cleared.') });
  };

  if (lockedOut) return <BusyScreen />;
  return (
    <div className="animate-rise">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-primary"><span className="size-1.5 rounded-full bg-primary"/>{status?.state === 'connected' ? 'Live workspace' : 'Workspace standby'}</div><h1 className="font-display text-4xl tracking-tight text-foreground md:text-[46px]">Your notebook,<br/><em className="text-primary not-italic">within reach.</em></h1><p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">Direct a connected {targetLabel(status?.target)} runtime with natural language, inspect every command, and stay close to what is running.</p></div>
        <div className="flex items-center gap-2"><button onClick={() => refetchStatus()} data-testid="button-refresh-status" className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground"><RefreshCw size={15} className={statusLoading ? 'animate-spin' : ''}/></button>{sessionId && <button onClick={() => setShowDisconnect(true)} data-testid="button-disconnect-runtime" className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:border-destructive/40 hover:text-destructive"><Unplug size={14} className="mr-1.5 inline"/> Disconnect</button>}</div>
      </div>
      {statusError && <div className="mb-5 flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" data-testid="status-runtime-error"><span>Runtime status is temporarily unavailable.</span><button onClick={() => refetchStatus()} data-testid="button-retry-status" className="font-bold underline">Retry</button></div>}
      <RuntimeBanner status={status} loading={statusLoading} onConnect={() => setLocation('/setup')}/>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card soft-shadow">
          <div className="flex items-center justify-between border-b border-border px-5 py-4"><div className="flex items-center gap-2.5"><div className="grid size-8 place-items-center rounded-lg bg-secondary text-primary"><Zap size={16} fill="currentColor"/></div><div><h2 className="text-sm font-bold">Command dialogue</h2><p className="text-[11px] text-muted-foreground">Ask, inspect, then execute</p></div></div><div className="flex rounded-lg bg-muted p-1"><button onClick={() => setActiveTab('chat')} data-testid="button-tab-chat" className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${activeTab === 'chat' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>Chat</button><button onClick={() => setActiveTab('code')} data-testid="button-tab-code" className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${activeTab === 'code' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>Code runner</button></div></div>
           {activeTab === 'chat' ? <ChatPanel threadRef={threadRef} messages={messages} message={message} setMessage={setMessage} pending={assistant.isPending} loading={messagesLoading} error={messagesError} onSend={runAssistant} connected={Boolean(sessionId)} /> : <CodePanel code={code} setCode={setCode} onRun={runCode} pending={execute.isPending} connected={Boolean(sessionId)} onInterrupt={interruptRuntime} interrupting={interrupt.isPending} safeMode={safeMode}/>}
        </section>
        <div className="flex flex-col gap-5">
           <MemoryPanel memory={memory} loading={memoryLoading} error={memoryError} onToggle={(id) => togglePlan.mutate({ id }, { onSuccess: refreshMemory })} onAdd={addMemory} onClearPlan={clearMemoryPlan} clearing={clearPlan.isPending} onSaveProject={doSaveProject} saving={saveProject.isPending} />
           <RuntimePanel status={status} events={events} loading={eventsLoading} error={eventsError} onInterrupt={interruptRuntime} interrupting={interrupt.isPending} />
        </div>
      </div>
      {toast && <div className="fixed bottom-5 right-5 z-50 flex max-w-sm items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-xs font-semibold soft-shadow" data-testid="status-toast"><Check size={15} className="text-emerald-600"/>{toast}<button onClick={() => setToast('')} data-testid="button-dismiss-toast"><X size={14} className="text-muted-foreground"/></button></div>}
      {showDisconnect && <ConfirmDialog title="Disconnect this runtime?" description="Queued work stays visible, but session memory (chat, plan, decisions) is cleared on disconnect and no new commands run until you reconnect." onCancel={() => setShowDisconnect(false)} onConfirm={disconnectRuntime} pending={disconnect.isPending}/>}
      {showCodeConfirm && <ConfirmDialog title="Queue this code on the runtime?" description="This will send the current cell to your connected runtime. You can stop it from the output stream while it runs." onCancel={() => setShowCodeConfirm(false)} onConfirm={executeCode} pending={execute.isPending}/>}
    </div>
  );
}

function BusyScreen() {
  return <div className="animate-rise flex min-h-[70vh] flex-col items-center justify-center px-6 text-center" data-testid="status-app-busy"><div className="grid size-16 place-items-center rounded-2xl bg-accent/10 text-accent"><Loader2 size={30} className="animate-spin"/></div><h2 className="mt-6 max-w-xl font-display text-2xl tracking-tight">system is currently busy. please try again later.</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">This private workspace allows one active visitor at a time. The current session is still using the control plane.</p><Link href="/" data-testid="link-busy-retry" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground"><RefreshCw size={14}/> Retry</Link></div>;
}

function RuntimeBanner({ status, loading, onConnect }: { status?: RuntimeStatus; loading: boolean; onConnect: () => void }) {
  const connected = status?.state === 'connected' || status?.state === 'busy';
  return <section className={`relative overflow-hidden rounded-2xl border ${connected ? 'border-primary/25 bg-primary/[.055]' : 'border-accent/35 bg-accent/[.08]'}`} data-testid="card-runtime-status"><div className="absolute -right-12 -top-20 size-48 rounded-full border-[22px] border-primary/5"/><div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="flex items-center gap-4"><div className="relative grid size-11 place-items-center rounded-xl bg-card text-primary shadow-sm">{connected && <span className="animate-pulse-ring absolute inset-0 rounded-xl border-2 border-primary"/>}{loading ? <Loader2 size={19} className="animate-spin"/> : connected ? <Cloud size={20}/> : <Laptop size={20}/>}</div><div><div className="flex items-center gap-2"><span className="text-[11px] font-bold uppercase tracking-[.15em] text-muted-foreground">{targetLabel(status?.target)} runtime</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${connected ? 'bg-emerald-100 text-emerald-700' : 'bg-accent/25 text-foreground'}`}>{loading ? 'Checking' : stateLabel(status?.state)}</span></div><div className="mt-1 text-base font-bold">{status?.label || 'No notebook connected'}</div><div className="mt-1 text-xs text-muted-foreground">{connected ? `${status?.pythonVersion || 'Python runtime'} · Last seen ${formatTime(status?.lastSeenAt)}` : `Connect a temporary bridge from ${targetLabel(status?.target)} to begin.`}</div></div></div>{connected ? <div className="grid grid-cols-2 gap-2 text-right sm:flex sm:items-center sm:gap-6"><div><div className="mono text-lg font-medium text-primary">{status?.queuedCommands ?? 0}</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">queued</div></div><div className="hidden h-8 w-px bg-border sm:block"/><div><div className="mono text-lg font-medium">{formatTime(status?.connectedAt)}</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">connected</div></div></div> : <button onClick={onConnect} data-testid="button-connect-runtime" className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground hover:-translate-y-0.5 hover:shadow-lg"><PlugZap size={15}/> Connect {targetLabel(status?.target)}</button>}</div></section>;
}

function ChatPanel({ threadRef, messages, message, setMessage, pending, loading, error, onSend, connected }: { threadRef: React.RefObject<HTMLDivElement | null>; messages: ChatMessage[]; message: string; setMessage: (v: string) => void; pending: boolean; loading: boolean; error: boolean; onSend: () => void; connected: boolean }) {
  return <div className="flex h-[560px] flex-col"><div ref={threadRef} className="flex-1 overflow-y-auto p-5 md:p-6">{loading ? <div className="space-y-4" data-testid="status-chat-loading">{[1, 2, 3].map((i) => <div key={i} className={`animate-pulse rounded-2xl bg-muted p-4 ${i === 2 ? 'ml-auto w-3/4' : 'w-4/5'}`}><div className="h-2 w-1/3 rounded bg-border"/><div className="mt-3 h-2 w-full rounded bg-border"/><div className="mt-2 h-2 w-2/3 rounded bg-border"/></div>)}</div> : error ? <div className="flex h-full min-h-[350px] flex-col items-center justify-center text-center" data-testid="status-chat-error"><div className="grid size-12 place-items-center rounded-2xl bg-destructive/10 text-destructive"><RefreshCw size={20}/></div><h3 className="mt-4 text-sm font-bold">Conversation unavailable</h3><p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">The saved thread could not be loaded. You can still try a new request.</p></div> : messages.length === 0 && !pending ? <div className="flex h-full min-h-[350px] flex-col justify-center"><div className="mb-5 grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><Terminal size={23}/></div><h3 className="font-display text-3xl tracking-tight">What are we working on?</h3><p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Describe an analysis, ask about the current state, or draft code for review. Nothing runs without your say-so. CC R2 remembers the whole session.</p><div className="mt-7 grid gap-2 sm:grid-cols-2"><Prompt text="Profile the loaded dataframe" onClick={() => setMessage('Profile the loaded dataframe')} testId="button-prompt-profile"/><Prompt text="Check memory usage" onClick={() => setMessage('Check memory usage')} testId="button-prompt-memory"/><Prompt text="Find missing values" onClick={() => setMessage('Find missing values')} testId="button-prompt-missing"/><Prompt text="Explain the last output" onClick={() => setMessage('Explain the last output')} testId="button-prompt-explain"/></div></div> : <div className="space-y-5">{messages.map((m) => <MessageBubble key={m.id} message={m} />)}{pending && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin text-primary"/> CC R2 is thinking…</div>}</div>}</div><div className="border-t border-border p-4 md:p-5"><div className="rounded-xl border border-border bg-background p-2 focus-within:border-primary/60 focus-within:ring-4 focus-within:ring-primary/10"><textarea value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }}} placeholder={connected ? 'Ask your notebook anything…' : 'Connect a runtime first, then ask away…'} data-testid="input-chat-message" rows={2} className="w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground/60"/><div className="flex items-center justify-between px-1 pt-2"><div className="flex items-center gap-2 text-[10px] text-muted-foreground"><span className="mono rounded bg-muted px-1.5 py-1">CC R2</span>{!connected && <Link href="/setup" data-testid="link-chat-setup" className="font-bold text-primary hover:underline">Connect runtime</Link>}</div><button onClick={onSend} disabled={pending || !message.trim()} data-testid="button-send-message" className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"><Send size={16}/></button></div></div><p className="mt-2 px-1 text-[10px] text-muted-foreground/70">Enter to send · Shift + Enter for a new line</p></div></div>;
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') return <div className="ml-auto max-w-[86%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground"><p className="whitespace-pre-wrap break-words">{message.content}</p>{message.code && <pre className="mt-3 overflow-x-auto rounded-lg bg-primary-foreground/10 p-3 text-xs leading-6"><code>{message.code}</code></pre>}</div>;
  return <div className="max-w-[86%] rounded-2xl rounded-tl-md border border-border bg-background p-4"><div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.13em] text-primary"><div className="grid size-5 place-items-center rounded-md bg-secondary"><Zap size={11} fill="currentColor"/></div>CC R2</div><p className="whitespace-pre-wrap break-words text-sm leading-7">{message.content}</p>{message.code && <div className="mt-4 overflow-hidden rounded-xl border border-sidebar-border bg-sidebar"><div className="flex items-center justify-between border-b border-sidebar-border px-3 py-2 text-[10px] text-sidebar-foreground/60"><span className="mono">suggested.py</span><CopyButton value={message.code} testId="button-copy-assistant-code"/></div><pre className="overflow-x-auto p-4 text-xs leading-6 text-sidebar-accent-foreground"><code>{message.code}</code></pre></div>}</div>;
}

function MemoryPanel({ memory, loading, error, onToggle, onAdd, onClearPlan, clearing, onSaveProject, saving }: { memory?: import('@workspace/api-client-react').MemorySummary; loading: boolean; error: boolean; onToggle: (id: string) => void; onAdd: (kind: 'plan' | 'point' | 'decision', text: string) => void; onClearPlan: () => void; clearing: boolean; onSaveProject: (name: string) => void; saving: boolean }) {
  const plan = memory?.plan ?? [];
  const points = memory?.points ?? [];
  const decisions = memory?.decisions ?? [];
  const tasks = memory?.tasks ?? [];
  const [entry, setEntry] = useState('');
  const [kind, setKind] = useState<'plan' | 'point' | 'decision'>('plan');
  const hasNotes = plan.length + points.length + decisions.length + tasks.length > 0;
  const onSave = () => { const name = window.prompt('Project name to save on GitHub?', 'cc-plus-session'); if (name?.trim()) onSaveProject(name.trim()); };
  const submitEntry = () => {
    if (!entry.trim()) return;
    onAdd(kind, entry.trim());
    setEntry('');
  };
  return (
    <section className="rounded-2xl border border-border bg-card soft-shadow" data-testid="card-memory">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2"><BrainCircuit size={16} className="text-primary"/><h2 className="text-sm font-bold">Session memory</h2></div>
        <div className="flex items-center gap-2"><span className="mono text-[10px] text-muted-foreground">{plan.length + points.length + decisions.length} notes</span>{plan.length > 0 && <button onClick={onClearPlan} disabled={clearing} data-testid="button-clear-plan" className="text-[10px] font-bold text-muted-foreground hover:text-destructive disabled:opacity-50">{clearing ? 'Clearing' : 'Clear plan'}</button>}</div>
      </div>
      <div className="max-h-[230px] space-y-4 overflow-y-auto p-4">
        {loading ? <div className="space-y-2" data-testid="status-memory-loading">{[1, 2, 3].map((i) => <div key={i} className="animate-pulse rounded-lg bg-muted p-3"><div className="h-2 w-1/3 rounded bg-border"/><div className="mt-2 h-2 w-4/5 rounded bg-border"/></div>)}</div> : error ? <div className="py-6 text-center text-xs text-destructive" data-testid="status-memory-error">Session memory is unavailable.</div> : !hasNotes ? (
          <div className="py-6 text-center text-xs text-muted-foreground">No memory yet. CC R2 records plan, decisions and key points here as you work. Cleared on disconnect.</div>
        ) : (
          <>
            <MemorySection title="Plan" items={plan.map((p) => ({ id: p.id, text: p.text, done: p.done }))} onToggle={onToggle} />
            <MemorySection title="Important points" items={points.map((p) => ({ id: p.id, text: p.text }))} />
            <MemorySection title="Decisions" items={decisions.map((d) => ({ id: d.id, text: d.text }))} />
            {tasks.length > 0 && (
              <div>
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">Saved projects</div>
                <div className="space-y-1.5">
                  {tasks.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs">
                      <GitBranch size={12} className="text-primary"/>
                      <span className="font-semibold">{t.name}</span>
                      {t.githubRepo && <a href={`https://github.com/${t.githubRepo}`} target="_blank" rel="noreferrer" className="mono ml-auto text-[10px] text-primary hover:underline">{t.githubRepo}</a>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="border-t border-border bg-muted/35 p-3">
        <div className="mb-2 flex items-center gap-1 rounded-lg bg-background p-1">
          {(['plan', 'point', 'decision'] as const).map((value) => <button key={value} onClick={() => setKind(value)} data-testid={`button-memory-type-${value}`} className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-bold capitalize ${kind === value ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}>{value}</button>)}
        </div>
        <div className="flex gap-2">
          <input value={entry} onChange={(e) => setEntry(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitEntry(); }} data-testid="input-memory-entry" placeholder={`Add a ${kind} item`} maxLength={500} className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-2 text-xs outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
          <button onClick={submitEntry} disabled={!entry.trim()} data-testid="button-add-memory" className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"><ArrowUpRight size={15} /></button>
        </div>
      </div>
      <div className="border-t border-border p-3">
        <button onClick={onSave} disabled={saving} data-testid="button-save-github" className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-[11px] font-bold hover:border-primary/40 disabled:opacity-50">
          {saving ? <Loader2 size={13} className="animate-spin"/> : <GitBranch size={13}/>} Save session to GitHub
        </button>
      </div>
    </section>
  );
}

function MemorySection({ title, items, onToggle }: { title: string; items: { id: string; text: string; done?: boolean }[]; onToggle?: (id: string) => void }) {
  if (items.length === 0) return null;
  return <div><div className="mb-2 text-[10px] font-bold uppercase tracking-[.13em] text-muted-foreground">{title}</div><div className="space-y-1.5">{items.map((it) => <button key={it.id} onClick={() => onToggle?.(it.id)} data-testid={`button-memory-item-${it.id}`} className="flex w-full items-start gap-2 rounded-lg border border-border px-2.5 py-1.5 text-left text-xs hover:border-primary/40"><span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded border ${it.done ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>{it.done && <Check size={10} className="size-3" />}</span><span className={it.done ? 'text-muted-foreground line-through' : ''}>{it.text}</span></button>)}</div></div>;
}

function Prompt({ text, onClick, testId }: { text: string; onClick: () => void; testId: string }) { return <button onClick={onClick} data-testid={testId} className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground"><span>{text}</span><ArrowUpRight size={13}/></button>; }

function CodePanel({ code, setCode, onRun, pending, connected, onInterrupt, interrupting, safeMode }: { code: string; setCode: (v: string) => void; onRun: () => void; pending: boolean; connected: boolean; onInterrupt: () => void; interrupting: boolean; safeMode: boolean }) {
  return <div className="flex min-h-[510px] flex-col bg-sidebar"><div className="flex items-center justify-between border-b border-sidebar-border px-5 py-3 text-sidebar-foreground"><div className="flex items-center gap-2 text-xs font-semibold"><FileCode2 size={15} className="text-accent"/> untitled_cell.py</div><div className="mono text-[10px] text-sidebar-foreground/45">PYTHON 3</div></div><textarea value={code} onChange={(e) => setCode(e.target.value)} data-testid="input-runtime-code" spellCheck={false} className="min-h-[335px] flex-1 resize-none bg-transparent p-5 font-mono text-[13px] leading-7 text-sidebar-accent-foreground outline-none placeholder:text-sidebar-foreground/40" /><div className="border-t border-sidebar-border p-4"><div className="mb-3 flex items-center gap-2 text-[11px] text-sidebar-foreground/60"><ShieldCheck size={14} className={safeMode ? 'text-emerald-400' : 'text-accent'}/>{safeMode ? 'Safe mode · review before execution' : 'Direct execution enabled'}</div><div className="flex gap-2">{pending || interrupting ? <button onClick={onInterrupt} data-testid="button-interrupt-code" className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-destructive px-3 py-2.5 text-xs font-bold text-destructive-foreground"><Square size={13} fill="currentColor"/> Interrupt</button> : <button onClick={onRun} disabled={!connected || !code.trim()} data-testid="button-run-code" className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-xs font-bold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"><Play size={14} fill="currentColor"/> Run on runtime</button>}<button onClick={() => setCode('')} data-testid="button-clear-code" className="grid size-10 place-items-center rounded-lg border border-sidebar-border text-sidebar-foreground/65 hover:text-sidebar-accent-foreground"><RotateCcw size={14}/></button></div>{!connected && <p className="mt-3 text-[11px] text-sidebar-foreground/50">Connect a runtime to execute this cell.</p>}</div></div>;
}

function RuntimePanel({ status, events, loading, error, onInterrupt, interrupting }: { status?: RuntimeStatus; events: RuntimeEvent[]; loading: boolean; error: boolean; onInterrupt: () => void; interrupting: boolean }) {
  const recent = [...events].reverse().slice(0, 7);
  return <section className="flex min-h-[510px] flex-col rounded-2xl border border-border bg-card soft-shadow"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><div className="flex items-center gap-2"><Activity size={16} className="text-primary"/><h2 className="text-sm font-bold">Output stream</h2></div><p className="mt-1 text-[11px] text-muted-foreground">Live runtime events</p></div>{status?.state === 'busy' && <button onClick={onInterrupt} disabled={interrupting} data-testid="button-interrupt-runtime" className="rounded-md border border-destructive/30 px-2 py-1.5 text-[10px] font-bold text-destructive hover:bg-destructive/5"><Square size={11} className="mr-1 inline" fill="currentColor"/> Stop</button>}</div><div className="flex-1 p-4">{loading ? <div className="space-y-3">{[1,2,3,4].map((i) => <div key={i} className="animate-pulse rounded-lg bg-muted p-3"><div className="h-2 w-1/4 rounded bg-border"/><div className="mt-2 h-2 w-4/5 rounded bg-border"/></div>)}</div> : error ? <div className="flex h-full min-h-[365px] flex-col items-center justify-center text-center" data-testid="status-events-error"><div className="grid size-12 place-items-center rounded-2xl bg-destructive/10 text-destructive"><Activity size={20}/></div><h3 className="mt-4 text-sm font-bold">Output stream unavailable</h3><p className="mt-1 max-w-[210px] text-xs leading-relaxed text-muted-foreground">The runtime may be offline. Reconnect or refresh to resume event polling.</p></div> : recent.length ? <div className="space-y-1">{recent.map((event) => <EventRow key={event.id} event={event}/>)}</div> : <div className="flex h-full min-h-[365px] flex-col items-center justify-center text-center"><div className="grid size-12 place-items-center rounded-2xl border border-dashed border-border text-muted-foreground"><Activity size={20}/></div><h3 className="mt-4 text-sm font-bold">No events yet</h3><p className="mt-1 max-w-[210px] text-xs leading-relaxed text-muted-foreground">Runtime output and execution updates will appear here as your notebook works.</p></div>}</div><div className="flex items-center justify-between border-t border-border px-5 py-3 text-[10px] text-muted-foreground"><span className="flex items-center gap-1.5"><span className={`size-1.5 rounded-full ${status?.sessionId ? 'bg-emerald-500' : 'bg-border'}`}/> polling every 3.5s</span><span className="mono">{events.length} events</span></div></section>;
}

function EventRow({ event }: { event: RuntimeEvent }) { const tone = event.type === 'stderr' || event.type === 'error' ? 'text-destructive' : event.type === 'result' ? 'text-emerald-700' : event.type === 'command' ? 'text-primary' : 'text-muted-foreground'; return <div className="group flex gap-3 rounded-lg p-2.5 hover:bg-muted/70" data-testid={`event-row-${event.id}`}><div className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-muted ${tone}`}><span className="mono text-[9px]">{event.type === 'stdout' ? 'out' : event.type.slice(0, 3)}</span></div><div className="min-w-0 flex-1"><div className={`text-xs leading-relaxed ${tone}`}>{event.message}</div><div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/60"><span className="mono uppercase">{event.type}</span><span>·</span><span>{formatTime(event.createdAt)}</span></div>{event.payload && <pre className="mt-2 max-h-20 overflow-auto rounded bg-muted p-2 text-[10px] text-muted-foreground">{event.payload}</pre>}</div></div>; }

function SetupPage() {
  const create = useCreateRuntimeBootstrap();
  const connect = useConnectColabRuntime();
  const postEvent = usePostColabEvent();
  const qc = useQueryClient();
  const { data: status } = useGetRuntimeStatus({ query: { queryKey: getGetRuntimeStatusQueryKey(), refetchInterval: 5000 } });
  const [target, setTarget] = useState<'colab' | 'kaggle'>('colab');
  const [label, setLabel] = useState('My Colab notebook');
  const [bootstrap, setBootstrap] = useState<{ sessionId: string; token: string; connectorCode: string; expiresAt: string } | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [token, setToken] = useState('');
  const [runtimeName, setRuntimeName] = useState('My Colab notebook');
  const [pythonVersion, setPythonVersion] = useState('3.11');
  const [notice, setNotice] = useState('');
  const isKaggle = target === 'kaggle';
  const commandParams = useMemo(() => ({ sessionId, token }), [sessionId, token]);
  const { data: commandResponse, isLoading: commandsLoading, isError: commandsError } = useGetColabCommands(commandParams, { query: { queryKey: getGetColabCommandsQueryKey(commandParams), enabled: sessionId.length >= 8 && token.length > 0, refetchInterval: 3500 } });
  const pendingCommands = commandResponse?.commands ?? [];
  const generate = () => { setLabel(isKaggle ? 'My Kaggle notebook' : 'My Colab notebook'); create.mutate({ data: { label: isKaggle ? 'My Kaggle notebook' : label, target } }, { onSuccess: (data) => { setBootstrap(data); setSessionId(data.sessionId); setToken(data.token); }, onError: () => setNotice('Could not create a bootstrap session. Try again.') }); };
  const connectRuntime = () => connect.mutate({ data: { sessionId, token, runtimeName, pythonVersion } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetRuntimeStatusQueryKey() }); setNotice('Connector registered. Start the cell to finish the handshake.'); }, onError: () => setNotice('That session could not be connected. Check the session details.') });
  const sendHeartbeat = () => postEvent.mutate({ data: { sessionId, token, type: 'system', message: 'Manual connector check from CC+', payload: null } }, { onSuccess: () => setNotice('Test signal accepted by the control plane.') });
  const code = bootstrap?.connectorCode || `# Paste this cell into ${isKaggle ? 'Kaggle' : 'Google Colab'}\\n# A temporary connector session will be created\\n\\n${label}\\n`;
  return <div className="animate-rise max-w-5xl"><PageIntro eyebrow="CONNECTOR SETUP" title="Bring the notebook closer." description={`A short-lived bridge lets CC+ talk to your own ${isKaggle ? 'Kaggle' : 'Colab'} runtime. Your code stays in the notebook; only commands and events cross the connection.`}/><div className="mt-8 grid gap-5 lg:grid-cols-[1.08fr_.92fr]"><section className="rounded-2xl border border-border bg-card p-5 soft-shadow md:p-7"><Step n="01" title="Create a private session" copy="Pick a target and give this bridge a name so you can recognize it in your workspace."/><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold">Target<div className="mt-2 flex rounded-lg bg-muted p-1"><button onClick={() => setTarget('colab')} data-testid="button-target-colab" className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-bold ${target === 'colab' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}><Cloud size={13}/> Colab</button><button onClick={() => setTarget('kaggle')} data-testid="button-target-kaggle" className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-bold ${target === 'kaggle' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}><Terminal size={13}/> Kaggle</button></div></label><label className="text-xs font-bold">Runtime label<input value={label} onChange={(e) => setLabel(e.target.value)} data-testid="input-bootstrap-label" maxLength={80} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"/></label></div><button onClick={generate} disabled={create.isPending || !label.trim()} data-testid="button-create-bootstrap" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-50">{create.isPending ? <Loader2 size={15} className="animate-spin"/> : <KeyRound size={15}/>} {bootstrap ? 'Regenerate session' : `Create ${isKaggle ? 'Kaggle' : 'Colab'} session`}</button>{bootstrap && <div className="mt-5 rounded-xl border border-primary/20 bg-primary/[.05] p-4"><div className="flex items-center justify-between text-xs font-bold"><span>Session created</span><span className="text-primary">Expires {formatTime(bootstrap.expiresAt)}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><KeyValue label="SESSION_ID" value={bootstrap.sessionId}/><KeyValue label="TOKEN" value={bootstrap.token}/></div></div>}</section><section className="rounded-2xl border border-border bg-sidebar text-sidebar-foreground soft-shadow"><div className="flex items-center justify-between border-b border-sidebar-border px-5 py-4"><div className="flex items-center gap-2 text-sm font-bold text-sidebar-accent-foreground"><Code2 size={16} className="text-accent"/> {isKaggle ? 'Kaggle' : 'Colab'} bootstrap cell</div><CopyButton value={code} testId="button-copy-bootstrap"/></div><pre className="min-h-[260px] overflow-auto p-5 text-xs leading-6 text-sidebar-accent-foreground/85"><code>{code}</code></pre><div className="border-t border-sidebar-border px-5 py-4 text-[11px] leading-relaxed text-sidebar-foreground/60">Paste the generated cell into a fresh {isKaggle ? 'Kaggle' : 'Colab'} cell and run it. Keep this tab open while the connector registers.</div>{sessionId && token && <div className="border-t border-sidebar-border bg-sidebar-accent/45 px-5 py-3"><div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[.15em] text-sidebar-foreground/55"><span>Command queue</span><span className="mono text-accent">{commandsLoading ? '…' : pendingCommands.length}</span></div>{commandsError ? <p className="mt-2 text-[11px] text-sidebar-foreground/55">Queue status is unavailable.</p> : pendingCommands.length > 0 ? <div className="mt-2 space-y-1">{pendingCommands.slice(0, 2).map((command) => <div key={command.id} className="truncate rounded bg-sidebar px-2 py-1.5 font-mono text-[10px] text-sidebar-foreground/75">{command.description || 'Queued Python command'}</div>)}</div> : <p className="mt-2 text-[11px] text-sidebar-foreground/55">No commands waiting for the connector.</p>}</div>}</section></div><section className="mt-5 rounded-2xl border border-border bg-card p-5 soft-shadow md:p-7"><Step n="02" title="Register the connector" copy="The cell posts its credentials back here. You can also enter them manually if you already have a session."/><div className="mt-5 grid gap-4 md:grid-cols-2"><label className="text-xs font-bold">Session ID<input value={sessionId} onChange={(e) => setSessionId(e.target.value)} data-testid="input-session-id" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-xs outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"/></label><label className="text-xs font-bold">Session token<input value={token} onChange={(e) => setToken(e.target.value)} data-testid="input-session-token" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-xs outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"/></label><label className="text-xs font-bold">Runtime name<input value={runtimeName} onChange={(e) => setRuntimeName(e.target.value)} data-testid="input-runtime-name" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"/></label><label className="text-xs font-bold">Python version<input value={pythonVersion} onChange={(e) => setPythonVersion(e.target.value)} data-testid="input-python-version" className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-xs outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"/></label></div><div className="mt-5 flex flex-wrap gap-2"><button onClick={connectRuntime} disabled={connect.isPending || sessionId.length < 8 || token.length < 1} data-testid="button-register-connector" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-50">{connect.isPending ? <Loader2 size={15} className="animate-spin"/> : <PlugZap size={15}/>} Register connector</button>{sessionId && token && <button onClick={sendHeartbeat} disabled={postEvent.isPending} data-testid="button-test-connector" className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-xs font-bold hover:border-primary/40">{postEvent.isPending ? <Loader2 size={14} className="animate-spin"/> : <Activity size={14}/>} Send test signal</button>}{status?.sessionId && <Link href="/" data-testid="link-return-command-center" className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-xs font-bold hover:border-primary/40">Open command center <ArrowUpRight size={14}/></Link>}</div>{notice && <p className="mt-4 rounded-lg bg-secondary px-3 py-2.5 text-xs font-semibold text-primary" data-testid="status-setup-notice">{notice}</p>}</section><div className="mt-6 flex gap-3 rounded-xl border border-border bg-secondary/50 p-4 text-xs leading-relaxed text-muted-foreground"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-primary"/><p><strong className="text-foreground">Designed for control.</strong> Sessions are temporary, tokens are shown only during setup, and every runtime action is visible in the output stream. Memory is cleared on disconnect.</p></div></div>;
}

function Step({ n, title, copy }: { n: string; title: string; copy: string }) { return <div className="flex gap-3"><span className="mono grid size-7 shrink-0 place-items-center rounded-lg bg-secondary text-[10px] font-bold text-primary">{n}</span><div><h2 className="text-sm font-bold">{title}</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{copy}</p></div></div>; }
function KeyValue({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-border bg-card p-2.5"><div className="mono text-[9px] tracking-wider text-muted-foreground">{label}</div><div className="mt-1 truncate font-mono text-[11px]">{value}</div></div>; }
function CopyButton({ value, testId }: { value: string; testId: string }) { const [copied, setCopied] = useState(false); return <button onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1600); }} data-testid={testId} className="inline-flex items-center gap-1.5 rounded-md border border-current/20 px-2.5 py-1.5 text-[10px] font-bold text-current opacity-80 hover:opacity-100">{copied ? <Check size={12}/> : <Copy size={12}/>} {copied ? 'Copied' : 'Copy'}</button>; }

function SettingsPage() {
  const prefs = usePrefs();
  const [healthResult, setHealthResult] = useState('');
  const [saved, setSaved] = useState(false);
  const { data: health, isLoading: healthLoading } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30000 } });
  const testHealth = async () => { try { const response = await healthCheck(); setHealthResult(response.status); } catch { setHealthResult('unavailable'); } };
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2200);
    return () => clearTimeout(timer);
  }, [saved]);
   return <div className="animate-rise max-w-4xl"><PageIntro eyebrow="WORKSPACE SETTINGS" title="Tune the control surface." description="Choose how CC+ thinks, what it can do, and how much friction you want before code reaches your runtime. Keys are managed on the server — you never enter one here. To add your own key for a task, just paste it into chat; CC R2 uses it for that session only and never shows it in full."/><div className="mt-8 space-y-5"><section className="rounded-2xl border border-border bg-card p-5 soft-shadow md:p-7"><SectionHeading icon={<Cpu size={17}/>} title="Assistant orchestration" copy="Run the lead and specialist agents together, then let the lead synthesize one answer. Direct modes stay available for focused work and never act as silent fallbacks."/><div className="mt-6 grid gap-2 rounded-lg bg-muted p-1 sm:grid-cols-3"><button onClick={() => prefs.setPreference('ensemble')} data-testid="button-preference-ensemble" className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2.5 text-xs font-bold ${prefs.preference === 'ensemble' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}><BrainCircuit size={14}/> Synchronized</button><button onClick={() => prefs.setPreference('primary')} data-testid="button-preference-primary" className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2.5 text-xs font-bold ${prefs.preference === 'primary' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}><Cpu size={14}/> DeepSeek direct</button><button onClick={() => prefs.setPreference('fast')} data-testid="button-preference-fast" className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2.5 text-xs font-bold ${prefs.preference === 'fast' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}><Zap size={14} fill="currentColor"/> Gemini direct</button></div><p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">Synchronized mode sends the same request to both agents in parallel and uses the lead agent to reconcile their work. One agent is never silently substituted for another.</p></section><KeyVaultStatus/><section className="rounded-2xl border border-border bg-card p-5 soft-shadow md:p-7"><SectionHeading icon={<ShieldCheck size={17}/>} title="Execution guardrails" copy="These preferences affect what the assistant is allowed to send to your runtime."/><div className="mt-5 space-y-1"><Toggle checked={prefs.safeMode} onChange={prefs.setSafeMode} title="Safe mode" description="Draft code for review instead of executing assistant-generated code automatically." testId="toggle-safe-mode"/><Toggle checked={prefs.confirmExecution} onChange={prefs.setConfirmExecution} title="Confirm runtime commands" description="Require a deliberate action before manually drafted code is queued." testId="toggle-confirm-execution"/></div></section><section className="rounded-2xl border border-border bg-card p-5 soft-shadow md:p-7"><SectionHeading icon={<Cloud size={17}/>} title="Control plane health" copy="A quick diagnostic for the service that brokers your runtime connection."/><div className="mt-5 flex flex-wrap items-center gap-3"><div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-xs font-semibold"><span className={`size-2 rounded-full ${health?.status === 'ok' || healthResult === 'ok' ? 'bg-emerald-500' : 'bg-accent'}`}/>{healthLoading ? 'Checking…' : healthResult || health?.status || 'Ready to check'}</div><button onClick={testHealth} data-testid="button-test-health" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-bold hover:border-primary/40"><RefreshCw size={13}/> Run diagnostic</button></div></section><div className="flex items-center justify-end gap-3"><span className={`text-xs font-semibold text-emerald-700 transition-opacity ${saved ? 'opacity-100' : 'opacity-0'}`} data-testid="status-settings-saved"><Check size={14} className="mr-1 inline"/>Preferences saved</span><button onClick={() => setSaved(true)} data-testid="button-save-settings" className="rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground hover:-translate-y-0.5">Save preferences</button></div></div></div>;
}

type VaultKey = { kind: string; masked: string };

// Read-only view of session keys added via chat. No entry form here — users
// paste keys into chat and CC R2 stores them masked for the session only.
function KeyVaultStatus() {
  const [keys, setKeys] = useState<VaultKey[]>([]);
  useEffect(() => {
    let alive = true;
    fetch('/api/vault').then((r) => r.json()).then((d: { keys?: VaultKey[] }) => { if (alive) setKeys(d.keys ?? []); }).catch(() => {});
    const id = setInterval(() => fetch('/api/vault').then((r) => r.json()).then((d: { keys?: VaultKey[] }) => setKeys(d.keys ?? [])).catch(() => {}), 8000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return <section className="rounded-2xl border border-border bg-card p-5 soft-shadow md:p-7"><SectionHeading icon={<KeyRound size={17}/>} title="Session keys" copy="Keys are never entered here. To supply your own key for a task, paste it into chat — CC R2 saves it masked, uses it for this session, and clears it on disconnect. Below is what is currently active (masked)."/>
    {keys.length > 0 ? <div className="mt-5 space-y-1.5">{keys.map((k) => <div key={k.kind} className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs"><KeyRound size={12} className="text-primary"/><span className="font-bold capitalize">{k.kind}</span><span className="mono text-muted-foreground">{k.masked}</span></div>)}</div> : <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">No session keys active. The server-side key pool is in use. Paste a key into chat to use your own for a task.</p>}
  </section>;
}

function PageIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div><div className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-primary">{eyebrow}</div><h1 className="font-display text-4xl tracking-tight md:text-[46px]">{title}</h1><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p></div>; }
function SectionHeading({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) { return <div className="flex items-start gap-3"><div className="grid size-8 place-items-center rounded-lg bg-secondary text-primary">{icon}</div><div><h2 className="text-sm font-bold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{copy}</p></div></div>; }
function Toggle({ checked, onChange, title, description, testId }: { checked: boolean; onChange: (v: boolean) => void; title: string; description: string; testId: string }) { return <button onClick={() => onChange(!checked)} data-testid={testId} className="flex w-full items-center justify-between gap-4 rounded-xl px-2 py-4 text-left hover:bg-muted"><div><div className="text-sm font-bold">{title}</div><div className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">{description}</div></div><span className={`relative h-6 w-11 shrink-0 rounded-full ${checked ? 'bg-primary' : 'bg-muted-foreground/25'}`}><span className={`absolute top-1 size-4 rounded-full bg-card shadow-sm ${checked ? 'left-6' : 'left-1'}`}/></span></button>; }
function ConfirmDialog({ title, description, onCancel, onConfirm, pending }: { title: string; description: string; onCancel: () => void; onConfirm: () => void; pending: boolean }) { return <div className="fixed inset-0 z-50 grid place-items-center bg-sidebar/35 p-4 backdrop-blur-sm"><div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 soft-shadow" role="dialog" data-testid="dialog-confirm-disconnect"><div className="grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive"><Unplug size={18}/></div><h2 className="mt-4 text-lg font-bold">{title}</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p><div className="mt-6 flex justify-end gap-2"><button onClick={onCancel} data-testid="button-cancel-dialog" className="rounded-lg border border-border px-3 py-2 text-xs font-bold">Cancel</button><button onClick={onConfirm} disabled={pending} data-testid="button-confirm-disconnect" className="rounded-lg bg-destructive px-3 py-2 text-xs font-bold text-destructive-foreground disabled:opacity-50">{pending ? 'Disconnecting…' : 'Disconnect'}</button></div></div></div>; }

export default App;