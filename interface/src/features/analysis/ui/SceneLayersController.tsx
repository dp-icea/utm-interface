import { useEffect } from "react";
import { useCesium } from "resium";
import * as Cesium from "cesium";
import { useToast } from "@/shared/lib/hook";
import { useAnalysis } from "../model/use-analysis";

/**
 * Adds the selected 3D layer (OSM Buildings or Google Photorealistic 3D Tiles)
 * on top of the terrain. Must be rendered inside <Viewer>.
 */
export const SceneLayersController = () => {
  const { viewer } = useCesium();
  const { baseScene, setBaseScene } = useAnalysis();
  const { toast } = useToast();

  useEffect(() => {
    if (!viewer || baseScene === "terrain") return;
    const v = viewer as Cesium.Viewer;
    let tileset: Cesium.Cesium3DTileset | undefined;
    let cancelled = false;
    const widget = v.cesiumWidget;
    const creditContainer = widget.creditContainer as HTMLElement;
    const creditsWereAttached = creditContainer.isConnected;

    const load = async () => {
      try {
        tileset =
          baseScene === "google"
            ? await Cesium.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true })
            : await Cesium.createOsmBuildingsAsync();
        if (cancelled || v.isDestroyed()) {
          tileset.destroy();
          return;
        }
        v.scene.primitives.add(tileset);
        if (baseScene === "google") {
          // Google tiles replace the globe; hide it to avoid z-fighting.
          v.scene.globe.show = false;
          // Google's terms require their attribution to stay visible.
          if (!creditsWereAttached) widget.container.appendChild(creditContainer);
        }
      } catch (e) {
        if (cancelled) return;
        console.error("Failed to load 3D layer", e);
        toast({
          title: baseScene === "google" ? "Google 3D Tiles unavailable" : "OSM Buildings unavailable",
          description: "Check that the Cesium Ion token has access to this asset.",
          variant: "destructive",
        });
        setBaseScene("terrain");
      }
    };
    load();

    return () => {
      cancelled = true;
      if (v.isDestroyed()) return;
      if (tileset) v.scene.primitives.remove(tileset); // also destroys it
      v.scene.globe.show = true;
      if (!creditsWereAttached && creditContainer.isConnected) creditContainer.remove();
    };
  }, [viewer, baseScene, setBaseScene, toast]);

  return null;
};
