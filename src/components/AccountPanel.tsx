import AnnouncementSpotlight from "@/components/AnnouncementSpotlight";
import UnitSidebar from "@/components/UnitSidebar";

export function AccountPanel() {
  return (
    <div className="hidden min-h-0 min-w-0 flex-col gap-4 lg:flex">
      <UnitSidebar variant="inline" showUnitsPanel={false} rightClassName="w-full" />
      <div className="w-full min-w-0">
        <AnnouncementSpotlight />
      </div>
    </div>
  );
}
