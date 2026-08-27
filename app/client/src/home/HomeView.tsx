/**
 * Home / landing page.
 *
 * Template concern: this is where you tell the STORY of the use case.
 * The narrative pieces (hero persona, headline, situation, goal, journey
 * diagram quotes, starter prompts, featured action) are hardcoded in this
 * file as an EXAMPLE — rewrite them for your demo. Only `assistantScript`
 * and `branding` stay config-driven (script chain is reused by the chat
 * dock; branding is also read by the shell header).
 *
 * The journey diagram's 4 cards wire into the floating chat dock via
 * `dockController` (pub/sub in `chat/dockController.ts`) — clicking a card
 * either navigates somewhere, opens the dock, or opens the dock and
 * auto-sends a scripted prompt. That's the "see the demo in action" path.
 */
import { Fragment, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  Eye,
  Mail,
  MessageCircleQuestion,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react';
import { useSession, type ScriptStep } from '@/lib/api';
import { fetchActivity } from '@/lib/lines';
import type { ActivityEvent } from '@/shared/types';
import { dataMutated } from '@/lib/events';
import { dockController } from '@/chat/dockController';
import { AgentLoopFlow } from '@/architecture/AgentLoopFlow';

// ---------------------------------------------------------------------------
// Narrative — REPLACE for your demo.
// This is what the landing page shows. Hero persona, headline, situation,
// starter prompts, and the "featured action" are the story hooks that tell
// the viewer what this app does. Rewrite these to match your use case.
// ---------------------------------------------------------------------------

const HERO = {
  name: 'Sam Ortiz',
  role: 'VP Manufacturing Operations',
};

const STORY = {
  headline: 'Lines are trending toward a stop.',
  situation:
    'A 3-week high-utilization run wore ~90 production lines toward failure. Rising vibration, climbing temperature, and open work orders. About $3.3M downtime at risk across 8 plants, ~150 open corrective work orders. Each unplanned stop costs $22K per hour.',
  goal: 'Find the lines heading for a stop, rank the maintenance action that avoids the most downtime cost, and approve it in one conversation.',
};

const STARTER_QUESTIONS = [
  'Which lines are trending toward a stop?',
  'Why is LINE-04 heading for a breakdown?',
  'Should we pull LINE-04 now or run it to the end of the shift?',
];

// The featured action's copy is inlined in the JSX below — the section is just
// HTML, edit it freely. The prompt text is the single thing the agent runs.
const FEATURED_ACTION_PROMPT =
  'Recommend an action for LINE-04 — rank pull now vs run to shift end vs expedite parts and run. Show me the downtime cost each action avoids, the cost of the action itself, and the net value. Explain which one wins and why. Draft the work order. Wait for my approval.';

export function HomeView() {
  const { config, configError, retry: retrySession } = useSession();
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    // Activity feed errors are non-fatal (feed silently empty). Logged for
    // dev debugging; the page still renders the story without it.
    const reload = () =>
      fetchActivity(20).then(setActivity).catch((e) => {
        console.error('[home] activity feed failed', e);
      });
    void reload();
    return dataMutated.subscribe(reload);
  }, []);

  if (configError) {
    return (
      <div className="p-12 max-w-xl text-sm">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-destructive flex items-start gap-3">
          <AlertTriangle className="size-5 mt-0.5 shrink-0" />
          <div className="space-y-2">
            <div className="font-semibold">Couldn't load app config</div>
            <div className="text-destructive/80">{configError}</div>
            <button
              type="button"
              onClick={retrySession}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs hover:bg-destructive/15 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!config) {
    return <div className="p-12 text-muted-foreground">Loading…</div>;
  }

  const heroFirstName = HERO.name.split(/\s+/)[0];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-14 space-y-5 sm:space-y-7">
        {/* Hero */}
        <section className="space-y-5">
          <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <span className="inline-block h-px w-8 bg-foreground/40" />
            {HERO.name} · {HERO.role}
          </div>
          <h1 className="display text-3xl sm:text-5xl lg:text-6xl font-semibold leading-[1.05] tracking-tight text-foreground">
            {STORY.headline}
          </h1>
          <p className="hidden sm:block text-lg text-muted-foreground leading-relaxed max-w-3xl">
            {STORY.situation}
          </p>
          <p
            className="inline-block text-sm text-foreground italic border-l-2 pl-3 py-0.5 max-w-3xl"
            style={{ borderColor: 'var(--accent)' }}
          >
            <span className="font-semibold not-italic uppercase tracking-[0.15em] text-xs text-muted-foreground mr-2">
              Goal
            </span>
            {STORY.goal}
          </p>
        </section>

        {/* Persona journey diagram */}
        <section className="space-y-5">
          <div className="hidden sm:block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            A week of work · before noon
          </div>
          <JourneyDiagram heroName={heroFirstName} script={config.assistantScript} />

          <AgentLoopFlow />
        </section>

        {/* Starter prompts — each opens the floating assistant dock */}
        <section className="space-y-3">
          <div className="hidden sm:block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Try asking
          </div>
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
            {STARTER_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => dockController.newAndSend(q)}
                className="flex w-full sm:w-auto sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground hover:border-foreground/30 hover:shadow-sm transition-all"
              >
                <Sparkles className="size-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 text-left sm:flex-none">{q}</span>
                <ArrowRight className="size-3.5 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        </section>

        {/* Featured action — climax. Inline the copy; edit this HTML freely. */}
        <section>
          <div
            className="rounded-2xl p-7 relative overflow-hidden"
            style={{
              background:
                'linear-gradient(135deg, #E5484D 0%, #FFB020 100%)',
              color: 'white',
            }}
          >
            <div
              className="absolute -right-16 -top-16 size-52 rounded-full opacity-20"
              style={{ background: '#0A0F1C' }}
            />
            <div className="relative">
              <div className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] opacity-90 mb-3">
                <Zap className="size-3.5" />
                Let the assistant rank it
              </div>
              <h3 className="display text-2xl font-semibold mb-2 leading-tight">
                Rank the maintenance action for LINE-04 — pull now vs run to shift end vs expedite
              </h3>
              <p className="hidden sm:block text-sm opacity-90 leading-relaxed mb-5 max-w-2xl">
                The assistant investigates LINE-04's failure risk trend via
                Genie, reads the live Lakebase status and parts context, then
                ranks the three plays against the downtime cost each would
                avoid. It explains which action wins and why. It drafts the
                work order and stops for your approval. Once you say yes, it
                writes to Lakebase and the KPIs tick live.
              </p>
              <p className="sm:hidden text-sm opacity-90 leading-relaxed mb-5">
                Investigate the line's trend, rank the actions by downtime
                avoided, draft the work order — approve before executing.
              </p>
              <button
                onClick={() => dockController.newAndSend(FEATURED_ACTION_PROMPT)}
                className="inline-flex items-center gap-2 rounded-full bg-white text-foreground px-5 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Run this <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        </section>

        {/* Proof — activity feed */}
        {activity.length > 0 && (
          <section className="space-y-4">
            <div className="hidden sm:block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Recent activity
            </div>
            <ActivityFeed
              events={activity}
              onJumpToLine={(id) => navigate(`/operations?line=${id}`)}
            />
          </section>
        )}
      </div>
    </div>
  );
}

