import ODataModel from "sap/ui/model/odata/v4/ODataModel";

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
 * Kennzahlen der Kopfzeile. Uebernommen aus der frueheren OVP-Custom-Card
 * webapp/ext/kpi/Kpi.controller.js - Filter und Pfade unveraendert, damit
 * sich die Zahlen gegenueber dem OVP-Stand nicht still aendern.
 *
 * Gezaehlt wird serverseitig ueber $count, nicht durch Abzaehlen geladener
 * Zeilen. Wichtig: die OVP-Tabellenkarten zeigten in ihrer "X of Y"-
 * Kopfzeile den UNGEFILTERTEN Gesamtbestand - deshalb wich die frueher
 * angezeigte Abbruch-Zahl von dieser hier ab. Diese Zaehlung ist die
 * korrekte.
 *
 * "Fehler" zaehlt bewusst ueber alle Zeiten, nicht nur ueber die sieben
 * Tage des Charts.
 */
// Exportierte Konstante eines ES-Moduls, kein globaler Bezeichner. Die Regel
// sap-no-global-variable behandelt Modul-Scope faelschlich als globalen Scope.
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
export const metrics: KpiDefinition[] = [
	{ key: "gesamt",   model: "tpaModel",  path: "/Tpa",    select: "OrderNumber" },
	{ key: "offen",    model: "tpaModel",  path: "/Tpa",    select: "OrderNumber",
	  filter: "OrderStatus ne 'Finished' and OrderStatus ne 'Cancelled'" },
	{ key: "fehler",   model: "mainModel", path: "/AppLog", select: "LogUuid",
	  filter: "LogType eq 'E'" },
	{ key: "abbrueche", model: "tpaModel", path: "/Tpa",    select: "OrderNumber",
	  filter: "OrderStatus eq 'Cancelled'" },
	// Zaehler fuer die Kopfzeile des Panels "Abbrueche & Warnungen". Die
	// fachlichen Abbrueche werden im Backend als 'W' geloggt, nicht als 'E'
	// (fuenf von sechs Abbruchstellen, siehe CLAUDE.md O-25) - deshalb ist das
	// die Menge, die dort interessiert.
	// Das Gegenstueck "Technische Fehler" braucht keinen eigenen Eintrag: es
	// ist derselbe Filter wie 'fehler' und bindet gegen /kpi/fehler.
	{ key: "nichtUebertragen", model: "mainModel", path: "/AppLog", select: "LogUuid",
	  filter: "LogType eq 'W'" }
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
