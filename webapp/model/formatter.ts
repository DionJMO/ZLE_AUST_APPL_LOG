import NumberFormat from "sap/ui/core/format/NumberFormat";

/**
 * Formatter der Monitoring-Oberflaeche.
 *
 * ZUSTAND AUS DEM FACHWERT, NICHT AUS DER KRITIKALITAET
 * Die Bindings hingen bis 25.08.2026 an den berechneten Feldern
 * LogTypeCriticality (ZLE_AUST_C_APPL_LOG) und StatusCriticality
 * (ZLE_AUST_C_TPA). Ergebnis in der Oberflaeche: ein Eintrag mit
 * LogType 'E' wurde mit dem blauen Info-Symbol und ohne Farbe
 * dargestellt - die Kritikalitaet kam als 0 bzw. undefined an. Zwei
 * plausible Ursachen (LogTypeCriticality ist im CDS-View
 * @UI.hidden und wird von autoExpandSelect womoeglich nicht
 * selektiert; oder Edm.Byte erreicht die Bindung als String und der
 * strikte Vergleich case 1 greift nicht).
 *
 * Statt die Ursache zu jagen, leiten wir den Zustand jetzt aus dem
 * fachlichen Wert ab - LogType und OrderStatus sind garantiert
 * vorhanden, sie werden ja als Text angezeigt. Damit ist die
 * Darstellung unabhaengig von beiden Ursachen.
 *
 * criticalityState/criticalityIcon bleiben fuer den Fall, dass die
 * Kritikalitaetsfelder spaeter zuverlaessig ankommen; sie sind
 * gegen String-Werte abgesichert.
 *
 * Farbe wird immer zusammen mit einem Icon ausgegeben - semantische
 * Farbe allein verletzt das Zwei-Sinne-Prinzip der Fiori-Guidelines.
 */

// Konstante eines ES-Moduls, kein globaler Bezeichner. Die Regel
// sap-no-global-variable behandelt Modul-Scope faelschlich als globalen
// Scope - gleiche Ausnahme wie in model/KpiLoader.ts.
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const DASH = "–";

function logTypeKey(sLogType?: string | null): string {
	return (sLogType ?? "").trim().toUpperCase();
}

/**
 * E = technischer Fehlschlag, W = fachlicher Abbruch, S = Erfolg.
 * Siehe CLAUDE.md, Abschnitt Feedback Gollmer 25.08.2026.
 */
export function logTypeState(sLogType?: string | null): string {
	switch (logTypeKey(sLogType)) {
		case "E": return "Error";
		case "W": return "Warning";
		case "S": return "Success";
		default: return "None";
	}
}

export function logTypeIcon(sLogType?: string | null): string {
	switch (logTypeKey(sLogType)) {
		case "E": return "sap-icon://error";
		case "W": return "sap-icon://alert";
		case "S": return "sap-icon://sys-enter-2";
		default: return "sap-icon://information";
	}
}

/**
 * HiLIS-Auftrags- und Zeilenstatus. Die Werte kommen als Klartext aus
 * der API (New, Allocated, Finished, Cancelled). Unbekannte Werte
 * bleiben neutral, statt sie zu erraten.
 */
export function orderStatusState(sStatus?: string | null): string {
	switch ((sStatus ?? "").trim()) {
		case "Finished": return "Success";
		case "Cancelled": return "Error";
		case "Allocated": return "Warning";
		case "New": return "Information";
		default: return "None";
	}
}

export function orderStatusIcon(sStatus?: string | null): string {
	switch ((sStatus ?? "").trim()) {
		case "Finished": return "sap-icon://sys-enter-2";
		case "Cancelled": return "sap-icon://decline";
		case "Allocated": return "sap-icon://alert";
		case "New": return "sap-icon://future";
		default: return "sap-icon://information";
	}
}

