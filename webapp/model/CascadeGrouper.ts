/**
 * Fasst die Logzeilen EINES Vorgangs zu einer Zeile zusammen.
 *
 * WARUM DAS BIS ZUM 26.08.2026 NICHT GING
 * In project2/CLAUDE.md stand unter "Bewusst NICHT gemacht": die drei
 * Kaskadenzeilen zu einem Ereignis zusammenfassen - "es gibt keine
 * Korrelations-ID in der Tabelle, ohne die ist Deduplizieren Raten".
 * Diese Begruendung ist entfallen: ZCL_ZLE_AUST_APPL_LOG schreibt jetzt
 * CORR_UUID (Vorgangsklammer) und SEQ_NR (Reihenfolge darin), und
 * reset_correlation sorgt dafuer, dass die Klammer je FACHLICHER Einheit
 * gilt und nicht je Programmlauf - genau die Granularitaet, die eine
 * Gruppierung braucht.
 *
 * Damit wird aus drei Zeilen fuer ein Ereignis eine Zeile mit drei
 * Schritten. Das ist die direkte Antwort auf "meldungen vernuenftiger
 * gruppieren".
 *
 * ⚠ ALTBESTAND: Saetze aus der Zeit vor der Backend-Aenderung tragen eine
 * INITIALE Korrelations-ID. Wer naiv nach CORR_UUID gruppiert, wirft sie
 * alle in EINE Riesengruppe - der haeufigste Weg, sich diese Auswertung zu
 * zerschiessen. Solche Zeilen bekommen hier deshalb ihre eigene Gruppe
 * ueber die LogUuid und bleiben damit einzeln stehen.
 *
 * ⚠ Die zusammengefassten Zeilen tragen ABSICHTLICH dieselben
 * Eigenschaftsnamen wie die OData-Zeilen (CreatedAtStamp, LogType,
 * Message, ...). Nur so bleiben die bestehenden Tabellenspalten
 * unveraendert nutzbar, wenn die Tabelle zwischen OData und diesem
 * Ergebnis umgebunden wird.
 */

/**
 * Zielgroesse der Sicht - in VORGAENGEN, nicht in Meldungen.
 *
 * 🔴 DIE GRENZE STAND BIS 11.09.2026 IN DER FALSCHEN EINHEIT. Geladen wurden
 * 5000 MELDUNGEN, und was dabei an Vorgaengen herauskam, war Zufall: bei
 * dichter Verdichtung 3000, bei lauter Einzelmeldungen 5000. Die Oberflaeche
 * spricht seit derselben Runde konsequent von Vorgaengen - dann darf die
 * einzige harte Grenze der Sicht nicht die andere Einheit benutzen.
 *
 * Geladen wird jetzt in Bloecken, bis so viele Vorgaenge beisammen sind.
 */
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
export const MAX_OPS = 5000;

/** Blockgroesse je Abfrage. */
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
export const CHUNK_ROWS = 5000;

/**
 * Harte Obergrenze in MELDUNGEN - der Schutz hinter dem Vorgangsziel.
 *
 * 🔴 OHNE DIE WAERE DAS ZIEL UNBESCHRAENKT. Ein Vorgang kann beliebig viele
 * Meldungen haben: der Materialstamm-Sammellauf traegt mehrere tausend unter
 * EINER Korrelations-ID (ZLE_AUST_ITEM_EXPORT ruft reset_correlation( ) nicht,
 * s. MAX_STEPS). Bestuende der Bestand ueberwiegend aus solchen Gruppen,
 * muesste man Hunderttausende Zeilen laden, um 5000 Vorgaenge zu erreichen.
 *
 * Greift diese Grenze, ist das ein eigener Befund und wird auch so benannt -
 * nicht als "Sicht gekappt" wie der Normalfall.
 */
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
export const MAX_ROWS = 20000;

/**
 * Ab wann eine Gruppe kein Vorgang mehr ist, sondern ein SAMMELLAUF.
 *
 * 🔴 DER GRUND STEHT IN MICHAELS DOKU, ALS OFFENER PUNKT P19:
 *
 *   reset_correlation( ) ... in Batch-Verarbeitungen JE FACHLICHER EINHEIT
 *   rufen, sonst traegt ein Lauf ueber 10.000 Artikel EINE EINZIGE UUID und
 *   die Klammer ist wertlos.
 *
 * Genau dieser Aufruf fehlt in ZLE_AUST_ITEM_EXPORT. Ein Massenlauf bildet
 * damit EINEN Vorgang - bei den Materialstamm-Meldungen waeren das leicht
 * mehrere tausend Schritte in einer Zeile, und das Popover baute sie alle im
 * Speicher auf.
 *
 * Ein echter Vorgang hat eine Handvoll Schritte: der HTTP-Fehler aus der
 * Consumer-Schicht, die fachliche Meldung des Triggers, die Quittierung.
 * Michaels Doku nennt drei Saetze je BUSINESS_KEY als den Fall, um den es
 * geht. 25 ist grosszuegig und liegt zugleich weit unter jedem Sammellauf.
 *
 * ⚠ Das bleibt auch nach seinem Fix noetig: der Altbestand behaelt seine
 * Sammel-UUIDs.
 */
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
export const MAX_STEPS = 25;

