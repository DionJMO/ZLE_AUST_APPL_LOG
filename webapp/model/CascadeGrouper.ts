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

/** Obergrenze wie beim Chart - der View kennt kein @Aggregation.applySupported. */
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
export const MAX_ROWS = 5000;

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
}

export interface CascadeRow extends LogRow {
	/** Anzahl Logzeilen des Vorgangs. 1 = kein Vorgang, nur eine Meldung. */
	StepCount: number;
	/** Alle Zeilen des Vorgangs, nach SeqNr aufsteigend. */
	Steps: LogRow[];
}

export interface CascadeResult {
	rows: CascadeRow[];
	/** Zeilen gesamt vor der Verdichtung. */
	sourceCount: number;
	/** true, wenn MAX_ROWS erreicht wurde - dann ist die Sicht unvollstaendig. */
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
 * Regel: die SCHWERSTE Zeile; bei Gleichstand die mit der HOECHSTEN SeqNr.
 *
 * Die zweite Haelfte ist die eigentliche Entscheidung. Ein Vorgang endet
 * mit seinem Ergebnis - bei gleichem Schweregrad ist die letzte Meldung
 * die aussagekraeftigere. Der HTTP-Fehler aus der Consumer-Schicht kommt
 * zuerst, die fachliche Zusammenfassung des Triggers danach.
 *
 * Verloren geht dabei nichts: alle Zeilen stehen in Steps und sind ueber
 * das Popover einsehbar.
 */
function leadRow(aSteps: LogRow[]): LogRow {
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

export function group(aRows: LogRow[], bTruncated = false): CascadeResult {
	const mGroups = new Map<string, LogRow[]>();

	aRows.forEach((oRow, iIndex) => {
		// Initiale Korrelations-ID -> eigene Gruppe, sonst kollabiert der
		// gesamte Altbestand zu einer einzigen Zeile.
		const sKey = isInitialUuid(oRow.CorrUuid)
			? `single:${oRow.LogUuid ?? iIndex}`
			: `corr:${oRow.CorrUuid}`;
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
			Steps:       aSteps
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
