import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link to="/" className="flex items-baseline gap-2">
          <span className="font-heading text-xl tracking-tight">Humanizer</span>
          <span className="eyebrow hidden sm:inline">voice &amp; rigor</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a href="/#how" className="transition-colors hover:text-foreground">
            How it works
          </a>
          <a href="/#styles" className="transition-colors hover:text-foreground">
            Voices
          </a>
          <a href="/#privacy" className="transition-colors hover:text-foreground">
            Privacy
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/editor">Open editor</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}