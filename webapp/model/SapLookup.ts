import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ResourceBundle from "sap/base/i18n/ResourceBundle";
import { normalizeMaterial, quantityOrDash } from "./formatter";

/**
 * Phase 2 des Detail-Popovers: die SAP-Felder, die im Log nicht stehen.
 *
 * Quelle ist der Service ZLE_AUST_SD_LOOKUP ueber vier eigene Views:
 *   MaterialBase       MARA + MARC ueber I_Product / I_ProductPlantBasic
 *   MaterialWarehouse  MLGN - dafuer gibt es KEINEN Standard-View
 *   MaterialUnit       MARM ueber I_ProductUnitsOfMeasure
 *   TransferOrderItem  LTAK + LTAP - dafuer gibt es ebenfalls keinen
 *
 * ⚠ DIESES MODUL DARF NIE DAS POPOVER MITREISSEN. Solange das Service
 * Binding ZLE_AUST_SB_LOOKUP nicht publiziert ist, existiert der Service
 * nicht - dann liefern die Abfragen einen Fehler, und Phase 1 (Logzeilen
 * und Pufferzeilen) muss trotzdem stehen. Deshalb ist alles in try/catch
 * gekapselt und der Ausfall wird als Hinweis zurueckgegeben, nicht
 * geworfen.
 *
 * ⚠ DER ZWECK IST DIAGNOSE, NICHT ANZEIGE. Die Felder sind so gewaehlt,
 * dass die bekannten stillen Fallen sichtbar werden, und sie werden
 * eingefaerbt, wenn sie zutreffen:
 *   - Gewicht gefuellt bei LEERER Gewichtseinheit  -> Punkt 4
 *   - VOMEM = 'M' bei leerem LVSME                 -> leere ME, Position
 *                                                     wird still uebersprungen
 *   - kein MLGN-Satz fuer die Lagernummer          -> "Stammdaten nicht lesbar"
 *   - Abmessungen gefuellt bei leerer MEABM        -> Abmessungen ohne Einheit
 */

/*
 * Konstanten eines ES-Moduls, keine globalen Bezeichner - gleiche Ausnahme
 * wie in model/ProcessAxis.ts und model/formatter.ts.
 */
/* eslint-disable @sap-ux/fiori-tools/sap-no-global-variable */
/** Die Lagernummer des AutoStore. Projektweit fest, wie in allen Klassen. */
const LGNUM = "001";
/** Obergrenze fuer TA-Positionen je Auftrag. */
const MAX_ITEMS = 50;
/* eslint-enable @sap-ux/fiori-tools/sap-no-global-variable */

export interface SapField {
	label: string;
	value: string;
	/** ObjectStatus-Zustand: "Error" faerbt einen erkannten Befund ein. */
	state: string;
}

export interface SapRow {
	title: string;
	intro: string;
	status: string;
	statusState: string;
	/**
	 * Soll/Ist und Von->Nach. Bleiben VOLLE BREITE und stehen immer da:
	 * sie sind der Kern einer TA-Position, und eine fehlende Menge waere
	 * selbst ein Befund.
	 */
	lines: string[];
	/**
	 * Metadaten (WE-Datum, MHD, Charge, ...) als Label/Wert. Sie flossen
	 * frueher als je eine volle Zeile untereinander - sechs Zeilen fuer
	 * sechs kurze Werte. Als SapField koennen sie im Raster nebeneinander
	 * stehen und teilen sich die Leer-Regel mit dem Kopf-Panel.
	 */
	attrs: SapField[];
}

export interface SapDetail {
	available: boolean;
	hint: string;
	/** Titel des Feld-Panels: Materialstamm bzw. TA-Kopf. */
	header: string;
	fields: SapField[];
	/** Titel des Zeilen-Panels: TA-Positionen. Leer, wenn es keine gibt. */
	rowsHeader: string;
	rows: SapRow[];
}

function text(vValue: unknown): string {
	if (typeof vValue === "string") {
		return vValue;
	}
	if (typeof vValue === "number" || typeof vValue === "boolean") {
		return String(vValue);
	}
	return "";
}

