import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Database,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  Shield,
  Users,
} from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import { getRuntimeConfig } from '../../core/config/env';
import {
  BUSINESS_TYPE_OPTIONS,
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  ORGANISATION_ROLES,
  formatCurrencyDisplay,
} from '../../core/constants/businessOptions';
import {
  fetchOrganisationMembers,
  removeOrganisationMember,
  updateOrganisationMemberRole,
  updateOrganisationProfile,
} from '../../core/supabase/organisations';
import type {
  BusinessType,
  OrganisationMemberRecord,
  OrganisationRole,
} from '../../core/types/domain';

import { inviteOrganisationMember, type InviteableOrganisationRole } from '../../core/supabase/organizationInvitations';
import { ReceiptSettingsPanel } from './ReceiptSettingsPanel';

export type SettingsTab =
  | 'auth_orgs'
  | 'receipt_settings'
  | 'members_roles'
  | 'schema_rls'
  | 'environment'
  | 'security_storage';

const ENV_TEMPLATE = `VITE_SUPABASE_URL="https://your-project-ref.supabase.co"
VITE_SUPABASE_ANON_KEY="your-public-anon-key"`;

const MIGRATION_SNIPPET = `-- Connected Supabase Tables:
--   public.profiles
--   public.organizations
--   public.organization_memberships

-- Atomic business workspace creation with server-enforced Owner role:
select public.create_business_workspace(
  p_name := 'Northbridge Wholesale Ltd.',
  p_business_type := 'wholesale',
  p_country := 'United Kingdom',
  p_base_currency := 'GBP',
  p_business_email := 'accounts@northbridge.co.uk',
  p_business_phone := '+44 20 7946 0921',
  p_timezone := 'Europe/London'
);`;

interface SettingsViewProps {
  requestedTab?: SettingsTab;
}

