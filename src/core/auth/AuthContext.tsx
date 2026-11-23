import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getRuntimeConfig } from '../config/env';
import { getSupabaseClient } from '../supabase/client';
import { normalizeOrganisationRow } from '../supabase/organisations';
import type {
  BusinessType,
  Organisation,
  OrganisationMembership,
  OrganisationRole,
  UserProfile,
} from '../types/domain';

export type WorkspaceAuthStatus =
  | 'unconfigured'
  | 'loading'
  | 'signed_out'
  | 'password_recovery'
  | 'invitation_setup'
  | 'authenticated';

export interface WorkspaceLoadError {
  kind: 'expired_session' | 'permission_denied' | 'missing_schema' | 'unknown';
  message: string;
  diagnostic: string;
}

export interface CreateOrganisationInput {
  name: string;
  businessType: BusinessType;
  country: string;
  baseCurrency: string;
  timezone: string;
  businessEmail?: string;
  businessPhone?: string;
}

interface AuthContextValue {
  status: WorkspaceAuthStatus;
  isSupabaseConfigured: boolean;
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  memberships: OrganisationMembership[];
  activeMembership: OrganisationMembership | null;
  activeOrganisation: Organisation | null;
  activeRole: OrganisationRole | null;
  authError: string | null;
  workspaceLoadError: WorkspaceLoadError | null;
  isLoadingOrgs: boolean;
  hasLoadedOrgs: boolean;
  recentlyCreatedOrgName: string | null;
  clearRecentlyCreatedNotice: () => void;
  switchOrganisation: (organisationId: string) => void;
  refreshMemberships: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithPassword: (
    email: string,
    password: string,
    fullName: string
  ) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  updateProfileName: (fullName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  createOrganisation: (
    input: CreateOrganisationInput,
    options?: { allowAdditional?: boolean }
  ) => Promise<{ error: string | null; organisationId: string | null }>;
}

const ACTIVE_ORG_KEY_PREFIX = 'veyora_active_org_id:';

function getStoredOrgId(userId: string): string | null {
  try {
    return window.localStorage.getItem(`${ACTIVE_ORG_KEY_PREFIX}${userId}`);
  } catch {
    return null;
  }
}

function setStoredOrgId(userId: string, orgId: string): void {
  try {
    window.localStorage.setItem(`${ACTIVE_ORG_KEY_PREFIX}${userId}`, orgId);
  } catch {
    // ignore storage write errors
  }
}

function clearStoredOrgId(userId: string): void {
  try {
    window.localStorage.removeItem(`${ACTIVE_ORG_KEY_PREFIX}${userId}`);
  } catch {
    // ignore storage removal errors
  }
}

function classifySupabaseError(err: { code?: string; message: string }): WorkspaceLoadError {
  const code = err.code ?? '';
  const msg = err.message ?? 'Unknown database error';
  const lower = msg.toLowerCase();

  if (
    code === 'PGRST301' ||
    lower.includes('jwt') ||
    lower.includes('expired') ||
    lower.includes('invalid token')
  ) {
    return {
      kind: 'expired_session',
      message: msg,
      diagnostic:
        'Your authentication session has expired or is no longer valid. Please sign in again to continue.',
    };
  }

  if (
    code === '42501' ||
    lower.includes('permission denied') ||
    lower.includes('row-level security') ||
    lower.includes('rls') ||
    lower.includes('policy')
  ) {
    return {
      kind: 'permission_denied',
      message: msg,
      diagnostic:
        'Access to organization data was denied by PostgreSQL Row Level Security. Verify that RLS policies on public.organizations and public.organization_memberships are configured in Supabase.',
    };
  }

  if (
    code === '42P01' ||
    code === 'PGRST205' ||
    lower.includes('does not exist') ||
    lower.includes('schema cache')
  ) {
    return {
      kind: 'missing_schema',
      message: msg,
      diagnostic:
        'Required Supabase tables (public.organizations or public.organization_memberships) were not found in the schema cache.',
    };
  }

  return {
    kind: 'unknown',
    message: msg,
    diagnostic:
      'Unable to load organisation memberships from Supabase. Check your network connection and project configuration.',
  };
}

function isInvitationCallback(): boolean {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return search.get('auth_flow') === 'invite' ||
    search.get('type') === 'invite' ||
    hash.get('type') === 'invite';
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const runtimeConfig = getRuntimeConfig();
  const supabase = getSupabaseClient();

  const [status, setStatus] = useState<WorkspaceAuthStatus>(() =>
    runtimeConfig.isSupabaseConfigured ? 'loading' : 'unconfigured'
  );
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [memberships, setMemberships] = useState<OrganisationMembership[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [workspaceLoadError, setWorkspaceLoadError] = useState<WorkspaceLoadError | null>(null);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(false);
  const [hasLoadedOrgs, setHasLoadedOrgs] = useState(false);
  const [recentlyCreatedOrgName, setRecentlyCreatedOrgName] = useState<string | null>(null);

  const loadSeqRef = useRef(0);
  const loadedUserIdRef = useRef<string | null>(null);
  const creatingOrgRef = useRef(false);
  const membershipsRef = useRef<OrganisationMembership[]>([]);
  const invitationFlowRef = useRef(isInvitationCallback());

  const clearRecentlyCreatedNotice = useCallback(() => {
    setRecentlyCreatedOrgName(null);
  }, []);

  const loadUserWorkspaceContext = useCallback(
    async (userId: string, preferredOrgId?: string | null) => {
      if (!supabase) return;
      const seq = ++loadSeqRef.current;

      if (loadedUserIdRef.current !== userId) {
        loadedUserIdRef.current = userId;
        membershipsRef.current = [];
        setMemberships([]);
        setActiveOrgId(null);
        setRecentlyCreatedOrgName(null);
        setHasLoadedOrgs(false);
      }

      setIsLoadingOrgs(true);
      setAuthError(null);
      setWorkspaceLoadError(null);

      try {
        const [profileRes, membershipsRes] = await Promise.all([
          supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle(),
          supabase
            .from('organization_memberships')
            .select('*, organization:organizations (*)')
            .eq('user_id', userId)
            .order('created_at', { ascending: true }),
        ]);

        if (seq !== loadSeqRef.current) return;

        if (profileRes.data) {
          setProfile(profileRes.data as UserProfile);
        }

        if (membershipsRes.error) {
          const classified = classifySupabaseError(membershipsRes.error);
          setWorkspaceLoadError(classified);
          setAuthError(membershipsRes.error.message);
          membershipsRef.current = [];
          setMemberships([]);
          setActiveOrgId(null);
          return;
        }

        const rawRows = (membershipsRes.data ?? []) as Array<
          Record<string, unknown> & {
            id: string;
            user_id: string;
            role: OrganisationRole;
            is_active?: boolean;
            created_at: string;
            organization?: Record<string, unknown> | null;
            organisation?: Record<string, unknown> | null;
            organization_id?: string;
            organisation_id?: string;
          }
        >;

        const activeRows = rawRows.filter((row) => row.is_active !== false);
        const hasUnreadableOrg = activeRows.some(
          (row) => (row.organization ?? row.organisation ?? null) === null
        );

        if (hasUnreadableOrg) {
          setWorkspaceLoadError({
            kind: 'permission_denied',
            message: 'Organization record returned null for an active membership.',
            diagnostic:
              'Your account has an active membership row in public.organization_memberships, but reading the linked record in public.organizations was blocked by Row Level Security.',
          });
          membershipsRef.current = [];
          setMemberships([]);
          setActiveOrgId(null);
          return;
        }

        const dedupedMap = new Map<string, OrganisationMembership>();
        for (const row of activeRows) {
          const rawOrg = (row.organization ?? row.organisation) as Record<string, unknown>;
          const org = normalizeOrganisationRow(rawOrg);
          const orgId = row.organization_id ?? row.organisation_id ?? org.id;
          if (!orgId) continue;

          if (!dedupedMap.has(orgId)) {
            const rawRole = typeof row.role === 'string' ? row.role.trim().toLowerCase() : '';
            const normalizedRole: OrganisationRole =
              rawRole === 'owner' ||
              rawRole === 'admin' ||
              rawRole === 'manager' ||
              rawRole === 'staff'
                ? rawRole
                : 'staff';
            dedupedMap.set(orgId, {
              id: row.id,
              organisation_id: orgId,
              user_id: row.user_id,
              role: normalizedRole,
              is_active: row.is_active ?? true,
              created_at: row.created_at,
              organisation: org,
            });
          }
        }

        const normalized = Array.from(dedupedMap.values());
        membershipsRef.current = normalized;
        setMemberships(normalized);

        if (normalized.length > 0) {
          const stored = getStoredOrgId(userId);
          setActiveOrgId((prev) => {
            const candidate = preferredOrgId ?? prev ?? stored;
            const exists = candidate && normalized.some((m) => m.organisation_id === candidate);
            const nextId = exists ? candidate : normalized[0].organisation_id;
            setStoredOrgId(userId, nextId);
            return nextId;
          });
        } else {
          clearStoredOrgId(userId);
          setActiveOrgId(null);
        }
      } catch (err: unknown) {
        if (seq !== loadSeqRef.current) return;
        const message = err instanceof Error ? err.message : 'Network error loading workspace.';
        setWorkspaceLoadError({
          kind: 'unknown',
          message,
          diagnostic: 'Could not reach Supabase to verify your organisation memberships.',
        });
      } finally {
        if (seq === loadSeqRef.current) {
          setIsLoadingOrgs(false);
          setHasLoadedOrgs(true);
        }
      }
    },
    [supabase]
  );

  useEffect(() => {
    if (!supabase) {
      setStatus('unconfigured');
      return;
    }

    let isMounted = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          setAuthError(error.message);
          setStatus('signed_out');
          return;
        }
        const currentSession = data.session ?? null;
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        if (currentSession?.user) {
          setStatus((prev) => prev === 'password_recovery' ? 'password_recovery' : invitationFlowRef.current ? 'invitation_setup' : 'authenticated');
          void loadUserWorkspaceContext(currentSession.user.id);
        } else {
          setStatus('signed_out');
        }
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        setAuthError(err instanceof Error ? err.message : 'Unable to reach Supabase Auth.');
        setStatus('signed_out');
      });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!isMounted) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (event === 'PASSWORD_RECOVERY') {
        setStatus('password_recovery');
        return;
      }