/**
 * Ist ein Kennzeichen gesetzt?
 *
 * 🔴 NICHT mit text( ) <> '' pruefen. SADL bildet ABAP-Kennzeichen mit
 * XFELD-Domaene auf Edm.Boolean ab - aus einem NICHT gesetzten Flag wird
 * dann der Wert false, und String(false) ist "false", also ein NICHT leerer
 * String. Die Pruefung kehrte sich damit um: eine nicht quittierte
 * TA-Position wurde als "quittiert" angezeigt (gefunden 27.08.2026 an einer
 * Position mit "Soll 1.000 / Ist -", die trotzdem gruen als quittiert
 * erschien).
 *
 * Welche Felder als Boolean und welche als CHAR1 ankommen, haengt an der
 * Domaene des jeweiligen Datenelements - deshalb hier beide Formen
 * behandeln statt zu raten.
 */
function isFlagged(vValue: unknown): boolean {
	if (typeof vValue === "boolean") {
		return vValue;
	}
	if (typeof vValue === "number") {
		return vValue !== 0;
	}
	if (typeof vValue !== "string") {
		return false;
	}
	const sValue = vValue.trim().toLowerCase();
	return sValue !== "" && sValue !== "false" && sValue !== "0";
}

/** Ist ein Betragsfeld gefuellt und von null verschieden? */
function hasValue(vValue: unknown): boolean {
	const nValue = Number(vValue);
	return !Number.isNaN(nValue) && nValue !== 0;
}

async function fetchRows(
	oModel: ODataModel,
	sPath: string,
	sFilter: string,
	iMax: number
): Promise<Record<string, unknown>[]> {
	const oBinding = oModel.bindList(sPath, undefined, [], [], { $filter: sFilter });
	const aContexts = await oBinding.requestContexts(0, iMax);
	return aContexts.map((oContext) => oContext.getObject() as Record<string, unknown>);
}

function literal(sValue: string): string {
	return `'${sValue.replace(/'/g, "''")}'`;
}

function field(oBundle: ResourceBundle, sKey: string, sValue: string, sState = "None"): SapField {
	/*
	 * Ein markiertes Feld OHNE Text laese sich wie ein Darstellungsfehler -
	 * roter Punkt, nichts dahinter. Wenn die Leere der Befund ist, wird sie
	 * deshalb ausgeschrieben.
	 */
	const sShown = sValue.trim() || (sState !== "None" ? (oBundle.getText("sapEmptyValue") ?? "") : "");
	return { label: oBundle.getText(sKey) ?? sKey, value: sShown, state: sState };
}

/**
 * DIE REGEL FUER LEERE FELDER: weglassen statt "-" anzeigen.
 *
 * Ein Popover, das zur Haelfte aus Gedankenstrichen besteht, verbirgt die
 * Zeilen, auf die es ankommt. Gezeigt wird ein Feld deshalb nur, wenn es
 * einen Wert hat.
 *
 * ⚠ MIT EINER AUSNAHME, UND DIE IST DER SPRINGENDE PUNKT: traegt das Feld
 * einen Zustand ungleich "None", ist seine LEERE selbst der Befund - etwa
 * eine gesendete Mengeneinheit, die leer ist. Solche Zeilen muessen
 * bleiben, sonst verschwindet genau die Information, wegen der jemand das
 * Popover geoeffnet hat.
 */
function pushIf(aTarget: SapField[], oField: SapField): void {
	if (oField.value.trim() || oField.state !== "None") {
		aTarget.push(oField);
	}
}

/*
 * Je Befundart eine Funktion. Zusammen in einer waere es zwar kuerzer,
 * aber jede dieser Gruppen ist eine eigene bekannte Falle - getrennt
 * laesst sich eine ergaenzen oder streichen, ohne die anderen zu lesen.
 */

