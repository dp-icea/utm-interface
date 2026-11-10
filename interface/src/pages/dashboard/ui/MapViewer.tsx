import { Component } from "react";
import { Terrain, Ion } from "cesium";
import * as Cesium from "cesium";
import { Viewer, ImageryLayer } from "resium";
import { MapDataService } from "../lib/MapDataService";
import { AnalysisLayerRenderer } from "@/features/analysis";

export class MapViewer extends Component {
  render() {
    const ionAccessToken = import.meta.env.VITE_ION_ACCESS_TOKEN;
    if (ionAccessToken) {
      Ion.defaultAccessToken = ionAccessToken;
    } else {
      console.warn(
        "VITE_ION_ACCESS_TOKEN is not set. Using default Cesium Ion access token.",
      );
    }

    return (
      <div className="absolute inset-0">
        <Viewer
          terrain={Terrain.fromWorldTerrain()}
          selectionIndicator={false}
          infoBox={true}
          animation={false}
          timeline={false}
          homeButton={false}
          fullscreenButton={false}
          navigationHelpButton={false}
          vrButton={false}
          sceneModePicker={false}
          baseLayerPicker={false}
          style={{ width: "100%", height: "100%" }}
          imageryProvider={false}
        >
          <MapDataService />
          <AnalysisLayerRenderer />
          <ImageryLayer
            imageryProvider={
              new Cesium.OpenStreetMapImageryProvider({
                // url: "https://a.tile.openstreetmap.org",
                // url: "https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/",
                // url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
                url: "https://a.tile.openstreetmap.fr/hot/",
              })
            }
            show={true}
          />
          {/*<Cesium3DTileset url={IonResource.fromAssetId(96188)} />*/}
        </Viewer>
      </div>
    );
  }
}
