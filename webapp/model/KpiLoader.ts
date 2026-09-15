import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";

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

	/*
	 * ⚠ DIE REITERZAEHLER STEHEN SEIT 11.09.2026 NICHT MEHR HIER.
	 *
	 * Sie zaehlten ueber einen rohen OData-String je Prozess und kannten
	 * damit weder Typfilter noch Suche noch Tag - nach jeder Eingrenzung
	 * zeigten Reiter und Tabelle verschiedene Mengen. Jetzt baut
	 * Main._loadTabCounts( ) sie aus derselben Filterkette wie die Tabelle
	 * (_msgFilters mit ausgetauschtem Prozess).
	 *
	 * Nebengewinn: die Prozessachse gab es zweimal - als Filter-Objekte und
	 * als OData-String. Die String-Fassung (ProcessAxis.odataProcess /
	 * odataUnassigned) hatte hier ihren einzigen Verbraucher und ist mit
	 * entfallen.
	 */

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
	  filter: "BusinessKey eq ''" }
];

/**
 * ⚠ Der Parameter ist bewusst NICHT KpiDefinition, sondern nur deren drei
 * abfragerelevante Felder. Die Funktion liest "model" und "key" nie - das
 * Modell kommt als eigenes Argument herein. Mit KpiDefinition waere sie an
 * die Aufzaehlung in dessen "model" gebunden gewesen, und der Zaehler des
 * Arbeitsvorrats (reprocModel) haette die Aufzaehlung erweitern muessen,
 * ohne dass die Funktion das Feld je anfasst. Bestehende Aufrufer mit einer
 * vollen KpiDefinition passen weiterhin.
 */
export async function loadCount(
	oModel: ODataModel,
	oDefinition: Pick<KpiDefinition, "path" | "select" | "filter">,
	aFilters: Filter[] = []
): Promise<number> {
	const mParameters: Record<string, string | boolean> = {
		$select: oDefinition.select,
		$count: true
	};
	if (oDefinition.filter) {
		// Rohes $filter gehoert in die Parameter, NICHT in den vFilters-Parameter
		// von bindList - dort erwartet UI5 sap.ui.model.Filter-Objekte.
		mParameters.$filter = oDefinition.filter;
	}

	/*
	 * Filter-OBJEKTE gehen an den vierten Parameter, roher Text in die
	 * Parameter - beides zusammen ist zulaessig und wird von UI5
	 * UND-verknuepft. Der Weg ueber Objekte ist der, den die Reiterzaehler
	 * seit 11.09.2026 nehmen: sie bekommen dieselbe Filterkette wie die
	 * Tabelle, und die liegt als Filter-Objekte vor.
	 */
	const oBinding = oModel.bindList(oDefinition.path, undefined, [], aFilters, mParameters);
	await oBinding.requestContexts(0, 1);
	return oBinding.getCount() ?? 0;
}

/*
 * Zählt VORGÄNGE statt Meldungen - die Zahl, die neben den Reitern stehen
 * soll (Festlegung Tolksdorf, 11.09.2026: "nur die Vorgänge als Zahl
 * anzeigen").
 *
 * 🔴 DAS GEHT NUR SERVERSEITIG. Ein Vorgang ist eine Gruppe gleicher
 * CorrUuid; im Browser wüsste man das erst, nachdem man alle Zeilen geladen
 * hat - für den offenen Reiter tut die App das ohnehin, für die vier anderen
 * wären es zusammen über 7000 Zeilen bei jedem Filterwechsel. Über
 * $apply=groupby kostet es dieselbe eine Abfrage wie bisher, nur zählt der
 * Server Gruppen statt Zeilen.
 *
 * ⚠ OB DER SERVICE DAS KANN, IST NICHT ZUGESICHERT. Die Container-Annotation
 * Aggregation.ApplySupported steht im $metadata (aggregate/groupby/filter),
 * aber SADL weist $apply auf nicht-analytischen Views durchaus zurück. Statt
 * darauf zu wetten: EINMAL versuchen, das Ergebnis merken, und bei Ablehnung
 * dauerhaft auf die Meldungszählung zurückfallen. Schlimmster Fall ist damit
 * genau der Zustand von vorher plus eine abgewiesene Anfrage je Sitzung.
 */

/**
 * Die initiale Korrelations-ID. CorrUuid ist Edm.Guid (am $metadata
 * geprueft), UI5 formatiert das Literal deshalb selbst richtig - ein
 * handgeschriebenes guid'...' waere die Art Annahme, die hier schon einmal
 * danebenlag.
 */
// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
const INITIAL_UUID = "00000000-0000-0000-0000-000000000000";

// eslint-disable-next-line @sap-ux/fiori-tools/sap-no-global-variable
let bApplySupported = true;

/** Konnte zuletzt nach Vorgängen gezählt werden? Steuert die Beschriftung. */
export function isApplySupported(): boolean {
	return bApplySupported;
}