/** Mengeneinheit - die haeufigste Abbruchursache der Trigger. */
function unitFields(oWm: Record<string, unknown> | undefined, oBundle: ResourceBundle): SapField[] {
	if (!oWm) {
		// Genau der Fall hinter "HiLIS-Stammdaten nicht lesbar": ohne
		// MLGN-Satz faellt das Material aus ZI_LE_AUST_SAPMAT heraus.
		return [field(oBundle, "sapNoMlgn", oBundle.getText("sapNoMlgnHint", [LGNUM]) ?? "", "Error")];
	}

	const sSent = text(oWm.SentUnit).trim();
	const sVomem = text(oWm.UnitProposal).trim();
	const aFields: SapField[] = [];

	/*
	 * Die gesendete ME steht immer da - leer ist sie ein Befund und bleibt
	 * ueber pushIf erhalten.
	 */
	pushIf(aFields, field(oBundle, "sapSentUnit", sSent, sSent ? "None" : "Error"));

	/*
	 * VOMEM und LVSME erklaeren, WIE die gesendete ME zustande kam - das ist
	 * nur interessant, wenn die WM-Einheit ueberhaupt greift. Bei VOMEM
	 * ungleich 'M' liefert die Regel schlicht MARA-MEINS, und beide Felder
	 * waeren zwei Zeilen Rauschen.
	 */
	if (sVomem === "M") {
		pushIf(aFields, field(oBundle, "sapUnitProposal", sVomem));
		pushIf(aFields, field(oBundle, "sapWarehouseUnit", text(oWm.WarehouseUnit)));
	}

	const sPut = text(oWm.PutAwayIndicator).trim();
	const sRem = text(oWm.StockRemovalIndicator).trim();
	if (sPut || sRem) {
		pushIf(aFields, field(oBundle, "sapPutAwayInd", `${sPut || "–"} / ${sRem || "–"}`));
	}

	if (isFlagged(oWm.HasEmptyUnit)) {
		aFields.push(field(oBundle, "sapEmptyUnit", oBundle.getText("sapEmptyUnitHint") ?? "", "Error"));
	}
	return aFields;
}

/** Gewicht - Punkt 4: gefuelltes BRGEW bei leerer GEWEI geht als Gramm raus. */
function weightFields(oBase: Record<string, unknown>, oBundle: ResourceBundle): SapField[] {
	const sUnit = text(oBase.WeightUnit).trim();
	const bTrap = hasValue(oBase.GrossWeight) && !sUnit;
	const aFields: SapField[] = [];
	pushIf(aFields, field(oBundle, "sapGrossWeight",
		hasValue(oBase.GrossWeight)
			? `${quantityOrDash(oBase.GrossWeight as string | number | null)} ${sUnit || "?"}`
			: "",
		bTrap ? "Error" : "None"));
	if (bTrap) {
		aFields.push(field(oBundle, "sapWeightNoUnit", oBundle.getText("sapWeightNoUnitHint") ?? "", "Error"));
	}
	return aFields;
}

/** Chargenpflicht und Loeschvormerkung. */
function batchFields(oBase: Record<string, unknown>, oBundle: ResourceBundle): SapField[] {
	const aFields: SapField[] = [];
	pushIf(aFields, field(oBundle, "sapBatchType", text(oBase.SentBatchHandlingType)));

	if (isFlagged(oBase.BatchMgmtRequiredInPlant) !== isFlagged(oBase.BatchMgmtRequiredClientWide)) {
		aFields.push(field(oBundle, "sapBatchMismatch", oBundle.getText("sapBatchMismatchHint") ?? "", "Warning"));
	}
	if (isFlagged(oBase.IsMarkedForDeletion) || isFlagged(oBase.IsMarkedForDeletionInPlant)) {
		aFields.push(field(oBundle, "sapDeleted", oBundle.getText("sapDeletedHint") ?? "", "Warning"));
	}
	return aFields;
}

/** Abmessungen - derselbe Fehlertyp wie beim Gewicht, nur nie gestellt. */
function dimensionFields(oUom: Record<string, unknown> | undefined, oBundle: ResourceBundle): SapField[] {
	if (!oUom) {
		return [];
	}
	const sUnit = text(oUom.DimensionUnit).trim();
	const bDims = hasValue(oUom.ProductLength) || hasValue(oUom.ProductWidth) || hasValue(oUom.ProductHeight);
	if (!bDims) {
		return [];
	}
	const aFields: SapField[] = [
		field(oBundle, "sapDimensions",
			`${quantityOrDash(oUom.ProductLength as string | number | null)} × `
			+ `${quantityOrDash(oUom.ProductWidth as string | number | null)} × `
			+ `${quantityOrDash(oUom.ProductHeight as string | number | null)} ${sUnit || "?"}`,
			sUnit ? "None" : "Warning")
	];
	if (!sUnit) {
		aFields.push(field(oBundle, "sapDimNoUnit", oBundle.getText("sapDimNoUnitHint") ?? "", "Warning"));
	}
	return aFields;
}

