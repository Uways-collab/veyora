import { ArrowRight, BarChart3, Boxes, Check, ChevronRight, FileText, ShieldCheck, Sparkles, Users, Wallet } from 'lucide-react';
import { useState } from 'react';

const plans = [
  {
    name: 'Starter',
    description: 'The essentials to bring your daily operations together.',
    monthly: 5000,
    annual: 50000,
    users: '2 users',
    locations: '1 location',
    features: ['Inventory and stock tracking', 'Sales and purchase management', 'Supplier and customer records', 'Basic financial records', 'Standard business reports', '10 AI invoice scans per month'],
  },
  {
    name: 'Standard',
    description: 'More control and insight as your business grows.',
    monthly: 12000,
    annual: 120000,
    users: '5 users',
    locations: '3 locations',
    popular: true,
    features: ['Everything in Starter', 'Advanced inventory and receiving', 'Staff roles and permissions', 'Profit and margin analysis', '100 AI invoice scans per month', 'AI pricing recommendations', 'AI business insights'],
  },
  {
    name: 'Premium',
    description: 'Advanced visibility for established, growing teams.',
    monthly: 25000,
    annual: 250000,
    users: '15 users',
    locations: '10 locations',
    features: ['Everything in Standard', 'Advanced analytics and dashboards', 'Cash-flow insights and forecasting', 'Custom reports', '500 AI invoice scans per month', 'Advanced AI business analysis', 'Priority support and onboarding'],
  },
];

const formatNaira = (value: number) => '₦' + value.toLocaleString('en-NG');

function Brand() {
  return (
    <a href="/" className="inline-flex items-center gap-2.5" aria-label="Veyora home">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white shadow-lg shadow-slate-950/15">
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
          <path d="M4.5 6L12 19L19.5 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9.4 6L12 10.7L14.6 6" stroke="#7DD3FC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="font-display text-lg font-bold tracking-tight text-slate-950">veyora</span>
    </a>
  );
}

