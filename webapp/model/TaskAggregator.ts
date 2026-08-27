import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import { normalizeMaterial } from "./formatter";

/**
 * Verdichtet die fachlichen Abbrueche zu einer Arbeitsliste.
 *
 * WARUM VERDICHTEN
 * Am 25.08.2026 standen 476 Abbruchmeldungen im Log - der handlungs-
 * relevante Inhalt waren aber nur eine Handvoll Materialien, jedes
 * mehrfach. Fuer den Fachbereich zaehlt das betroffene OBJEKT, nicht
 * das einzelne Ereignis: eine Zeile je Material und Problem statt je
 * Vorfall.
 *
 * WELCHE MELDUNGEN
 * Nur LogType 'W'. Das sind genau die Faelle, die der Fachbereich
 * loesen kann (Stammdaten, Mengeneinheit, Menge). Technische Fehler
 * ('E') gehoeren nicht in diese Liste - dafuer ist das Monitoring da.
 *
 * ⚠ UEBERGANGSLOESUNG BEI DER ZUORDNUNG
 * Die Problemklasse wird aus dem Meldungstext erkannt, weil die
 * Tabelle kein strukturiertes Kennzeichen fuehrt. Die Muster stammen
 * aus den String-Templates in ZCL_ZLE_AUST_TO_TRIGGER und
 * ZCL_ZLE_AUST_OB_TRIGGER und sind heute eindeutig. Aendert das
 * Backend den Wortlaut, faellt die Zeile in die Klasse OTHER und
 * zeigt den Originaltext - es geht nichts verloren, es wird nur
 * wieder technisch.
 * Der saubere Weg ist ein Feld ABORT_REASON mit Festwerten
 * (siehe CLAUDE.md, O-25). Dann entfaellt classify( ) ersatzlos.
 *
 * ⚠ WAS DIE LISTE NICHT WEISS
 * Der Log kennt kein "erledigt". Ein behobenes Problem verschwindet
 * erst, wenn es nicht mehr auftritt und aus dem Zeitfenster faellt.
 * Deshalb ist "Zuletzt" die wichtigere Spalte: liegt sie Tage zurueck,
 * ist der Punkt vermutlich erledigt.
 */

export interface TaskItem {
	itemNumber: string;
	problemKey: string;
	detail: string;
	count: number;
	firstDay: string;
	lastDay: string;
	sample: string;
}

export interface OtherItem {
	day: string;
	tpaNumber: string;
	message: string;
}

export interface TaskData {
	items: TaskItem[];
	others: OtherItem[];
	truncated: boolean;
	days: number;
	hasContent: boolean;
}

interface LogRow {
	CreatedAt?: string;
	ItemNumber?: string;
	TpaNumber?: string;
	Message?: string;
}

/**
 * Ordnet eine Meldung einer Problemklasse zu und zieht die fachlich
 * interessante Einzelheit heraus - bei der Mengeneinheit sind das die
 * beiden Werte, die nicht zusammenpassen.
 */
function classify(sMessage: string): { key: string; detail: string } {
	if (sMessage.indexOf("HiLIS-Stammdaten nicht lesbar") >= 0) {
		return { key: "NO_MASTER", detail: "" };
	}
	if (sMessage.indexOf("ME-Abweichung") >= 0) {
		const aMatch = /ME-Abweichung SAP '([^']*)' <> HiLIS '([^']*)'/.exec(sMessage);
		return {
			key: "UOM_CONFLICT",
			detail: aMatch ? `SAP ${aMatch[1].trim()} ≠ AutoStore ${aMatch[2].trim()}` : ""
		};
	}
	if (sMessage.indexOf("VSOLA = 0") >= 0) {
		return { key: "QTY_ZERO", detail: "" };
	}
	if (sMessage.indexOf("MARA") >= 0) {
		return { key: "NOT_IN_MARA", detail: "" };
	}
	return { key: "OTHER", detail: "" };
}

function isoDay(oDate: Date): string {
	const sMonth = String(oDate.getMonth() + 1).padStart(2, "0");
	const sDay = String(oDate.getDate()).padStart(2, "0");
	return `${String(oDate.getFullYear())}-${sMonth}-${sDay}`;
}

function germanDay(sIsoDay: string): string {
	if (sIsoDay.length < 10) {
		return sIsoDay;
	}
	return `${sIsoDay.slice(8, 10)}.${sIsoDay.slice(5, 7)}.${sIsoDay.slice(0, 4)}`;
}

export async function loadOpenTasks(oModel: ODataModel, nDays: number): Promise<TaskData> {
	const nMaxRows = 5000;
	const oToday = new Date();
	const oFrom = new Date(oToday.getFullYear(), oToday.getMonth(), oToday.getDate() - (nDays - 1));

	const oBinding = oModel.bindList("/AppLog", undefined, [], undefined, {
		// CreatedAt ist Edm.Date - nacktes ISO-Datum, ohne Anfuehrungszeichen
		// und ohne Zeitanteil. Siehe model/LogAggregator.ts.
		$select: "CreatedAt,ItemNumber,TpaNumber,Message",
		$filter: `LogType eq 'W' and CreatedAt ge ${isoDay(oFrom)}`,
		$count: true
	});

	const aContexts = await oBinding.requestContexts(0, nMaxRows);
	const mByKey = new Map<string, TaskItem>();
	const aOthers: OtherItem[] = [];

	aContexts.forEach((oContext) => {
		const oRow = oContext.getObject() as LogRow | undefined;
		if (!oRow) {
			return;
		}
		const sMessage = (oRow.Message ?? "").trim();
		const sDay = (oRow.CreatedAt ?? "").slice(0, 10);
		// Normalisiert, sonst verdichtet dasselbe Material zu zwei Zeilen -
		// die Trigger-Klassen liefern es in zwei Schreibweisen.
		const sItem = normalizeMaterial(oRow.ItemNumber);

		// Ohne Materialbezug laesst sich nicht je Material verdichten -
		// diese Punkte kommen einzeln in die zweite, kurze Liste.
		if (sItem === "") {
			aOthers.push({
				day: germanDay(sDay),
				tpaNumber: (oRow.TpaNumber ?? "").trim(),
				message: sMessage
			});
			return;
		}

		const oClass = classify(sMessage);
		const sKey = `${sItem}|${oClass.key}|${oClass.detail}`;
		const oExisting = mByKey.get(sKey);

		if (oExisting) {
			oExisting.count++;
			if (sDay < oExisting.firstDay) {
				oExisting.firstDay = sDay;
			}
			if (sDay > oExisting.lastDay) {
				oExisting.lastDay = sDay;
			}
			return;
		}

		mByKey.set(sKey, {
			itemNumber: sItem,
			problemKey: oClass.key,
			detail: oClass.detail,
			count: 1,
			firstDay: sDay,
			lastDay: sDay,
			sample: sMessage
		});
	});

	// Aeltestes zuerst: "liegt seit drei Tagen" ist handlungsrelevanter
	// als "ist 68-mal passiert".
	const aItems = Array.from(mByKey.values()).sort((a, b) => a.firstDay.localeCompare(b.firstDay));
	aItems.forEach((oItem) => {
		oItem.firstDay = germanDay(oItem.firstDay);
		oItem.lastDay = germanDay(oItem.lastDay);
	});

	const nTotal = oBinding.getCount() ?? aContexts.length;

	return {
		items: aItems,
		others: aOthers,
		truncated: nTotal > aContexts.length,
		days: nDays,
		hasContent: aItems.length > 0 || aOthers.length > 0
	};
}