/**
 * Das Flag vor einem neuen Zaehllauf zuruecksetzen.
 *
 * 🔴 OHNE DAS VERGIFTET EIN EINZIGER FEHLSCHLAG DIE GANZE SITZUNG.
 * bApplySupported ist ein Modulzustand und blieb bis 14.09.2026 fuer immer
 * false, sobald er einmal gekippt war - auch wenn die Ursache eine
 * voruebergehende war (ein Netzaussetzer, eine Filterkombination, die es
 * inzwischen nicht mehr gibt). Die Reiter zaehlten danach bis zum Neuladen
 * der Seite Meldungen, waehrend die Beschriftung Vorgaenge versprach.
 *
 * Innerhalb EINES Laufs bleibt das Flag dagegen klebrig, und das ist
 * gewollt: es spart den uebrigen Reitern die Abfragen, sobald der erste
 * gezeigt hat, dass der Service nicht mitspielt.
 */
export function resetApplySupport(): void {
	bApplySupported = true;
}

/**
 * Anzahl verschiedener CorrUuid unter denselben Bedingungen.
 *
 * ⚠ Rückgabe -1 heißt "nicht ermittelbar" - NICHT 0. Eine 0 wäre eine
 * Aussage, und der Aufrufer soll auf die Meldungszahl ausweichen können,
 * statt eine Null hinzuschreiben, die niemand geprüft hat.
 *
 * ⚠ Zeilen mit INITIALER CorrUuid fallen in EINE Gruppe, während
 * CascadeGrouper jede davon als eigenen Vorgang führt. Die Zahl kann für
 * Altbestand also zu klein sein; _loadCascades vergleicht sie deshalb für
 * den offenen Reiter gegen die im Browser gebildete Menge und meldet eine
 * Abweichung auf der Konsole.
 */
export async function loadOperationCount(
	oModel: ODataModel,
	sPath: string,
	aFilters: Filter[] = []
): Promise<number> {
	if (!bApplySupported) {
		return -1;
	}
	try {
		/*
		 * 🔴 ZWEI ABFRAGEN, WEIL EIN VORGANG ZWEI DINGE SEIN KANN.
		 *
		 * Gruppieren allein zaehlt falsch, und am 11.09.2026 war das an
		 * echten Zahlen zu sehen: der Reiter "Alle" meldete 437, die Tabelle
		 * darunter 4.521 - obwohl der Reiter ueber den GANZEN Bestand zaehlt
		 * und die Tabelle nur ueber die neuesten 5000. Weniger bei mehr
		 * Daten kann kein Ausschnitt sein, nur ein Einbruch.
		 *
		 * Die Ursache steht in CascadeGrouper.group( ): eine INITIALE
		 * Korrelations-ID bekommt dort je Zeile eine eigene Gruppe
		 * ("single:<LogUuid>"), denn sie bedeutet nicht "gehoert zusammen",
		 * sondern "hat keine Klammer". Ein groupby wirft sie dagegen alle in
		 * EINE Gruppe - und da ein Grossteil des Bestands keine Klammer
		 * traegt, schrumpfte die Zahl um eine Zehnerpotenz.
		 *
		 * Also genauso zaehlen, wie die Tabelle gruppiert:
		 *   korrelierte Vorgaenge  = verschiedene CorrUuid OHNE die initiale
		 *   + unkorrelierte Zeilen = jede fuer sich ein Vorgang
		 */
		const aCorrelated = aFilters.concat(new Filter({
			path: "CorrUuid", operator: FilterOperator.NE, value1: INITIAL_UUID
		}));
		const oGroups = oModel.bindList(sPath, undefined, [], aCorrelated, {
			// $$aggregation statt handgebautem $apply: UI5 setzt die
			// Filterkette als filter() VOR das groupby. Ein danebengestelltes
			// $filter wirkte laut OData erst NACH der Gruppierung - dort gibt
			// es weder LogType noch HistoryType mehr, und der Service
			// antwortete folgerichtig mit 0.
			$$aggregation: { group: { CorrUuid: {} } },
			$count: true
		});
		const aContexts = await oGroups.requestContexts(0, 1);
		const nGroups = oGroups.getCount();

		/*
		 * ⚠ KEIN "?? 0". Eine fehlende Antwort ist keine Null - genau daran
		 * scheiterte der erste Anlauf: der Rueckfall haengt an einer
		 * Exception, und es kam keine.
		 */
		if (typeof nGroups !== "number" || !Number.isFinite(nGroups)
				|| (nGroups === 0 && aContexts.length > 0)) {
			bApplySupported = false;
			// eslint-disable-next-line no-console
			console.warn("[Reiterzaehler] Der Service liefert zur Gruppierung "
				+ "keine brauchbare Anzahl - es wird weiter nach Meldungen gezaehlt.");
			return -1;
		}

		const aLoose = aFilters.concat(new Filter({
			path: "CorrUuid", operator: FilterOperator.EQ, value1: INITIAL_UUID
		}));
		const oLoose = oModel.bindList(sPath, undefined, [], aLoose, {
			$select: "LogUuid",
			$count: true
		});
		await oLoose.requestContexts(0, 1);
		// Hier ist "?? 0" vertretbar: ein schlichtes $count ohne Aggregation
		// ist der Weg, den die Zaehler seit jeher gehen - er ist erprobt.
		const nLoose = oLoose.getCount() ?? 0;

		return nGroups + nLoose;
	} catch (oError) {
		bApplySupported = false;
		// eslint-disable-next-line no-console
		console.warn("[Reiterzaehler] Gruppierung nach Vorgaengen wird vom "
			+ "Service nicht unterstuetzt - es wird weiter nach Meldungen "
			+ "gezaehlt.", oError);
		return -1;
	}
}
