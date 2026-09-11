import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";

/**
 * Die Prozessachse der Schnittstelle - eine Zeile je Logistikprozess.
 *
 * EINZIGE QUELLE fuer Praefixe und Wortmarker. Vorher standen dieselben
 * Werte doppelt: als Filter-Objekte in Main.view.xml und als OData-Strings
 * in KpiLoader.ts. Ein neuer Marker musste an zwei Stellen nachgezogen
 * werden - genau die Art Redundanz, die irgendwann auseinanderlaeuft.
 *
 * WORAN DIE ZUORDNUNG HAENGT
 * 1. HISTORY_TYPE-Praefix. Zuverlaessig, aber nur die Consumer-Ebene setzt
 *    ihn; die WM-Trigger lassen ihn leer (CLAUDE.md O-27).
 * 2. Ein Wortmarker im Meldungstext, abgelesen am Quelltext der drei
 *    Trigger-Klassen. Der Marker ordnet nur ZU, nie FALSCH zu: Meldungen,
 *    die in mehreren Richtungen zeichengleich vorkommen, tragen keinen
 *    Marker und bleiben unzugeordnet, statt geraten zu werden.
 *
 *    Zwei Arten davon, und der Unterschied entscheidet ueber die
 *    Trennschaerfe: markers trifft IRGENDWO im Text (Contains),
 *    msgPrefixes nur am ANFANG (StartsWith). Siehe ProcessDef.
 *
 * Faellt der saubere Weg (gefuelltes HISTORY_TYPE bzw. ein Feld
 * ABORT_REASON), entfallen die markers-Eintraege ersatzlos.
 *
 * WARUM NUR DREI
 * Das Paket ZLE_AUST kennt sieben Prozesse - neben diesen dreien noch
 * Bestand, Umbuchung, Lieferanzeige und Inventur. Deren Consumer-Klassen
 * existieren, werden aber von nichts aufgerufen: kein SAP-seitiger
 * Ausloeser, also keine Meldungen, also eine dauerhaft leere Gruppe.
 * Aufgenommen wird ein Prozess, sobald ihn etwas in SAP ausloest.
 * Umbuchung wird relevant, sobald die Altbestandsmigration des
 * Bestandstrenners laeuft - dann ist es eine Zeile hier.
 */

export interface ProcessDef {
	/** Schluessel des Reiters, zugleich i18n-Suffix (tabIB, tabOB, ...) */
	key: string;
	/** Praefix in HISTORY_TYPE, ohne Unterstrich-Suffix */
	prefix: string;
	/** Wortmarker IRGENDWO im Meldungstext (Contains) */
	markers: string[];
	/**
	 * Marker am ANFANG des Meldungstextes (StartsWith).
	 *
	 * Der Unterschied ist nicht kosmetisch. "Material " kommt auch in
	 * Meldungen der WM-Trigger vor - sie lauten
	 * "Pos 0001 Material 4028: ME-Abweichung ...". Mit Contains zoege der
	 * Materialstamm-Reiter genau die Einlager- und Auslager-Abbrueche an
	 * sich, also die groesste Gruppe der Seite, und wuerde damit die
	 * Eigenschaft verletzen, die diese Marker ueberhaupt vertretbar macht:
	 * zuordnen ja, falsch zuordnen nie.
	 */
	msgPrefixes?: string[];
}

/*
 * Reiter, die keine Prozessgruppe sind. Konstanten eines ES-Moduls, keine
 * globalen Bezeichner - die Regel sap-no-global-variable behandelt
 * Modul-Scope faelschlich als globalen Scope (gleiche Ausnahme wie in
 * model/KpiLoader.ts und model/formatter.ts).
 */
/* eslint-disable @sap-ux/fiori-tools/sap-no-global-variable */
export const KEY_UNASSIGNED = "NONE";
export const KEY_ALL = "ALL";
export const KEY_ORDERS = "TPA";
/**
 * Vollstaendigkeitspruefung Warenausgang. Wie KEY_ORDERS keine Meldungsachse:
 * eine Sicht auf SAP-Daten, fuer die Typfilter, Suche und Vorgangsverdichtung
 * nicht gelten.
 */
export const KEY_WACHECK = "WACHECK";
/**
 * Materialstammabgleich SAP gegen HiLIS - Punkt 38, vierter Fehlerfall
 * ("Matstammkonfiguration SAP <-> HiLIS abweichend").
 *
 * Wie KEY_ORDERS und KEY_WACHECK keine Meldungsachse: der Inhalt kommt
 * nicht aus dem Anwendungsprotokoll, sondern aus dem Vergleich zweier
 * Systeme. Typfilter, Suche und Vorgangsverdichtung gelten nicht.
 *
 * ⚠ Die Daten sind eine MOMENTAUFNAHME des letzten Laufs von
 * ZLE_AUST_ITEM_COMPARE, kein Live-Zustand - deshalb steht der Zeitpunkt
 * ueber der Tabelle und nicht im Kleingedruckten.
 */