export function SettingsView({ requestedTab }: SettingsViewProps) {
  const runtime = getRuntimeConfig();
  const {
    isSupabaseConfigured,
    user,
    profile,
    memberships,
    activeOrganisation,
    activeRole,
    refreshMemberships,
    updateProfileName,
    signOut,
    createOrganisation,
    switchOrganisation,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<SettingsTab>(requestedTab ?? 'auth_orgs');

  useEffect(() => {
    if (requestedTab) {
      const businessTabs: SettingsTab[] = ['auth_orgs', 'receipt_settings', 'members_roles'];
      setActiveTab(businessTabs.includes(requestedTab) ? requestedTab : 'auth_orgs');
    }
  }, [requestedTab]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // User Profile Edit
  const [profileName, setProfileName] = useState(profile?.full_name ?? '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  useEffect(() => {
    setProfileName(profile?.full_name ?? '');
  }, [profile?.full_name]);

  // Active Organisation Edit (Owner/Admin only)
  const canEditOrg = activeRole === 'owner' || activeRole === 'admin';

  useEffect(() => {
    if (activeTab === 'receipt_settings' && !canEditOrg) {
      setActiveTab('auth_orgs');
    }
  }, [activeTab, canEditOrg]);
  const [editOrgName, setEditOrgName] = useState(activeOrganisation?.name ?? '');
  const [editOrgType, setEditOrgType] = useState<BusinessType>(
    activeOrganisation?.business_type ?? 'retail'
  );
  const [editOrgCountry, setEditOrgCountry] = useState(
    activeOrganisation?.country ?? 'United States'
  );
  const [editOrgCurrency, setEditOrgCurrency] = useState(
    activeOrganisation?.base_currency ?? 'USD'
  );
  const [editOrgTimezone, setEditOrgTimezone] = useState(
    activeOrganisation?.timezone ?? 'UTC'
  );
  const [editOrgEmail, setEditOrgEmail] = useState(
    activeOrganisation?.business_email ?? ''
  );
  const [editOrgPhone, setEditOrgPhone] = useState(
    activeOrganisation?.business_phone ?? ''
  );
  const editOrgLockRef = useRef(false);
  const prevEditOrgIdRef = useRef<string | null>(activeOrganisation?.id ?? null);
  const [editOrgSaving, setEditOrgSaving] = useState(false);
  const [editOrgMsg, setEditOrgMsg] = useState<string | null>(null);
  const [editOrgRefreshWarning, setEditOrgRefreshWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!activeOrganisation) return;
    setEditOrgName(activeOrganisation.name);
    setEditOrgType(activeOrganisation.business_type);
    setEditOrgCountry(activeOrganisation.country);
    setEditOrgCurrency(activeOrganisation.base_currency);
    setEditOrgTimezone(activeOrganisation.timezone);
    setEditOrgEmail(activeOrganisation.business_email ?? '');
    setEditOrgPhone(activeOrganisation.business_phone ?? '');
    if (prevEditOrgIdRef.current !== activeOrganisation.id) {
      prevEditOrgIdRef.current = activeOrganisation.id;
      setEditOrgMsg(null);
      setEditOrgRefreshWarning(null);
    }
  }, [activeOrganisation]);

  // Create Additional Organisation Form
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgType, setNewOrgType] = useState<BusinessType>('retail');
  const [newOrgCountry, setNewOrgCountry] = useState('United States');
  const [newOrgCurrency, setNewOrgCurrency] = useState('USD');
  const [newOrgTimezone, setNewOrgTimezone] = useState('America/New_York');
  const [newOrgEmail, setNewOrgEmail] = useState('');
  const [newOrgPhone, setNewOrgPhone] = useState('');
  const newOrgLockRef = useRef(false);
  const [orgSubmitting, setOrgSubmitting] = useState(false);
  const [orgFeedback, setOrgFeedback] = useState<string | null>(null);

  // Members Roster State
  const [members, setMembers] = useState<OrganisationMemberRecord[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [memberActionMsg, setMemberActionMsg] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteableOrganisationRole>('staff');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  const loadMembers = useCallback(async () => {
    if (!activeOrganisation) return;
    setMembersLoading(true);
    setMembersError(null);
    const res = await fetchOrganisationMembers(activeOrganisation.id);
    setMembers(res.members);
    setMembersError(res.error);
    setMembersLoading(false);
  }, [activeOrganisation]);

  useEffect(() => {
    if (activeTab === 'members_roles' && activeOrganisation) {
      void loadMembers();
    }
  }, [activeTab, activeOrganisation, loadMembers]);

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMsg(null);
    const { error } = await updateProfileName(profileName);
    setProfileMsg(error ? `Error: ${error}` : 'Profile updated.');
    setProfileSaving(false);
  };

  const handleSaveOrgDetails = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeOrganisation || !canEditOrg || editOrgLockRef.current || editOrgSaving) return;

    const trimmedName = editOrgName.trim();
    if (trimmedName.length < 2 || trimmedName.length > 120) {
      setEditOrgRefreshWarning(null);
      setEditOrgMsg('Error: Business name must be between 2 and 120 characters.');
      return;
    }

    const trimmedTimezone = editOrgTimezone.trim();
    if (!trimmedTimezone) {
      setEditOrgRefreshWarning(null);
      setEditOrgMsg('Error: Timezone is required.');
      return;
    }

    editOrgLockRef.current = true;
    setEditOrgSaving(true);
    setEditOrgMsg(null);
    setEditOrgRefreshWarning(null);

    try {
      const { error } = await updateOrganisationProfile(activeOrganisation.id, {
        name: trimmedName,
        business_type: editOrgType,
        country: editOrgCountry,
        base_currency: editOrgCurrency,
        timezone: trimmedTimezone,
        business_email: editOrgEmail.trim() || null,
        business_phone: editOrgPhone.trim() || null,
      });

      if (error) {
        setEditOrgMsg(`Error: ${error}`);
        return;
      }

      setEditOrgMsg('Organisation settings saved.');

      try {
        await refreshMemberships();
      } catch (refreshErr: unknown) {
        setEditOrgRefreshWarning(
          `Saved, but refreshing the workspace view failed: ${
            refreshErr instanceof Error ? refreshErr.message : 'Reload to view updated details.'
          }`
        );
      }
    } catch (err: unknown) {
      setEditOrgMsg(
        `Error: ${err instanceof Error ? err.message : 'Unable to update organisation settings.'}`
      );
    } finally {
      editOrgLockRef.current = false;
      setEditOrgSaving(false);
    }
  };

  const handleNewCountryChange = (selectedCountry: string) => {
    setNewOrgCountry(selectedCountry);
    const match = COUNTRY_OPTIONS.find((c) => c.name === selectedCountry);
    if (match) {
      setNewOrgCurrency(match.defaultCurrency);
      setNewOrgTimezone(match.defaultTimezone);
    }
  };

  const handleCreateOrg = async (e: FormEvent) => {
    e.preventDefault();
    if (newOrgLockRef.current || orgSubmitting || !newOrgName.trim()) return;
    newOrgLockRef.current = true;
    setOrgSubmitting(true);
    setOrgFeedback(null);

    try {
      const { error } = await createOrganisation(
        {
          name: newOrgName,
          businessType: newOrgType,
          country: newOrgCountry,
          baseCurrency: newOrgCurrency,
          timezone: newOrgTimezone,
          businessEmail: newOrgEmail.trim() || undefined,
          businessPhone: newOrgPhone.trim() || undefined,
        },
        { allowAdditional: true }
      );

      if (error) {
        setOrgFeedback(`Error: ${error}`);
      } else {
        setNewOrgName('');
        setNewOrgEmail('');
        setNewOrgPhone('');
        setOrgFeedback('New business workspace created with Owner role.');
      }
    } finally {
      newOrgLockRef.current = false;
      setOrgSubmitting(false);
    }
  };

  const handleRoleChange = async (member: OrganisationMemberRecord, nextRole: OrganisationRole) => {
    if (!activeOrganisation) return;
    setMemberActionMsg(null);
    const { error } = await updateOrganisationMemberRole(
      activeOrganisation.id,
      member.id,
      nextRole
    );
    if (error) {
      setMemberActionMsg(`Policy rejected role change: ${error}`);
    } else {
      setMemberActionMsg('Member role updated.');
      await loadMembers();
    }
  };

  const handleRemoveMember = async (member: OrganisationMemberRecord) => {
    if (!activeOrganisation) return;
    setMemberActionMsg(null);
    const { error } = await removeOrganisationMember(activeOrganisation.id, member.id);
    if (error) {
      setMemberActionMsg(`Policy rejected removal: ${error}`);
    } else {
      setMemberActionMsg('Member removed from organisation.');
      await loadMembers();
    }
  };

  const handleInviteMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeOrganisation || (activeRole !== 'owner' && activeRole !== 'manager') || inviteSubmitting) return;
    if (activeRole === 'manager' && inviteRole !== 'staff') return;
    setInviteSubmitting(true);
    setMemberActionMsg(null);
    try {
      const { result, error } = await inviteOrganisationMember(
        activeOrganisation.id,
        inviteEmail,
        inviteRole
      );
      if (error || !result) {
        setMemberActionMsg(`Invitation rejected: ${error ?? 'Unknown error'}`);
        return;
      }
      setInviteEmail('');
      setMemberActionMsg(
        result.status === 'added'
          ? 'Existing confirmed Auth user provisioned in this organisation.'
          : result.awaiting_existing_account_confirmation
            ? 'Invitation is pending. This existing account must confirm its Auth email before membership is provisioned.'
            : result.awaiting_email_confirmation
              ? result.already_pending
                ? 'An invitation is already pending. Membership will be provisioned after email confirmation.'
                : 'Invitation email sent. Membership will be provisioned only after the recipient confirms the email.'
              : 'Invitation is pending and membership has not yet been provisioned.'
      );
      await loadMembers();
    } catch (err: unknown) {
      setMemberActionMsg(
        `Invitation failed: ${err instanceof Error ? err.message : 'Unexpected error'}`
      );
    } finally {
      setInviteSubmitting(false);
    }
  };

  const maskedUrl = runtime.supabaseUrl
    ? runtime.supabaseUrl.replace(/(https?:\/\/[^.]+)\./, '$1.')
    : 'Not configured';

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-slate-500">
            Workspace Administration
            <span aria-hidden="true"> · </span>
            Business Profile &amp; Team Access
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
            Settings &amp; Access Management
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl">
            Manage your profile, business details, receipts, and team access.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Sign Out</span>
        </button>
      </section>

      {/* Sub-navigation Tabs */}
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md w-fit"
      >
        {(
          [
            { id: 'auth_orgs', label: 'Account & Organisations' },
            ...(canEditOrg
              ? [{ id: 'receipt_settings' as const, label: 'Receipt Settings' }]
              : []),
            { id: 'members_roles', label: 'Members & Roles' },
          ] satisfies ReadonlyArray<{ id: SettingsTab; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Account & Organisations */}
      {activeTab === 'auth_orgs' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left Column: User Profile + Switcher + Active Business Edit */}
          <div className="space-y-6">
            <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="border-b border-slate-200 pb-3 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Your User Profile</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Authenticated via Supabase Auth · <span className="font-mono">{user?.email}</span>
                  </p>
                </div>
                <span className="text-xs font-mono text-slate-500 capitalize">
                  {activeRole ?? 'member'}
                </span>
              </div>

              <form onSubmit={(e) => void handleSaveProfile(e)} className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="settings-profile-name" className="block text-xs font-medium text-slate-700">
                    Full Name
                  </label>
                  <input
                    id="settings-profile-name"
                    type="text"
                    required
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="w-full h-9 px-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>

                {profileMsg && (
                  <div className="text-xs px-3 py-2 rounded-md border border-slate-200 bg-slate-50 text-slate-800">
                    {profileMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={profileSaving}
                  className="px-3.5 py-1.5 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
                >
                  {profileSaving ? 'Saving...' : 'Save Profile'}
                </button>
              </form>
            </section>

            {/* Active Organisation Editor */}
            {activeOrganisation && (
              <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                <div className="border-b border-slate-200 pb-3">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Active Business Profile
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {canEditOrg
                      ? 'Owners and Admins can update organisation metadata.'
                      : 'Read-only view. Contact an Owner or Admin to modify business details.'}
                  </p>
                </div>

                <form onSubmit={(e) => void handleSaveOrgDetails(e)} className="space-y-3">
                  <div className="space-y-1">
                    <label htmlFor="edit-org-name" className="block text-xs font-medium text-slate-700">
                      Business Name
                    </label>
                    <input
                      id="edit-org-name"
                      type="text"
                      required
                      minLength={2}
                      maxLength={120}
                      disabled={!canEditOrg}
                      value={editOrgName}
                      onChange={(e) => setEditOrgName(e.target.value)}
                      className="w-full h-9 px-3 rounded-md border border-slate-300 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label htmlFor="edit-org-type" className="block text-xs font-medium text-slate-700">
                        Business Type
                      </label>
                      <select
                        id="edit-org-type"
                        disabled={!canEditOrg}
                        value={editOrgType}
                        onChange={(e) => setEditOrgType(e.target.value as BusinessType)}
                        className="w-full h-9 px-2.5 rounded-md border border-slate-300 text-xs text-slate-900 bg-white disabled:bg-slate-50"
                      >
                        {BUSINESS_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="edit-org-country" className="block text-xs font-medium text-slate-700">
                        Country
                      </label>
                      <select
                        id="edit-org-country"
                        disabled={!canEditOrg}
                        value={editOrgCountry}
                        onChange={(e) => setEditOrgCountry(e.target.value)}
                        className="w-full h-9 px-2.5 rounded-md border border-slate-300 text-xs text-slate-900 bg-white disabled:bg-slate-50"
                      >
                        {COUNTRY_OPTIONS.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="edit-org-currency" className="block text-xs font-medium text-slate-700">
                        Currency
                      </label>
                      <select
                        id="edit-org-currency"
                        disabled={!canEditOrg}
                        value={editOrgCurrency}
                        onChange={(e) => setEditOrgCurrency(e.target.value)}
                        className="w-full h-9 px-2.5 rounded-md border border-slate-300 text-xs text-slate-900 bg-white disabled:bg-slate-50"
                      >
                        {CURRENCY_OPTIONS.map((cur) => (
                          <option key={cur.code} value={cur.code}>
                            {cur.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="edit-org-tz" className="block text-xs font-medium text-slate-700">
                        Timezone
                      </label>
                      <input
                        id="edit-org-tz"
                        type="text"
                        required
                        disabled={!canEditOrg}
                        value={editOrgTimezone}
                        onChange={(e) => setEditOrgTimezone(e.target.value)}
                        className="w-full h-9 px-3 rounded-md border border-slate-300 text-xs font-mono text-slate-900 disabled:bg-slate-50"
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="edit-org-email" className="block text-xs font-medium text-slate-700">
                        Business Email (Optional)
                      </label>
                      <input
                        id="edit-org-email"
                        type="email"
                        disabled={!canEditOrg}
                        value={editOrgEmail}
                        onChange={(e) => setEditOrgEmail(e.target.value)}
                        placeholder="accounts@company.com"
                        className="w-full h-9 px-3 rounded-md border border-slate-300 text-xs text-slate-900 disabled:bg-slate-50"
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="edit-org-phone" className="block text-xs font-medium text-slate-700">
                        Business Phone (Optional)
                      </label>
                      <input
                        id="edit-org-phone"
                        type="tel"
                        disabled={!canEditOrg}
                        value={editOrgPhone}
                        onChange={(e) => setEditOrgPhone(e.target.value)}
                        placeholder="+1 (555) 010-9900"
                        className="w-full h-9 px-3 rounded-md border border-slate-300 text-xs text-slate-900 disabled:bg-slate-50"
                      />
                    </div>
                  </div>

                  {editOrgMsg && (
                    <div
                      role={editOrgMsg.startsWith('Error:') ? 'alert' : 'status'}
                      className={`flex items-center gap-2 text-xs px-3 py-2.5 rounded-md border ${
                        editOrgMsg.startsWith('Error:')
                          ? 'border-red-200 bg-red-50 text-red-700'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      }`}
                    >
                      {!editOrgMsg.startsWith('Error:') && (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
                      )}
                      <span>{editOrgMsg}</span>
                    </div>
                  )}

                  {editOrgRefreshWarning && (
                    <div
                      role="status"
                      className="text-xs px-3 py-2.5 rounded-md border border-amber-200 bg-amber-50 text-amber-800"
                    >
                      {editOrgRefreshWarning}
                    </div>
                  )}

                  {canEditOrg && (
                    <button
                      type="submit"
                      disabled={editOrgSaving}
                      aria-busy={editOrgSaving}
                      className="px-4 py-2 rounded-md bg-blue-700 text-white text-xs font-medium hover:bg-blue-800 disabled:opacity-50"
                    >
                      {editOrgSaving ? 'Saving...' : 'Update Business Profile'}
                    </button>
                  )}
                </form>
              </section>
            )}
          </div>

          {/* Right Column: Switcher + Register Additional Business */}
          <div className="space-y-6">
            <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="border-b border-slate-200 pb-3 flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Your Business Workspaces
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Switch between organisations you belong to. Data across tenants is isolated by RLS.
                  </p>
                </div>
                <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap">
                  {memberships.length} {memberships.length === 1 ? 'workspace' : 'workspaces'}
                </span>
              </div>

              <ul className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                {memberships.map((m) => {
                  const isSelected = activeOrganisation?.id === m.organisation_id;
                  return (
                    <li
                      key={m.organisation_id}
                      className="px-3.5 py-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">
                          {m.organisation.name}
                        </div>
                        <div className="text-slate-500">
                          <span className="capitalize">{m.role}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{m.organisation.country}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{formatCurrencyDisplay(m.organisation.base_currency)}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => switchOrganisation(m.organisation_id)}
                        disabled={isSelected}
                        className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap shrink-0 ${
                          isSelected
                            ? 'bg-blue-50 text-blue-700 cursor-default'
                            : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {isSelected ? 'Active' : 'Switch'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

{activeRole === 'owner' && (
            <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="border-b border-slate-200 pb-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  Create Additional Business Workspace
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Creates an isolated organisation via <span className="font-mono">create_business_workspace</span> with you as Owner.
                </p>
              </div>

              <form onSubmit={(e) => void handleCreateOrg(e)} className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="new-org-name" className="block text-xs font-medium text-slate-700">
                    Business Name
                  </label>
                  <input
                    id="new-org-name"
                    type="text"
                    required
                    minLength={2}
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    placeholder="e.g. Harbor Distribution Co."
                    className="w-full h-9 px-3 rounded-md border border-slate-300 text-sm text-slate-900"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="new-org-type" className="block text-xs font-medium text-slate-700">
                      Type
                    </label>
                    <select
                      id="new-org-type"
                      value={newOrgType}
                      onChange={(e) => setNewOrgType(e.target.value as BusinessType)}
                      className="w-full h-9 px-2.5 rounded-md border border-slate-300 text-xs text-slate-900 bg-white"
                    >
                      {BUSINESS_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="new-org-country" className="block text-xs font-medium text-slate-700">
                      Country
                    </label>
                    <select
                      id="new-org-country"
                      value={newOrgCountry}
                      onChange={(e) => handleNewCountryChange(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-md border border-slate-300 text-xs text-slate-900 bg-white"
                    >
                      {COUNTRY_OPTIONS.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="new-org-currency" className="block text-xs font-medium text-slate-700">
                      Currency
                    </label>
                    <select
                      id="new-org-currency"
                      value={newOrgCurrency}
                      onChange={(e) => setNewOrgCurrency(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-md border border-slate-300 text-xs text-slate-900 bg-white"
                    >
                      {CURRENCY_OPTIONS.map((cur) => (
                        <option key={cur.code} value={cur.code}>
                          {cur.code}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="new-org-email" className="block text-xs font-medium text-slate-700">
                      Business Email (Optional)
                    </label>
                    <input
                      id="new-org-email"
                      type="email"
                      value={newOrgEmail}
                      onChange={(e) => setNewOrgEmail(e.target.value)}
                      placeholder="ops@business.com"
                      className="w-full h-9 px-3 rounded-md border border-slate-300 text-xs text-slate-900"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="new-org-phone" className="block text-xs font-medium text-slate-700">
                      Business Phone (Optional)
                    </label>
                    <input
                      id="new-org-phone"
                      type="tel"
                      value={newOrgPhone}
                      onChange={(e) => setNewOrgPhone(e.target.value)}
                      placeholder="+44 20 7946 0921"
                      className="w-full h-9 px-3 rounded-md border border-slate-300 text-xs text-slate-900"
                    />
                  </div>
                </div>

                {orgFeedback && (
                  <div className="text-xs px-3 py-2 rounded-md border border-slate-200 bg-slate-50 text-slate-800">
                    {orgFeedback}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={orgSubmitting}
                  aria-busy={orgSubmitting}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {orgSubmitting && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
                  )}
                  <span>{orgSubmitting ? 'Creating...' : 'Create Business Workspace'}</span>
                </button>
              </form>
            </section>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Receipt Settings (Owner / Admin only) */}
      {activeTab === 'receipt_settings' && canEditOrg && (
        <ReceiptSettingsPanel
          organisation={activeOrganisation}
          activeRole={activeRole}
          onRefreshOrganisation={refreshMemberships}
        />
      )}

      {/* Tab 3: Members & Roles */}
      {activeTab === 'members_roles' && (
        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <Users className="h-4 w-4 text-slate-500" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Organisation Members ({activeOrganisation?.name})
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Self-promotion is blocked at the database level; only Owners can assign Owner or Admin roles.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void loadMembers()}
                disabled={membersLoading}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${membersLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>Refresh</span>
              </button>
            </div>

            {(activeRole === 'owner' || activeRole === 'manager') && (
              <form onSubmit={(e) => void handleInviteMember(e)} className="px-5 py-4 border-b border-slate-200 bg-slate-50/50 space-y-3">
                <div>
                  <h3 className="text-xs font-semibold text-slate-900">Invite a team member</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Owners can invite Manager or Staff. Managers can invite Staff only.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_150px_auto] gap-2">
                  <label className="sr-only" htmlFor="member-invite-email">Member email</label>
                  <input
                    id="member-invite-email"
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="h-9 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900"
                  />
                  <label className="sr-only" htmlFor="member-invite-role">Role</label>
                  <select
                    id="member-invite-role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as InviteableOrganisationRole)}
                    className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900"
                  >
                    <option value="staff">Staff</option>
                    {activeRole === 'owner' && <option value="manager">Manager</option>}
                  </select>
                  <button
                    type="submit"
                    disabled={inviteSubmitting || !inviteEmail.trim()}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {inviteSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Users className="h-3.5 w-3.5" aria-hidden="true" />}
                    <span>{inviteSubmitting ? 'Sending…' : 'Invite member'}</span>
                  </button>
                </div>
              </form>
            )}

            {memberActionMsg && (
              <div className="px-5 py-2.5 text-xs bg-slate-50 border-b border-slate-200 text-slate-800">
                {memberActionMsg}
              </div>
            )}

            {membersError ? (
              <div className="p-5 text-xs text-red-700 bg-red-50/50">
                Error loading members: {membersError}
              </div>
            ) : membersLoading ? (
              <div className="p-5 space-y-2" aria-busy="true">
                <div className="h-9 bg-slate-100 rounded animate-pulse" />
                <div className="h-9 bg-slate-100 rounded animate-pulse" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                      <th className="py-2.5 px-4">Member</th>
                      <th className="py-2.5 px-4">Email</th>
                      <th className="py-2.5 px-4">Role</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {members.map((member) => {
                      const isSelf = member.user_id === user?.id;
                      const canManageTarget =
                        !isSelf &&
                        (activeRole === 'owner' ||
                          (activeRole === 'admin' &&
                            (member.role === 'manager' || member.role === 'staff')));

                      const assignableRoles =
                        activeRole === 'owner'
                          ? ORGANISATION_ROLES
                          : ORGANISATION_ROLES.filter(
                              (r) => r.key === 'manager' || r.key === 'staff'
                            );

                      return (
                        <tr key={member.id} className="h-11 hover:bg-slate-50/60">
                          <td className="px-4 py-2 font-medium text-slate-900 whitespace-nowrap">
                            {member.profile?.full_name || 'Unnamed User'}
                            {isSelf && (
                              <span className="ml-2 text-[11px] font-normal text-slate-500">
                                (You)
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 font-mono text-slate-600 whitespace-nowrap">
                            {member.profile?.email || member.user_id}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            {canManageTarget ? (
                              <select
                                aria-label={`Role for ${member.profile?.email ?? member.user_id}`}
                                value={member.role}
                                onChange={(e) =>
                                  void handleRoleChange(
                                    member,
                                    e.target.value as OrganisationRole
                                  )
                                }
                                className="h-7 px-2 rounded border border-slate-300 bg-white text-xs text-slate-900"
                              >
                                {assignableRoles.map((r) => (
                                  <option key={r.key} value={r.key}>
                                    {r.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="capitalize font-medium text-slate-800">
                                {member.role}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            {activeRole === 'owner' && !isSelf ? (
                              <button
                                type="button"
                                onClick={() => void handleRemoveMember(member)}
                                className="text-xs font-medium text-red-700 hover:text-red-800"
                              >
                                Remove
                              </button>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Role Definitions Reference */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">
                Organisation Role Hierarchy
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                These roles determine what each team member can access and manage.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
              {ORGANISATION_ROLES.map((roleDef) => (
                <div key={roleDef.key} className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900">
                      {roleDef.label}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                      {roleDef.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {roleDef.description}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Tab 3: Database Schema & RLS */}
      {activeTab === 'schema_rls' && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Database className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Supabase Schema &amp; Migrations
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Migration history is maintained in <span className="font-mono">supabase/migrations/</span>. Review and apply only migrations compatible with the connected database schema.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleCopy('sql', MIGRATION_SNIPPET)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              {copiedId === 'sql' ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Copy Snippet</span>
                </>
              )}
            </button>
          </div>

          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6 border-b border-slate-200 text-xs">
            <div className="space-y-2">
              <h3 className="font-semibold text-slate-900">Core Tables</h3>
              <ul className="space-y-1.5 text-slate-600">
                <li>
                  <span className="font-mono text-slate-900">public.profiles</span> — User display name and avatar metadata. Auth email addresses remain in <span className="font-mono">auth.users</span>.
                </li>
                <li>
                  <span className="font-mono text-slate-900">public.organizations</span> — Business name, type, country, currency, timezone, email, phone.
                </li>
                <li>
                  <span className="font-mono text-slate-900">public.organization_memberships</span> — Tenant memberships and role assignments (<span className="font-mono">owner | manager | staff</span>; legacy Admin rows may exist).
                </li>
              </ul>
            </div>

            <div className="space-y-2">
              <h3 className="font-semibold text-slate-900">Anti-Privilege-Escalation Controls</h3>
              <ul className="space-y-1.5 text-slate-600">
                <li>
                  <span className="font-mono text-slate-900">enforce_membership_rbac()</span> — Membership changes are constrained by database policies and role checks.
                </li>
                <li>
                  <span className="font-mono text-slate-900">organization_memberships_*_privileged</span> — Constrains membership role changes to prevent privilege escalation.
                </li>
                <li>
                  <span className="font-mono text-slate-900">create_business_workspace()</span> — Atomic <span className="font-mono">SECURITY DEFINER</span> RPC assigning Owner server-side.
                </li>
              </ul>
            </div>
          </div>

          <pre className="p-5 text-xs font-mono text-slate-800 bg-slate-50/70 overflow-x-auto leading-relaxed">
            {MIGRATION_SNIPPET}
          </pre>
        </section>
      )}

      {/* Tab 4: Environment & Supabase */}
      {activeTab === 'environment' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-slate-900">
                Runtime Environment Status
              </h2>
            </div>

            <dl className="divide-y divide-slate-200 text-xs">
              <div className="px-5 py-3.5 flex items-center justify-between gap-4">
                <dt className="font-mono text-slate-700">VITE_SUPABASE_URL</dt>
                <dd className="font-mono text-right truncate max-w-[260px] text-slate-900">
                  {runtime.supabaseUrl ? maskedUrl : 'Missing'}
                </dd>
              </div>
              <div className="px-5 py-3.5 flex items-center justify-between gap-4">
                <dt className="font-mono text-slate-700">VITE_SUPABASE_ANON_KEY</dt>
                <dd className={`font-medium ${runtime.supabaseAnonKey ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {runtime.supabaseAnonKey ? 'Configured (client-safe)' : 'Missing'}
                </dd>
              </div>
              <div className="px-5 py-3.5 flex items-center justify-between gap-4">
                <dt className="font-mono text-slate-700">SUPABASE_SERVICE_ROLE_KEY</dt>
                <dd className="text-slate-600">Server-only (never exposed in browser)</dd>
              </div>
              <div className="px-5 py-3.5 flex items-center justify-between gap-4">
                <dt className="text-slate-700 font-medium">Connection State</dt>
                <dd className={`font-medium ${isSupabaseConfigured ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {isSupabaseConfigured ? 'Connected' : 'Credentials required'}
                </dd>
              </div>
            </dl>
          </section>

          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Environment Template
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure in <span className="font-mono">.env.local</span> or runtime environment secrets.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleCopy('env', ENV_TEMPLATE)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                {copiedId === 'env' ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Copy Template</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-5 text-xs font-mono text-slate-800 bg-slate-50/70 overflow-x-auto flex-1 leading-relaxed">
              {ENV_TEMPLATE}
            </pre>
          </section>
        </div>
      )}

      {/* Tab 5: Security & Storage */}
      {activeTab === 'security_storage' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Lock className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <span>Supabase Storage Isolation</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              The private <span className="font-mono text-slate-900">organisation-files</span> bucket enforces path-prefix Row Level Security so businesses can never access another tenant&apos;s documents.
            </p>
            <div className="p-3 rounded-md bg-slate-50 border border-slate-200 font-mono text-xs text-slate-800">
              organisation-files/&lt;organisation_id&gt;/&lt;module&gt;/&lt;filename&gt;
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Shield className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <span>Portability &amp; Key Separation</span>
            </div>
            <ul className="space-y-2 text-xs text-slate-600 leading-relaxed">
              <li>
                <span className="font-medium text-slate-900">Protected Routes:</span> Unauthenticated users and users without an organisation cannot access the business dashboard.
              </li>
              <li>
                <span className="font-medium text-slate-900">Zero Exposed Secrets:</span> Only <span className="font-mono">VITE_SUPABASE_URL</span> and <span className="font-mono">VITE_SUPABASE_ANON_KEY</span> exist in browser code.
              </li>
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
