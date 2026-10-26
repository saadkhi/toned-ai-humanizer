import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function Hero() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-12 pt-16 sm:px-6 sm:pt-24">
      <p className="eyebrow">A voice-and-rigor editor</p>
      <h1 className="mt-5 max-w-3xl text-4xl leading-[1.05] sm:text-6xl">
        Write like yourself.
        <br />
        Stay true to your meaning.
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
        Humanizer rewrites rushed or machine-flavoured prose into natural writing in the voice you
        choose — then checks claims, numbers, names and citations against your original to help you spot changes in meaning.
      </p>
      <div className="mt-9 flex flex-wrap items-center gap-3">
        <Button asChild size="lg">
          <Link to="/editor">
            Start rewriting
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <a href="#how">See the five stages</a>
        </Button>
      </div>
      <p className="mt-6 max-w-xl text-sm text-muted-foreground">
        Voice and rigor — never evasion. Humanizer does not report, predict or promise a detector
        score, and it declines requests meant to mislead an assessor.
      </p>
    </section>
  );
}