/** Materialstamm aus SAP - der Teil, den das Log nicht kennt. */
async function loadMaterial(
	oModel: ODataModel,
	sMaterial: string,
	oBundle: ResourceBundle
): Promise<SapField[]> {
	const sBare = normalizeMaterial(sMaterial);
	const sPadded = sBare.padStart(18, "0");
	const sMatFilter = `Material eq ${literal(sBare)} or Material eq ${literal(sPadded)}`;

	const [aBase, aWm, aUom] = await Promise.all([
		fetchRows(oModel, "/MaterialBase", sMatFilter, 1),
		fetchRows(oModel, "/MaterialWarehouse",
			`(${sMatFilter}) and WarehouseNumber eq ${literal(LGNUM)}`, 1),
		fetchRows(oModel, "/MaterialUnit", sMatFilter, 20)
	]);

	const oBase = aBase[0];
	if (!oBase) {
		return [field(oBundle, "sapNoMaterial", "", "Error")];
	}
	const oWm = aWm[0];
	// Die Abmessungen der GESENDETEN Mengeneinheit, nicht irgendeiner -
	// genau die gehen an HiLIS.
	const oUom = aUom.find((o) => text(o.AlternativeUnit) === text(oWm?.SentUnit)) ?? aUom[0];

	const aHead: SapField[] = [];
	pushIf(aHead, field(oBundle, "sapMaterialName", text(oBase.MaterialName)));
	pushIf(aHead, field(oBundle, "sapBaseUnit", text(oBase.BaseUnit)));

	return [
		...aHead,
		...unitFields(oWm, oBundle),
		...weightFields(oBase, oBundle),
		...batchFields(oBase, oBundle),
		...dimensionFields(oUom, oBundle)
	];
}

/**
 * Die reine TA-Nummer aus dem, was im Log steht.
 *
 * 🔴 ZLE_AUST_APL_LOG-TPA_NUMBER (CHAR17) traegt ZWEI FORMATE nebeneinander,
 * je nachdem, welche Schicht geschrieben hat:
 *
 *   Trigger-Klassen   log_msg( iv_tanum = is_ltak-tanum )   "0006024375"
 *   Consumer-Schicht  die HiLIS-Auftragsnummer              "00060244110001001"
 *
 * Die lange Form ist zusammengesetzt: TANUM(10)+TAPOS(4)+LGNUM(3) beim
 * PutAway, TANUM(10)+LGNUM(3) beim Pick. In BEIDEN Faellen sind die ersten
 * zehn Stellen die TANUM - genau die Trunkierung, die ZLE_AUST_TPA_SYNC
 * unbeabsichtigt vornimmt (siehe ../CLAUDE.md, Offene Punkte).
 *
 * Ohne diese Ableitung liefert der Filter gegen LTAP-TANUM (NUMC10) bei
 * jedem Klick auf eine lange Nummer nichts, und das Popover zeigt einen
 * leeren Auftragskopf.
 */
function tanumFrom(sValue: string): string {
	const sTrimmed = (sValue ?? "").trim();
	if (!sTrimmed || !/^\d+$/.test(sTrimmed)) {
		return sTrimmed;
	}
	return sTrimmed.length > 10 ? sTrimmed.slice(0, 10) : sTrimmed.padStart(10, "0");
}

/**
 * Auftragskopf aus LTAK.
 *
 * WARUM GETRENNT VON DEN POSITIONEN
 * LTAK-Felder sind je TA EINMAL vorhanden. In der ersten Fassung steckten
 * sie als Positionsattribute mit drin - die Bewegungsart stand damit bei
 * jeder Position identisch, und alles Uebrige (Ersteller, Anlagezeit,
 * TA-Quittierung, Gruppe, Transportbedarf, Materialbeleg, Anzahl
 * Positionen) fiel ganz weg, weil in einer Positionszeile kein Platz
 * dafuer war. Ein eigenes Panel zeigt sie einmal und vollstaendig.
 *
 * Alle Zeilen tragen dieselben Kopfdaten - die erste genuegt.
 */