      if (nextSession?.user) {
        if (event === 'INITIAL_SESSION' && loadedUserIdRef.current === nextSession.user.id) {
          return;
        }
        setStatus(invitationFlowRef.current || isInvitationCallback() ? 'invitation_setup' : 'authenticated');
        void loadUserWorkspaceContext(nextSession.user.id);
      } else {
        loadSeqRef.current += 1;
        loadedUserIdRef.current = null;
        membershipsRef.current = [];
        setStatus('signed_out');
        setProfile(null);
        setMemberships([]);
        setActiveOrgId(null);
        setWorkspaceLoadError(null);
        setRecentlyCreatedOrgName(null);
        setIsLoadingOrgs(false);
        setHasLoadedOrgs(false);
      }
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase, loadUserWorkspaceContext]);

  const switchOrganisation = useCallback(
    (organisationId: string) => {
      setActiveOrgId(organisationId);
      if (user) {
        setStoredOrgId(user.id, organisationId);
      }
    },
    [user]
  );

  const refreshMemberships = useCallback(async () => {
    if (user) {
      await loadUserWorkspaceContext(user.id);
    }
  }, [user, loadUserWorkspaceContext]);

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      if (!supabase) {
        return { error: 'Supabase environment variables are not configured.' };
      }
      setAuthError(null);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthError(error.message);
        return { error: error.message };
      }
      return { error: null };
    },
    [supabase]
  );

  const signUpWithPassword = useCallback(
    async (email: string, password: string, fullName: string) => {
      if (!supabase) {
        return {
          error: 'Supabase environment variables are not configured.',
          needsConfirmation: false,
        };
      }
      setAuthError(null);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: { full_name: fullName.trim() },
        },
      });
      if (error) {
        setAuthError(error.message);
        return { error: error.message, needsConfirmation: false };
      }
      const needsConfirmation = !data.session;
      return { error: null, needsConfirmation };
    },
    [supabase]
  );

  const requestPasswordReset = useCallback(
    async (email: string) => {
      if (!supabase) {
        return { error: 'Supabase environment variables are not configured.' };
      }
      setAuthError(null);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) {
        return { error: error.message };
      }
      return { error: null };
    },
    [supabase]
  );

  const updatePassword = useCallback(
    async (newPassword: string) => {
      if (!supabase) {
        return { error: 'Supabase environment variables are not configured.' };
      }
      setAuthError(null);
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        return { error: error.message };
      }
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        invitationFlowRef.current = false;
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('auth_flow');
        window.history.replaceState({}, document.title, cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
        setStatus('authenticated');
        await loadUserWorkspaceContext(data.user.id);
      } else {
        setStatus('signed_out');
      }
      return { error: null };
    },
    [supabase, loadUserWorkspaceContext]
  );

  const updateProfileName = useCallback(
    async (fullName: string) => {
      if (!supabase || !user) {
        return { error: 'You must be signed in to update your profile.' };
      }
      const trimmed = fullName.trim();
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: trimmed })
        .eq('id', user.id);

      if (error) {
        return { error: error.message };
      }
      await loadUserWorkspaceContext(user.id);
      return { error: null };
    },
    [supabase, user, loadUserWorkspaceContext]
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    setRecentlyCreatedOrgName(null);
    await supabase.auth.signOut();
  }, [supabase]);

  const createOrganisation = useCallback(
    async (
      input: CreateOrganisationInput,
      options?: { allowAdditional?: boolean }
    ) => {
      if (!supabase || !user) {
        return {
          error: 'You must be signed in to create a business workspace.',
          organisationId: null,
        };
      }

      if (creatingOrgRef.current) {
        return {
          error: 'A workspace creation request is already in progress. Please wait.',
          organisationId: null,
        };
      }

      const currentRoles = membershipsRef.current.map((membership) => membership.role);
      if (
        options?.allowAdditional &&
        currentRoles.some((role) => role === 'manager' || role === 'staff') &&
        !currentRoles.includes('owner')
      ) {
        return {
          error: 'Managers and Staff cannot create business workspaces. Contact an Owner.',
          organisationId: null,
        };
      }

      creatingOrgRef.current = true;
      try {
        if (!options?.allowAdditional) {
          if (membershipsRef.current.length > 0) {
            const existingId = membershipsRef.current[0].organisation_id;
            setStoredOrgId(user.id, existingId);
            setActiveOrgId(existingId);
            return { error: null, organisationId: existingId };
          }

          const { data: existingRows, error: existingErr } = await supabase
            .from('organization_memberships')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true });

          if (!existingErr && existingRows && existingRows.length > 0) {
            const activeExisting = (
              existingRows as Array<{
                is_active?: boolean;
                organization_id?: string;
                organisation_id?: string;
              }>
            ).filter((row) => row.is_active !== false);

            if (activeExisting.length > 0) {
              const existingOrgId =
                activeExisting[0].organization_id ?? activeExisting[0].organisation_id ?? null;
              await loadUserWorkspaceContext(user.id, existingOrgId);
              return { error: null, organisationId: existingOrgId };
            }
          }
        }

        const { data, error } = await supabase.rpc('create_business_workspace', {
          p_name: input.name.trim(),
          p_business_type: input.businessType,
          p_country: input.country.trim(),
          p_base_currency: input.baseCurrency.trim().toUpperCase(),
          p_business_email: input.businessEmail?.trim() || null,
          p_business_phone: input.businessPhone?.trim() || null,
          p_timezone: input.timezone.trim(),
        });

        if (error) {
          return { error: error.message, organisationId: null };
        }

        let createdOrgId: string | null = null;
        if (typeof data === 'string' && data.length > 0) {
          createdOrgId = data;
        } else {
          const createdRecord = Array.isArray(data) ? data[0] : data;
          if (createdRecord && typeof createdRecord === 'object') {
            const recordObj = createdRecord as Record<string, unknown>;
            const candidate =
              recordObj.id ?? recordObj.organization_id ?? recordObj.organisation_id;
            if (typeof candidate === 'string' && candidate.length > 0) {
              createdOrgId = candidate;
            }
          }
        }

        if (!createdOrgId) {
          return {
            error: 'Workspace creation completed without returning an organization UUID.',
            organisationId: null,
          };
        }

        setStoredOrgId(user.id, createdOrgId);
        setActiveOrgId(createdOrgId);
        setRecentlyCreatedOrgName(input.name.trim());

        await loadUserWorkspaceContext(user.id, createdOrgId);

        return { error: null, organisationId: createdOrgId };
      } finally {
        creatingOrgRef.current = false;
      }
    },
    [supabase, user, loadUserWorkspaceContext]
  );

  const activeMembership = useMemo(() => {
    if (memberships.length === 0) return null;
    return memberships.find((m) => m.organisation_id === activeOrgId) ?? memberships[0];
  }, [memberships, activeOrgId]);

  const value: AuthContextValue = {
    status,
    isSupabaseConfigured: runtimeConfig.isSupabaseConfigured,
    user,
    profile,
    session,
    memberships,
    activeMembership,
    activeOrganisation: activeMembership?.organisation ?? null,
    activeRole: activeMembership?.role ?? null,
    authError,
    workspaceLoadError,
    isLoadingOrgs,
    hasLoadedOrgs,
    recentlyCreatedOrgName,
    clearRecentlyCreatedNotice,
    switchOrganisation,
    refreshMemberships,
    signInWithPassword,
    signUpWithPassword,
    requestPasswordReset,
    updatePassword,
    updateProfileName,
    signOut,
    createOrganisation,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }
  return ctx;
}
