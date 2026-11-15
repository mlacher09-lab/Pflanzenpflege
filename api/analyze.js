// Server-Funktion für Pflanzenerkennung und Gesundheitscheck.
// Läuft als Vercel Serverless Function (Ordner /api) oder lokal über dev-server.js.
// Der API-Schlüssel kommt ausschließlich aus der Umgebungsvariable ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';
import { timingSafeEqual } from 'node:crypto';
import { PLANT_DB } from '../js/plants-db.js';

// Erkennung: günstiges Haiku; Gesundheitscheck: Sonnet. ANTHROPIC_MODEL überschreibt beide gemeinsam.
const MODEL_IDENTIFY = process.env.ANTHROPIC_MODEL_IDENTIFY || process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const MODEL_DIAGNOSE = process.env.ANTHROPIC_MODEL_DIAGNOSE || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const DB_KEYS = Object.keys(PLANT_DB);
const DB_LIST = DB_KEYS.map(k => `${k} (${PLANT_DB[k].sci})`).join('; ');

const IDENTIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_plant', 'candidates', 'health', 'note'],
  properties: {
    is_plant: { type: 'boolean', description: 'true, wenn auf dem Foto eine Pflanze erkennbar ist' },
    candidates: {
      type: 'array',
      description: 'Bis zu 3 wahrscheinlichste Arten, absteigend nach Wahrscheinlichkeit',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name_de', 'sci', 'confidence', 'dbKey'],
        properties: {
          name_de: { type: 'string', description: 'Gebräuchlicher deutscher Name' },
          sci: { type: 'string', description: 'Wissenschaftlicher Name (Gattung Art)' },
          confidence: { type: 'number', description: 'Wahrscheinlichkeit 0–1' },
          dbKey: { type: ['string', 'null'], description: 'Exakter Schlüssel aus der Pflegedatenbank oder null, wenn keiner passt' },
        },
      },
    },
    health: { type: 'string', description: 'Kurze Einschätzung des sichtbaren Zustands in 1–3 Sätzen (Markdown erlaubt), leer wenn nicht beurteilbar' },
    note: { type: 'string', description: 'Hinweis, falls keine Pflanze erkennbar ist oder das Foto ungeeignet ist; sonst leer' },
  },
};

