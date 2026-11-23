import { useState, type FormEvent } from 'react';
import { ArrowLeft, KeyRound, Lock, Mail } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { getRuntimeConfig } from '../../core/config/env';

type AuthViewMode = 'signin' | 'signup' | 'forgot';

export function AuthScreen() {
  const {
    status,
    authError,
    signInWithPassword,
    signUpWithPassword,
    requestPasswordReset,
    updatePassword,
  } = useAuth();

  const runtime = getRuntimeConfig();

  const [mode, setMode] = useState<AuthViewMode>('signin');
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
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Minimal Header */}
      <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-white shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
              <path
                d="M5 6.5L12 18.5L19 6.5"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M9.5 6.5L12 11L14.5 6.5"
                stroke="#60A5FA"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="font-display text-sm font-semibold tracking-tight text-slate-900">
            Veyora Business
          </span>
        </div>
        <span className="text-xs text-slate-500">
          Multi-Tenant Workspace Access
        </span>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-6">
          {status === 'unconfigured' ? (
            <section className="bg-white border border-slate-200 rounded-lg p-6 sm:p-8 space-y-5">
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
            <section className="bg-white border border-slate-200 rounded-lg p-6 sm:p-8 space-y-6">
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
                  <input
                    id="recovery-new-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full h-10 px-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="recovery-confirm-password" className="block text-xs font-medium text-slate-700">
                    Confirm New Password
                  </label>
                  <input
                    id="recovery-confirm-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full h-10 px-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
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
                  {submitting ? 'Saving password...' : status === 'invitation_setup' ? 'Accept Invitation & Set Password' : 'Update Password'}
                </button>
              </form>
            </section>
          ) : (
            <section className="bg-white border border-slate-200 rounded-lg p-6 sm:p-8 space-y-6">
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
                    <input
                      id="signin-password"
                      type="password"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full h-10 px-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>

                  {displayError && (
                    <div role="alert" className="text-xs px-3 py-2.5 rounded-md border border-red-200 bg-red-50 text-red-700">
                      {displayError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full h-10 rounded-md bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 disabled:opacity-50 transition-colors"
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
                    <input
                      id="signup-password"
                      type="password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      className="w-full h-10 px-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="signup-confirm" className="block text-xs font-medium text-slate-700">
                      Confirm Password
                    </label>
                    <input
                      id="signup-confirm"
                      type="password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      className="w-full h-10 px-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
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
                    className="w-full h-10 rounded-md bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors"
                  >
                    {submitting ? 'Sending link...' : 'Send Reset Link'}
                  </button>
                </form>
              )}
            </section>
          )}

          <p className="text-center text-xs text-slate-500">
            Authenticated via Supabase Auth · Tenant isolation enforced by PostgreSQL RLS
          </p>
        </div>
      </main>
    </div>
  );
}
