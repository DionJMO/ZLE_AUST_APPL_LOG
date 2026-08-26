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
	/** Wortmarker im Meldungstext, die nur in diesem Prozess vorkommen */
	markers: string[];
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
/* eslint-enable @sap-ux/fiori-tools/sap-no-global-variable */

// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
export const processes: ProcessDef[] = [
	// ZCL_ZLE_AUST_TO_TRIGGER schreibt "HiLIS PutAway TA ..."
	{ key: "IB", prefix: "IB_", markers: ["PutAway"] },
	// ZCL_ZLE_AUST_OB_TRIGGER schreibt "HiLIS Pick TA ..." und als einzige
	// Klasse "Menge VSOLA = 0" - TO_TRIGGER prueft die Menge nicht.
	{ key: "OB", prefix: "OB_", markers: ["Pick", "VSOLA"] },
	// ZCL_ZLE_AUST_ITEM_TRIGGER: ALLE acht Log-Aufrufe beginnen mit
	// "Material ", und keine Meldung der WM-Trigger tut das (die fangen mit
	// "Pos ", "HiLIS ", "TA ", "Resend" oder "Cancel" an). Damit ist der
	// Materialstamm-Pfad vollstaendig und trennscharf erfasst.
	{ key: "ITEM", prefix: "ITEM_", markers: ["Material "] }
];

function definition(sKey: string): ProcessDef | undefined {
	return processes.find((o) => o.key === sKey);
}

/** Alle Marker aller Prozesse - fuer die Gegenprobe "in keiner Gruppe". */
function allMarkers(): string[] {
	return processes.reduce<string[]>((aAll, o) => aAll.concat(o.markers), []);
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
		new Filter({ path: "Message", operator: FilterOperator.Contains, value1: s })));

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
		new Filter({ path: "Message", operator: FilterOperator.NotContains, value1: s })));

	return new Filter({ filters: aParts, and: true });
}

/** Dieselben Bedingungen als OData-Ausdruck - fuer die Zaehler. */
export function odataProcess(sKey: string): string {
	const oDef = definition(sKey);
	if (!oDef) {
		return "";
	}
	return [`startswith(HistoryType,'${oDef.prefix}')`]
		.concat(oDef.markers.map((s) => `contains(Message,'${s}')`))
		.join(" or ");
}

export function odataUnassigned(): string {
	return ["HistoryType eq ''"]
		.concat(allMarkers().map((s) => `not contains(Message,'${s}')`))
		.join(" and ");
}