function headerFields(oRow: Record<string, unknown> | undefined, oBundle: ResourceBundle): SapField[] {
	if (!oRow) {
		return [];
	}
	const aFields: SapField[] = [];

	const sWm = text(oRow.WarehouseProcessType).trim();
	const sMm = text(oRow.GoodsMovementType).trim();
	pushIf(aFields, field(oBundle, "sapHdrMovement",
		sWm && sMm ? `${sWm} / ${sMm}` : (sWm || sMm)));

	const sDate = text(oRow.CreationDate).trim();
	const sTime = text(oRow.CreationTime).trim();
	pushIf(aFields, field(oBundle, "sapHdrCreated", [sDate, sTime].filter((x) => x).join(" ")));
	pushIf(aFields, field(oBundle, "sapHdrCreatedBy", text(oRow.CreatedByUser)));

	const bConf = isFlagged(oRow.OrderIsConfirmed);
	pushIf(aFields, field(oBundle, "sapHdrConfirmed",
		oBundle.getText(bConf ? "sapHdrConfirmedYes" : "sapHdrConfirmedNo",
			bConf ? [text(oRow.OrderConfirmationDate).trim() || "?"] : undefined) ?? "",
		bConf ? "Success" : "Warning"));

	pushIf(aFields, field(oBundle, "sapHdrItems", text(oRow.NumberOfItems)));
	pushIf(aFields, field(oBundle, "sapHdrDelivery", text(oRow.HeaderDeliveryDocument)));

	const sReqType = text(oRow.RequirementType).trim();
	const sReqNo = text(oRow.RequirementNumber).trim();
	pushIf(aFields, field(oBundle, "sapHdrRequirement",
		sReqType && sReqNo ? `${sReqType} ${sReqNo}` : (sReqType || sReqNo)));

	pushIf(aFields, field(oBundle, "sapHdrGroup", text(oRow.GroupNumber)));
	pushIf(aFields, field(oBundle, "sapHdrTransferReq", text(oRow.TransferRequirement)));

	const sDoc = text(oRow.MaterialDocument).trim();
	const sYear = text(oRow.MaterialDocumentYear).trim();
	pushIf(aFields, field(oBundle, "sapHdrMatDoc", sDoc ? `${sDoc} / ${sYear}` : ""));

	/*
	 * DRUKZ steuert zusammen mit LGTYP die Druckerfindung ueber ZLGTYP_SORT.
	 * Dort fehlt der Eintrag fuer 'AS' - deshalb steht das Kennzeichen hier,
	 * auch wenn es fuer sich genommen unscheinbar ist.
	 */
	pushIf(aFields, field(oBundle, "sapHdrPrintInd", text(oRow.PrintIndicator)));
	pushIf(aFields, field(oBundle, "sapHdrDeliveryDate", text(oRow.DeliveryDate)));

	return aFields;
}

