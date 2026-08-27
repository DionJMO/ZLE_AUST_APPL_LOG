import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ResourceBundle from "sap/base/i18n/ResourceBundle";
import { normalizeMaterial, timestamp, quantityOrDash, dashIfEmpty } from "./formatter";

/**
 * Laedt die Detailsicht zu EINER TPA- oder Materialnummer.
 *
 * Quelle sind ausschliesslich die beiden vorhandenen OData-Services. SAP-Felder
 * aus LTAK/LTAP oder MARA sind vom Frontend nicht erreichbar - dafuer braucht
 * es einen eigenen CDS-View (Phase 2, siehe project2/CLAUDE.md).
 *
 * ⚠ WARUM DIE VERKNUEPFUNG UEBERHAUPT FUNKTIONIERT
 * ZLE_AUST_TPA-ORDER_NUMBER ist CHAR10, HiLIS' orderNumber aber
 * TANUM(10)+TAPOS(4)+LGNUM(3) = 17 Zeichen. ZLE_AUST_TPA_SYNC weist ungeprueft
 * zu, ABAP schneidet still rechts ab - uebrig bleibt exakt die TANUM. Und
 * ZLE_AUST_APL_LOG-TPA_NUMBER traegt ebenfalls die TANUM. Der Join ist damit
 * moeglich, aber unbeabsichtigt: aenderte HiLIS das Format der
 * Auftragsnummer, braeche er lautlos. Befund in ../CLAUDE.md, Offene Punkte.
 */

/*
 * Konstanten eines ES-Moduls, keine globalen Bezeichner - die Regel
 * sap-no-global-variable behandelt Modul-Scope faelschlich als globalen Scope
 * (gleiche Ausnahme wie in model/ProcessAxis.ts und model/formatter.ts).
 */
/* eslint-disable @sap-ux/fiori-tools/sap-no-global-variable */
/** Obergrenzen je Abfrage. Wird eine erreicht, sagt es die Kopfzeile. */
const MAX_LOG = 100;
const MAX_TPA = 50;
/** Laenge von MATNR - fuer die gepolsterte Schreibweise. */
const MATNR_LEN = 18;
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

export interface TpaEntry {
	title: string;
	intro: string;
	status: string;
	qty: string;
	batch: string;
	sync: string;
}

export interface KeyDetail {
	title: string;
	subtitle: string;
	logHeader: string;
	tpaHeader: string;
	tpaExpanded: boolean;
	log: LogEntry[];
	tpa: TpaEntry[];
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

/** OData-Stringliteral: einfache Anfuehrungszeichen werden verdoppelt. */
function literal(sValue: string): string {
	return `'${sValue.replace(/'/g, "''")}'`;
}

function orFilter(sField: string, aValues: string[]): string {
	return aValues.map((s) => `${sField} eq ${literal(s)}`).join(" or ");
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

export async function loadKeyDetail(
	oMainModel: ODataModel,
	oTpaModel: ODataModel,
	sKind: KeyKind,
	sRawValue: string,
	oBundle: ResourceBundle
): Promise<KeyDetail> {
	const bItem = sKind === "ITEM";
	const aForms = keyForms(sRawValue, bItem);
	const sDisplay = bItem ? normalizeMaterial(sRawValue) : (sRawValue ?? "").trim();

	const sLogField = bItem ? "ItemNumber" : "TpaNumber";
	const sTpaField = bItem ? "ItemNumber" : "OrderNumber";

	const [aLogRows, aTpaRows] = await Promise.all([
		fetchRows(
			oMainModel,
			"/AppLog",
			"LogUuid,CreatedAtStamp,LogType,HistoryType,TpaNumber,OrderLineNr,ItemNumber,HttpStatus,Message,JsonPayload",
			orFilter(sLogField, aForms),
			"CreatedAtStamp desc",
			MAX_LOG
		),
		fetchRows(
			oTpaModel,
			"/Tpa",
			"OrderNumber,OrderLineNumber,ItemNumber,Menge,MeasurementUnit,BatchNumber,OrderStatus,LineStatus,LastSyncAt",
			orFilter(sTpaField, aForms),
			"OrderNumber,OrderLineNumber",
			MAX_TPA
		)
	]);

	const aLog: LogEntry[] = aLogRows.map((oRow) => ({
		stamp: timestamp(text(oRow.CreatedAtStamp)),
		logType: text(oRow.LogType),
		message: text(oRow.Message),
		process: oBundle.getText("popAttrProcess", [dashIfEmpty(text(oRow.HistoryType))]) ?? "",
		http: oRow.HttpStatus ? (oBundle.getText("popAttrHttp", [text(oRow.HttpStatus)]) ?? "") : "",
		line: oRow.OrderLineNr ? (oBundle.getText("popAttrLine", [text(oRow.OrderLineNr)]) ?? "") : "",
		payload: prettyJson(text(oRow.JsonPayload))
	}));

	const aTpa: TpaEntry[] = aTpaRows.map((oRow) => ({
		title: oBundle.getText("popTpaLine", [
			text(oRow.OrderNumber),
			dashIfEmpty(text(oRow.OrderLineNumber))
		]) ?? "",
		intro: oBundle.getText("popTpaItem", [
			normalizeMaterial(text(oRow.ItemNumber)) || "–"
		]) ?? "",
		status: text(oRow.LineStatus) || text(oRow.OrderStatus),
		qty: oBundle.getText("popAttrQty", [
			quantityOrDash(oRow.Menge as string | number | null),
			dashIfEmpty(text(oRow.MeasurementUnit))
		]) ?? "",
		batch: oBundle.getText("popAttrBatch", [dashIfEmpty(text(oRow.BatchNumber))]) ?? "",
		sync: oBundle.getText("popAttrSync", [timestamp(text(oRow.LastSyncAt))]) ?? ""
	}));

	return {
		title: oBundle.getText(bItem ? "popTitleItem" : "popTitleTpa", [sDisplay]) ?? sDisplay,
		subtitle: oBundle.getText(bItem ? "popSubtitleItem" : "popSubtitleTpa") ?? "",
		logHeader: countText(oBundle, "popLogPanel", aLog.length, MAX_LOG),
		tpaHeader: countText(oBundle, "popTpaPanel", aTpa.length, MAX_TPA),
		tpaExpanded: aTpa.length > 0 && aLog.length <= 5,
		log: aLog,
		tpa: aTpa
	};
}
