import DateFormat from "sap/ui/core/format/DateFormat";
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

/**
 * Zeitstempel im 24-Stunden-Format.
 *
 * WARUM EIN FESTES MUSTER STATT DER LOCALE
 * Ohne Muster formatiert UI5 Edm.DateTimeOffset nach der Locale des
 * Browsers. Steht die auf Englisch, kommt "8/26/26, 10:39:17 AM"
 * heraus - in einer Tabelle mit Zeitstempeln ist AM/PM sowohl
 * schlechter lesbar als auch breiter, und die Sortierrichtung laesst
 * sich am Text nicht mehr nachvollziehen. Das Muster ist deshalb
 * bewusst hart gesetzt und locale-unabhaengig.
 *
 * ⚠ ZEITZONE: der Wert ist in der Datenbank UTC. new Date( ) wertet
 * das abschliessende Z aus und DateFormat gibt ohne UTC:true die
 * ORTSZEIT des Browsers aus, bei CEST also +2h. Der Report
 * ZLE_AUST_LOG_DELETE zeigt dagegen UTC - beim Abgleich der beiden
 * Werkzeuge daran denken. Ortszeit ist hier die richtige Wahl, weil
 * der Anwender die Uhrzeit mit seiner eigenen vergleicht.
 *
 * ⚠ Nur fuer Edm.DateTimeOffset-Felder (CreatedAtStamp, LastSyncAt,
 * CreationDate). Reine Datumsfelder wie BestBeforeDate haben keine
 * Uhrzeit und bleiben bei der Standardformatierung.
 */
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const oTimestampFormat = DateFormat.getDateTimeInstance({ pattern: "dd.MM.yyyy HH:mm:ss" });

export function timestamp(vValue?: string | Date | null): string {
	if (!vValue) {
		return DASH;
	}
	const oDate = vValue instanceof Date ? vValue : new Date(vValue);
	if (Number.isNaN(oDate.getTime())) {
		return String(vValue);
	}
	return oTimestampFormat.format(oDate);
}

/**
 * Materialnummer in EINER Schreibweise.
 *
 * WARUM DAS NOETIG IST
 * Dasselbe Feld kommt aus dem Backend in zwei Formen, weil die Klassen es
 * unterschiedlich uebergeben:
 *
 *   ZCL_ZLE_AUST_ITEM_TRIGGER   conv #( lv_matnr )        -> 000000000000011217
 *   ZCL_ZLE_AUST_TO_/OB_TRIGGER |{ matnr alpha = out }|   -> 4028
 *
 * Folgen ohne Normalisierung: Sortieren und Filtern nach Material greift
 * ueber die Zeilen hinweg nicht, und TaskAggregator verdichtet dasselbe
 * Material als ZWEI Zeilen, wenn es sowohl ein Stammdaten- als auch ein
 * WM-Problem hat.
 *
 * Sauber waere es im ABAP (ein Wort in acht add_message-Aufrufen), aber die
 * ERP-Seite ruht. Hier ist es die ALPHA-Konvention: fuehrende Nullen fallen
 * weg, wenn der Wert rein numerisch ist - sonst bleibt er unveraendert.
 * Ein Materialnummer wie "M-4028" wird also nicht angetastet.
 */
export function normalizeMaterial(sValue?: string | null): string {
	const sTrimmed = (sValue ?? "").trim();
	if (!sTrimmed || !/^\d+$/.test(sTrimmed)) {
		return sTrimmed;
	}
	return sTrimmed.replace(/^0+/, "") || "0";
}

/** normalizeMaterial fuer die Anzeige - leer wird zum Gedankenstrich. */
export function materialNumber(sValue?: string | null): string {
	return normalizeMaterial(sValue) || DASH;
}

/**
 * Ueberschrift des Verlaufs mit dem gewaehlten Zeitraum.
 *
 * Der Text traegt einen Platzhalter ("Verlauf ({0} Tage)"), damit die Zahl
 * nicht in drei Uebersetzungen dupliziert werden muss.
 */
export function chartTitle(sPattern?: string | null, vDays?: number | string | null): string {
	return (sPattern ?? "").replace("{0}", String(vDays ?? ""));
}

/**
 * Zaehler eines Prozessreiters - leer, solange nach Vorgang gruppiert wird.
 *
 * WARUM DER ZAEHLER DANN VERSCHWINDET
 * Die Reiterzahlen kommen aus $count ueber ZLE_AUST_APL_LOG und zaehlen
 * MELDUNGEN. In der Vorgangssicht stehen in der Tabelle aber VORGAENGE -
 * "Wareneingang 12" ueber einer Liste mit 5 Zeilen liest sich wie ein
 * Fehler. Lieber keine Zahl als eine, die nicht zu dem passt, was
 * darunter steht; die Summenzeile neben der Tabelle nennt beide.
 *
 * WARUM NICHT DIE VORGANGSZAHL JE REITER
 * Sie waere die Anzahl VERSCHIEDENER CORR_UUID je Filter. OData V4 kann
 * das ohne $apply nicht, und ZLE_AUST_C_APPL_LOG traegt kein
 * @Aggregation.applySupported. Im Browser ginge es nur, indem die
 * Filterlogik aus model/ProcessAxis.ts ein zweites Mal als
 * JS-Praedikate nachgebaut wuerde - genau die Redundanz, gegen die
 * ProcessAxis gebaut wurde.
 *
 * ⚠ Bewusst ein Formatter und KEINE Ausdrucksbindung. count ist eine
 * String-Eigenschaft; eine Ausdrucksbindung wandelt referenzierte Werte
 * vorher in den Zieltyp, aus dem booleschen Flag wuerde "true"/"false" -
 * beides wahr, der Zaehler waere immer leer. Ein Formatter bekommt die
 * Rohwerte.
 */
export function tabCount(bGrouped?: boolean | null, vCount?: number | string | null): string {
	if (bGrouped) {
		return "";
	}
	return vCount === undefined || vCount === null ? "" : String(vCount);
}
