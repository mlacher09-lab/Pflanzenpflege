// Pflanzendatenbank – strukturierte Daten für Pflegeplan, Standort-Finder und Scan-Zuordnung.
//
// Felder:
//   sci     wissenschaftlicher Name          e      Emoji
//   w / f   Gieß- / Düngeintervall (Tage)    d      Schwierigkeit 1 (leicht) – 3 (anspruchsvoll)
//   lt/hm/tmp  Anzeigetexte für Licht / Luftfeuchte / Temperatur
//   light   Lichtstufen, an denen die Pflanze gut gedeiht: sun | bright | partial | shade
//   hum     benötigte Luftfeuchte 1 (niedrig ok) · 2 (mittel) · 3 (hoch)
//   tmin/tmax  Wohlfühl-Temperaturbereich in °C (Winterminimum / Sommermaximum)
//   pet     safe | toxic | mixed   (Verträglichkeit für Hund & Katze)
//   size    s (< 40 cm) · m (40–120 cm) · l (> 120 cm)
//   air     luftreinigend          flower  blüht sichtbar
//   cat     Saison-Kategorie: drought | moisture | flowering | foliage
//   aliases weitere Namen / Gattungen für die Zuordnung von Scan-Ergebnissen
//   tips    Pflegetipps

export const LIGHT_LEVELS = {
  sun:     { label: 'Vollsonnig',   icon: '☀️', hint: 'Südfenster, mehrere Stunden direkte Sonne' },
  bright:  { label: 'Hell',         icon: '🌤', hint: 'Fensternähe ohne pralle Mittagssonne' },
  partial: { label: 'Halbschattig', icon: '⛅', hint: '1–3 m vom Fenster, Ost-/Westseite' },
  shade:   { label: 'Schattig',     icon: '🌥', hint: 'Raummitte, Nordfenster, Flur' },
};
export const HUM_LEVELS = { 1: 'Niedrig', 2: 'Mittel', 3: 'Hoch' };
export const SIZE_LEVELS = { s: 'Klein (bis 40 cm)', m: 'Mittel (40–120 cm)', l: 'Groß (über 120 cm)' };
export const PET_LEVELS = { safe: 'Haustiersicher', toxic: 'Giftig für Haustiere', mixed: 'Je nach Art' };

// Rückwärtskompatibel zu den alten Lichtwerten der ersten Version
export const LEGACY_LIGHT = { 'Vollsonnig': 'sun', 'Hell': 'bright', 'Halbschattig': 'partial', 'Schattig': 'shade' };

import { PLANT_MORE } from './plants-more.js';