/** TA-Positionen aus LTAP - die Felder, fuer die man sonst LT21 braucht. */
async function loadTransferOrder(
	oModel: ODataModel,
	sTransferOrder: string,
	oBundle: ResourceBundle
): Promise<{ header: SapField[]; rows: SapRow[] }> {
	const sTanum = tanumFrom(sTransferOrder);
	const aRows = await fetchRows(
		oModel,
		"/TransferOrderItem",
		`WarehouseNumber eq ${literal(LGNUM)} and TransferOrder eq ${literal(sTanum)}`,
		MAX_ITEMS
	);

	const aItems = aRows.map((oRow) => {
		const bConfirmed = isFlagged(oRow.ItemIsConfirmed);
		const sUser = text(oRow.ConfirmedByUser).trim();

		/*
		 * ZWEI EBENEN, UND DAS IST DER PUNKT DER ANORDNUNG:
		 *
		 * lines = Soll/Ist und Von->Nach. Der Kern der Position, volle
		 *   Breite, immer sichtbar - eine fehlende Menge ist selbst ein
		 *   Befund.
		 * attrs = Metadaten. Kurze Werte (Datum, Charge, Drucker), die
		 *   frueher je eine volle Zeile belegten. Als Label/Wert-Paare
		 *   stehen sie jetzt im Raster nebeneinander.
		 *
		 * Leere fallen wie ueberall HERAUS statt als "-" zu erscheinen.
		 * Vorher standen zusammengesetzte Texte drin ("WE-Datum - · MHD -"),
		 * die bei halb gefuellten Positionen kaputt aussahen.
		 *
		 * ⚠ Die Bewegungsart steht NICHT hier - sie kommt aus LTAK und waere
		 * bei jeder Position derselbe Wert. Sie sitzt im Kopf-Panel.
		 */
		const aLines = [
			oBundle.getText("sapAttrQty", [
				quantityOrDash(oRow.DestTargetQtyInAltUnit as string | number | null),
				quantityOrDash(oRow.DestActualQtyInAltUnit as string | number | null),
				text(oRow.AlternativeUnit)
			]) ?? "",
			oBundle.getText("sapAttrBin", [
				`${text(oRow.SourceStorageType) || "–"}/${text(oRow.SourceStorageBin) || "–"}`,
				`${text(oRow.DestStorageType) || "–"}/${text(oRow.DestStorageBin) || "–"}`
			]) ?? ""
		];

		const aAttrs: SapField[] = [];
		pushIf(aAttrs, field(oBundle, "sapLblGr", text(oRow.GoodsReceiptDate)));
		pushIf(aAttrs, field(oBundle, "sapLblBbd", text(oRow.ShelfLifeExpirationDate)));
		pushIf(aAttrs, field(oBundle, "sapLblBatch", text(oRow.Batch)));
		pushIf(aAttrs, field(oBundle, "sapLblSpecial", text(oRow.SpecialStockNumber)));
		pushIf(aAttrs, field(oBundle, "sapLblDelivery", text(oRow.DeliveryDocument)));
		pushIf(aAttrs, field(oBundle, "sapLblPrinter", text(oRow.PrinterName)));

		return {
			title: oBundle.getText("sapTaItem", [
				text(oRow.TransferOrderItem),
				normalizeMaterial(text(oRow.Material)) || "–"
			]) ?? "",
			intro: text(oRow.MaterialName),
			// Kein Fragezeichen erfinden: ohne Benutzernamen bleibt es beim
			// blossen "quittiert".
			status: (bConfirmed
				? oBundle.getText(sUser ? "sapConfirmed" : "sapConfirmedPlain", sUser ? [sUser] : undefined)
				: oBundle.getText("sapOpen")) ?? "",
			statusState: bConfirmed ? "Success" : "Warning",
			lines: aLines.filter((sLine) => sLine),
			attrs: aAttrs
		};
	});

	/*
	 * Ein leeres Ergebnis muss sich MELDEN. Die Regel "leere Felder
	 * verschwinden" wuerde sonst einen Auftragskopf ganz ohne Inhalt
	 * zeigen - der sieht aus wie ein Anzeigefehler, ist aber ein Befund:
	 * zu dieser Nummer gibt es in LTAK/LTAP nichts (archiviert, falsche
	 * Lagernummer, oder die Nummer stammt gar nicht aus einem TA).
	 */
	if (!aRows.length) {
		return {
			header: [field(oBundle, "sapNoTransferOrder",
				oBundle.getText("sapNoTransferOrderHint", [sTanum, LGNUM]) ?? "", "Warning")],
			rows: []
		};
	}

	return { header: headerFields(aRows[0], oBundle), rows: aItems };
}

/**
 * Laedt die SAP-Seite. Faellt der Service aus, kommt available = false
 * zurueck - das Popover zeigt dann nur Phase 1 plus einen Hinweis.
 */
export async function load(
	oModel: ODataModel | undefined,
	sKind: "TPA" | "ITEM",
	sValue: string,
	oBundle: ResourceBundle
): Promise<SapDetail> {
	const oEmpty: SapDetail = {
		available: false,
		hint: oBundle.getText("sapUnavailable") ?? "",
		header: oBundle.getText(sKind === "ITEM" ? "sapPanelMaterial" : "sapPanelTaHead") ?? "",
		fields: [],
		rowsHeader: "",
		rows: []
	};

	if (!oModel || !sValue.trim()) {
		return oEmpty;
	}

	try {
		if (sKind === "ITEM") {
			return { ...oEmpty, available: true, hint: "", fields: await loadMaterial(oModel, sValue, oBundle) };
		}
		const oResult = await loadTransferOrder(oModel, sValue, oBundle);
		return {
			...oEmpty,
			available: true,
			hint: "",
			fields: oResult.header,
			rowsHeader: oBundle.getText("sapPanelTaCount", [String(oResult.rows.length)]) ?? "",
			rows: oResult.rows
		};
	} catch {
		return oEmpty;
	}
}
