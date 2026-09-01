import { GenerateCampaignPanel } from "../campaigns/components/GenerateCampaignPanel";
import { PublisherCalendarHeader } from "./components/PublisherCalendarHeader";

export function PublisherCalendarPage() {
  return (
    <>
      <PublisherCalendarHeader onGenerateCampaign={() => undefined} />
      <GenerateCampaignPanel />
    </>
  );
}
