// XroMax Code: «Повседневный режим» — ИИ как помощник в быту: находит нужные товары в магазинах рядом (по геолокации устройства)
// и предлагает забрать их или забронировать. Все действия с покупкой/бронью — только после подтверждения пользователя.
// Местоположение берётся средствами Windows (после явного разрешения); наружу, к модели, идут координаты, округлённые до ~1 км.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const UA = "XroMaxCode/1.0 (everyday-mode; contact: xromax-ai.defhosting.com)";
let last = null; // { lat, lon, acc, at }

const PS = `Add-Type -AssemblyName System.Device
$w = New-Object System.Device.Location.GeoCoordinateWatcher([System.Device.Location.GeoPositionAccuracy]::Default)
$w.Start()
for ($i = 0; $i -lt 40 -and $w.Status -ne 'Ready'; $i++) { Start-Sleep -Milliseconds 250 }
$l = $w.Position.Location
if ($l.IsUnknown) { 'unknown' } else { "{0},{1},{2}" -f $l.Latitude, $l.Longitude, $l.HorizontalAccuracy }
$w.Stop()`;

/** Определить местоположение средствами Windows (нужна включённая служба «Расположение»). Точные координаты остаются в приложении. */
function readLocation() {
  return new Promise((resolve) => {
    if (last && Date.now() - last.at < 5 * 60_000) return resolve(last);
    const file = path.join(os.tmpdir(), "xc-geo-" + process.pid + ".ps1");
    fs.writeFileSync(file, PS, "utf8");
    let out = "";
    const c = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], { windowsHide: true });
    const t = setTimeout(() => c.kill(), 20_000);
    c.stdout.on("data", (b) => (out += b));
    c.on("close", () => {
      clearTimeout(t);
      try {
        fs.unlinkSync(file);
      } catch {}
      const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)/m.exec(out.replace(/,/g, ".").replace(/(\d)\.(\d+)\.(\d+)\.(\d+)/, "$1.$2,$3.$4") && out);
      // PowerShell может писать десятичные с запятой в русской локали: «48,5177,34,57,55» — разбираем строго по трём числам
      const nums = out.trim().split(/\r?\n/).pop().match(/-?\d+(?:[.,]\d+)?/g);
      if (!nums || nums.length < 3 || /unknown/i.test(out)) return resolve(null);
      const clean = nums.map((x) => Number(x.replace(",", ".")));
      // русская локаль: 6 «чисел» (две части на каждое) — склеиваем
      const [lat, lon, acc] = nums.length >= 6 ? [Number(nums[0] + "." + nums[1]), Number(nums[2] + "." + nums[3]), Number(nums[4])] : clean;
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return resolve(null);
      last = { lat, lon, acc, at: Date.now() };
      resolve(last);
    });
  });
}

const round2 = (n) => Math.round(n * 100) / 100; // ~1 км
async function reverse(lat, lon) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=ru&lat=${lat}&lon=${lon}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) });
    const j = await r.json();
    const a = j.address || {};
    return [a.city || a.town || a.village || a.municipality, a.suburb || a.city_district, a.state, a.country].filter(Boolean).join(", ");
  } catch {
    return "";
  }
}

/** Инструмент get_location: примерное место (округлённые координаты и район), без точных координат */
async function getLocationTool(consent) {
  if (!(await consent())) return "The user did not allow access to the location. Ask them to allow it in Settings or name their city/area in the chat.";
  const p = await readLocation();
  if (!p) return "Location is unavailable: Windows Location service is off or has no position. Ask the user to turn on Settings → Privacy → Location, or to name their city or area.";
  const area = await reverse(round2(p.lat), round2(p.lon));
  return `Approximate location (rounded to ~1 km): lat ${round2(p.lat)}, lon ${round2(p.lon)}${area ? ` — ${area}` : ""}. Accuracy about ${Math.round(p.acc)} m.`;
}

const dist = (a, b) => {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

/** Инструмент find_places: магазины/аптеки/кафе рядом по запросу (OpenStreetMap), отсортированы по расстоянию */
async function findPlacesTool(args, consent) {
  if (!(await consent())) return "The user did not allow access to the location.";
  const p = await readLocation();
  if (!p) return "Location is unavailable (Windows Location is off). Ask the user to enable it or name their area.";
  const q = String(args.query || "").trim();
  if (!q) return "Give a query: a store type or brand, e.g. \"аптека\", \"pharmacy\", \"электроника\", \"Фора\".";
  const radius = Math.min(Math.max(Number(args.radius_m) || 3000, 300), 20000);
  const dLat = radius / 111_000;
  const dLon = radius / (111_000 * Math.cos((p.lat * Math.PI) / 180));
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=15&bounded=1&extratags=1&addressdetails=1&accept-language=ru&q=${encodeURIComponent(q)}&viewbox=${p.lon - dLon},${p.lat + dLat},${p.lon + dLon},${p.lat - dLat}`;
  let list;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
    list = await r.json();
  } catch (e) {
    return "Place search failed: " + String(e.message || e).slice(0, 100);
  }
  if (!Array.isArray(list) || !list.length) return `Nothing found for "${q}" within ${radius} m. Try another word (a category like "supermarket", "pharmacy", or a brand) or a bigger radius_m.`;
  const rows = list
    .map((x) => ({ x, d: dist(p, { lat: Number(x.lat), lon: Number(x.lon) }) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 8)
    .map(({ x, d }, i) => {
      const t = x.extratags || {};
      const addr = x.address || {};
      const street = [addr.road, addr.house_number].filter(Boolean).join(" ");
      return `${i + 1}. ${x.name || x.display_name.split(",")[0]} — ${d < 1000 ? d + " m" : (d / 1000).toFixed(1) + " km"}${street ? `, ${street}` : ""}` +
        `${t.opening_hours ? `; hours: ${t.opening_hours}` : ""}${t.phone || t["contact:phone"] ? `; phone: ${t.phone || t["contact:phone"]}` : ""}${t.website || t["contact:website"] ? `; site: ${t.website || t["contact:website"]}` : ""}` +
        ` [id ${x.osm_type}/${x.osm_id}; at ${Number(x.lat).toFixed(5)},${Number(x.lon).toFixed(5)}]`;
    });
  return `Places near the user for "${q}" (OpenStreetMap data — availability and prices are NOT known; confirm with the store):\n` + rows.join("\n");
}

/** Ссылка на маршрут до точки (OpenStreetMap) от текущего положения */
function routeUrl(toLat, toLon) {
  const from = last ? `${last.lat},${last.lon}` : "";
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${from};${toLat},${toLon}`;
}

module.exports = { getLocationTool, findPlacesTool, routeUrl, round2 };