export function LandingPage() {
  const [annual, setAnnual] = useState(false);

  return (
    <div className="min-h-screen overflow-hidden bg-white text-slate-900">
      <header className="relative z-10 border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <Brand />
          <div className="hidden items-center gap-8 text-sm font-medium text-slate-600 md:flex">
            <a href="#platform" className="transition hover:text-slate-950">Platform</a>
            <a href="#features" className="transition hover:text-slate-950">Features</a>
            <a href="#pricing" className="transition hover:text-slate-950">Pricing</a>
          </div>
          <div className="flex items-center gap-3">
            <a href="/login" className="hidden rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 sm:inline-flex">Log in</a>
            <a href="/signup" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-950/15 transition hover:-translate-y-0.5 hover:bg-slate-800">
              Get started <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </nav>
      </header>

      <main>
        <section id="platform" className="relative isolate">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_15%_15%,rgba(186,230,253,0.55),transparent_40%),radial-gradient(ellipse_at_85%_35%,rgba(221,214,254,0.48),transparent_42%)]" />
          <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 py-20 sm:px-8 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16 lg:py-28">
            <div className="max-w-2xl">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/80 px-3.5 py-2 text-xs font-semibold text-sky-800 shadow-sm">
                <Sparkles className="h-3.5 w-3.5" /> One workspace. Clearer business decisions.
              </div>
              <h1 className="font-display text-4xl font-bold leading-[1.08] tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
                Run your business with <span className="text-sky-700">more clarity.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-8 text-slate-600 sm:text-lg">
                Bring inventory, sales, purchases, suppliers and financial visibility into one connected workspace—so your team can spend less time chasing records and more time moving forward.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <a href="/signup" className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-6 py-3.5 text-sm font-semibold text-white shadow-xl shadow-slate-950/15 transition hover:-translate-y-0.5 hover:bg-slate-800">
                  Create your workspace <ArrowRight className="h-4 w-4" />
                </a>
                <a href="#pricing" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white/80 px-6 py-3.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-white">
                  Explore plans <ChevronRight className="h-4 w-4" />
                </a>
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs font-medium text-slate-500">
                <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Organisation-level data protection</span>
                <span className="inline-flex items-center gap-2"><Check className="h-4 w-4 text-emerald-600" /> Built for growing teams</span>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-xl">
              <div className="absolute -inset-5 rounded-[2rem] bg-gradient-to-br from-sky-200/60 via-indigo-100/60 to-violet-200/60 blur-2xl" />
              <div className="relative rounded-[1.7rem] border border-white/80 bg-slate-950 p-3 shadow-2xl shadow-slate-900/20">
                <div className="overflow-hidden rounded-[1.2rem] bg-slate-50">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
                    <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-sky-600" /><span className="text-sm font-bold text-slate-900">Workspace overview</span></div>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">Live workspace</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 p-4 sm:p-5">
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="text-[11px] font-medium text-slate-500">Sales overview</div>
                      <div className="mt-2 text-2xl font-bold tracking-tight text-slate-950">₦2.84m</div>
                      <div className="mt-1 text-[10px] text-emerald-700">Illustrative dashboard</div>
                      <div className="mt-4 flex h-12 items-end gap-1.5">{[25,39,32,55,44,68,53,85,70,96].map((h,i)=><span key={i} className="flex-1 rounded-t bg-sky-500/80" style={{height:h+'%'}} />)}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="text-[11px] font-medium text-slate-500">Inventory health</div>
                      <div className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Healthy</div>
                      <div className="mt-1 text-[10px] text-slate-500">Illustrative status</div>
                      <div className="mt-4 flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-4/5 rounded-full bg-emerald-500" /></div><span className="text-xs font-semibold text-slate-600">80%</span></div>
                    </div>
                    <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-4">
                      <div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold text-slate-800">Connected operations</span><span className="text-[10px] text-slate-400">Platform preview</span></div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {[[Boxes,'Inventory'],[BarChart3,'Sales'],[FileText,'Purchases'],[Wallet,'Finance']].map(([Icon,label])=>{const ItemIcon=Icon as typeof Boxes;return <div key={label as string} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-3"><ItemIcon className="h-4 w-4 text-sky-700"/><span className="text-[11px] font-semibold text-slate-700">{label as string}</span></div>})}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 border-t border-slate-200 bg-white px-5 py-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50"><Sparkles className="h-4 w-4 text-violet-700" /></div>
                    <div><div className="text-xs font-semibold text-slate-800">AI-assisted workflows</div><div className="text-[10px] text-slate-500">Invoice capture and smarter business insights</div></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="border-y border-slate-200 bg-white py-20">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-700">A connected toolkit</p>
              <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">The moving parts of your business, working together.</h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">Keep essential operations connected, with access shaped around your organisation and each team member's role.</p>
            </div>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [Boxes,'Inventory control','Track products, variants and stock movements.'],
                [BarChart3,'Sales management','Keep sales records and customer activity organised.'],
                [FileText,'Purchases & receiving','Manage suppliers, purchases and goods received.'],
                [Wallet,'Financial visibility','Review expenses, reports and financial activity.'],
              ].map(([Icon,title,desc])=>{const FeatureIcon=Icon as typeof Boxes;return <article key={title as string} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-6 transition hover:-translate-y-1 hover:border-sky-200 hover:bg-white hover:shadow-xl hover:shadow-slate-900/5"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-sky-700 shadow-sm ring-1 ring-slate-200"><FeatureIcon className="h-5 w-5"/></div><h3 className="mt-5 font-display text-base font-bold text-slate-950">{title as string}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{desc as string}</p></article>})}
            </div>
          </div>
        </section>

        <section id="pricing" className="bg-slate-50 py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-700">Straightforward plans</p>
              <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Room to grow, at every stage.</h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">Start with the essentials and move up as your team and operations expand.</p>
              <div className="mt-7 inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                <button type="button" onClick={()=>setAnnual(false)} className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${!annual?'bg-slate-950 text-white':'text-slate-600 hover:bg-slate-100'}`}>Monthly</button>
                <button type="button" onClick={()=>setAnnual(true)} className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${annual?'bg-slate-950 text-white':'text-slate-600 hover:bg-slate-100'}`}>Yearly <span className="ml-1 text-emerald-500">Save up to 17%</span></button>
              </div>
            </div>
            <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-3">
              {plans.map((plan)=>(
                <article key={plan.name} className={`relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm sm:p-7 ${plan.popular?'border-sky-400 shadow-xl shadow-sky-900/10 ring-1 ring-sky-200':'border-slate-200'}`}>
                  {plan.popular&&<div className="absolute -top-3 left-6 rounded-full bg-sky-700 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white">Most popular</div>}
                  <h3 className="font-display text-xl font-bold text-slate-950">{plan.name}</h3>
                  <p className="mt-2 min-h-10 text-sm leading-6 text-slate-600">{plan.description}</p>
                  <div className="mt-6"><span className="font-display text-4xl font-bold tracking-tight text-slate-950">{formatNaira(annual?plan.annual:plan.monthly)}</span><span className="ml-1 text-xs text-slate-500">/{annual?'year':'month'}</span></div>
                  <div className="mt-4 flex gap-2 text-xs font-semibold text-slate-600"><span className="rounded-lg bg-slate-100 px-2.5 py-1.5"><Users className="mr-1 inline h-3.5 w-3.5"/>{plan.users}</span><span className="rounded-lg bg-slate-100 px-2.5 py-1.5">{plan.locations}</span></div>
                  <a href={`/signup?plan=${plan.name.toLowerCase()}`} className={`mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${plan.popular?'bg-sky-700 text-white hover:bg-sky-800':'bg-slate-950 text-white hover:bg-slate-800'}`}>Choose {plan.name} <ArrowRight className="h-4 w-4"/></a>
                  <div className="my-6 border-t border-slate-200"/>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Included features</p>
                  <ul className="mt-4 space-y-3">{plan.features.map((feature)=><li key={feature} className="flex items-start gap-2.5 text-sm text-slate-600"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"/><span>{feature}</span></li>)}</ul>
                </article>
              ))}
            </div>
            <p className="mx-auto mt-8 max-w-3xl text-center text-xs leading-6 text-slate-500">Pricing and feature allowances shown are the proposed launch packages. Subscription checkout and automatic plan enforcement are not activated yet; selecting a plan starts account registration.</p>
          </div>
        </section>

        <section className="bg-slate-950 py-16 text-white sm:py-20">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-5 sm:px-8 md:flex-row md:items-center">
            <div className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-300">Start with a clearer view</p><h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">Bring your business into one workspace.</h2><p className="mt-4 text-sm leading-7 text-slate-300">Create your account and take the first step towards more connected operations.</p></div>
            <a href="/signup" className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-bold text-slate-950 transition hover:-translate-y-0.5 hover:bg-sky-50">Get started <ArrowRight className="h-4 w-4"/></a>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-7 text-xs text-slate-500 sm:px-8 md:flex-row md:items-center md:justify-between"><Brand/><span>© {new Date().getFullYear()} Veyora. Business operations, made clearer.</span><div className="flex gap-5"><a href="/login" className="hover:text-slate-900">Log in</a><a href="#pricing" className="hover:text-slate-900">Pricing</a></div></div>
      </footer>
    </div>
  );
}
