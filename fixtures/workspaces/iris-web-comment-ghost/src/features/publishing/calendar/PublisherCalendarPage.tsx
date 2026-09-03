import { GenerateCampaignPanel } from '../campaigns/components/GenerateCampaignPanel';
import { PublisherCalendarHeader } from './components/PublisherCalendarHeader';

export function PublisherCalendarPage() {
  const handleGenerateCampaign = () => setPanelOpen(true);
  return (
    <div>
      <PublisherCalendarHeader onGenerateCampaign={handleGenerateCampaign} />
      <GenerateCampaignPanel open={panelOpen} />
    </div>
  );
}
