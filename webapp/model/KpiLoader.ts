import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import * as ProcessAxis from "./ProcessAxis";

export interface KpiDefinition {
	/** Schluessel im ui-Modell unter /kpi */
	key: string;
	/** Name des benannten OData-Modells */
	model: "mainModel" | "tpaModel";
	path: string;
	select: string;
	filter?: string;
}

/**
 * Kennzahlen der Kopfzeile und Zaehler der Reiter.
 *
 * Gezaehlt wird serverseitig ueber $count, nicht durch Abzaehlen geladener
 * Zeilen. Wichtig: die OVP-Tabellenkarten zeigten in ihrer "X of Y"-
 * Kopfzeile den UNGEFILTERTEN Gesamtbestand - deshalb wich die frueher
 * angezeigte Abbruch-Zahl von dieser hier ab. Diese Zaehlung ist die
 * korrekte.
 *
 * "Fehler" zaehlt bewusst ueber alle Zeiten, nicht nur ueber die sieben
 * Tage des Charts.
 *
 * Die Kennzahlenzeile mischt bewusst zwei Mengen, sagt es aber jetzt in
 * den Beschriftungen: drei Zahlen zaehlen TPA-ZEILEN ("Auftraege ..."),
 * eine zaehlt MELDUNGEN ("Fehlermeldungen"). Der Schluessel hiess bis
 * 26.08.2026 "abbrueche" und kollidierte damit begrifflich mit dem
 * Typfilter "Abbrueche" (= LogType W) - gemeint waren aber stornierte
 * AUFTRAEGE. Deshalb jetzt "storniert".
 *
 * Die Prozessfilter kommen aus model/ProcessAxis.ts und stehen NICHT mehr
 * doppelt hier und in der View.
 */
// Exportierte Konstante eines ES-Moduls, kein globaler Bezeichner. Die Regel
// sap-no-global-variable behandelt Modul-Scope faelschlich als globalen Scope.
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
export const metrics: KpiDefinition[] = [
	// --- Kennzahlenzeile im Ueberblick ---
	{ key: "gesamt",    model: "tpaModel",  path: "/Tpa",    select: "OrderNumber" },
	{ key: "offen",     model: "tpaModel",  path: "/Tpa",    select: "OrderNumber",
	  filter: "OrderStatus ne 'Finished' and OrderStatus ne 'Cancelled'" },
	{ key: "fehler",    model: "mainModel", path: "/AppLog", select: "LogUuid",
	  filter: "LogType eq 'E'" },
	{ key: "storniert", model: "tpaModel",  path: "/Tpa",    select: "OrderNumber",
	  filter: "OrderStatus eq 'Cancelled'" },

	// --- Zaehler der Reiter ---
	// Je Prozess einer, erzeugt aus der Prozesstabelle. Ein vierter Prozess
	// dort bringt seinen Zaehler automatisch mit.
	...ProcessAxis.processes.map((oProcess): KpiDefinition => ({
		key: "tab" + oProcess.key,
		model: "mainModel",
		path: "/AppLog",
		select: "LogUuid",
		filter: ProcessAxis.odataProcess(oProcess.key)
	})),

	// Was in KEINER Prozessgruppe erscheint - weder ueber den Praefix noch
	// ueber einen Marker. Das Mass fuer die verbleibende Backend-Luecke, und
	// nach dem Fuellen von HISTORY_TYPE direkt als Rueckgang ablesbar.
	{ key: "tab" + ProcessAxis.KEY_UNASSIGNED, model: "mainModel", path: "/AppLog",
	  select: "LogUuid", filter: ProcessAxis.odataUnassigned() },

	/*
	 * Meldungen OHNE fachlichen Schluessel.
	 *
	 * Das Mass fuer Michaels offenen Punkt P17 ("viele Log-Aufrufe ohne
	 * Vorgangsbezug"). Ohne BUSINESS_KEY haengt ein Satz an keinem Vorgang und
	 * ist weder mit dem Arbeitsvorrat noch mit einem HiLIS-Callback
	 * zusammenzufuehren - so steht es in seiner Doku unter "Immer mitgeben".
	 *
	 * Der Zaehler bringt die Restgroesse in die Oberflaeche statt in ein
	 * Dokument, und er SCHRUMPFT SICHTBAR, waehrend die Aufrufstellen
	 * nachgezogen werden. Dieselbe Idee wie beim Zaehler der nicht
	 * zugeordneten Meldungen, die dort schon aufgegangen ist.
	 */
	{ key: "ohneKey", model: "mainModel", path: "/AppLog", select: "LogUuid",
	  filter: "BusinessKey eq ''" },

	// Rohsicht: ungefiltert, bewusst Obermenge der uebrigen Reiter.
	{ key: "tab" + ProcessAxis.KEY_ALL, model: "mainModel", path: "/AppLog",
	  select: "LogUuid" }
];

export async function loadCount(oModel: ODataModel, oDefinition: KpiDefinition): Promise<number> {
	const mParameters: Record<string, string | boolean> = {
		$select: oDefinition.select,
		$count: true
	};
	if (oDefinition.filter) {
		// Rohes $filter gehoert in die Parameter, NICHT in den vFilters-Parameter
		// von bindList - dort erwartet UI5 sap.ui.model.Filter-Objekte.
		mParameters.$filter = oDefinition.filter;
	}

	const oBinding = oModel.bindList(oDefinition.path, undefined, [], undefined, mParameters);
	await oBinding.requestContexts(0, 1);
	return oBinding.getCount() ?? 0;
}