// --- Journey diagram -------------------------------------------------------

/**
 * Four-step narrative. Each step is clickable and fires the demo:
 *   - "Claire operates"    → navigate to Operations page
 *   - "She asks"           → open dock, auto-send "Why so many returns?"
 *   - "AI investigates"    → open dock (shows the investigation in progress)
 *   - "AI takes action"    → open dock, auto-send the final "send it" prompt
 *
 * `script` comes from config — the handlers pull the matching prompts.
 */
function JourneyDiagram({
  heroName,
  script,
}: {
  heroName: string;
  script: ScriptStep[];
}) {
  const navigate = useNavigate();
  const step0 = script[0];
  const step1 = script[1];
  const step2 = script[2];

  const steps = [
    {
      icon: <Eye className="size-5" />,
      role: `${heroName} sees it`,
      quote: '"Lines are trending to a stop."',
      highlight: false,
      onClick: () => navigate('/operations'),
    },
    {
      icon: <MessageCircleQuestion className="size-5" />,
      role: 'She asks',
      quote: '"Why is LINE-04 heading for a breakdown?"',
      highlight: false,
      onClick: () =>
        step0
          ? dockController.newAndSend(step0.prompt)
          : dockController.open(),
    },
    {
      icon: <Brain className="size-5" />,
      role: 'AI investigates',
      quote: '"Vibration climbing 3 weeks. Part not local. $76K downtime if unplanned."',
      highlight: true,
      onClick: () => dockController.open(),
    },
    {
      icon: <Wrench className="size-5" />,
      role: 'AI ranks action',
      quote: '"Pull now avoids $76K. Run to shift end risks the full stop. Expedite barely breaks even."',
      highlight: true,
      onClick: () => {
        // Fire step-1 (rank + draft). If user is mid-chain the dock will
        // still open; they can then click "Yes — approve" from the chip.
        if (step1) dockController.openAndSend(step1.prompt);
        else if (step2) dockController.openAndSend(step2.prompt);
        else dockController.open();
      },
    },
  ];

  return (
    <>
      {/* Desktop / tablet: 4 cards in a row with arrows between. */}
      <div className="hidden md:grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] gap-3 items-stretch">
        {steps.map((s, i) => (
          <Fragment key={i}>
            <button
              onClick={s.onClick}
              className={`text-left rounded-xl px-4 py-4 flex flex-col gap-2 transition-all hover:shadow-sm ${stepCardClass(s.highlight)}`}
              style={stepCardStyle(s.highlight)}
            >
              <StepIcon step={s} size="sm" />
              <StepText step={s} />
            </button>
            {i < steps.length - 1 && (
              <div className="flex items-center justify-center text-muted-foreground">
                <ArrowRight className="size-4" />
              </div>
            )}
          </Fragment>
        ))}
      </div>

      {/* Phone: vertical rail of icons on the left (sequential-flow cue),
          card per step on the right. */}
      <ol className="md:hidden relative flex flex-col gap-2.5">
        {/* Vertical rail behind the icon column — starts just under
            step-1's icon and ends just above step-N's. */}
        <div
          aria-hidden
          className="absolute left-[18px] top-7 bottom-7 w-px bg-border"
        />
        {steps.map((s, i) => (
          <li key={i} className="relative flex items-start gap-3">
            <StepIcon step={s} size="md" className="relative z-10 shrink-0 mt-1" />
            <button
              onClick={s.onClick}
              className={`flex-1 min-w-0 text-left rounded-xl px-3 py-2.5 transition-all hover:shadow-sm ${stepCardClass(s.highlight)}`}
              style={stepCardStyle(s.highlight)}
            >
              <StepText step={s} compact />
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

// --- Journey step primitives ------------------------------------------------
// Shared between the desktop grid + the mobile rail. Owning the highlight
// styling here means a tweak to "what does highlighted look like" lands
// in one place instead of two.

type JourneyStep = {
  icon: React.ReactNode;
  role: string;
  quote: string;
  highlight: boolean;
  onClick: () => void;
};

function stepCardClass(highlight: boolean): string {
  return highlight
    ? 'border-2 bg-card'
    : 'border border-border bg-card hover:border-foreground/30';
}

function stepCardStyle(highlight: boolean): React.CSSProperties | undefined {
  return highlight ? { borderColor: 'var(--accent)' } : undefined;
}

function StepIcon({
  step,
  size,
  className = '',
}: {
  step: JourneyStep;
  size: 'sm' | 'md';
  className?: string;
}) {
  // Literal Tailwind classes so the JIT picks them up at build time.
  const sizeClass = size === 'sm' ? 'size-8' : 'size-9';
  return (
    <div
      className={`${sizeClass} rounded-lg flex items-center justify-center ${className}`}
      style={{
        background: step.highlight ? 'var(--accent)' : 'var(--muted)',
        color: step.highlight ? 'var(--accent-foreground)' : 'var(--foreground)',
      }}
    >
      {step.icon}
    </div>
  );
}

function StepText({ step, compact = false }: { step: JourneyStep; compact?: boolean }) {
  return (
    <>
      <div
        className={`text-sm font-semibold text-foreground ${compact ? 'leading-tight' : ''}`}
      >
        {step.role}
      </div>
      <div
        className={`text-xs text-muted-foreground leading-snug italic ${compact ? 'mt-0.5' : ''}`}
      >
        {step.quote}
      </div>
    </>
  );
}

// --- Activity feed ---------------------------------------------------------

function ActivityFeed({
  events,
  onJumpToLine,
}: {
  events: ActivityEvent[];
  onJumpToLine: (lineId: string) => void;
}) {
  return (
    <ul className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
      {events.map((e, i) => (
        <li
          key={i}
          className="px-4 py-3 flex items-start gap-3 text-sm"
        >
          <ActivityIcon kind={e.kind} />
          <div className="flex-1 min-w-0">
            <ActivityBody event={e} onJumpToLine={onJumpToLine} />
          </div>
          <div className="text-xs text-muted-foreground shrink-0">
            {relativeTime(e.at)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ActivityIcon({ kind }: { kind: ActivityEvent['kind'] }) {
  const Icon = kind === 'work_order' ? CheckCircle2 : AlertTriangle;
  const bg =
    kind === 'work_order'
      ? 'bg-[var(--success-subtle)] text-[var(--success-subtle-foreground)]'
      : 'bg-[var(--warning-subtle)] text-[var(--warning-subtle-foreground)]';
  return (
    <div
      className={`size-7 rounded-full flex items-center justify-center shrink-0 ${bg}`}
    >
      <Icon className="size-3.5" />
    </div>
  );
}

function ActivityBody({
  event,
  onJumpToLine,
}: {
  event: ActivityEvent;
  onJumpToLine: (lineId: string) => void;
}) {
  if (event.kind === 'work_order') {
    return (
      <>
        <div className="text-foreground truncate">
          <span className="font-medium capitalize">{event.action.replace(/_/g, ' ')}</span>{' '}
          on <span className="font-mono text-xs">{event.line_id}</span>:{' '}
          <span className="text-muted-foreground">
            ${(event.downtime_avoided_usd / 1000).toFixed(1)}K downtime avoided
          </span>
        </div>
        <button
          onClick={() => onJumpToLine(event.line_id)}
          className="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          View line →
        </button>
      </>
    );
  }
  return (
    <>
      <div className="text-foreground">
        <span className="font-medium capitalize">{event.action}</span>
        {event.notes && (
          <span className="text-muted-foreground"> · {event.notes}</span>
        )}
        <span className="text-xs text-muted-foreground ml-2">by {event.by}</span>
      </div>
      <button
        onClick={() => onJumpToLine(event.line_id)}
        className="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
      >
        View line →
      </button>
    </>
  );
}

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(1, Math.round((now - d) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
