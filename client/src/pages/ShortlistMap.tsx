import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MapView } from "@/components/Map";
import { trpc } from "@/lib/trpc";
import { MapPin } from "lucide-react";
import { useRef } from "react";

const TORONTO_CENTER = { lat: 43.6532, lng: -79.3832 };

export default function ShortlistMap() {
  const shortlist = trpc.dashboard.shortlist.useQuery({});
  const jobs = shortlist.data ?? [];
  const geocodedRef = useRef(new Set<string>());
  const hasApiKey = Boolean(import.meta.env.VITE_FRONTEND_FORGE_API_KEY);

  const onMapReady = (map: google.maps.Map) => {
    if (!window.google?.maps) return;
    const geocoder = new window.google.maps.Geocoder();
    const bounds = new window.google.maps.LatLngBounds();
    let plotted = 0;

    for (const item of jobs) {
      const key = `${item.job.location}|${item.job.employer}`;
      if (geocodedRef.current.has(key)) continue;
      geocodedRef.current.add(key);

      geocoder.geocode(
        { address: item.job.location, region: "ca" },
        (results, status) => {
          if (status !== "OK" || !results?.[0]) return;
          const position = results[0].geometry.location;
          new window.google!.maps.marker.AdvancedMarkerElement({
            map,
            position,
            title: `${item.job.title} — ${item.job.employer} (${item.scorecard.totalScore}/100)`,
          });
          bounds.extend(position);
          plotted += 1;
          if (plotted > 0) map.fitBounds(bounds);
        }
      );
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-7">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
          Shortlist map
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
          Today’s roles by location
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Plots today’s shortlisted roles across the Toronto/GTA search radius.
        </p>
      </header>

      {shortlist.isLoading ? (
        <Skeleton className="h-[500px] w-full rounded-2xl" />
      ) : !hasApiKey ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center text-sm text-muted-foreground">
            <MapPin className="h-8 w-8" />
            <p>
              Map view requires a configured maps API key (
              <code className="font-data">VITE_FRONTEND_FORGE_API_KEY</code>).
              Once it's set, this page plots every shortlisted job by location.
            </p>
          </CardContent>
        </Card>
      ) : jobs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center text-sm text-muted-foreground">
            No shortlisted roles today to plot.
          </CardContent>
        </Card>
      ) : (
        <>
          <MapView
            className="rounded-2xl border"
            initialCenter={TORONTO_CENTER}
            initialZoom={10}
            onMapReady={onMapReady}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {jobs.map(item => (
              <Badge
                key={item.entry.id}
                variant="outline"
                className="font-normal"
              >
                {item.job.title} · {item.job.location}
              </Badge>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
