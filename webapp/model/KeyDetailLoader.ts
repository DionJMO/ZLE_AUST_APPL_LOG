import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ResourceBundle from "sap/base/i18n/ResourceBundle";
import { normalizeMaterial, timestamp, dashIfEmpty } from "./formatter";

/**
 * Laedt die Detailsicht zu EINER TPA- oder Materialnummer.
 *
 * Quelle sind ausschliesslich die beiden vorhandenen OData-Services. SAP-Felder
 * aus LTAK/LTAP oder MARA sind vom Frontend nicht erreichbar - dafuer braucht
 * es einen eigenen CDS-View (Phase 2, siehe project2/CLAUDE.md).
 *
 * ⚠ SEIT 27.08.2026 NUR NOCH DER LOG. Die Pufferzeilen aus ZLE_AUST_TPA
 * sind hier entfallen - seit model/SapLookup.ts die TA-Positionen aus
 * LTAK/LTAP liefert, zeigten sie dieselbe Sache aus der schwaecheren Quelle
 * (HiLIS' Sicht statt SAPs), und als eigener Reiter gibt es den Puffer
 * ohnehin. Damit auch eine OData-Abfrage weniger je Oeffnen.
 */

/*
 * Konstanten eines ES-Moduls, keine globalen Bezeichner - die Regel
 * sap-no-global-variable behandelt Modul-Scope faelschlich als globalen Scope
 * (gleiche Ausnahme wie in model/ProcessAxis.ts und model/formatter.ts).
 */
/* eslint-disable @sap-ux/fiori-tools/sap-no-global-variable */
/** Obergrenzen je Abfrage. Wird eine erreicht, sagt es die Kopfzeile. */
const MAX_LOG = 100;
/** Laenge von MATNR - fuer die gepolsterte Schreibweise. */
const MATNR_LEN = 18;
/** Laenge von LTAK-TANUM. */
const TANUM_LEN = 10;
/** Feldliste beider Ladewege - JsonPayload ist dabei, TpaNumber fuer den Bezug. */
const LOG_SELECT = "LogUuid,CreatedAtStamp,SeqNr,LogType,HistoryType,TpaNumber,"
	+ "OrderLineNr,ItemNumber,HttpStatus,Message,JsonPayload";
/* eslint-enable @sap-ux/fiori-tools/sap-no-global-variable */

export type KeyKind = "TPA" | "ITEM";

export interface LogEntry {
	stamp: string;
	logType: string;
	message: string;
	process: string;
	http: string;
	line: string;
	payload: string;
}

export interface KeyDetail {
	title: string;
	subtitle: string;
	logHeader: string;
	log: LogEntry[];
}

/**
 * Alle Schreibweisen, unter denen ein Schluessel in der Datenbank stehen kann.
 *
 * Bei Materialnummern sind es zwei: die ALPHA-konvertierte ("4028") und die
 * gepolsterte ("000000000000004028"). Die Trigger-Klassen benutzen beide, und
 * ein Filter auf nur eine Form fuende die Haelfte der Zeilen nicht.
 *
 * ⚠ Bewusst zwei EXAKTE Vergleiche statt endswith: "4028" ist ein Suffix von
 * "14028", ein endswith-Filter zoege also fremde Materialien mit herein.
 */
function keyForms(sValue: string, bPad: boolean): string[] {
	const sTrimmed = (sValue ?? "").trim();
	if (!sTrimmed) {
		return [];
	}
	if (!bPad || !/^\d+$/.test(sTrimmed)) {
		return [sTrimmed];
	}
	const sBare = normalizeMaterial(sTrimmed);
	const sPadded = sBare.padStart(MATNR_LEN, "0");
	return sBare === sPadded ? [sBare] : [sBare, sPadded];
}

/**
 * Die reine TA-Nummer aus jeder Schreibweise.
 *
 * 🔴 DER GRUND: TPA_NUMBER traegt ZWEI Formate nebeneinander. Die
 * Trigger-Klassen schreiben die blanke TANUM (10), die Consumer-Schicht die
 * zusammengesetzte HiLIS-Auftragsnummer (17 bei PutAway, 13 bei Pick). Ein
 * Filter auf Gleichheit fand deshalb IMMER NUR EINE HAELFTE der Geschichte:
 * klickte man die lange Form an, fehlten die Trigger-Meldungen, klickte man
 * die kurze, fehlten die HTTP-Fehler des Consumers.
 *
 * Beide Formate BEGINNEN mit der TANUM - darauf laesst sich der Filter
 * stellen. Eine Verwechslung ist ausgeschlossen, weil TANUM immer zehn
 * Stellen hat; eine fremde TA kann nicht mit dieser beginnen.
 */
