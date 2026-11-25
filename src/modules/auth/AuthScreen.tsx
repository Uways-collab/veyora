import { useState, type FormEvent } from 'react';
import { ArrowLeft, Eye, EyeOff, KeyRound, Lock, Mail } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { getRuntimeConfig } from '../../core/config/env';

type AuthViewMode = 'signin' | 'signup' | 'forgot';

function PasswordInput({
  id, value, onChange, autoComplete, placeholder, minLength,
}: {
  id: string; value: string; onChange: (value: string) => void;
  autoComplete: string; placeholder: string; minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={visible ? 'text' : 'password'} required minLength={minLength}
        autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full h-11 px-3 pr-11 rounded-lg border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15" />
      <button type="button" onClick={() => setVisible((current) => !current)}
        aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-400 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-sky-600">
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
}


export function AuthScreen({ initialMode }: { initialMode?: AuthViewMode }) {
  const {
    status,
    authError,
    signInWithPassword,
    signUpWithPassword,
    requestPasswordReset,
    updatePassword,
  } = useAuth();

  const runtime = getRuntimeConfig();

  const [mode, setMode] = useState<AuthViewMode>(() => initialMode ?? (new URLSearchParams(window.location.search).has('plan') ? 'signup' : 'signin'));
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const switchMode = (nextMode: AuthViewMode) => {
    setMode(nextMode);
    setLocalError(null);
    setSuccessMessage(null);
  };

  const handleSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    const { error } = await signInWithPassword(email.trim(), password);
    if (error) {
      setLocalError(error);
    }
    setSubmitting(false);
  };

  const handleSignUp = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSuccessMessage(null);

    if (fullName.trim().length < 2) {
      setLocalError('Please enter your full name.');
      return;
    }
    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const { error, needsConfirmation } = await signUpWithPassword(
      email.trim(),
      password,
      fullName.trim()
    );

    if (error) {
      setLocalError(error);
    } else if (needsConfirmation) {
      setSuccessMessage(
        'Account registered. Check your email inbox and confirm your address, then sign in to continue business setup.'
      );
      setPassword('');
      setConfirmPassword('');
    }
    setSubmitting(false);
  };

  const handlePasswordResetRequest = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    const { error } = await requestPasswordReset(email.trim());
    if (error) {
      setLocalError(error);
    } else {
      setSuccessMessage(
        `Password reset instructions have been sent to ${email.trim()} if an account exists for that address.`
      );
    }
    setSubmitting(false);
  };

  const handlePasswordRecoveryUpdate = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSuccessMessage(null);

    if (newPassword.length < 8) {
      setLocalError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setLocalError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const { error } = await updatePassword(newPassword);
    if (error) {
      setLocalError(error);
    } else {
      setSuccessMessage(status === 'invitation_setup' ? 'Invitation accepted and password set. Your organisation access is ready.' : 'Password updated successfully.');
    }
    setSubmitting(false);
  };

  const displayError = localError ?? authError;

  return (
    <div className="min-h-screen overflow-hidden bg-[#f5f7fb] text-slate-900 flex flex-col">
      {/* Minimal Header */}
      <header className="sticky top-0 z-10 h-[76px] bg-white/85 backdrop-blur-xl border-b border-slate-200/70 px-5 sm:px-8 lg:px-12 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img src="/veyora-logo.svg" alt="Veyora" className="h-9 w-auto max-w-[180px] object-contain" />
        </div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500"><span className="h-2 w-2 rounded-full bg-emerald-500" />Built for ambitious businesses <span className="mx-2 text-slate-300">·</span><span>Secure workspace access</span></div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:px-6 lg:px-10 lg:py-12"><div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16"><aside className="hidden lg:block"><div className="max-w-xl"><div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-blue-800"><span className="h-1.5 w-1.5 rounded-full bg-blue-600" />YOUR BUSINESS, IN SYNC</div><h1 className="mt-7 max-w-lg font-display text-5xl font-semibold leading-[1.12] tracking-tight text-slate-950">Run your business with <span className="text-blue-700">clarity.</span></h1><p className="mt-5 max-w-lg text-base leading-7 text-slate-600">Bring your people, daily operations, money and decisions into one connected workspace—shaped around the way your business actually works.</p><div className="mt-9 grid gap-3"><div className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-900/[0.03]"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12h18M12 3v18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" /></svg></span><div><p className="text-sm font-semibold text-slate-900">Operations that fit your industry</p><p className="mt-0.5 text-xs text-slate-500">Workflows for the way you really operate.</p></div></div><div className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-900/[0.03]"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 19V5m0 14h16M8 15l3-4 3 2 5-7" /></svg></span><div><p className="text-sm font-semibold text-slate-900">A clearer view of performance</p><p className="mt-0.5 text-xs text-slate-500">Connect sales, stock, finance and reporting.</p></div></div><div className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-900/[0.03]"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 4.5 6v5.5c0 4.6 3.2 7.7 7.5 9.5 4.3-1.8 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/></svg></span><div><p className="text-sm font-semibold text-slate-900">Your organisation stays yours</p><p className="mt-0.5 text-xs text-slate-500">Private workspaces with role-based access.</p></div></div></div><p className="mt-8 text-xs text-slate-400">One connected platform. Specialist tools when you need them.</p></div></aside><div className="w-full max-w-xl justify-self-center space-y-6">
          {status === 'unconfigured' ? (
            <section className="bg-white/95 border border-slate-200/80 rounded-2xl p-6 sm:p-8 space-y-5 shadow-xl shadow-slate-900/5">
              <div className="flex items-center gap-2.5 text-slate-900">
                <KeyRound className="h-5 w-5 text-slate-600" aria-hidden="true" />
                <h1 className="font-display text-xl font-semibold">
                  Supabase Configuration Required
                </h1>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                Protected authentication requires a connected Supabase project. Supply your project URL and public anon key in <span className="font-mono text-slate-900">.env.local</span> and restart the development server.
              </p>
              <dl className="divide-y divide-slate-200 border border-slate-200 rounded-md text-xs">
                <div className="px-3.5 py-2.5 flex items-center justify-between gap-3">
                  <dt className="font-mono text-slate-700">VITE_SUPABASE_URL</dt>
                  <dd className="text-amber-700 font-medium">
                    {runtime.supabaseUrl ? 'Configured' : 'Missing'}
                  </dd>
                </div>
                <div className="px-3.5 py-2.5 flex items-center justify-between gap-3">
                  <dt className="font-mono text-slate-700">VITE_SUPABASE_ANON_KEY</dt>
                  <dd className="text-amber-700 font-medium">
                    {runtime.supabaseAnonKey ? 'Configured' : 'Missing'}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-slate-500 leading-relaxed">
                Apply <span className="font-mono">supabase/migrations/0001_initial_foundation.sql</span> and <span className="font-mono">0002_auth_onboarding_and_rbac_hardening.sql</span> in your Supabase SQL Editor before signing in.
              </p>
            </section>
          ) : status === 'password_recovery' || status === 'invitation_setup' ? (
            <section className="bg-white/95 border border-slate-200/80 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl shadow-slate-900/5">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{status === 'invitation_setup' ? 'Accept Organisation Invitation' : 'Password Recovery'}</span>
                </div>
                <h1 className="font-display text-xl font-semibold text-slate-900">
                  Set a new password
                </h1>
                <p className="text-xs text-slate-600">
                  {status === 'invitation_setup' ? 'Your email has been confirmed. Set a password to finish activating your Veyora account and open the invited organisation.' : 'Enter a new password for your Veyora Business account.'}
                </p>
              </div>

              <form onSubmit={(e) => void handlePasswordRecoveryUpdate(e)} className="space-y-4">
                <div className="space-y-1">
                  <label htmlFor="recovery-new-password" className="block text-xs font-medium text-slate-700">
                    New Password
                  </label>
                  <PasswordInput id="recovery-new-password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" placeholder="Minimum 8 characters" minLength={8} />
                </div>

                <div className="space-y-1">
                  <label htmlFor="recovery-confirm-password" className="block text-xs font-medium text-slate-700">
                    Confirm New Password
                  </label>
                  <PasswordInput id="recovery-confirm-password" value={confirmNewPassword} onChange={setConfirmNewPassword} autoComplete="new-password" placeholder="Re-enter password" minLength={8} />
                </div>

                {displayError && (
                  <div role="alert" className="text-xs px-3 py-2.5 rounded-md border border-red-200 bg-red-50 text-red-700">
                    {displayError}
                  </div>
                )}

                {successMessage && (
                  <div className="text-xs px-3 py-2.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800">
                    {successMessage}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-11 rounded-xl bg-[#10223c] text-white text-sm font-semibold hover:bg-[#1b3557] disabled:opacity-50 transition-colors shadow-lg shadow-slate-950/10"
                >
                  {submitting ? 'Saving password...' : status === 'invitation_setup' ? 'Accept Invitation & Set Password' : 'Update Password'}
                </button>
              </form>
            </section>
          ) : (
            <section className="rounded-[28px] border border-slate-200/80 bg-white p-6 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.22)] sm:p-9 space-y-7">
              {/* Mode Switcher for Sign In / Register */}
              {mode !== 'forgot' ? (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h1 className="font-display text-xl font-semibold text-slate-900">
                      {mode === 'signin'
                        ? 'Sign in to Veyora Business'
                        : 'Create your Veyora Business account'}
                    </h1>
                    <p className="text-xs text-slate-600">
                      {mode === 'signin'
                        ? 'Access your organisation workspace with your email and password.'
                        : 'Register an account first, then set up your business workspace.'}
                    </p>
                  </div>

                  <div
                    role="tablist"
                    aria-label="Authentication mode"
                    className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-md"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'signin'}
                      onClick={() => switchMode('signin')}
                      className={`py-1.5 text-xs font-medium rounded transition-colors ${
                        mode === 'signin'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Sign In
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'signup'}
                      onClick={() => switchMode('signup')}
                      className={`py-1.5 text-xs font-medium rounded transition-colors ${
                        mode === 'signup'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Create Account
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => switchMode('signin')}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Back to Sign In</span>
                  </button>
                  <h1 className="font-display text-xl font-semibold text-slate-900">
                    Reset your password
                  </h1>
                  <p className="text-xs text-slate-600">
                    Enter your registered email address and we will send a password recovery link.
                  </p>
                </div>
              )}

              {/* Forms */}
              {mode === 'signin' && (
                <form onSubmit={(e) => void handleSignIn(e)} className="space-y-4">
                  <div className="space-y-1">
                    <label htmlFor="signin-email" className="block text-xs font-medium text-slate-700">
                      Work Email
                    </label>
                    <input
                      id="signin-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      className="w-full h-10 px-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label htmlFor="signin-password" className="block text-xs font-medium text-slate-700">
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={() => switchMode('forgot')}
                        className="text-xs font-medium text-blue-700 hover:text-blue-800"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <PasswordInput id="signin-password" value={password} onChange={setPassword} autoComplete="current-password" placeholder="Enter your password" />
                  </div>

                  {displayError && (
                    <div role="alert" className="text-xs px-3 py-2.5 rounded-md border border-red-200 bg-red-50 text-red-700">
                      {displayError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full h-10 rounded-md bg-[#2864e8] text-white text-sm font-medium hover:bg-[#1f50bd] disabled:opacity-50 transition-colors"
                  >
                    {submitting ? 'Signing in...' : 'Sign In'}
                  </button>
                </form>
              )}

              {mode === 'signup' && (
                <form onSubmit={(e) => void handleSignUp(e)} className="space-y-4">
                  <div className="space-y-1">
                    <label htmlFor="signup-fullname" className="block text-xs font-medium text-slate-700">
                      Full Name
                    </label>
                    <input
                      id="signup-fullname"
                      type="text"
                      required
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Alex Mercer"
                      className="w-full h-10 px-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="signup-email" className="block text-xs font-medium text-slate-700">
                      Work Email
                    </label>
                    <input
                      id="signup-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      className="w-full h-10 px-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="signup-password" className="block text-xs font-medium text-slate-700">
                      Password
                    </label>
                    <PasswordInput id="signup-password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="Minimum 8 characters" minLength={8} />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="signup-confirm" className="block text-xs font-medium text-slate-700">
                      Confirm Password
                    </label>
                    <PasswordInput id="signup-confirm" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" placeholder="Re-enter password" minLength={8} />
                  </div>

                  {displayError && (
                    <div role="alert" className="text-xs px-3 py-2.5 rounded-md border border-red-200 bg-red-50 text-red-700">
                      {displayError}
                    </div>
                  )}

                  {successMessage && (
                    <div className="text-xs px-3 py-2.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800">
                      {successMessage}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full h-10 rounded-md bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 disabled:opacity-50 transition-colors"
                  >
                    {submitting ? 'Creating account...' : 'Create Account'}
                  </button>
                </form>
              )}

              {mode === 'forgot' && (
                <form onSubmit={(e) => void handlePasswordResetRequest(e)} className="space-y-4">
                  <div className="space-y-1">
                    <label htmlFor="reset-email" className="block text-xs font-medium text-slate-700">
                      Registered Email
                    </label>
                    <div className="relative">
                      <input
                        id="reset-email"
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@company.com"
                        className="w-full h-10 pl-9 pr-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                      />
                      <Mail className="h-4 w-4 text-slate-400 absolute left-3 top-3" aria-hidden="true" />
                    </div>
                  </div>

                  {displayError && (
                    <div role="alert" className="text-xs px-3 py-2.5 rounded-md border border-red-200 bg-red-50 text-red-700">
                      {displayError}
                    </div>
                  )}

                  {successMessage && (
                    <div className="text-xs px-3 py-2.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800">
                      {successMessage}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full h-11 rounded-xl bg-[#10223c] text-white text-sm font-semibold hover:bg-[#1b3557] disabled:opacity-50 transition-colors shadow-lg shadow-slate-950/10"
                  >
                    {submitting ? 'Sending link...' : 'Send Reset Link'}
                  </button>
                </form>
              )}
            </section>
          )}

          <p className="text-center text-xs text-slate-400">Protected by secure sign-in and organisation-level access controls.</p></div></div></main>
    </div>
  );
}