export interface LogRow {
	LogUuid?: string;
	CorrUuid?: string;
	SeqNr?: number | string;
	CreatedAtStamp?: string;
	LogType?: string;
	HistoryType?: string;
	Message?: string;
	ItemNumber?: string;
	TpaNumber?: string;
	OrderLineNr?: string;
	BusinessKey?: string;
	KeyType?: string;
	Lgnum?: string;
	HttpStatus?: number | string;
	JsonPayload?: string;
	/** Aus dem Service: 'X' = juengster Satz des Schluessels ist ein Erfolg. */
	IsResolved?: string;
}

export interface CascadeRow extends LogRow {
	/** Anzahl Logzeilen des Vorgangs - die WAHRE Zahl, auch bei Sammellaeufen. */
	StepCount: number;
	/**
	 * Die Zeilen des Vorgangs, nach SeqNr aufsteigend.
	 *
	 * ⚠ Bei einem Sammellauf (IsBulk) auf MAX_STEPS gekappt. StepCount nennt
	 * weiterhin die wahre Zahl - die Oberflaeche muss beides auseinanderhalten
	 * und sagen, dass sie nur einen Ausschnitt zeigt.
	 */
	Steps: LogRow[];
	/**
	 * true = mehr Schritte, als ein Vorgang plausibel hat.
	 *
	 * Kein echter Vorgang, sondern ein Programmlauf ohne reset_correlation( ) -
	 * siehe MAX_STEPS. Die Gruppe bleibt bestehen (technisch ist sie richtig:
	 * es IST ein Lauf), wird aber gekennzeichnet.
	 */
	IsBulk: boolean;
}

export interface CascadeResult {
	rows: CascadeRow[];
	/** Zeilen gesamt vor der Verdichtung. */
	sourceCount: number;
	/**
	 * true, wenn es mehr Meldungen gibt als geladen wurden - dann ist die
	 * Sicht unvollstaendig. Ermittelt seit 11.09.2026 ueber $count, nicht
	 * mehr ueber "genau die Obergrenze gelesen, also wohl gekappt".
	 */
	truncated: boolean;
}

/**
 * Ist die Korrelations-ID leer bzw. der Initialwert?
 *
 * Der Wert erreicht die Oberflaeche je nach OData-Typisierung als
 * Guid-Schreibweise ("0000...-0000") oder als Hex-Kette. Beide Formen
 * werden hier erkannt, indem alles ausser Ziffern und Buchstaben entfernt
 * und auf "nur Nullen" geprueft wird.
 */
export function isInitialUuid(sValue?: string | null): boolean {
	const sBare = (sValue ?? "").replace(/[^0-9a-fA-F]/g, "");
	return sBare === "" || /^0+$/.test(sBare);
}

/** E vor W vor S - dieselbe Skala wie LogTypeCriticality im CDS-View. */
function severityRank(sLogType?: string): number {
	switch ((sLogType ?? "").trim().toUpperCase()) {
		case "E": return 3;
		case "W": return 2;
		case "S": return 1;
		default: return 0;
	}
}

function seq(oRow: LogRow): number {
	const iSeq = Number(oRow.SeqNr);
	return Number.isNaN(iSeq) ? 0 : iSeq;
}

/** Erster nicht-leerer Wert einer Eigenschaft über alle Schritte. */
function firstFilled(aSteps: LogRow[], sKey: keyof LogRow): string {
	for (const oStep of aSteps) {
		const vValue = oStep[sKey];
		if (typeof vValue === "string" && vValue.trim()) {
			return vValue;
		}
		if (typeof vValue === "number") {
			return String(vValue);
		}
	}
	return "";
}

/**
 * Die Zeile, die den Vorgang repraesentiert.
 *
 * DAS ABZEICHEN BESCHREIBT DAS ERGEBNIS, NICHT DEN SCHLIMMSTEN MOMENT.
 *
 * Endet der Vorgang mit einem Erfolg, fuehrt der LETZTE Schritt. Sonst
 * gilt die alte Regel: der schwerste, bei Gleichstand der spaeteste.
 *
 * Der Grund ist keine Kosmetik. Die Zeile entscheidet, ob jemand etwas
 * tun muss - und wenn der Vorgang gut ausgegangen ist, muss niemand
 * etwas tun. Vorher gewann die schwerste Zeile immer, mit diesem
 * Ergebnis (echter Fall vom 08.09.2026, TA-Position 48897):
 *
 *   1. ME 'ST' -> 'ROL', Menge umgerechnet          S
 *   2. GET order status failed                      E   <- fuehrte
 *   3. POST create inbound order OK                 S
 *
 * Der Auftrag lag danach in HiLIS, die Zeile zeigte trotzdem rotes E -
 * und als Text ausgerechnet die einzige Meldung ohne Aussagewert, naemlich
 * die Existenzpruefung, deren 404 die richtige Antwort war. Gleichzeitig
 * stand in der Vorgang-Spalte "erledigt". Die Zeile widersprach sich.
 *
 * ⚠ Die Regel ist GRUPPENLOKAL und benutzt bewusst NICHT IsResolved.
 * Jenes Kennzeichen gilt fuer den ganzen Geschaeftsschluessel ueber alle
 * Vorgaenge hinweg: ein gescheiterter Versuch und sein spaeterer
 * erfolgreicher Wiederanstoss sind beide "erledigt". Der gescheiterte
 * Versuch SOLL aber weiter als Fehler erkennbar sein - er ist ja einer
 * gewesen. Nur wer selbst gut ausgeht, wird gruen.
 *
 * ⚠ Fachliche Folge, mit Joerg Tolksdorf zu bestaetigen: ein Vorgang mit
 * einem echten Fehler, der danach im selben Durchlauf gelingt, erscheint
 * unter "Fehler" nicht mehr. Konsequent - "Nur offene" macht es heute
 * schon so -, aber es ist eine Festlegung und keine technische Frage.
 *
 * Verloren geht nichts: alle Zeilen stehen in Steps und sind ueber das
 * Popover einsehbar, die Spalte "Schritte" kuendigt sie an.
 */
