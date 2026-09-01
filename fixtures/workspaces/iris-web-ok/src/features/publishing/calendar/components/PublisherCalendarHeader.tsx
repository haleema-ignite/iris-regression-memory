export function PublisherCalendarHeader({ onGenerateCampaign }: { onGenerateCampaign?: () => void }) {
  return (
    <button onClick={() => onGenerateCampaign?.()}>
      Generate Campaign
    </button>
  );
}