const PLANT_BASE = {
  "Aloe Vera": { sci:"Aloe vera", e:"🌵", w:14, f:28, d:1, lt:"Sonnig bis hell", hm:"Niedrig", tmp:"15–30°C",
    light:["sun","bright"], hum:1, tmin:12, tmax:32, pet:"toxic", size:"s", air:false, flower:false, cat:"drought", aliases:["Aloe"],
    tips:["Staunässe unbedingt vermeiden – Topf mit Abzugsloch verwenden","Im Winter fast trocken halten (alle 3–4 Wochen)","Substrat: Kakteenerde mit Sand","Blattgel hilft bei kleinen Hautreizungen"] },
  "Anthurie": { sci:"Anthurium andraeanum", e:"🌺", w:7, f:14, d:2, lt:"Hell, indirektes Licht", hm:"Hoch", tmp:"18–25°C",
    light:["bright","partial"], hum:3, tmin:18, tmax:28, pet:"toxic", size:"m", air:true, flower:true, cat:"flowering", aliases:["Anthurium","Flamingoblume"],
    tips:["Blätter regelmäßig besprühen","Verwelkte Blüten sofort entfernen","Nicht in direkte Sonne stellen","Alle 2–3 Jahre umtopfen"] },
  "Agave": { sci:"Agave americana", e:"🌵", w:21, f:28, d:1, lt:"Vollsonnig", hm:"Niedrig", tmp:"15–35°C",
    light:["sun"], hum:1, tmin:5, tmax:35, pet:"toxic", size:"m", air:false, flower:false, cat:"drought", aliases:[],
    tips:["Sehr trockenheitsresistent","Im Winter nur einmal im Monat gießen","Frostempfindlich – unter 5°C hereinholen","Spitze Blattenden ggf. kappen (Kinder, Haustiere)"] },
  "Bogenhanf": { sci:"Dracaena trifasciata", e:"🌿", w:14, f:28, d:1, lt:"Hell bis halbschattig", hm:"Niedrig", tmp:"15–27°C",
    light:["sun","bright","partial","shade"], hum:1, tmin:12, tmax:30, pet:"toxic", size:"m", air:true, flower:false, cat:"drought", aliases:["Sansevieria","Sansevieria trifasciata","Schwiegermutterzunge"],
    tips:["Eine der pflegeleichtesten Zimmerpflanzen überhaupt","Zu viel Wasser ist der häufigste Fehler","Reinigt die Luft von Schadstoffen","Auch in dunklen Ecken lebensfähig"] },
  "Bonsai": { sci:"verschiedene Gattungen", e:"🌳", w:2, f:14, d:3, lt:"Hell bis sonnig", hm:"Mittel", tmp:"5–30°C",
    light:["sun","bright"], hum:2, tmin:5, tmax:30, pet:"mixed", size:"s", air:false, flower:false, cat:"foliage", aliases:["Ficus retusa","Ficus ginseng","Carmona","Zelkova"],
    tips:["Täglich die Erde auf Feuchtigkeit prüfen","Nie komplett austrocknen lassen","Regelmäßiger Rückschnitt formt die Krone","Tauchen statt Gießen für gleichmäßige Feuchte"] },
  "Bromelie": { sci:"Bromeliaceae", e:"🌺", w:7, f:21, d:2, lt:"Hell, indirektes Licht", hm:"Hoch", tmp:"18–25°C",
    light:["bright","partial"], hum:3, tmin:16, tmax:28, pet:"safe", size:"s", air:false, flower:true, cat:"moisture", aliases:["Guzmania","Vriesea","Aechmea","Bromelien"],
    tips:["Wasser in den Blatttrichter gießen, Erde nur leicht feucht","Nach der Blüte bilden sich Kindel – abtrennen und neu topfen","Kein kalkhaltiges Wasser – Regenwasser bevorzugen","Blüte hält Monate, Mutterpflanze stirbt danach langsam ab"] },
  "Drachenbaum": { sci:"Dracaena marginata", e:"🌴", w:10, f:21, d:1, lt:"Hell bis halbschattig", hm:"Niedrig bis mittel", tmp:"16–25°C",
    light:["bright","partial"], hum:1, tmin:15, tmax:28, pet:"toxic", size:"l", air:true, flower:false, cat:"foliage", aliases:["Dracaena","Dracaena fragrans","Dracaena reflexa"],
    tips:["Braune Spitzen meist durch Kalk oder Fluorid – gefiltertes Wasser nutzen","Kann auf 30–50 cm Stamm zurückgeschnitten werden","Giftig für Haustiere","Im Winter deutlich weniger gießen"] },
  "Dieffenbachie": { sci:"Dieffenbachia seguine", e:"🌿", w:7, f:14, d:2, lt:"Hell bis halbschattig", hm:"Mittel bis hoch", tmp:"18–28°C",
    light:["bright","partial"], hum:2, tmin:17, tmax:28, pet:"toxic", size:"m", air:true, flower:false, cat:"moisture", aliases:["Dieffenbachia"],
    tips:["Giftig – Handschuhe beim Umtopfen","Blätter regelmäßig abwischen","Vor Zugluft schützen","Im Winter an den wärmsten Fensterplatz"] },
  "Efeutute": { sci:"Epipremnum aureum", e:"🌱", w:7, f:21, d:1, lt:"Halbschattig bis hell", hm:"Mittel", tmp:"15–25°C",
    light:["bright","partial","shade"], hum:1, tmin:14, tmax:28, pet:"toxic", size:"m", air:true, flower:false, cat:"foliage", aliases:["Epipremnum","Pothos","Scindapsus","Goldene Efeutute"],
    tips:["Kommt auch mit wenig Licht zurecht","Als Hängepflanze oder an einer Kletterhilfe","Stecklinge wurzeln sehr leicht in Wasser","Giftig für Katzen und Hunde"] },
  "Einblatt": { sci:"Spathiphyllum wallisii", e:"🌸", w:5, f:14, d:1, lt:"Halbschattig", hm:"Hoch", tmp:"18–25°C",
    light:["bright","partial","shade"], hum:3, tmin:16, tmax:27, pet:"toxic", size:"m", air:true, flower:true, cat:"moisture", aliases:["Spathiphyllum","Friedenslilie","Peace Lily"],
    tips:["Hängende Blätter zeigen Durst – dann sofort gießen","Regelmäßig besprühen für hohe Luftfeuchte","Luftreinigend – ideal für Schlaf- und Arbeitsräume","Im Sommer alle 5–6 Tage, im Winter alle 7–10 Tage"] },
  "Elefantenfuß": { sci:"Beaucarnea recurvata", e:"🌴", w:14, f:28, d:1, lt:"Sonnig bis hell", hm:"Niedrig", tmp:"15–30°C",
    light:["sun","bright"], hum:1, tmin:10, tmax:32, pet:"safe", size:"m", air:false, flower:false, cat:"drought", aliases:["Beaucarnea","Flaschenbaum","Ponytail Palm"],
    tips:["Der dicke Stammfuß speichert Wasser – nie überwässern","Im Winter alle 3–4 Wochen gießen reicht","Mag viel direktes Licht","Wächst langsam – selten umtopfen"] },
  "Birkenfeige": { sci:"Ficus benjamina", e:"🌳", w:7, f:14, d:2, lt:"Hell bis sonnig", hm:"Mittel", tmp:"16–25°C",
    light:["sun","bright"], hum:2, tmin:15, tmax:28, pet:"toxic", size:"l", air:true, flower:false, cat:"foliage", aliases:["Ficus Benjamina","Ficus benjamini","Benjamini"],
    tips:["Standortwechsel löst Blattabwurf aus – einmal aufgestellt stehen lassen","Sehr empfindlich gegen Zugluft","Blätter regelmäßig abstauben","Im Sommer gern draußen, langsam wieder eingewöhnen"] },
  "Gummibaum": { sci:"Ficus elastica", e:"🌿", w:10, f:14, d:1, lt:"Hell bis vollsonnig", hm:"Mittel", tmp:"16–27°C",
    light:["sun","bright"], hum:1, tmin:15, tmax:30, pet:"toxic", size:"l", air:true, flower:false, cat:"foliage", aliases:["Ficus elastica","Rubber Plant"],
    tips:["Blätter mit feuchtem Tuch glänzend wischen","Milchsaft reizt Haut und Augen","Im Sommer gern auf Balkon oder Terrasse","Erde zwischen den Wassergaben leicht antrocknen lassen"] },
  "Geigenfeige": { sci:"Ficus lyrata", e:"🌳", w:7, f:14, d:2, lt:"Hell, indirektes Licht", hm:"Mittel", tmp:"18–26°C",
    light:["bright"], hum:2, tmin:16, tmax:28, pet:"toxic", size:"l", air:true, flower:false, cat:"foliage", aliases:["Ficus lyrata","Fiddle Leaf Fig"],
    tips:["Mag einen festen, hellen Platz ohne Zugluft","Erde oberflächlich antrocknen lassen, dann durchdringend gießen","Große Blätter regelmäßig abstauben","Braune Flecken deuten meist auf zu viel Wasser hin"] },
  "Grünlilie": { sci:"Chlorophytum comosum", e:"🌱", w:7, f:21, d:1, lt:"Hell bis halbschattig", hm:"Mittel", tmp:"14–25°C",
    light:["bright","partial","shade"], hum:1, tmin:10, tmax:28, pet:"safe", size:"s", air:true, flower:false, cat:"foliage", aliases:["Chlorophytum","Spider Plant"],
    tips:["Bildet Ausläufer mit Kindeln – einfach im Wasser bewurzeln","Kaum Schädlingsbefall","Braune Spitzen meist durch Kalk oder trockene Luft","Unbedenklich für Katzen – wird gern angeknabbert"] },
  "Hibiskus": { sci:"Hibiscus rosa-sinensis", e:"🌺", w:5, f:7, d:2, lt:"Sonnig bis hell", hm:"Mittel bis hoch", tmp:"18–30°C",
    light:["sun","bright"], hum:2, tmin:12, tmax:32, pet:"safe", size:"m", air:false, flower:true, cat:"flowering", aliases:["Hibiscus","Roseneibisch"],
    tips:["Volle Sonne fördert Blütenbildung","Im Winter bei 12–15°C und wenig gießen","Regelmäßiger Rückschnitt hält den Wuchs kompakt","Bei Blattfall auf Spinnmilben prüfen"] },
  "Kaffeepflanze": { sci:"Coffea arabica", e:"☕", w:7, f:14, d:2, lt:"Hell, indirektes Licht", hm:"Hoch", tmp:"18–25°C",
    light:["bright","partial"], hum:3, tmin:15, tmax:27, pet:"toxic", size:"m", air:false, flower:true, cat:"foliage", aliases:["Coffea"],
    tips:["Niemals pralle Mittagssonne","Weiches Wasser oder Regenwasser bevorzugt","Bildet nach Jahren kleine rote Früchte","Im Sommer gern halbschattig auf dem Balkon"] },
  "Kaktus": { sci:"Cactaceae", e:"🌵", w:21, f:28, d:1, lt:"Vollsonnig", hm:"Niedrig", tmp:"10–35°C",
    light:["sun"], hum:1, tmin:8, tmax:35, pet:"safe", size:"s", air:false, flower:true, cat:"drought", aliases:["Kakteen","Echinocactus","Mammillaria","Opuntia","Cereus"],
    tips:["Im Winter Ruhe gönnen: fast kein Wasser, kühler Standort","Im Frühjahr langsam an die Sonne gewöhnen","Kakteenerde mit hohem Sandanteil","Blüten bilden sich nur bei ausreichend Licht"] },
  "Glücksfeder": { sci:"Zamioculcas zamiifolia", e:"🌿", w:14, f:28, d:1, lt:"Halbschattig bis hell", hm:"Niedrig", tmp:"15–25°C",
    light:["bright","partial","shade"], hum:1, tmin:15, tmax:30, pet:"toxic", size:"m", air:true, flower:false, cat:"drought", aliases:["Zamioculcas","ZZ Plant","ZZ-Pflanze"],
    tips:["Extrem trockenheitsresistent – Staunässe meiden","Erde zwischen den Wassergaben komplett austrocknen lassen","Wächst auch in dunklen Räumen, nur langsamer","Giftig für Haustiere – Handschuhe beim Umtopfen"] },
  "Glückskastanie": { sci:"Pachira aquatica", e:"🌳", w:7, f:14, d:2, lt:"Hell, indirektes Licht", hm:"Mittel bis hoch", tmp:"18–28°C",
    light:["bright","partial"], hum:2, tmin:16, tmax:28, pet:"safe", size:"l", air:false, flower:false, cat:"moisture", aliases:["Pachira","Money Tree"],
    tips:["Der geflochtene Stamm ist dekorativ – nicht beschädigen","Blätter regelmäßig besprühen","Keine direkte Mittagssonne – Blätter verbrennen","Im Winter etwas weniger gießen"] },
  "Kokospalme": { sci:"Cocos nucifera", e:"🥥", w:4, f:14, d:3, lt:"Vollsonnig", hm:"Hoch (60–80%)", tmp:"22–32°C",
    light:["sun"], hum:3, tmin:20, tmax:32, pet:"safe", size:"l", air:false, flower:false, cat:"moisture", aliases:["Cocos"],
    tips:["Braucht den hellsten Platz im Raum – am besten Südfenster","Erde gleichmäßig feucht halten, nie austrocknen lassen","Regelmäßig besprühen oder Luftbefeuchter nutzen","Kälteempfindlich – nie unter 18°C, Zugluft vermeiden","Als Zimmerpflanze anspruchsvoll"] },
  "Klivie": { sci:"Clivia miniata", e:"🌺", w:10, f:21, d:2, lt:"Hell, indirektes Licht", hm:"Mittel", tmp:"15–25°C",
    light:["bright","partial"], hum:2, tmin:10, tmax:26, pet:"toxic", size:"m", air:false, flower:true, cat:"flowering", aliases:["Clivia","Riemenblatt","Clivie"],
    tips:["Winterruhe bei 10–15°C und wenig Wasser fördert die Blüte","Keine direkte Sonne – Blätter verbrennen leicht","Nur nach der Blüte und selten umtopfen","Giftig für Mensch und Tier"] },
  "Philodendron": { sci:"Philodendron sp.", e:"🌿", w:7, f:14, d:1, lt:"Hell, indirektes Licht", hm:"Mittel bis hoch", tmp:"18–27°C",
    light:["bright","partial"], hum:2, tmin:16, tmax:28, pet:"toxic", size:"m", air:true, flower:false, cat:"moisture", aliases:["Philodendron hederaceum","Philodendron scandens","Baumfreund"],
    tips:["Erde leicht feucht halten, aber keine Staunässe","Luftwurzeln sind normal – in feuchtes Moos leiten oder lassen","Blätter regelmäßig abwischen","Giftig – Handschuhe beim Umtopfen"] },
  "Strahlenaralie": { sci:"Schefflera arboricola", e:"🌿", w:7, f:14, d:2, lt:"Hell bis halbschattig", hm:"Mittel", tmp:"15–25°C",
    light:["bright","partial"], hum:2, tmin:14, tmax:27, pet:"toxic", size:"l", air:true, flower:false, cat:"foliage", aliases:["Schefflera"],
    tips:["Erde zwischen den Gaben leicht antrocknen lassen","Blätter regelmäßig abstauben oder abduschen","Rückschnitt fördert buschigen Wuchs","Giftig für Haustiere – Saft reizt die Haut"] },
  "Monstera": { sci:"Monstera deliciosa", e:"🌿", w:7, f:14, d:1, lt:"Hell, indirektes Licht", hm:"Hoch", tmp:"18–27°C",
    light:["bright","partial"], hum:2, tmin:16, tmax:28, pet:"toxic", size:"l", air:true, flower:false, cat:"moisture", aliases:["Fensterblatt","Monstera adansonii"],
    tips:["Blätter regelmäßig mit feuchtem Tuch abstauben","Im Winter auf alle 10–14 Tage reduzieren","Luftwurzeln in feuchtes Moos oder zurück in den Topf leiten","Keine direkte Mittagssonne – Blattverbrennungen"] },
  "Orchidee": { sci:"Phalaenopsis sp.", e:"🌸", w:10, f:28, d:2, lt:"Hell, indirektes Licht", hm:"Mittel", tmp:"16–26°C",
    light:["bright","partial"], hum:2, tmin:16, tmax:28, pet:"safe", size:"s", air:false, flower:true, cat:"moisture", aliases:["Phalaenopsis","Schmetterlingsorchidee","Dendrobium"],
    tips:["In lichtdurchlässigem Orchideentopf kultivieren","Wurzeln grün = feucht, silbrig = gießen","Nach der Blüte Trieb bis zum zweiten Auge zurückschneiden","Kein Kalkwasser – Regenwasser ideal"] },
  "Sukkulente": { sci:"diverse Gattungen", e:"🪴", w:14, f:28, d:1, lt:"Sonnig bis hell", hm:"Niedrig", tmp:"10–30°C",
    light:["sun","bright"], hum:1, tmin:8, tmax:32, pet:"mixed", size:"s", air:false, flower:false, cat:"drought", aliases:["Sukkulenten","Sedum","Sempervivum","Hauswurz"],
    tips:["Substrat zwischen den Gaben komplett austrocknen lassen","Im Winter fast kein Wasser","Viel direktes Licht oder Pflanzenlampe","Staunässe führt schnell zu Wurzelfäule"] },
  "Geldbaum": { sci:"Crassula ovata", e:"🪴", w:14, f:28, d:1, lt:"Sonnig bis hell", hm:"Niedrig", tmp:"10–28°C",
    light:["sun","bright"], hum:1, tmin:8, tmax:30, pet:"toxic", size:"m", air:false, flower:false, cat:"drought", aliases:["Crassula ovata","Pfennigbaum","Jade Plant"],
    tips:["Dicke Blätter speichern Wasser – lieber zu wenig als zu viel gießen","Kühler, heller Winterstand fördert Blüte","Stecklinge wurzeln sehr leicht","Kann über Jahrzehnte alt werden"] },
  "Usambaraveilchen": { sci:"Saintpaulia ionantha", e:"💜", w:5, f:14, d:2, lt:"Hell, indirektes Licht", hm:"Mittel bis hoch", tmp:"18–24°C",
    light:["bright","partial"], hum:2, tmin:17, tmax:26, pet:"safe", size:"s", air:false, flower:true, cat:"flowering", aliases:["Saintpaulia","Streptocarpus"],
    tips:["Nie Wasser auf die Blätter – von unten gießen","Keine Zugluft, keine direkte Sonne","Verwelkte Blüten und Blätter regelmäßig entfernen","Spezialerde für Usambaraveilchen verwenden"] },
  "Yucca": { sci:"Yucca elephantipes", e:"🌴", w:14, f:21, d:1, lt:"Sonnig bis hell", hm:"Niedrig", tmp:"15–30°C",
    light:["sun","bright"], hum:1, tmin:8, tmax:32, pet:"toxic", size:"l", air:false, flower:false, cat:"drought", aliases:["Palmlilie","Yucca gigantea"],
    tips:["Zwischen den Gaben komplett austrocknen lassen","Im Sommer gern draußen in der Sonne","Staubige Blätter mit feuchtem Tuch abwischen","Im Winter kaum düngen"] },
  "Zimmerpalme": { sci:"Chamaedorea elegans", e:"🌴", w:5, f:14, d:1, lt:"Hell, indirektes Licht", hm:"Mittel bis hoch", tmp:"15–24°C",
    light:["bright","partial","shade"], hum:2, tmin:14, tmax:26, pet:"safe", size:"m", air:true, flower:false, cat:"moisture", aliases:["Chamaedorea","Bergpalme"],
    tips:["Braune Spitzen durch Trockenheit oder Kalk","Regelmäßig besprühen","Verträgt weniger Licht als die meisten Palmen","Im Winter etwas weniger gießen"] },
  "Kentia-Palme": { sci:"Howea forsteriana", e:"🌴", w:7, f:21, d:1, lt:"Hell bis halbschattig", hm:"Mittel", tmp:"16–26°C",
    light:["bright","partial","shade"], hum:2, tmin:14, tmax:28, pet:"safe", size:"l", air:true, flower:false, cat:"moisture", aliases:["Howea","Kentia"],
    tips:["Sehr robust – verzeiht auch dunklere Standorte","Erde leicht feucht, nie nass halten","Wedel gelegentlich abduschen","Langsam wachsend, selten umtopfen"] },
  "Goldfruchtpalme": { sci:"Dypsis lutescens", e:"🌴", w:5, f:14, d:2, lt:"Hell, indirektes Licht", hm:"Hoch", tmp:"18–26°C",
    light:["bright"], hum:3, tmin:16, tmax:28, pet:"safe", size:"l", air:true, flower:false, cat:"moisture", aliases:["Areca","Areca-Palme","Dypsis"],
    tips:["Braucht gleichmäßig feuchte Erde und hohe Luftfeuchte","Braune Wedelspitzen bei trockener Heizungsluft","Kalkarmes Wasser verwenden","Alle 2–3 Jahre umtopfen"] },
  "Zimmerfarn": { sci:"Nephrolepis exaltata", e:"🌿", w:3, f:14, d:2, lt:"Halbschattig", hm:"Hoch", tmp:"15–22°C",
    light:["partial","shade"], hum:3, tmin:14, tmax:25, pet:"safe", size:"m", air:true, flower:false, cat:"moisture", aliases:["Schwertfarn","Nephrolepis","Farn","Boston Fern"],
    tips:["Substrat immer gleichmäßig feucht halten","Regelmäßiges Besprühen ist essenziell","Keine Heizungsluft, keine direkte Sonne","Gelbe Wedel regelmäßig entfernen"] },
  "Zimmerlinde": { sci:"Sparrmannia africana", e:"🌼", w:5, f:14, d:2, lt:"Hell bis halbschattig", hm:"Mittel", tmp:"15–22°C",
    light:["bright","partial"], hum:2, tmin:8, tmax:24, pet:"safe", size:"l", air:false, flower:true, cat:"flowering", aliases:["Sparrmannia"],
    tips:["Wächst schnell – regelmäßiger Rückschnitt nötig","Kann im Sommer draußen stehen","Im Winter bei 8–12°C fast trocken halten","Große Blätter regelmäßig abstauben"] },
  "Korbmarante": { sci:"Calathea sp.", e:"🌿", w:5, f:14, d:3, lt:"Halbschattig", hm:"Hoch", tmp:"18–26°C",
    light:["partial","shade"], hum:3, tmin:17, tmax:27, pet:"safe", size:"m", air:true, flower:false, cat:"moisture", aliases:["Calathea","Goeppertia","Calathea orbifolia","Calathea makoyana"],
    tips:["Nur kalkfreies, zimmerwarmes Wasser verwenden","Hohe Luftfeuchte – ideal fürs Bad","Blätter rollen sich bei Trockenheit ein","Keine direkte Sonne – bleicht die Zeichnung aus"] },
  "Pfeilwurz": { sci:"Maranta leuconeura", e:"🌿", w:5, f:14, d:2, lt:"Halbschattig", hm:"Hoch", tmp:"18–26°C",
    light:["partial","shade"], hum:3, tmin:16, tmax:27, pet:"safe", size:"s", air:true, flower:false, cat:"moisture", aliases:["Maranta","Gebetspflanze","Prayer Plant"],
    tips:["Blätter stellen sich nachts auf – völlig normal","Gleichmäßig feucht halten, nicht nass","Weiches Wasser, hohe Luftfeuchte","Hängend oder als Bodendecker in Töpfen"] },
  "Ufopflanze": { sci:"Pilea peperomioides", e:"🪴", w:7, f:21, d:1, lt:"Hell, indirektes Licht", hm:"Mittel", tmp:"15–25°C",
    light:["bright","partial"], hum:2, tmin:12, tmax:27, pet:"safe", size:"s", air:false, flower:false, cat:"foliage", aliases:["Pilea","Glückstaler","Chinesischer Geldbaum","Bauchnabelpflanze"],
    tips:["Topf regelmäßig drehen – wächst zum Licht","Erde zwischen den Gaben antrocknen lassen","Bildet viele Ableger, die sich leicht abtrennen lassen","Blätter gelegentlich abstauben"] },
  "Peperomie": { sci:"Peperomia sp.", e:"🪴", w:10, f:28, d:1, lt:"Hell bis halbschattig", hm:"Mittel", tmp:"16–26°C",
    light:["bright","partial"], hum:2, tmin:14, tmax:28, pet:"safe", size:"s", air:false, flower:false, cat:"drought", aliases:["Peperomia","Zwergpfeffer","Peperomia obtusifolia","Peperomia caperata"],
    tips:["Speichert Wasser in den Blättern – mäßig gießen","Ideal für kleine Fensterbänke und Regale","Verträgt normale Zimmerluft gut","Stecklinge wurzeln leicht"] },
  "Wachsblume": { sci:"Hoya carnosa", e:"🌸", w:10, f:28, d:1, lt:"Hell, indirektes Licht", hm:"Mittel", tmp:"16–26°C",
    light:["sun","bright"], hum:2, tmin:12, tmax:28, pet:"safe", size:"m", air:false, flower:true, cat:"drought", aliases:["Hoya","Porzellanblume"],
    tips:["Blühende Triebe nicht abschneiden – dort kommen neue Blüten","Erde gut antrocknen lassen","Mag es hell, auch etwas Morgensonne","Hängend oder an einem Rankbogen"] },
  "Alokasie": { sci:"Alocasia sp.", e:"🌿", w:5, f:14, d:3, lt:"Hell, indirektes Licht", hm:"Hoch", tmp:"18–28°C",
    light:["bright","partial"], hum:3, tmin:18, tmax:28, pet:"toxic", size:"m", air:false, flower:false, cat:"moisture", aliases:["Alocasia","Pfeilblatt","Elefantenohr","Alocasia zebrina","Alocasia polly"],
    tips:["Braucht Wärme und hohe Luftfeuchte","Gleichmäßig feucht halten, Staunässe meiden","Zieht im Winter oft Blätter ein – Knolle überlebt","Anfällig für Spinnmilben bei trockener Luft"] },
  "Dreimasterblume": { sci:"Tradescantia zebrina", e:"🌿", w:5, f:14, d:1, lt:"Hell", hm:"Mittel", tmp:"15–26°C",
    light:["sun","bright","partial"], hum:2, tmin:12, tmax:28, pet:"toxic", size:"s", air:false, flower:false, cat:"foliage", aliases:["Tradescantia","Zebrakraut"],
    tips:["Je heller, desto kräftiger die Blattfärbung","Regelmäßig stutzen für dichten Wuchs","Stecklinge wurzeln in Wasser in wenigen Tagen","Saft kann Hautreizungen auslösen"] },
  "Fittonie": { sci:"Fittonia albivenis", e:"🌿", w:3, f:21, d:2, lt:"Halbschattig", hm:"Hoch", tmp:"18–26°C",
    light:["partial","shade"], hum:3, tmin:17, tmax:27, pet:"safe", size:"s", air:false, flower:false, cat:"moisture", aliases:["Fittonia","Mosaikpflanze","Silbernetzblatt"],
    tips:["Fällt bei Trockenheit dramatisch zusammen – erholt sich nach dem Gießen","Perfekt für Terrarien und Flaschengärten","Hohe Luftfeuchte, keine direkte Sonne","Regelmäßig zurückschneiden"] },
  "Tillandsie": { sci:"Tillandsia sp.", e:"🌿", w:4, f:28, d:1, lt:"Hell, indirektes Licht", hm:"Mittel bis hoch", tmp:"15–28°C",
    light:["bright","partial"], hum:2, tmin:12, tmax:30, pet:"safe", size:"s", air:false, flower:true, cat:"moisture", aliases:["Tillandsia","Luftpflanze","Air Plant"],
    tips:["Braucht keine Erde – 1–2× pro Woche tauchen oder gründlich besprühen","Nach dem Tauchen kopfüber abtropfen lassen","Gute Luftzirkulation wichtig","Blüht einmal und bildet dann Kindel"] },
  "Weihnachtsstern": { sci:"Euphorbia pulcherrima", e:"🌺", w:5, f:14, d:2, lt:"Hell", hm:"Mittel", tmp:"15–22°C",
    light:["bright"], hum:2, tmin:15, tmax:24, pet:"toxic", size:"s", air:false, flower:true, cat:"flowering", aliases:["Euphorbia pulcherrima","Poinsettia","Adventsstern"],
    tips:["Keine Zugluft und keine Kälte beim Transport","Erst gießen, wenn die Erde oberflächlich trocken ist","Zum Wiederfärben ab Oktober 12 Stunden Dunkelheit täglich","Milchsaft ist giftig"] },
  "Begonie": { sci:"Begonia sp.", e:"🌸", w:5, f:14, d:2, lt:"Hell bis halbschattig", hm:"Mittel bis hoch", tmp:"16–24°C",
    light:["bright","partial"], hum:2, tmin:15, tmax:26, pet:"toxic", size:"s", air:false, flower:true, cat:"flowering", aliases:["Begonia","Begonia maculata","Forellenbegonie","Blattbegonie"],
    tips:["Von unten gießen – Blätter nicht benetzen","Verblühtes regelmäßig ausputzen","Keine pralle Sonne","Luftfeuchte durch Kiesschale erhöhen, nicht besprühen"] },
  "Zebrapflanze": { sci:"Aphelandra squarrosa", e:"🌼", w:5, f:14, d:3, lt:"Hell, indirektes Licht", hm:"Hoch", tmp:"18–26°C",
    light:["bright","partial"], hum:3, tmin:17, tmax:27, pet:"safe", size:"s", air:false, flower:true, cat:"flowering", aliases:["Aphelandra","Glanzkölbchen"],
    tips:["Gleichmäßig feucht halten – reagiert empfindlich auf Trockenheit","Hohe Luftfeuchte nötig","Nach der Blüte zurückschneiden","Zugluft und Temperaturschwankungen meiden"] },
  "Christusdorn": { sci:"Euphorbia milii", e:"🌵", w:14, f:28, d:1, lt:"Vollsonnig", hm:"Niedrig", tmp:"15–30°C",
    light:["sun","bright"], hum:1, tmin:12, tmax:32, pet:"toxic", size:"m", air:false, flower:true, cat:"drought", aliases:["Euphorbia milii"],
    tips:["Blüht fast ganzjährig an einem sonnigen Platz","Sparsam gießen, im Winter noch weniger","Dornen und giftiger Milchsaft – Handschuhe tragen","Kakteenerde verwenden"] },
};

