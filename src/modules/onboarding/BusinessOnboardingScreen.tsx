import { useRef, useState, type FormEvent } from 'react';
import { Building2, CheckCircle2, Loader2, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../core/auth/AuthContext';
import {
  BUSINESS_CATEGORY_OPTIONS,
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
} from '../../core/constants/businessOptions';
import type { BusinessCategory } from '../../core/types/domain';

export function BusinessOnboardingScreen() {
  const {
    user,
    profile,
    memberships,
    hasLoadedOrgs,
    isLoadingOrgs,
    refreshMemberships,
    createOrganisation,
    signOut,
  } = useAuth();

  const [name, setName] = useState('');
  const [businessCategory, setBusinessCategory] = useState<BusinessCategory>('retail');
  const [country, setCountry] = useState('Nigeria');
  const [currency, setCurrency] = useState('NGN');
  const [timezone, setTimezone] = useState('Africa/Lagos');
  const [businessEmail, setBusinessEmail] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [productsOrServices, setProductsOrServices] = useState('');
  const [operatingChannels, setOperatingChannels] = useState<string[]>(['physical']);
  const [teamSize, setTeamSize] = useState('1-5');
  const [locationCount, setLocationCount] = useState('1');
  const [businessPriorities, setBusinessPriorities] = useState<string[]>(['sales']);

  const submitLockRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleCountryChange = (selectedCountry: string) => {
    setCountry(selectedCountry);
    const match = COUNTRY_OPTIONS.find((c) => c.name === selectedCountry);
    if (match) {
      setCurrency(match.defaultCurrency);
      setTimezone(match.defaultTimezone);
    }
  };

  const isBlocked = submitting || isLoadingOrgs || !hasLoadedOrgs || memberships.length > 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isBlocked) {
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setErrorMsg('Business name must be at least 2 characters.');
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);

    try {
      const { error, organisationId } = await createOrganisation({
        name: trimmedName,
        businessType: businessCategory,
        configuration: { business_description: businessDescription.trim(), products_or_services: productsOrServices.trim(), operating_channels: operatingChannels.length ? operatingChannels : ['physical'], team_size: teamSize, location_count: locationCount, priorities: businessPriorities },
        country,
        baseCurrency: currency,
        timezone,
        businessEmail: businessEmail.trim() || undefined,
        businessPhone: businessPhone.trim() || undefined,
      });

      if (error || !organisationId) {
        setErrorMsg(error ?? 'Unable to create business workspace.');
        submitLockRef.current = false;
        setSubmitting(false);
        return;
      }

      setSuccessMsg('Business workspace "' + trimmedName + '" created with the ' + businessCategory.replaceAll('_', ' ') + ' workspace. Loading dashboard...');
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unexpected error creating business workspace.'
      );
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Header */}
      <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
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
          <span className="font-display text-sm font-semibold tracking-tight text-slate-900 whitespace-nowrap">
            Veyora Business
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-slate-600 truncate max-w-[220px]">
            {profile?.full_name ? `${profile.full_name} · ` : ''}
            {user?.email}
          </span>
          <button
            type="button"
            onClick={() => void refreshMemberships()}
            disabled={isLoadingOrgs}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoadingOrgs ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>Check Invitations</span>
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-2xl space-y-6">
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-500">
              Step 1 of 1
              <span aria-hidden="true"> · </span>
              Business Workspace Setup
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
              Set up your business
            </h1>
            <p className="text-sm text-slate-600">
              Enter your business details to continue.
            </p>
          </div>

          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="bg-white border border-slate-200 rounded-lg p-6 sm:p-8 space-y-6"
          >
            <fieldset disabled={isBlocked} className="space-y-6">
            {/* Primary Business Details */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 border-b border-slate-200 pb-2.5">
                <Building2 className="h-4 w-4 text-slate-500" aria-hidden="true" />
                <span>Business details</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 space-y-1">
                  <label htmlFor="onboard-business-name" className="block text-xs font-medium text-slate-700">
                    Business Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="onboard-business-name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={120}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Northbridge Retail & Supply Ltd."
                    className="w-full h-10 px-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="onboard-country" className="block text-xs font-medium text-slate-700">
                    Country <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="onboard-country"
                    value={country}
                    onChange={(e) => handleCountryChange(e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-slate-300 text-sm text-slate-900 bg-white focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  >
                    {COUNTRY_OPTIONS.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="onboard-currency" className="block text-xs font-medium text-slate-700">
                    Base Currency <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="onboard-currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-slate-300 text-sm text-slate-900 bg-white focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  >
                    {CURRENCY_OPTIONS.map((cur) => (
                      <option key={cur.code} value={cur.code}>
                        {cur.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="onboard-business-category" className="block text-xs font-semibold text-slate-900">Business type <span className="text-red-600">*</span></label>
              <p className="text-xs leading-5 text-slate-500">Choose the type that matches this business.</p>
              <select id="onboard-business-category" required value={businessCategory} onChange={(event) => setBusinessCategory(event.target.value as BusinessCategory)} className="w-full h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900">
                {BUSINESS_CATEGORY_OPTIONS.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
              </select>
            </div>

            <p className="text-xs text-slate-500">Choose your business type. Veyora will prepare the matching dashboard.</p>

            {/* Optional Business Contact Details */}
            <div className="space-y-4">
              <div className="text-xs font-semibold text-slate-900 border-b border-slate-200 pb-2.5">
                Contact details (optional)
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor="onboard-business-email" className="block text-xs font-medium text-slate-700">
                    Business Email
                  </label>
                  <input
                    id="onboard-business-email"
                    type="email"
                    value={businessEmail}
                    onChange={(e) => setBusinessEmail(e.target.value)}
                    placeholder="accounts@yourbusiness.com"
                    className="w-full h-10 px-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="onboard-business-phone" className="block text-xs font-medium text-slate-700">
                    Business Phone Number
                  </label>
                  <input
                    id="onboard-business-phone"
                    type="tel"
                    value={businessPhone}
                    onChange={(e) => setBusinessPhone(e.target.value)}
                    placeholder="+1 (555) 010-9900"
                    className="w-full h-10 px-3 rounded-md border border-slate-300 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  />
                </div>
              </div>
            </div>

            {errorMsg && (
              <div role="alert" className="text-xs px-3 py-2.5 rounded-md border border-red-200 bg-red-50 text-red-700">
                {errorMsg}
              </div>
            )}

            {successMsg && (
              <div
                role="status"
                className="flex items-center gap-2 text-xs px-3 py-2.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
                <span>{successMsg}</span>
              </div>
            )}

            </fieldset>

            <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
                <span>Your account will be assigned the Owner role with isolated tenant access.</span>
              </div>

              <button
                type="submit"
                disabled={isBlocked}
                aria-busy={submitting}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
              >
                {submitting && (
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
                )}
                <span>{submitting ? 'Creating Workspace...' : 'Create Business Workspace'}</span>
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
