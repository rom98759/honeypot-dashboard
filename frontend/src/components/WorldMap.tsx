import { memo, useState } from "react";
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps";
import { useTheme } from "../theme/ThemeContext";
import { chartTheme, countryFill, PRIMARY } from "../theme/chartTheme";
import { ISO3_TO_ISO2 } from "../utils/isoCountries";
import { countryLabel, formatNumber } from "../utils/format";
import type { CountryCount } from "../api/types";

const MAP_FILE = "/world.json";

interface Tip {
  x: number;
  y: number;
  text: string;
}

// Port of Umami's WorldMap: Mercator choropleth, empty countries in the neutral fill, every
// border in the primary blue, shade by share of the total.
export const WorldMap = memo(function WorldMap({
  countries,
  onCountryClick,
}: {
  countries: CountryCount[];
  onCountryClick?: (country: CountryCount) => void;
}) {
  const [theme] = useTheme();
  const colors = chartTheme(theme);
  const [tip, setTip] = useState<Tip | null>(null);

  const total = countries.reduce((sum, c) => sum + c.n, 0);
  const byCode = new Map(countries.filter((c) => c.country_code).map((c) => [c.country_code!, c]));

  return (
    <div className="world-map" onMouseLeave={() => setTip(null)}>
      <ComposableMap projection="geoMercator" width={800} height={500}>
        <ZoomableGroup zoom={0.8} minZoom={0.7} center={[0, 40]}>
          <Geographies geography={MAP_FILE}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const code = ISO3_TO_ISO2[geo.id as string];
                if (code === "AQ") return null;
                const country = code ? byCode.get(code) : undefined;
                const fill = country ? countryFill(total ? (country.n / total) * 100 : 0, theme) : colors.fill;
                const name = countryLabel(code, (geo.properties as { name?: string })?.name);
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke={PRIMARY}
                    strokeWidth={0.5}
                    style={{
                      default: { outline: "none" },
                      hover: { outline: "none", fill: PRIMARY, cursor: country && onCountryClick ? "pointer" : "default" },
                      pressed: { outline: "none" },
                    }}
                    onMouseMove={(e) =>
                      setTip({ x: e.clientX, y: e.clientY, text: `${name} : ${formatNumber(country?.n ?? 0)} sessions` })
                    }
                    onMouseLeave={() => setTip(null)}
                    onClick={() => country && onCountryClick?.(country)}
                  />
                );
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>
      {tip && (
        <div className="map-tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
    </div>
  );
});