export const PLANT_DB = { ...PLANT_BASE, ...PLANT_MORE };
export const PLANT_NAMES = Object.keys(PLANT_DB).sort((a, b) => a.localeCompare(b, 'de'));

export const ROOMS = ["Wohnzimmer", "Schlafzimmer", "Küche", "Bad", "Büro", "Flur", "Kinderzimmer", "Balkon", "Terrasse"];

// Typische Bedingungen pro Raum als Vorschlag für den Standort-Finder
export const ROOM_PRESETS = {
  "Wohnzimmer":   { hum: 2, temp: "normal" },
  "Schlafzimmer": { hum: 2, temp: "cool" },
  "Küche":        { hum: 3, temp: "normal" },
  "Bad":          { hum: 3, temp: "warm" },
  "Büro":         { hum: 1, temp: "normal" },
  "Flur":         { hum: 1, temp: "cool" },
  "Kinderzimmer": { hum: 2, temp: "normal", pet: true },
  "Balkon":       { hum: 2, temp: "cool", light: "sun", outdoor: true },
  "Terrasse":     { hum: 2, temp: "cool", light: "sun", outdoor: true },
};

// Saisontipps nach Kategorie
export const SEASONAL = {
  drought: {
    spring: ['Gießintervall langsam erhöhen – Wachstumsstart', 'Jetzt umtopfen und erste Düngergabe'],
    summer: ['Bei Hitze öfter prüfen, aber weiterhin mäßig gießen', 'Vor praller Mittagssonne im Hochsommer schützen'],
    autumn: ['Gießen reduzieren – Pflanze bereitet die Winterruhe vor', 'Letzte Düngergabe im September'],
    winter: ['Kaum gießen – nur alle 3–4 Wochen prüfen', 'Keine Düngung bis März', 'Kühl und hell überwintern, wenn möglich'],
  },
  moisture: {
    spring: ['Gießmenge wieder steigern, erste Düngergabe März/April', 'Guter Zeitpunkt zum Umtopfen'],
    summer: ['Regelmäßig auf Austrocknung prüfen – bei Hitze öfter gießen', 'Luftfeuchte erhöhen: besprühen oder Kiesschale mit Wasser'],
    autumn: ['Gießen ab Oktober reduzieren', 'Düngung Ende September einstellen'],
    winter: ['Weniger gießen als im Sommer, Erde aber nicht austrocknen lassen', 'Von Heizkörpern fernhalten – Heizungsluft senkt die Luftfeuchte stark'],
  },
  flowering: {
    spring: ['Rückschnitt nach dem Winter', 'Düngung mit Blühpflanzendünger starten', 'Hellen Platz für die Knospenbildung sichern'],
    summer: ['Verwelkte Blüten regelmäßig entfernen', 'Reichlich wässern und alle 2 Wochen Blühpflanzendünger'],
    autumn: ['Auf die Winterruhe vorbereiten', 'Düngung einstellen', 'Ggf. kühleren Standort suchen'],
    winter: ['Wenig gießen, nicht düngen', 'Ein kühler, heller Winter fördert die Blüte im Frühjahr'],
  },
  foliage: {
    spring: ['Jetzt umtopfen und Erde erneuern', 'Erste Düngergabe März–April', 'Blätter auf Schädlinge kontrollieren'],
    summer: ['Bei Hitze und Sonne vor Austrocknung schützen', 'Blätter regelmäßig besprühen oder abwischen'],
    autumn: ['Gießmenge und Düngeintervall schrittweise reduzieren', 'Vor Zugluft schützen'],
    winter: ['Reduziert gießen – Erde zwischen den Gaben leicht antrocknen lassen', 'Keine Düngung', 'Mindestens 3–4 Stunden Tageslicht sicherstellen'],
  },
};