function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function setCors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim());
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0]));
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-token');
  res.setHeader('Vary', 'Origin');
}
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > MAX_IMAGE_BYTES * 1.4) throw new Error('Anfrage zu groß'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function parseDataURL(dataURL) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/s.exec(dataURL || '');
  if (!m) throw new Error('Bild muss als Data-URL (JPEG/PNG/WebP) gesendet werden');
  const data = m[2].replace(/\s+/g, '');
  if (data.length * 0.75 > MAX_IMAGE_BYTES) throw new Error('Bild ist zu groß (max. 4 MB)');
  return { media_type: m[1], data };
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const configured = !!process.env.ANTHROPIC_API_KEY;
  // Leerzeichen/Zeilenumbrüche am Rand (z. B. beim Eintragen in Vercel) nicht als Fehler werten
  const appToken = (process.env.APP_TOKEN || '').trim();
  const tokenRequired = !!appToken;
  const tokenOk = !tokenRequired || safeEqual(String(req.headers['x-app-token'] || '').trim(), appToken);
  if (req.method === 'GET') return send(res, 200, { ok: true, configured, tokenRequired, tokenOk, provider: configured ? 'Claude' : null, model: configured && tokenOk ? MODEL_IDENTIFY : null, models: configured && tokenOk ? { identify: MODEL_IDENTIFY, diagnose: MODEL_DIAGNOSE } : null });
  if (req.method !== 'POST') return send(res, 405, { error: 'Methode nicht erlaubt' });

  if (!tokenOk) return send(res, 401, { error: 'Zugangscode fehlt oder ist falsch' });
  if (!configured) return send(res, 503, { error: 'ANTHROPIC_API_KEY ist auf dem Server nicht gesetzt' });

  let body;
  try { body = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const { mode, image, context = {} } = body || {};
  if (!['identify', 'diagnose'].includes(mode)) return send(res, 400, { error: 'mode muss identify oder diagnose sein' });
  let img;
  try { img = parseDataURL(image); } catch (e) { return send(res, 400, { error: e.message }); }

  const client = new Anthropic();
  const imageBlock = { type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } };

  try {
    if (mode === 'identify') {
      const system = `Du bist Botaniker mit Schwerpunkt Zimmer- und Balkonpflanzen. Bestimme die Pflanze auf dem Foto so präzise wie möglich und antworte auf Deutsch.
Pflegedatenbank (deutscher Name (wissenschaftlicher Name)): ${DB_LIST}.
Setze dbKey auf den exakten deutschen Datenbank-Schlüssel, wenn Art oder Gattung dort enthalten ist (z. B. Ficus elastica → "Gummibaum", jede Calathea → "Korbmarante", Sansevieria → "Bogenhanf"). Sonst null.
Gib confidence ehrlich an: 0.9+ nur bei eindeutigen Merkmalen. Beschreibe in health kurz den sichtbaren Zustand (Blattfarbe, Schäden, Schädlinge, Über-/Unterwässerung), ohne zu spekulieren.`;
      // Haiku 5.5 hat keinen serverseitigen Fallback (fallbacks/Beta würden dort nichts bewirken bzw. 400 liefern);
      // eine Ablehnung wird unten als 422 gemeldet. Der System-Block ist >512 Token und damit cachebar.
      const response = await client.messages.create({
        model: MODEL_IDENTIFY,
        max_tokens: 4096,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: [imageBlock, { type: 'text', text: 'Welche Pflanze ist das? Antworte im vorgegebenen JSON-Format.' }] }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: IDENTIFY_SCHEMA } },
      });
      if (response.stop_reason === 'refusal') return send(res, 422, { error: 'Die Analyse wurde vom Modell abgelehnt. Bitte ein anderes Foto versuchen.' });
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      let parsed;
      try { parsed = JSON.parse(text); } catch { return send(res, 502, { error: 'Unerwartete Antwort des Modells' }); }
      parsed.candidates = (parsed.candidates || []).filter(c => c && c.sci).map(c => ({ ...c, dbKey: c.dbKey && PLANT_DB[c.dbKey] ? c.dbKey : null, confidence: Math.max(0, Math.min(1, Number(c.confidence) || 0)) }));
      return send(res, 200, { ...parsed, model: response.model });
    }

    // mode === 'diagnose'
    const who = [context.type, context.sci ? `(${context.sci})` : '', context.nickname ? `namens „${context.nickname}“` : '', context.room ? `im Raum ${context.room}` : '', context.light ? `bei Lichtverhältnis „${context.light}“` : ''].filter(Boolean).join(' ');
    const prompt = `Analysiere dieses Foto ${who ? `einer ${who}` : 'einer Zimmerpflanze'} auf Deutsch.

Gliedere die Antwort in:
**Gesamtzustand** – gut / Aufmerksamkeit nötig / kritisch, mit Begründung aus dem Bild
**Erkennbare Probleme** – Schädlinge, Krankheiten, Über-/Unterwässerung, Nährstoffmangel, Lichtprobleme (nur was sichtbar ist)
**Konkrete Maßnahmen** – 2–4 priorisierte Schritte für die nächsten Tage

Bleibe knapp und praktisch (max. 180 Wörter). Ist das Foto unscharf oder zeigt keine Pflanze, sage das und beschreibe, was trotzdem erkennbar ist.`;
    const response = await client.beta.messages.create({
      model: MODEL_DIAGNOSE,
      max_tokens: 3000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: [imageBlock, { type: 'text', text: prompt }] }],
    });
    if (response.stop_reason === 'refusal') return send(res, 422, { error: 'Die Analyse wurde vom Modell abgelehnt.' });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return send(res, 200, { text, model: response.model });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return send(res, 500, { error: 'ANTHROPIC_API_KEY ist ungültig' });
    if (e instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'Zu viele Anfragen – bitte kurz warten' });
    if (e instanceof Anthropic.APIConnectionError) return send(res, 502, { error: 'KI-Dienst nicht erreichbar' });
    if (e instanceof Anthropic.APIError) return send(res, 502, { error: `KI-Dienst: ${e.message}` });
    console.error(e);
    return send(res, 500, { error: 'Interner Fehler bei der Analyse' });
  }
}
