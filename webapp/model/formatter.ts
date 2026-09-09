import { isInitialUuid } from "./CascadeGrouper";
import { positionFrom } from "./BusinessKey";
import DateFormat from "sap/ui/core/format/DateFormat";
import NumberFormat from "sap/ui/core/format/NumberFormat";
import * as MessageText from "./MessageText";

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

/**
 * Klartext zum Meldungstyp - fuer den Tooltip der Typ-Spalte.
 *
 * Die Spalte zeigt nur noch Symbol und Farbe (Festlegung Maring, 03.09.2026);
 * der Buchstabe E/W/S sagte niemandem etwas, der die Domaene nicht kennt.
 * Das Wort steht deshalb im Tooltip - und weil ein Symbol ohne Text sonst
 * keinen Namen haette, ist es zugleich der ZUGAENGLICHE NAME der Zelle.
 *
 * ⚠ Einzahl, anders als die Filterknoepfe darueber ("Fehler/Abbrueche/
 * Erfolge"): dort steht eine Menge, hier eine einzelne Meldung.
 *
 * Ein unbekannter Wert faellt auf den Rohwert zurueck statt auf einen
 * Gedankenstrich - ein neuer Festwert soll sichtbar sein, nicht verschwinden.
 */
export function logTypeTooltip(
	sLogType?: string | null,
	sError?: string | null,
	sAbort?: string | null,
	sSuccess?: string | null
): string {
	const s = (sLogType ?? "").trim().toUpperCase();
	switch (s) {
		case "E": return (sError ?? "").trim();
		case "W": return (sAbort ?? "").trim();
		case "S": return (sSuccess ?? "").trim();
		default: return (sLogType ?? "").trim();
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
export function tabCount(vCount?: number | string | null): string {
	return vCount === undefined || vCount === null ? "" : String(vCount);
}

/**
 * Der Schluesseltyp als lesbarer Text.
 *
 * 🔴 BEWUSST HIER UND NICHT AUS DER DOMAENE. Die Festwerttexte von
 * ZLE_AUST_KEY_TYPE sind im DDIC VERTAUSCHT - PICK traegt "Wareneingang (IB)"
 * und PUT "Warenausgang (OB)", also jeweils das Gegenteil. Wer die
 * Domaenentexte als Beschriftung uebernimmt, beschriftet spiegelverkehrt.
 * Dass es ein Versehen ist, belegt die Schwesterdomaene ZLE_AUST_ACTION, die
 * es richtig hat (PICK_CREAT = "OB Anlage").
 *
 * Die Zuordnung hier folgt der RICHTIGEN Bedeutung: PUT = PutAway =
 * Einlagerung, PICK = Auslagerung. Solange die Domaene nicht berichtigt ist,
 * ist das die einzige Stelle, an der die App das richtig anzeigt.
 *
 * Unbekannte Werte bleiben unveraendert stehen - ein fuenfter Festwert soll
 * sichtbar sein und nicht stillschweigend zu einem Gedankenstrich werden.
 */
export function keyTypeText(sKeyType?: string | null): string {
	switch ((sKeyType ?? "").trim().toUpperCase()) {
		case "PUT": return "Einlagerung";
		case "PICK": return "Auslagerung";
		case "MATNR": return "Materialstamm";
		case "ADVICE": return "Lieferanzeige";
		default: return (sKeyType ?? "").trim() || "–";
	}
}

/**
 * Gehoert die Zeile zu einem echten Vorgang?
 *
 * Altbestand traegt eine INITIALE Korrelations-ID - dort fuehrte der Sprung
 * ins Leere. Die Erkennung kommt aus CascadeGrouper und wird bewusst nicht
 * nachgebaut: sie muss mit der Gruppierung uebereinstimmen, sonst zeigte die
 * eine Stelle einen Vorgang an, den die andere nicht kennt.
 */
export function hasCorrelation(sCorrUuid?: string | null): boolean {
	return !isInitialUuid(sCorrUuid);
}

/**
 * Klartext zum Status eines Arbeitsvorrats-Satzes.
 *
 * Festwerte der Domaene ZLE_AUST_REPROC_STAT. 'I' ist der wichtigste Wert und
 * der unauffaelligste: bleibt ein Satz darauf stehen, war es ein Abbruch OHNE
 * catch (Kurzdump, Timeout, ICF-Abbruch) - der Totmannschalter des Frameworks.
 * Deshalb heisst er hier nicht bloss "laufend", sondern nennt den Verdacht.
 *
 * ⚠ Deutsch fest verdrahtet, wie keyTypeText und historyTypeText auch. Das
 * sind die drei verbliebenen deutschsprachigen Stellen einer sonst
 * durchgaengig ueber i18n uebersetzten Oberflaeche - ein XML-Formatter kommt
 * an das ResourceBundle nicht heran. Wird das gestoert, ist der Weg der von
 * model/MessageText.ts: Muster im Code, Wortlaut im Bundle, einmalig ueber
 * init( ) zwischengespeichert.
 */
export function reprocStatusText(sStatus?: string | null): string {
	switch ((sStatus ?? "").trim().toUpperCase()) {
		case "I": return "laufend / abgebrochen?";
		case "O": return "offen";
		case "D": return "erledigt";
		case "F": return "endgültig gescheitert";
		case "C": return "manuell erledigt";
		default: return (sStatus ?? "").trim() || "–";
	}
}

/**
 * "3 / 5" - Versuchszaehler gegen den Deckel aus ZLE_AUST_REPROCC.
 *
 * Ohne gepflegtes MAX_COUNT (oder bei 0) steht dort nur die Zahl: der
 * Dispatcher prueft den Deckel ausdruecklich nur bei "max_count > 0", ein
 * "3 / 0" waere also nicht bloss haesslich, sondern sachlich falsch.
 */
/**
 * Beschriftung der Aktionsspalte im Arbeitsvorrat.
 *
 * 🔴 ActionText kommt aus ZLE_AUST_REPROCC-DESCRIPTION und ist dort NICHT
 * fuer jeden Aktionscode gepflegt. Mit dashIfEmpty stand in solchen Zeilen
 * ein Gedankenstrich - und weil der Schluessel von ZLE_AUST_REPROC aus
 * ACTION + BUSINESS_KEY besteht, sahen zwei Saetze zur selben TA (Anlage und
 * Quittierung) dann VOELLIG GLEICH aus. Genau die Spalte, die sie
 * unterscheidet, war leer.
 *
 * Deshalb Rueckfall auf den technischen Code statt auf einen Strich: lieber
 * PICK_CONFIRM lesen als gar nichts.
 */
export function reprocAction(
	sActionText?: string | null,
	sAction?: string | null
): string {
	const sText = (sActionText ?? "").trim();
	if (sText) {
		return sText;
	}
	return (sAction ?? "").trim() || DASH;
}

export function reprocTries(
	vTry?: number | string | null,
	vMax?: number | string | null
): string {
	const nTry = Number(vTry ?? 0);
	const nMax = Number(vMax ?? 0);
	if (!Number.isFinite(nTry)) {
		return "–";
	}
	return Number.isFinite(nMax) && nMax > 0 ? `${nTry} / ${nMax}` : String(nTry);
}

function reprocEntries<T>(
	sBusinessKey?: string | null,
	oMap?: Record<string, T[]> | null
): T[] {
	const sKey = (sBusinessKey ?? "").trim();
	if (!sKey || !oMap) {
		return [];
	}
	return oMap[sKey] ?? [];
}

/**
 * Zusammenfassung des Arbeitsvorrats zu einem Business-Key.
 *
 * 🔴 Warum keine einzelne Aktion gezeigt wird: zu einem Business-Key koennen
 * mehrere Saetze gehoeren (Anlage, Storno, Quittierung derselben Position),
 * und die Logzeile traegt keine Aktion. Bei mehreren steht deshalb nur die
 * Anzahl - welche gemeint ist, entscheidet der Anwender im Popover.
 *
 * ⚠ Deutsch fest verdrahtet, wie bei keyTypeText, historyTypeText und
 * reprocStatusText. Das sind die vier verbliebenen deutschsprachigen Stellen
 * einer sonst ueber i18n uebersetzten Oberflaeche - ein XML-Formatter kommt
 * an das ResourceBundle nicht heran. Wer das aufloest, nimmt den Weg von
 * model/MessageText.ts: Muster im Code, Wortlaut im Bundle, einmalig ueber
 * init( ) zwischengespeichert.
 */
export function reprocLabel(
	sBusinessKey?: string | null,
	oMap?: Record<string, { Status?: string }[]> | null
): string {
	const a = reprocEntries(sBusinessKey, oMap);
	if (a.length === 0) {
		return DASH;
	}
	return a.length === 1 ? reprocStatusText(a[0].Status) : `${a.length} Aktionen`;
}

/** Gibt es zu diesem Schluessel ueberhaupt etwas anzustossen? */
export function hasReproc(
	sBusinessKey?: string | null,
	oMap?: Record<string, unknown[]> | null
): boolean {
	return reprocEntries(sBusinessKey, oMap).length > 0;
}

/**
 * Tooltip der Spalte: alle Saetze zum Schluessel, einer je Zeile.
 *
 * Der Umbruch ist ein echtes \n - ein title-Attribut bricht daran um. Damit
 * sieht man ohne Klick, welche Aktionen offen sind.
 */
export function reprocTooltip(
	sBusinessKey?: string | null,
	oMap?: Record<string, { Action?: string; ActionText?: string; Status?: string }[]> | null,
	sNone?: string | null
): string {
	const a = reprocEntries(sBusinessKey, oMap);
	if (a.length === 0) {
		// Nicht leer lassen: ohne Tooltip bliebe offen, ob es keinen Eintrag
		// gibt oder ob die Zelle nur nichts anzuzeigen weiss.
		return (sNone ?? "").trim();
	}
	return a.map((o) => `${reprocAction(o.ActionText, o.Action)}: ${reprocStatusText(o.Status)}`)
		.join("\n");
}


/** "offen (2 / 3)" - Status und Versuchszaehler in einem Zug. */
export function reprocStatusTries(
	sStatus?: string | null,
	vTry?: number | string | null,
	vMax?: number | string | null
): string {
	return `${reprocStatusText(sStatus)} (${reprocTries(vTry, vMax)})`;
}

/** "Letzter Versuch: 03.09.2026 08:12:44" - Beschriftung plus Zeitstempel. */
export function labelledTimestamp(
	sLabel?: string | null,
	vValue?: string | Date | null
): string {
	return `${(sLabel ?? "").trim()} ${timestamp(vValue)}`.trim();
}

/**
 * Wert einer TA-Position aus dem Nachschlagewerk von model/TaPositions.ts.
 *
 * 🔴 WOFUER: ZLE_AUST_TPA_SYNC fuellt MEASUREMENT_UNIT und BEST_BEFORE_DATE
 * NIE - beide kommen nicht aus GET_ORDER_LIST, die Spalten waren strukturell
 * leer. Die Anforderung F-01 verlangt aber ausdruecklich MHD und ME. Beides
 * steht in LTAP und kommt jetzt von dort.
 *
 * ⚠ Bewusst als Formatter mit einem Modell-Teil statt einer Umbindung der
 * Tabelle: so bleibt die OData-Bindung samt serverseitigem Blaettern und
 * Sortieren unveraendert. Aendert sich das Nachschlagewerk, aktualisiert UI5
 * die Zellen von selbst, weil es als Bindungsteil mitgefuehrt wird.
 */
function sapPosValue(
	sOrder: string | null | undefined,
	vLine: string | number | null | undefined,
	oMap: Record<string, Record<string, unknown>> | null | undefined,
	sField: string
): string {
	if (!oMap) {
		return "";
	}
	const sOrd = (sOrder ?? "").trim();
	const nLine = Number(String(vLine ?? "").trim());
	const sKey = `${sOrd}/${Number.isNaN(nLine) ? String(vLine ?? "").trim() : String(nLine)}`;
	const vValue = oMap[sKey]?.[sField];
	return typeof vValue === "string" || typeof vValue === "number" ? String(vValue).trim() : "";
}

/** MHD der TA-Position (LTAP-VFDAT). Leer, solange das Nachschlagewerk fehlt. */
export function sapBestBefore(
	sOrder?: string | null,
	vLine?: string | number | null,
	oMap?: Record<string, Record<string, unknown>> | null
): string {
	return sapPosValue(sOrder, vLine, oMap, "ShelfLifeExpirationDate") || "–";
}

/** Mengeneinheit der TA-Position (LTAP-ALTME). */
export function sapUnit(
	sOrder?: string | null,
	vLine?: string | number | null,
	oMap?: Record<string, Record<string, unknown>> | null
): string {
	return sapPosValue(sOrder, vLine, oMap, "AlternativeUnit") || "–";
}

/**
 * Ist der gewaehlte Reiter eine MELDUNGSSICHT?
 *
 * ⚠ Zentral, weil die Bedingung an fuenf Stellen haengt: Typfilter, Suchfeld,
 * Vorgangsschalter und beide Meldungstabellen. Als Literalvergleich
 * ("!== 'TPA'") stand sie fuenfmal im XML - ein sechster Reiter haette sechs
 * Stellen gebraucht, und eine vergessene faellt erst im Browser auf.
 *
 * Auftragspuffer und Warenausgangs-Pruefung sind KEINE Meldungssichten: sie
 * zeigen SAP- bzw. HiLIS-Daten, fuer die E/W/S, Suche und Vorgangsverdichtung
 * keinen Sinn ergeben.
 */
export function isMessageView(sProcess?: string | null): boolean {
	const s = (sProcess ?? "").trim();
	return s !== "TPA" && s !== "WACHECK";
}


/*
 * Klartext fuer HISTORY_TYPE.
 *
 * 🔴 DIE APP IST DIE EINZIG MOEGLICHE QUELLE. Das Datenelement
 * ZLE_AUST_HIST_TYPE ist CHAR20 OHNE DOMAENE (am System bestaetigt: das Feld
 * `domain` ist leer). Es gibt also keine Festwerte, keine Pruefung und keine
 * F4-Hilfe - die Werte sind reine Konvention. Ein lesbarer Text kann nirgends
 * sonst herkommen.
 *
 * ⚠ Die PICK-*-Bedeutungen sind aus ZCL_ZLE_AUST_MOD_OU_TPA abgeleitet
 * (Punkt 10: Auftragstyp, WA-Buchung, TPA-Druck), nicht aus einer
 * Wertebeschreibung - es gibt keine.
 */
/* eslint-disable @sap-ux/fiori-tools/sap-no-global-variable */
const HIST_TEXT: Record<string, string> = {
	IB_CREATE:  "Einlagerung anlegen",
	IB_CANCEL:  "Einlagerung stornieren",
	IB_CONFIRM: "Einlagerung quittieren",
	IB_GET:     "Einlagerung lesen",
	IB_STAT:    "Einlagerung Status",
	IB_LSTAT:   "Einlagerung Zeilenstatus",
	IB_LIST:    "Einlagerung Liste",
	IB_ADDLN:   "Einlagerung Zeile ergänzen",
	IB_UPDATE:  "Einlagerung ändern",
	IB_CANCLN:  "Einlagerung Zeile stornieren",
	OB_CREATE:  "Auslagerung anlegen",
	OB_CANCEL:  "Auslagerung stornieren",
	OB_CONFIRM: "Auslagerung quittieren",
	ITEM_GET:    "Material lesen",
	ITEM_LIST:   "Materialliste",
	ITEM_CREATE: "Material anlegen",
	ITEM_UPDATE: "Material ändern",
	ITEM_DELETE: "Material löschen",
	ITEM_IMG:    "Materialbild",
	"PICK-ORDCAT":     "Pick: Auftragstyp",
	"PICK-WA-BUCHUNG": "Pick: Warenausgangsbuchung",
	"PICK-TPA-DRUCK":  "Pick: TPA-Druck",
	STOCKCORRECTION:   "Bestandskorrektur"
};
/* eslint-enable @sap-ux/fiori-tools/sap-no-global-variable */

/**
 * HISTORY_TYPE als lesbarer Text.
 *
 * ⚠ Unbekannte Werte bleiben UNVERAENDERT stehen. Das Vokabular ist laut
 * Michaels Doku (P18) noch uneinheitlich - mehrere Namensschemata parallel,
 * teils hartcodiert. Ein unbekannter Wert soll deshalb sichtbar bleiben und
 * nicht zu einem Gedankenstrich werden; sonst verschwindet genau das, was
 * beim Aufraeumen zu finden waere.
 */
export function historyTypeText(sHistoryType?: string | null): string {
	const sRaw = (sHistoryType ?? "").trim();
	if (!sRaw) {
		return "–";
	}
	return HIST_TEXT[sRaw.toUpperCase()] ?? sRaw;
}

/**
 * Die Positionsnummer einer Meldung.
 *
 * Bevorzugt das protokollierte Feld. Fehlt es - Michaels offener Punkt P17,
 * viele Aufrufer geben es nicht mit -, wird es bei KEY_TYPE = PUT aus dem
 * BUSINESS_KEY abgeleitet: dort steckt die TAPOS an Stelle 11 bis 14.
 *
 * Bei PICK gibt es keine Position: eine PickOrder umfasst die ganze TA.
 */
export function orderLine(
	sOrderLineNr?: string | null,
	sBusinessKey?: string | null,
	sKeyType?: string | null
): string {
	const sLogged = (sOrderLineNr ?? "").trim();
	if (sLogged) {
		return sLogged;
	}
	return positionFrom(sBusinessKey, sKeyType) || "–";
}

/** Woher die angezeigte Positionsnummer stammt - als Tooltip. */
export function orderLineSource(
	sOrderLineNr?: string | null,
	sBusinessKey?: string | null,
	sKeyType?: string | null
): string {
	if ((sOrderLineNr ?? "").trim()) {
		return "";
	}
	return positionFrom(sBusinessKey, sKeyType)
		? "Aus dem Business-Key abgeleitet - der Aufrufer hat die Position nicht protokolliert."
		: "";
}

/**
 * Tooltip der Schritte-Zahl.
 *
 * Bei einem Sammellauf (siehe CascadeGrouper.MAX_STEPS) muss dranstehen, dass
 * die Gruppe kein Vorgang ist - sonst liest sich "3212 Schritte" wie ein
 * einzelnes Ereignis mit sehr vielen Meldungen.
 */
export function cascSteps(vStepCount?: number | string | null, bIsBulk?: boolean | null): string {
	if (bIsBulk) {
		return `Sammellauf mit ${String(vStepCount ?? "")} Meldungen - kein einzelner Vorgang. `
			+ "Im Programmlauf fehlt reset_correlation( ), deshalb tragen alle Meldungen "
			+ "dieselbe Korrelations-ID. Es wird nur ein Ausschnitt angezeigt.";
	}
	return "Alle Schritte dieses Vorgangs anzeigen";
}

/**
 * EINZIGER Einstiegspunkt fuer die Anzeige eines Meldungstexts.
 *
 * Reihenfolge: sprechende Uebersetzung, sonst die Praefix-Bereinigung,
 * sonst der Originaltext. Bewusst EINE Funktion und nicht zwei Formatter
 * hintereinander - sonst arbeiten beide am selben Text und das Ergebnis
 * haengt davon ab, in welcher Reihenfolge sie im XML stehen.
 *
 * Der Originaltext bleibt in der Zelle als Tooltip gebunden.
 */
export function messageDisplay(sMessage?: string | null): string {
	const sSpeaking = MessageText.translate(sMessage);
	return sSpeaking !== "" ? sSpeaking : messageShort(sMessage);
}


/**
 * Drei Zustaende, nicht zwei: erledigt, offen und "nicht zuordenbar".
 *
 * 🔴 Ein LEERER Business-Key ist NICHT erledigt. Der CDS-View liefert fuer
 * solche Zeilen ein leeres IsResolved - fachlich richtig "nicht erledigt",
 * aber nicht dasselbe wie "geprueft und offen". Wer das zusammenwirft,
 * behauptet einen Befund, wo gar keine Aussage vorliegt. Deshalb bekommt der
 * Fall eine eigene Auspraegung und in der Oberflaeche ein Fragezeichen.
 *
 * Die Luecke ist bekannt und wird ueber die Kennzahl "Ohne Business-Key"
 * gemessen (Michaels P17) - sie soll sichtbar bleiben, nicht verschwinden.
 */
function resolvedKind(sIsResolved?: string | null, sBusinessKey?: string | null): string {
	if ((sBusinessKey ?? "").trim() === "") {
		return "unknown";
	}
	return (sIsResolved ?? "").trim().toUpperCase() === "X" ? "resolved" : "open";
}

/**
 * Tooltip der Vorgangsspalte. Traegt ZWEI Aussagen, weil die Zelle nur noch
 * ein Symbol zeigt (Festlegung Maring, 03.09.2026):
 *
 *   Zeile 1   der Zustand - erledigt, offen, oder kein Vorgangsbezug
 *   Zeile 2+  was im Arbeitsvorrat dazu offen ist, eine Aktion je Zeile
 *
 * 🔴 Ohne Zeile 1 waere die Spalte unlesbar geworden: das Fragezeichen-Symbol
 * bei fehlendem Business-Key hatte vorher den Gedankenstrich als Erklaerung
 * daneben. Ein Symbol ohne Text braucht den Namen im Tooltip - und hier ist
 * es zugleich der zugaengliche Name der Zelle.
 *
 * Der Umbruch ist ein echtes \n; ein title-Attribut bricht daran um.
 */
export function resolvedTooltip(
	sIsResolved?: string | null,
	sBusinessKey?: string | null,
	sResolved?: string | null,
	sOpen?: string | null,
	sUnknown?: string | null,
	oMap?: Record<string, { Action?: string; ActionText?: string; Status?: string }[]> | null,
	sNone?: string | null
): string {
	const sKind = resolvedKind(sIsResolved, sBusinessKey);
	let sHead = sUnknown ?? "";
	if (sKind === "resolved") {
		sHead = sResolved ?? "";
	} else if (sKind === "open") {
		sHead = sOpen ?? "";
	}
	const sBody = reprocTooltip(sBusinessKey, oMap, sNone);
	return [sHead.trim(), sBody.trim()].filter((x) => x !== "").join("\n");
}

export function resolvedState(sIsResolved?: string | null, sBusinessKey?: string | null): string {
	const sKind = resolvedKind(sIsResolved, sBusinessKey);
	if (sKind === "resolved") {
		return "Success";
	}
	return sKind === "open" ? "Warning" : "None";
}

export function resolvedIcon(sIsResolved?: string | null, sBusinessKey?: string | null): string {
	const sKind = resolvedKind(sIsResolved, sBusinessKey);
	if (sKind === "resolved") {
		return "sap-icon://sys-enter-2";
	}
	return sKind === "open" ? "sap-icon://pending" : "sap-icon://question-mark";
}


/**
 * Tooltip des Aktualisierungsschalters - nennt die AKTION, nicht den Zustand.
 *
 * Dieselbe Regel wie beim Dunkelmodus (Festlegung Maring): den Zustand zeigt
 * der Schalter schon selbst, mit Stellung und Beschriftung "Live" bzw. "Aus".
 * Ihn im Tooltip zu wiederholen waere doppelt gemoppelt; die offene Frage beim
 * Draufzeigen ist "was passiert, wenn ich klicke".
 *
 * ⚠ Der Tooltip ist zugleich der ZUGAENGLICHE NAME des Schalters - ein
 * sap.m.Switch traegt keine eigene Beschriftung, und der Label davor ist mit
 * customTextOn entfallen. "Selbsttaetige Aktualisierung ausschalten" ist als
 * Name brauchbar; ein blosses "Aus" waere es nicht.
 */
export function autoRefreshTooltip(
	bOn?: boolean | null,
	sToOff?: string | null,
	sToOn?: string | null
): string {
	return (bOn === true ? sToOff : sToOn) ?? "";
}

/**
 * Symbol des Dunkelmodus-Schalters - zeigt die AKTION, nicht den Zustand.
 *
 * Festlegung Maring: man klickt auf das, was man haben WILL. Im hellen Modus
 * steht dort also der Mond, im dunklen die Sonne. Symbol und Tooltip sagen
 * damit dasselbe und verstaerken sich.
 *
 * ⚠ Die gedrueckte Darstellung des ToggleButton zeigt weiterhin den ZUSTAND
 * und laeuft dieser Logik entgegen (gedrueckt + Sonne = "dunkel ist an, klick
 * fuer hell"). Wenn das stoert, ist ein einfacher Button die konsequentere
 * Wahl - dann traegt allein das Symbol die Aussage.
 *
 * ℹ 01.09.2026 kurzzeitig durch einen sap.m.Switch ersetzt und wieder
 * zurueckgebaut: ein Switch hat KEINE Icon-Eigenschaft (nur customTextOn/Off
 * und das feste Haken/Kreuz von type="AcceptReject"). Zwischen Schalter und
 * Symbol hat das Symbol den Vorzug bekommen.
 */
export function darkModeIcon(bDark?: boolean | null): string {
	return bDark === true ? "sap-icon://light-mode" : "sap-icon://dark-mode";
}

/** Tooltip nennt die Aktion, passend zum jeweils anderen Modus. */
export function darkModeTooltip(
	bDark?: boolean | null,
	sToLight?: string | null,
	sToDark?: string | null
): string {
	return (bDark === true ? sToLight : sToDark) ?? "";
}
