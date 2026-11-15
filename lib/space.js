// Datenraum eines Nutzers: eigener Garten (user_id) oder – als Haushaltsmitglied – der gemeinsame Garten.
// items.user_id enthält den Datenraum: entweder die Nutzer-ID oder die Haushalts-ID (Präfix "hh_").
import { getPool, ensureSchema } from './db.js';

export const HOUSEHOLD_PREFIX = 'hh_';

/** Liefert die ID des Datenraums, in dem der Nutzer gerade arbeitet. */
export async function spaceOf(userId, client = null) {
  await ensureSchema();
  const { rows } = await (client || getPool()).query('SELECT household_id FROM household_members WHERE user_id = $1', [userId]);
  return rows[0]?.household_id || userId;
}

/** Sperrt den Datenraum für die Dauer der Transaktion (Sync-Reihenfolge, Mitgliederlimit). */
export async function lockSpace(client, space) {
  if (space.startsWith(HOUSEHOLD_PREFIX)) await client.query('SELECT id FROM households WHERE id = $1 FOR UPDATE', [space]);
  else await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [space]);
}

/**
 * Entfernt den Nutzer aus seinem Haushalt (innerhalb einer Transaktion auf `client`).
 * Letztes Mitglied → Haushalt samt Einträgen wird gelöscht; verlässt der Besitzer den Haushalt,
 * wird das am längsten beteiligte Mitglied zum Besitzer. Gibt die Haushalts-ID oder null zurück.
 */
export async function leaveHouseholdTx(client, userId) {
  const m = (await client.query('SELECT household_id, role FROM household_members WHERE user_id = $1', [userId])).rows[0];
  if (!m) return null;
  const hh = m.household_id;
  await client.query('SELECT id FROM households WHERE id = $1 FOR UPDATE', [hh]);
  await client.query('DELETE FROM household_members WHERE user_id = $1', [userId]);
  const rest = (await client.query('SELECT user_id, role FROM household_members WHERE household_id = $1 ORDER BY joined_at, user_id', [hh])).rows;
  if (!rest.length) {
    await client.query('DELETE FROM items WHERE user_id = $1', [hh]);
    await client.query('DELETE FROM households WHERE id = $1', [hh]);
  } else if (m.role === 'owner' && !rest.some(r => r.role === 'owner')) {
    await client.query(`UPDATE household_members SET role = 'owner' WHERE user_id = $1`, [rest[0].user_id]);
  }
  return hh;
}