export function season(d = new Date()) {
  const m = d.getMonth();
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}
export const SEASON_NAME = { spring: 'Frühling', summer: 'Sommer', autumn: 'Herbst', winter: 'Winter' };
export const SEASON_ICON = { spring: '🌸', summer: '☀️', autumn: '🍂', winter: '❄️' };

export function seasonalTips(type) {
  const cat = PLANT_DB[type]?.cat || 'foliage';
  return SEASONAL[cat]?.[season()] || [];
}

/** Findet den Datenbank-Schlüssel zu einem freien Namen (deutsch, wissenschaftlich oder Alias). */
export function resolvePlantName(input) {
  if (!input) return null;
  const q = input.trim().toLowerCase();
  if (!q) return null;
  if (PLANT_DB[input.trim()]) return input.trim();
  for (const [name, p] of Object.entries(PLANT_DB)) {
    if (name.toLowerCase() === q) return name;
    if (p.sci.toLowerCase() === q) return name;
    if (p.aliases.some(a => a.toLowerCase() === q)) return name;
  }
  // Gattung (erstes Wort des wissenschaftlichen Namens) – z. B. "Ficus elastica 'Robusta'"
  const genus = q.split(/\s+/)[0];
  const byGenus = Object.entries(PLANT_DB).filter(([, p]) =>
    p.sci.toLowerCase().startsWith(q) || q.startsWith(p.sci.toLowerCase().split(' ')[0]) && p.sci.toLowerCase().split(' ')[0] === genus
  );
  if (byGenus.length === 1) return byGenus[0][0];
  // Teilstring-Treffer
  const partial = Object.entries(PLANT_DB).filter(([name, p]) =>
    name.toLowerCase().includes(q) || p.aliases.some(a => a.toLowerCase().includes(q)) || q.includes(name.toLowerCase())
  );
  if (partial.length === 1) return partial[0][0];
  return null;
}

/** Freitext-Suche über Namen, wissenschaftliche Namen und Aliase (für Autocomplete). */
export function searchPlants(q) {
  const s = (q || '').trim().toLowerCase();
  if (!s) return PLANT_NAMES;
  const rank = n => {
    const p = PLANT_DB[n], nl = n.toLowerCase();
    if (nl === s) return 0;
    if (nl.startsWith(s)) return 1;
    if (p.aliases.some(a => a.toLowerCase().startsWith(s))) return 2;
    if (nl.includes(s)) return 3;
    if (p.sci.toLowerCase().startsWith(s)) return 4;
    if (p.sci.toLowerCase().includes(s) || p.aliases.some(a => a.toLowerCase().includes(s))) return 5;
    return 9;
  };
  return PLANT_NAMES.map(n => [n, rank(n)]).filter(([, r]) => r < 9).sort((a, b) => a[1] - b[1] || a[0].length - b[0].length).map(([n]) => n);
}
