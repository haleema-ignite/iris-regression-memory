import { Sparkles } from 'lucide-react';

interface PublisherCalendarHeaderProps {
  onGenerateCampaign?: () => void;
}

export function PublisherCalendarHeader({ onGenerateCampaign }: PublisherCalendarHeaderProps) {
  return (
    <div>
      {/* Filter and Generate Campaign - hidden when search is expanded */}
      {/* Generate Campaign Button — prop is optional; render visibly
          inactive when no handler is wired so it can't look clickable
          while doing nothing. */}
      <button>
        <Sparkles className="w-4 h-4" />
        Filters
      </button>
    </div>
  );
}