function leadRow(aSteps: LogRow[]): LogRow {
	const oLast = aSteps[aSteps.length - 1];
	if (severityRank(oLast?.LogType) === severityRank("S")) {
		return oLast;
	}
	return aSteps.reduce((oBest, oRow) => {
		const iBest = severityRank(oBest.LogType);
		const iRow = severityRank(oRow.LogType);
		if (iRow > iBest) {
			return oRow;
		}
		if (iRow === iBest && seq(oRow) >= seq(oBest)) {
			return oRow;
		}
		return oBest;
	}, aSteps[0]);
}

/**
 * Der Schluessel, unter dem eine Zeile zu einem Vorgang gehoert.
 *
 * 🔴 Eine INITIALE Korrelations-ID bedeutet nicht "gehoert zusammen", sondern
 * "hat keine Klammer" - jede solche Zeile ist ein eigener Vorgang. Wuerde man
 * sie zusammenfassen, kollabierte der gesamte Altbestand zu EINER Zeile.
 *
 * Exportiert, weil der Ladeblock in Main._loadCascades( ) beim Blaettern
 * mitzaehlen muss, wie viele Vorgaenge schon beisammen sind. Er benutzt
 * dieselbe Funktion statt die Regel nachzubauen - sonst liefen die beiden
 * Zaehlungen beim naechsten Anfassen auseinander.
 */
export function operationKey(oRow: LogRow, iIndex: number): string {
	return isInitialUuid(oRow.CorrUuid)
		? `single:${oRow.LogUuid ?? iIndex}`
		: `corr:${oRow.CorrUuid}`;
}

export function group(aRows: LogRow[], bTruncated = false): CascadeResult {
	const mGroups = new Map<string, LogRow[]>();

	aRows.forEach((oRow, iIndex) => {
		const sKey = operationKey(oRow, iIndex);
		const aGroup = mGroups.get(sKey);
		if (aGroup) {
			aGroup.push(oRow);
		} else {
			mGroups.set(sKey, [oRow]);
		}
	});

	const aResult: CascadeRow[] = [];
	mGroups.forEach((aSteps) => {
		aSteps.sort((a, b) => seq(a) - seq(b));
		const oLead = leadRow(aSteps);

		const bBulk = aSteps.length > MAX_STEPS;

		aResult.push({
			...oLead,
			// Der Vorgang beginnt mit seinem ersten Schritt, nicht mit dem
			// schwersten - sonst springt die Zeitachse.
			CreatedAtStamp: aSteps[0].CreatedAtStamp,
			// Bezugsfelder aus dem ganzen Vorgang, nicht nur aus der
			// Leitzeile: der HTTP-Fehler traegt oft kein Material, die
			// fachliche Meldung schon.
			ItemNumber:  firstFilled(aSteps, "ItemNumber"),
			TpaNumber:   firstFilled(aSteps, "TpaNumber"),
			OrderLineNr: firstFilled(aSteps, "OrderLineNr"),
			BusinessKey: firstFilled(aSteps, "BusinessKey"),
			KeyType:     firstFilled(aSteps, "KeyType"),
			HistoryType: firstFilled(aSteps, "HistoryType"),
			Lgnum:       firstFilled(aSteps, "Lgnum"),
			StepCount:   aSteps.length,
			IsBulk:      bBulk,
			// Gekappt, nicht weggeworfen: die ungruppierte Sicht zeigt weiter
			// alles. Hier geht es nur darum, dass ein Sammellauf nicht
			// tausende Listeneintraege im Popover aufbaut.
			Steps:       bBulk ? aSteps.slice(0, MAX_STEPS) : aSteps
		});
	});

	// Neueste zuerst - wie die ungruppierte Tabelle.
	aResult.sort((a, b) => (b.CreatedAtStamp ?? "").localeCompare(a.CreatedAtStamp ?? ""));

	return {
		rows: aResult,
		sourceCount: aRows.length,
		truncated: bTruncated
	};
}
