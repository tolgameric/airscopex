// api/opensky.js — Vercel Serverless Relay
export default async function handler(req, res) {
  // CORS izinleri
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { lamin, lomin, lamax, lomax } = req.query;
  const url = new URL("https://opensky-network.org/api/states/all");
  if (lamin) url.searchParams.set("lamin", lamin);
  if (lomin) url.searchParams.set("lomin", lomin);
  if (lamax) url.searchParams.set("lamax", lamax);
  if (lomax) url.searchParams.set("lomax", lomax);

  // Kullanıcı adı ve şifreyi Vercel Environment Variables’a ekleyeceksin
  const user = process.env.OPEN_SKY_USER;
  const pass = process.env.OPEN_SKY_PASS;
  const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

  try {
    const r = await fetch(url.toString(), { headers: { Authorization: auth } });
    const txt = await r.text();
    res.status(r.status).send(txt);
  } catch (e) {
    res.status(502).json({ error: "relay_failed", detail: String(e) });
  }
}