export const KEY_MATCMP = "MATCMP";
/**
 * Der Reiter, auf dem die App startet.
 *
 * Steht hier und nicht in Component.ts, weil ihn zwei Stellen brauchen:
 * der Startzustand des ui-Modells und _syncUrl( ), das ihn aus der Adresse
 * heraushaelt. Zwei Kopien wuerden auseinanderlaufen, und dann traege jede
 * URL einen Parameter, der nichts aussagt.
 */
export const KEY_DEFAULT = "IB";
/* eslint-enable @sap-ux/fiori-tools/sap-no-global-variable */

// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
export const processes: ProcessDef[] = [
	// ZCL_ZLE_AUST_TO_TRIGGER schreibt "HiLIS PutAway TA ..."
	{ key: "IB", prefix: "IB_", markers: ["PutAway"] },
	// ZCL_ZLE_AUST_OB_TRIGGER schreibt "HiLIS Pick TA ..." und als einzige
	// Klasse "Menge VSOLA = 0" - TO_TRIGGER prueft die Menge nicht.
	{ key: "OB", prefix: "OB_", markers: ["Pick", "VSOLA"] },
	// ZCL_ZLE_AUST_ITEM_TRIGGER: ALLE acht Log-Aufrufe BEGINNEN mit
	// "Material " (nicht in MARA, HiLIS-Verbindung, nicht mehr relevant,
	// DELETE, kein Sync, UPDATE, CREATE, SYNC - Quelltext geprueft
	// 26.08.2026). Keine Meldung der WM-Trigger faengt so an; die beginnen
	// mit "Pos ", "HiLIS ", "TA ", "Resend" oder "Cancel".
	//
	// Deshalb msgPrefixes und NICHT markers: zwei WM-Meldungen ENTHALTEN
	// "Material " in der Mitte ("Pos 0001 Material 4028: ME-Abweichung").
	{ key: "ITEM", prefix: "ITEM_", markers: [], msgPrefixes: ["Material "] }
];

function definition(sKey: string): ProcessDef | undefined {
	return processes.find((o) => o.key === sKey);
}

/** Alle Contains-Marker aller Prozesse - fuer die Gegenprobe "in keiner Gruppe". */
function allMarkers(): string[] {
	return processes.reduce<string[]>((aAll, o) => aAll.concat(o.markers), []);
}

/** Alle StartsWith-Marker aller Prozesse - dieselbe Gegenprobe. */
function allMsgPrefixes(): string[] {
	return processes.reduce<string[]>((aAll, o) => aAll.concat(o.msgPrefixes ?? []), []);
}

/**
 * Filter fuer einen Prozessreiter: Praefix ODER einer der Marker.
 */
export function processFilter(sKey: string): Filter | undefined {
	const oDef = definition(sKey);
	if (!oDef) {
		return undefined;
	}
	const aParts = [
		new Filter({ path: "HistoryType", operator: FilterOperator.StartsWith, value1: oDef.prefix })
	].concat(oDef.markers.map((s) =>
		new Filter({ path: "Message", operator: FilterOperator.Contains, value1: s })
	)).concat((oDef.msgPrefixes ?? []).map((s) =>
		new Filter({ path: "Message", operator: FilterOperator.StartsWith, value1: s })));

	return new Filter({ filters: aParts, and: false });
}

/**
 * Filter fuer "Ohne Prozesszuordnung": kein Praefix gesetzt UND kein Marker.
 * Die Gegenprobe zu allen Prozessfiltern zusammen.
 */
export function unassignedFilter(): Filter {
	const aParts = [
		new Filter({ path: "HistoryType", operator: FilterOperator.EQ, value1: "" })
	].concat(allMarkers().map((s) =>
		new Filter({ path: "Message", operator: FilterOperator.NotContains, value1: s })
	)).concat(allMsgPrefixes().map((s) =>
		new Filter({ path: "Message", operator: FilterOperator.NotStartsWith, value1: s })));

	return new Filter({ filters: aParts, and: true });
}

/*
 * ℹ odataProcess( ) und odataUnassigned( ) sind am 11.09.2026 entfallen.
 *
 * Sie waren die ZWEITE Fassung derselben Regel - dieselben Praefixe und
 * Marker noch einmal, nur als roher OData-Text statt als Filter-Objekt -,
 * und ihr einziger Verbraucher waren die Reiterzaehler in KpiLoader. Seit
 * die Zaehler dieselbe Filterkette wie die Tabelle benutzen
 * (Main._loadTabCounts), gibt es hier wieder genau eine Definition je
 * Prozess. Ein neuer Marker muss damit nur noch an einer Stelle nachgezogen
 * werden - der Zweck dieses Moduls, der durch die Doppelung stillschweigend
 * unterlaufen war.
 */