function tanumFrom(sValue: string): string {
	const sTrimmed = (sValue ?? "").trim();
	if (!sTrimmed || !/^\d+$/.test(sTrimmed)) {
		return sTrimmed;
	}
	return sTrimmed.length > TANUM_LEN ? sTrimmed.slice(0, TANUM_LEN) : sTrimmed.padStart(TANUM_LEN, "0");
}

/** OData-Stringliteral: einfache Anfuehrungszeichen werden verdoppelt. */
function literal(sValue: string): string {
	return `'${sValue.replace(/'/g, "''")}'`;
}

function orFilter(sField: string, aValues: string[]): string {
	return aValues.map((s) => `${sField} eq ${literal(s)}`).join(" or ");
}

/** Ein Praefix, mehrere Felder, ODER-verknuepft. */
function startsWithFilter(aFields: string[], sPrefix: string): string {
	return aFields.map((s) => `startswith(${s},${literal(sPrefix)})`).join(" or ");
}

async function fetchRows(
	oModel: ODataModel,
	sPath: string,
	sSelect: string,
	sFilter: string,
	sOrderBy: string,
	iMax: number
): Promise<Record<string, unknown>[]> {
	const mParameters: Record<string, string | boolean> = {
		$select: sSelect,
		$filter: sFilter
	};
	if (sOrderBy) {
		mParameters.$orderby = sOrderBy;
	}
	const oBinding = oModel.bindList(sPath, undefined, [], [], mParameters);
	const aContexts = await oBinding.requestContexts(0, iMax);
	return aContexts.map((oContext) => oContext.getObject() as Record<string, unknown>);
}

/**
 * Skalarwert als Text. Bewusst NICHT String( ) auf beliebige Objekte - ein
 * Objekt in einem skalaren OData-Feld waere ein Fehler und soll nicht als
 * "[object Object]" in der Oberflaeche landen.
 */
function text(vValue: unknown): string {
	if (typeof vValue === "string") {
		return vValue;
	}
	if (typeof vValue === "number" || typeof vValue === "boolean") {
		return String(vValue);
	}
	return "";
}

/** Rohes JSON lesbar machen - misslingt das Parsen, bleibt der Originaltext. */
function prettyJson(sPayloadRaw: string): string {
	const sRaw = (sPayloadRaw ?? "").trim();
	if (!sRaw) {
		return "";
	}
	try {
		return JSON.stringify(JSON.parse(sRaw), null, 2);
	} catch {
		return sRaw;
	}
}

function countText(oBundle: ResourceBundle, sKey: string, iCount: number, iMax: number): string {
	const sSuffix = iCount >= iMax ? "+" : "";
	return oBundle.getText(sKey, [`${iCount}${sSuffix}`]) ?? "";
}

/**
 * 🔴 ZWEI LITERALFORMEN, WEIL DER TYP NICHT SICHER IST.
 *
 * CORR_UUID haengt an der Domaene SYSUUID_X16 (RAW 16). SADL bildet das
 * ueblicherweise auf Edm.Guid ab - dessen Literal steht in OData V4 OHNE
 * Anfuehrungszeichen. Kommt es dagegen als Edm.String heraus, braucht es
 * welche. Welches von beidem gilt, steht im $metadata des Service und war
 * beim Bauen nicht einsehbar.
 *
 * Statt zu raten: erst die Guid-Form, bei Fehlschlag die String-Form. Der
 * Wert selbst stammt aus der Zeile, seine Schreibweise passt also per
 * Konstruktion.
 */
async function fetchByCorr(oModel: ODataModel, sCorrUuid: string): Promise<Record<string, unknown>[]> {
	if (!sCorrUuid) {
		return [];
	}
	for (const sLiteral of [sCorrUuid, literal(sCorrUuid)]) {
		try {
			return await fetchRows(
				oModel,
				"/AppLog",
				LOG_SELECT,
				`CorrUuid eq ${sLiteral}`,
				"SeqNr asc",
				MAX_LOG
			);
		} catch {
			// naechste Literalform versuchen
		}
	}
	return [];
}