/**
 * ÜBERGANGSLÖSUNG - Redundanz aus dem Meldungstext entfernen.
 *
 * Das Backend schreibt Material und Position in den Meldungstext,
 * obwohl beide als eigene Spalte daneben stehen:
 *
 *   "Pos 0001 Material 000000000000004028: HiLIS-Stammdaten nicht
 *    lesbar, nicht uebertragen: HTTP 400"
 *
 * Das Material erscheint dabei zweimal - einmal 18-stellig
 * aufgefuellt im Text, einmal sauber in der Spalte. Bei der
 * Spaltenbreite wird der Text abgeschnitten, und zwar genau an der
 * Stelle, die die Spalten NICHT enthalten (dem HTTP-Status).
 *
 * Entfernt werden ausschliesslich die beiden Praefixe, die
 * nachweislich als Spalte vorhanden sind. Der Rest bleibt
 * unveraendert - insbesondere "nicht uebertragen": das steht zwar
 * auch in der Panel-Kopfzeile, ist aber Teil des Satzes und beim
 * Entfernen wuerde die Aussage leiden.
 *
 * ⚠ Textbasiert und damit bruechig: aendert das Backend den
 * Wortlaut, greifen die Muster still nicht mehr - dann erscheint
 * einfach der Originaltext, es geht nichts verloren. Die saubere
 * Lösung ist ein fachlicher Text im Backend (bzw. ein getrenntes
 * Feld MESSAGE_TECH), siehe CLAUDE.md. Solange das nicht entschieden
 * ist, bleibt diese Anzeige-Bereinigung.
 *
 * Der vollstaendige Originaltext bleibt im Tooltip der Zelle
 * erreichbar - die Bindings setzen dort bewusst das rohe Feld.
 */
export function messageShort(sMessage?: string | null): string {
	if (!sMessage) {
		return "";
	}
	return sMessage
		.replace(/^\s*Pos\s+\d+\s+/i, "")
		.replace(/^\s*Material\s+\d+\s*:\s*/i, "")
		.trim();
}

/**
 * Leere Textfelder als Gedankenstrich, damit strukturell fehlende
 * Daten nicht wie ein leeres Feld aussehen, das man uebersehen kann.
 */
export function dashIfEmpty(sValue?: string | null): string {
	const sTrimmed = (sValue ?? "").trim();
	return sTrimmed === "" ? DASH : sTrimmed;
}

/**
 * Mengen: 0 wird zum Gedankenstrich.
 *
 * Der TPA-Sync-Report fuellt Menge, Material, Position und Charge
 * nicht (ASSIGN COMPONENT trifft die Komponenten nicht, jeder
 * Zugriff ist mit IF sy-subrc = 0 ohne else abgesichert). Eine
 * angezeigte "0,000" liest sich wie eine echte Nullmenge - das ist
 * sie nicht, es ist eine fehlende Information.
 *
 * Formatierung ueber NumberFormat, weil ein eigener Formatter die
 * Typformatierung der Bindung ersetzt. Die Instanz entsteht im
 * Funktionsaufruf und nicht auf Modulebene: Letzteres beanstandet
 * die ESLint-Regel sap-no-global-variable.
 */
export function quantityOrDash(vValue?: string | number | null): string {
	if (vValue === undefined || vValue === null || vValue === "") {
		return DASH;
	}
	const nValue = typeof vValue === "number" ? vValue : Number(vValue);
	if (Number.isNaN(nValue) || nValue === 0) {
		return DASH;
	}
	return NumberFormat.getFloatInstance({
		minFractionDigits: 3,
		maxFractionDigits: 3
	}).format(nValue);
}

/**
 * Abbildung der CDS-Kritikalitaet auf Fiori-Semantik (1 negativ,
 * 2 kritisch, 3 positiv, 0 neutral). Gegen String-Werte abgesichert,
 * weil Edm.Byte je nach Bindung als "1" ankommen kann.
 */
export function criticalityState(vCriticality?: number | string | null): string {
	switch (Number(vCriticality)) {
		case 1: return "Error";
		case 2: return "Warning";
		case 3: return "Success";
		default: return "None";
	}
}

export function criticalityIcon(vCriticality?: number | string | null): string {
	switch (Number(vCriticality)) {
		case 1: return "sap-icon://error";
		case 2: return "sap-icon://alert";
		case 3: return "sap-icon://sys-enter-2";
		default: return "sap-icon://information";
	}
}
