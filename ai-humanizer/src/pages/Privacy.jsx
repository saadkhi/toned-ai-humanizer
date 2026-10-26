import SiteHeader from '@/components/SiteHeader';

const SECTIONS = [
  {
    title: 'History stays in your browser',
    body: 'Your original text, rewrites, audit reports and preferences are saved in this browser’s local storage. There is no user account or cross-device sync. Anyone with access to this browser profile may be able to read that history. Clearing site data removes it.',
  },
  {
    title: 'AI processing',
    body: 'When you run a rewrite, your text, instructions and relevant job details are sent through this service’s API to the configured AI provider. Files are read on your device; their text is sent when you choose Rewrite. The provider’s retention and training policies apply. Do not submit information you are not permitted to share.',
  },
  {
    title: 'Retention and deletion',
    body: 'Choose no history, or a local retention window of 7, 30 or 90 days. With no history, the job remains in page memory only. Expired saved jobs are removed when you use the app; deletion does not run while the site is closed. Delete individual rewrites in History or all rewrites in Data & settings. This removes browser copies, not records retained by hosting or AI providers.',
  },
  {
    title: 'Server and provider data',
    body: 'The application does not use a server-side database for rewrite history and does not intentionally log document text or credentials. Hosting infrastructure and AI providers may retain request metadata or submitted content under their own policies. This application cannot guarantee deletion from those systems.',
  },
  {
    title: 'Request limits',
    body: 'Production request limits use a shared counter service. It receives a hashed network address identifier and request counters, not document text or raw network addresses. Counters expire at the end of the rate-limit window or day. The hosting service still receives your network address to handle requests.',
  },
  {
    title: 'Your controls',
    body: 'You can read, copy, download or delete your rewrites. Your browser is the only source of saved history, so keep a separate copy of anything you need. There is no account recovery for deleted or lost browser data.',
  },
];

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
        <p className="eyebrow">How your data is handled</p>
        <h1 className="mt-4 text-4xl">Privacy</h1>
        <div className="mt-10 space-y-8">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="text-lg">{section.title}</h2>
              <p className="mt-2 leading-relaxed text-muted-foreground">{section.body}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