/** Eine Logzeile in einen Popover-Eintrag - fuer beide Ladewege dieselbe. */
function toEntry(oBundle: ResourceBundle): (oRow: Record<string, unknown>) => LogEntry {
	return (oRow) => ({
		stamp: timestamp(text(oRow.CreatedAtStamp)),
		logType: text(oRow.LogType),
		message: text(oRow.Message),
		process: oBundle.getText("popAttrProcess", [dashIfEmpty(text(oRow.HistoryType))]) ?? "",
		http: oRow.HttpStatus ? (oBundle.getText("popAttrHttp", [text(oRow.HttpStatus)]) ?? "") : "",
		line: oRow.OrderLineNr ? (oBundle.getText("popAttrLine", [text(oRow.OrderLineNr)]) ?? "") : "",
		payload: prettyJson(text(oRow.JsonPayload))
	});
}

/**
 * Alle Meldungen EINES Vorgangs, ueber die Korrelations-ID.
 *
 * Das ist die Antwort auf „wo seh ich die restlichen Abbruchmeldungen zur
 * Zeile?" aus der Einzelmeldungs-Sicht: dort gibt es - anders als in der
 * Vorgangssicht mit ihrer Schritte-Spalte - sonst keinen Weg zu den
 * Geschwisterzeilen.
 *
 * ⚠ AUFSTEIGEND nach SEQ_NR, nicht absteigend wie sonst in dieser App. Ein
 * Vorgang wird von vorn gelesen; und genau dafuer gibt es das Feld, weil
 * CREATED_AT innerhalb einer LUW kollidieren kann.
 */
export async function loadCorrDetail(
	oMainModel: ODataModel,
	sCorrUuid: string,
	oBundle: ResourceBundle
): Promise<KeyDetail> {
	const aRows = await fetchByCorr(oMainModel, (sCorrUuid ?? "").trim());
	const aLog = aRows.map(toEntry(oBundle));
	return {
		title: oBundle.getText("popTitleCorr", [String(aLog.length)]) ?? "",
		subtitle: "",
		logHeader: countText(oBundle, "popLogPanel", aLog.length, MAX_LOG),
		log: aLog
	};
}

export async function loadKeyDetail(
	oMainModel: ODataModel,
	sKind: KeyKind,
	sRawValue: string,
	oBundle: ResourceBundle,
	sBusinessKey = ""
): Promise<KeyDetail> {
	const bItem = sKind === "ITEM";
	const aForms = keyForms(sRawValue, bItem);
	const sDisplay = bItem ? normalizeMaterial(sRawValue) : (sRawValue ?? "").trim();

	/*
	 * BEI EINER TPA WIRD UEBER DIE TA-NUMMER GESUCHT, NICHT UEBER DEN
	 * ANGEKLICKTEN WERT.
	 *
	 * Sonst zeigt das Panel je nach angeklickter Zelle nur die eine oder die
	 * andere Haelfte (s. tanumFrom). Gesucht wird in ZWEI Feldern:
	 *   TpaNumber   - beide Formate beginnen mit der TANUM
	 *   BusinessKey - seit Michaels Logging-Umbau der massgebliche fachliche
	 *                 Schluessel; die Trigger fuellen ihn, die Consumer noch
	 *                 nicht. Deshalb ODER, nicht statt.
	 *
	 * Mit jeder Aufrufstelle, die BUSINESS_KEY nachtraegt, wird das Ergebnis
	 * besser, ohne dass hier etwas zu aendern waere.
	 */
	const sFilter = bItem
		? orFilter("ItemNumber", aForms)
		: startsWithFilter(["TpaNumber", "BusinessKey"], tanumFrom(sRawValue))
			+ (sBusinessKey.trim() ? ` or BusinessKey eq ${literal(sBusinessKey.trim())}` : "");

	const aLogRows = await fetchRows(
		oMainModel,
		"/AppLog",
		LOG_SELECT,
		sFilter,
		// SeqNr als Tiebreak: CREATED_AT ist TIMESTAMPL und kann innerhalb
		// einer LUW kollidieren - genau dafuer gibt es das Feld.
		"CreatedAtStamp desc,SeqNr desc",
		MAX_LOG
	);

	const aLog: LogEntry[] = aLogRows.map(toEntry(oBundle));

	return {
		title: oBundle.getText(bItem ? "popTitleItem" : "popTitleTpa", [sDisplay]) ?? sDisplay,
		subtitle: oBundle.getText(bItem ? "popSubtitleItem" : "popSubtitleTpa") ?? "",
		logHeader: countText(oBundle, "popLogPanel", aLog.length, MAX_LOG),
		log: aLog
	};
}
