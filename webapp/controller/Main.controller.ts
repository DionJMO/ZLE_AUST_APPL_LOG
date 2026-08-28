import DateFormat from "sap/ui/core/format/DateFormat";
import UIComponent from "sap/ui/core/UIComponent";
import Table from "sap/ui/table/Table";
import JSONModel from "sap/ui/model/json/JSONModel";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import ListBinding from "sap/ui/model/ListBinding";
import Event from "sap/ui/base/Event";
import VizFrame from "sap/viz/ui5/controls/VizFrame";
import BaseController from "./BaseController";
import * as TableColumnState from "../util/TableColumnState";
import * as LogAggregator from "../model/LogAggregator";
import * as KpiLoader from "../model/KpiLoader";
import * as ChartColors from "../model/ChartColors";
import * as ProcessAxis from "../model/ProcessAxis";
import * as KeyDetailLoader from "../model/KeyDetailLoader";
import * as CascadeGrouper from "../model/CascadeGrouper";
import * as SapLookup from "../model/SapLookup";
import * as TaPositions from "../model/TaPositions";
import { normalizeMaterial as formatterNormalize } from "../model/formatter";
import Sorter from "sap/ui/model/Sorter";
import Fragment from "sap/ui/core/Fragment";
import Popover from "sap/m/Popover";
import Dialog from "sap/m/Dialog";
import Control from "sap/ui/core/Control";
import ODataModel from "sap/ui/model/odata/v4/ODataModel";
import ResourceModel from "sap/ui/model/resource/ResourceModel";
import ResourceBundle from "sap/base/i18n/ResourceBundle";

/**
 * @namespace zui5_zle_aust_mon.controller
 */
export default class Main extends BaseController {

	/**
	 * Standardmaessig sichtbare Spaltenanzahl je Tabelle. Der Rest ist
	 * ausgeblendet und laesst sich ueber das Zahnrad einblenden.
	 *
	 * Seit dem Umbau auf Reiter gibt es nur noch zwei Tabellen: eine fuer
	 * alle Meldungsreiter und eine fuer die Auftraege.
	 */
	private static readonly DEFAULT_VISIBLE: Record<string, number> = {
		idMsgTable: 6,
		idTpaTable: 8
	};

	/** Detail-Popover und Payload-Dialog werden einmal erzeugt und wiederverwendet. */
	private _pKeyPopover?: Promise<Popover>;
	private _pPayloadDialog?: Promise<Dialog>;

	/** Voreinstellung des Verlaufs-Zeitfensters in Tagen. */
	private static readonly CHART_DAYS = 7;

	/**
	 * Zeitfenster der Vollstaendigkeitspruefung Warenausgang.
	 *
	 * Bewusst laenger als das Verlaufsfenster: der Befund, um den es geht,
	 * blieb im August zwei Wochen unbemerkt. Ein Fenster von sieben Tagen
	 * haette ihn wieder verpasst.
	 */
	private static readonly WA_CHECK_DAYS = 30;

	/**
	 * Die Sicht als URL: Reiter, Typfilter, Suche, Gruppierung.
	 *
	 * Zweck ist weniger das Ueberleben eines Neuladens als das VERSCHICKEN -
	 * "schau dir mal das an" ist in einem Werkzeug, das zwischen drei Leuten
	 * hin und her geht, mehr wert als es klingt.
	 *
	 * ⚠ Kurze Schluessel, weil sie in der Adresszeile stehen und dort auch
	 * von Hand gelesen und getippt werden.
	 */
	private static readonly URL_KEYS = {
		p: "/selectedProcess",
		t: "/selectedType",
		q: "/searchTerm",
		g: "/grouped",
		d: "/chartDays"
	};

	/**
	 * Sperre gegen Rueckkopplung Modell -> URL.
	 *
	 * ⚠ Startwert TRUE, und das ist kein Versehen. onInit laeuft VOR dem
	 * ersten patternMatched und ruft _applyMsgFilter( ). Duerfte der dabei
	 * schon die URL schreiben, ueberschriebe der Standardzustand eine
	 * mitgegebene Adresse - wer einen Link mit ?p=OB&t=E oeffnet, landete
	 * beim Standardreiter. Erst der erste Routentreffer gibt frei.
	 */
	private _bApplyingUrl = true;

	public onInit(): void {
		this.getView()?.setModel(new JSONModel({ days: [] }), "chart");

		// Pfeilfunktion statt Methodenreferenz plus Listener-Kontext: eine
		// losgeloeste Methode traegt ihr "this" nicht mit, und ESLint weist
		// mit unbound-method zu Recht darauf hin.
		(this.getOwnerComponent() as UIComponent).getRouter()
			.getRoute("RouteMain")?.attachPatternMatched((oEvent: Event) => {
				this._onRouteMatched(oEvent);
			});

		Object.keys(Main.DEFAULT_VISIBLE).forEach((sTableId) => {
			const oTable = this._table(sTableId);
			if (oTable) {
				TableColumnState.restore(oTable, sTableId, Main.DEFAULT_VISIBLE[sTableId]);
			}
		});

		this._applyChartProperties();
		this._applyMsgFilter();
		this._loadData();
	}

	public onRefresh(): void {
		Object.keys(Main.DEFAULT_VISIBLE).forEach((sTableId) => {
			this._table(sTableId)?.getBinding("rows")?.refresh();
		});
		this._loadData();
	}

	/**
	 * Wechsel in die Arbeitsliste des Fachbereichs. Bewusst nur in diese
	 * Richtung: wer aus dem Fachbereich kommt, startet direkt auf #/tasks
	 * und soll die technische Sicht gar nicht erst sehen. Zurueck geht es
	 * ueber den Browser.
	 */
	public onNavToTasks(): void {
		(this.getOwnerComponent() as UIComponent).getRouter().navTo("RouteTasks");
	}

	/**
	 * Der Reiterschluessel wird aus dem Ereignis gelesen, nicht aus dem
	 * Modell: ob die Zwei-Wege-Bindung von selectedKey vor dem select-
	 * Ereignis greift, ist nicht garantiert.
	 */
	public onProcessTabSelect(oEvent: Event): void {
		const sKey = oEvent.getParameter("key" as never) as unknown as string;
		this.getUiModel().setProperty("/selectedProcess", sKey);
		this._applyMsgFilter();
	}

	/**
	 * Volltextsuche ueber die Meldungstabelle.
	 *
	 * ⚠ Bewusst nur am search-Ereignis (Eingabetaste, Lupe, Loeschkreuz) und
	 * NICHT an liveChange: bei ueber 6000 Saetzen wuerde jeder Tastendruck
	 * eine OData-Abfrage ausloesen.
	 */
	/**
	 * Zeitfenster des Verlaufs umschalten.
	 *
	 * ⚠ Nur der Chart wird neu geladen, nicht die Kennzahlen: die zaehlen
	 * bewusst ueber ALLE Zeiten und haben mit dem Fenster nichts zu tun.
	 * Ein _loadData( ) hier waere drei Abfragen fuer nichts.
	 */
	public onChartDaysChange(oEvent: Event): void {
		const oItem = oEvent.getParameter("item" as never) as unknown as { getKey(): string };
		this.getUiModel().setProperty("/chartDays", oItem.getKey());
		this._syncUrl();
		void this._loadChart();
	}

	public onMsgSearch(oEvent: Event): void {
		const sQuery = (oEvent.getParameter("query" as never) as unknown as string) ?? "";
		this.getUiModel().setProperty("/searchTerm", sQuery.trim());
		this._applyMsgFilter();
	}

	public onTypeFilterChange(oEvent: Event): void {
		const oItem = oEvent.getParameter("item" as never) as unknown as { getKey(): string };
		this.getUiModel().setProperty("/selectedType", oItem.getKey());
		this._applyMsgFilter();
	}

	/** Ein Zahnrad fuer beide Tabellen - je nachdem, welcher Reiter offen ist. */
	public onOpenMsgColumns(): void {
		const sProcess = this.getUiModel().getProperty("/selectedProcess") as string;
		if (sProcess === ProcessAxis.KEY_WACHECK) {
			// Die Pruefsicht hat sechs feste Spalten - eine Auswahl waere
			// Ballast, wie schon bei der Vorgangstabelle.
			return;
		}
		this._openColumns(sProcess === ProcessAxis.KEY_ORDERS ? "idTpaTable" : "idMsgTable");
	}

	/**
	 * Setzt Prozess- und Typfilter auf die Meldungstabelle.
	 *
	 * Der Reiter "Alle Meldungen" bleibt bewusst ungefiltert und ist damit
	 * eine Obermenge der uebrigen - er ist keine Kategorie, sondern die
	 * Rohsicht fuer die Fehlersuche. Wer die Reiterzahlen addiert, kommt
	 * deshalb nicht auf diese Zahl.
	 */
	private _applyMsgFilter(): void {
		// Alle vier Zustaende laufen hier zusammen - ein Anschlusspunkt
		// genuegt, statt ihn in jeden Handler einzeln zu haengen.
		this._syncUrl();

		if (this.getUiModel().getProperty("/grouped") as boolean) {
			void this._loadCascades();
			return;
		}
		const oBinding = this._table("idMsgTable")?.getBinding("rows") as ListBinding | undefined;
		if (!oBinding) {
			return;
		}
		oBinding.filter(this._msgFilters());
	}

	/**
	 * Prozess- und Typfilter als Filterliste.
	 *
	 * Ausgelagert, weil sie zweimal gebraucht wird: fuer die OData-Bindung
	 * der Tabelle und fuer den Ladevorgang der Vorgangs-Verdichtung. Zwei
	 * Kopien wuerden auseinanderlaufen, und dann zeigte die gruppierte
	 * Sicht etwas anderes als die einzelne.
	 */
	private _msgFilters(): Filter[] {
		const sProcess = this.getUiModel().getProperty("/selectedProcess") as string;
		const sType = this.getUiModel().getProperty("/selectedType") as string;
		const aFilters: Filter[] = [];

		if (sProcess === ProcessAxis.KEY_UNASSIGNED) {
			aFilters.push(ProcessAxis.unassignedFilter());
		} else if (sProcess !== ProcessAxis.KEY_ALL && sProcess !== ProcessAxis.KEY_ORDERS) {
			const oProcess = ProcessAxis.processFilter(sProcess);
			if (oProcess) {
				aFilters.push(oProcess);
			}
		}

		if (sType) {
			aFilters.push(new Filter({
				path: "LogType", operator: FilterOperator.EQ, value1: sType
			}));
		}

		/*
		 * Suche ueber drei Felder, ODER-verknuepft und mit Contains.
		 *
		 * Contains loest zwei Probleme auf einmal, die sonst je eine
		 * Sonderbehandlung braeuchten: die TPA-Nummer steht 10-stellig mit
		 * fuehrenden Nullen in der Tabelle ("0006024397"), getippt wird sie
		 * aber ohne ("6024397"); und die Materialnummer liegt in zwei
		 * Schreibweisen vor ("4028" und "000000000000004028"). Contains
		 * findet beide Male, ohne dass hier normalisiert werden muss.
		 *
		 * Message ist mit drin, weil "Stammdaten" oder "ME-Abweichung" die
		 * naheliegendste Suche ist, wenn man einem Fehlerbild nachgeht.
		 *
		 * 🔴 BusinessKey MUSS dabei sein, und das war er bis 27.08.2026 nicht.
		 * Wer die 17-stellige HiLIS-Auftragsnummer aus einem HiLIS-Bildschirm
		 * einfuegt, fand ohne ihn NUR die Consumer-Zeilen - die Trigger-Zeilen
		 * tragen in TpaNumber die 10-stellige TANUM und die lange Form
		 * ausschliesslich im BusinessKey. Derselbe Defekt wie im Popover, nur
		 * an der zweiten Stelle.
		 */
		const sSearch = this.getUiModel().getProperty("/searchTerm") as string;
		if (sSearch) {
			aFilters.push(new Filter({
				and: false,
				filters: ["TpaNumber", "BusinessKey", "ItemNumber", "Message"].map((sField) => new Filter({
					path: sField, operator: FilterOperator.Contains, value1: sSearch
				}))
			}));
		}

		return aFilters.length ? [new Filter({ filters: aFilters, and: true })] : [];
	}

	private _loadData(): void {
		this._stampRefresh();
		void this._loadChart();
		void this._loadKpis();
		void this._loadSapPositions();
		void this._loadShadowedPicks();
	}

	/**
	 * Reichert die Auftragstabelle um MHD und ME aus LTAP an.
	 *
	 * 🔴 F-01 verlangt "Uebersicht offener WE-Auftraege inkl. Status, MHD,
	 * Charge, ME". ZLE_AUST_TPA_SYNC fuellt MEASUREMENT_UNIT und
	 * BEST_BEFORE_DATE aber NIE - beide kommen nicht aus GET_ORDER_LIST, die
	 * Spalten waren strukturell leer. Die Anforderung galt deshalb als "nur
	 * teilweise erfuellbar". Mit dem Lookup-Service ist sie es nicht mehr.
	 *
	 * ⚠ Die Tabelle wird NICHT umgebunden: das Nachschlagewerk haengt als
	 * Bindungsteil an den zwei Zellen, die es brauchen. So bleiben
	 * serverseitiges Blaettern und Sortieren der OData-Bindung erhalten.
	 */
	private async _loadSapPositions(): Promise<void> {
		const oModel = this._jsonModel("sapPos", { map: {} });
		try {
			const oBinding = this.getODataModel("tpaModel")
				.bindList("/Tpa", undefined, [], [], { $select: "OrderNumber" });
			const aContexts = await oBinding.requestContexts(0, 2000);
			const aOrders = aContexts.map((oContext) =>
				(oContext.getProperty("OrderNumber") as string) ?? "");
			const oResult = await TaPositions.loadByOrders(
				this.getView()?.getModel("lookupModel") as ODataModel | undefined, aOrders);
			oModel.setProperty("/map", oResult.map);
			// ⚠ tsc hat DIESE Stelle nicht gemeldet, als loadByOrders seinen
			// Rueckgabetyp aenderte - setProperty nimmt any. Die Umstellung
			// muss hier von Hand nachgezogen werden.
			this.getUiModel().setProperty("/sapPosTruncated", oResult.truncated);
		} catch (oError) {
			// Zugabe, kein Bestandteil: faellt sie aus, bleiben die zwei
			// Spalten leer wie vorher.
			// eslint-disable-next-line no-console
			console.error("[Auftraege] Anreicherung aus LTAP fehlgeschlagen:", oError);
		}
	}

	/**
	 * Vollstaendigkeitspruefung Warenausgang.
	 *
	 * Siehe model/TaPositions.ts - geprueft wird gegen die SAP-Daten, NICHT
	 * gegen den Log: der Outbound-Pfad protokolliert Erfolge gar nicht, ein
	 * fehlender Eintrag waere also kein Befund.
	 */
	private async _loadShadowedPicks(): Promise<void> {
		const oModel = this._jsonModel("wacheck", { rows: [] });
		const oFrom = new Date();
		oFrom.setDate(oFrom.getDate() - Main.WA_CHECK_DAYS);
		const oResult = await TaPositions.loadAutoStore(
			this.getView()?.getModel("lookupModel") as ODataModel | undefined,
			oFrom.toISOString().slice(0, 10)
		);
		const aShadowed = TaPositions.shadowedPicks(oResult.rows);
		oModel.setProperty("/rows", aShadowed);
		this.getUiModel().setProperty("/waCheckCount", aShadowed.length);
		/*
		 * 🔴 Bei einer VOLLSTAENDIGKEITSpruefung ist ein stiller Deckel der
		 * schlimmste Fehler: die Liste behauptete dann, es gebe keine weiteren
		 * Faelle. Deshalb wird die Kappung angezeigt, wie beim Verlauf und bei
		 * der Vorgangsverdichtung auch.
		 */
		this.getUiModel().setProperty("/waCheckTruncated", oResult.truncated);
	}

	/** Legt ein JSON-Modell einmalig an und liefert es. */
	private _jsonModel(sName: string, oInitial: object): JSONModel {
		let oModel = this.getView()?.getModel(sName) as JSONModel | undefined;
		if (!oModel) {
			oModel = new JSONModel(oInitial);
			this.getView()?.setModel(oModel, sName);
		}
		return oModel;
	}

	private async _loadChart(): Promise<void> {
		try {
			const oData = await LogAggregator.loadLastDays(
				this.getODataModel("mainModel"),
				Number(this.getUiModel().getProperty("/chartDays")) || Main.CHART_DAYS
			);
			(this.getView()?.getModel("chart") as JSONModel).setData(oData);
			this.getUiModel().setProperty("/chartTruncated", oData.truncated);
		} catch (oError) {
			// eslint-disable-next-line no-console
			console.error("[Verlauf] Aggregation fehlgeschlagen:", oError);
		}
	}

	private async _loadKpis(): Promise<void> {
		await Promise.all(KpiLoader.metrics.map(async (oDefinition) => {
			try {
				const nCount = await KpiLoader.loadCount(
					this.getODataModel(oDefinition.model),
					oDefinition
				);
				this.getUiModel().setProperty("/kpi/" + oDefinition.key, String(nCount));
			} catch (oError) {
				// eslint-disable-next-line no-console
				console.error("[KPI] " + oDefinition.key + " fehlgeschlagen:", oError);
			}
		}));
	}

	/**
	 * Chart-Darstellung: Legende unter das Diagramm, Stapelfarben auf die
	 * semantischen Theme-Farben, damit sie zur Kritikalitaets-Darstellung in
	 * den Tabellen passen.
	 *
	 * Die Legendenposition sitzt unter legendGroup.layout.position - nicht
	 * unter legend, das steuert nur Sichtbarkeit und Titel der Legende.
	 * Referenz: https://ui5.sap.com/docs/vizdocs/index.html
	 */
	private _applyChartProperties(): void {
		const oVizFrame = this.byId("idTrendVizFrame") as VizFrame | undefined;
		if (!oVizFrame) {
			return;
		}
		ChartColors.resolvePalette((aColors) => {
			oVizFrame.setVizProperties({
				plotArea: { colorPalette: aColors, dataLabel: { visible: false } },
				legend: { visible: true, title: { visible: false } },
				legendGroup: { layout: { position: "bottom", alignment: "center" } },
				title: { visible: false },
				valueAxis: { title: { visible: false } },
				categoryAxis: { title: { visible: false } }
			});
		});
	}

	private _table(sTableId: string): Table | undefined {
		return this.byId(sTableId) as Table | undefined;
	}

	private _openColumns(sTableId: string): void {
		const oTable = this._table(sTableId);
		if (oTable) {
			TableColumnState.openDialog(oTable, sTableId);
		}
	}

	/**
	 * Schreibt den aktuellen Zeitpunkt in das ui-Modell. Bewusst hier und nicht
	 * als Expression Binding in der View: dort waere der Wert nicht reaktiv
	 * und nicht testbar.
	 */
	private _stampRefresh(): void {
		const oFormat = DateFormat.getDateTimeInstance({ style: "medium" });
		this.getUiModel().setProperty("/lastRefreshText", oFormat.format(new Date()));
	}

	/**
	 * Detailsicht zu einer TPA-Nummer.
	 *
	 * ⚠ Der Filterwert kommt aus dem BINDING-KONTEXT, nicht aus dem Linktext.
	 * Bei Materialnummern zeigt die Oberflaeche die normalisierte Form ("4028"),
	 * in der Datenbank steht je nach Erzeuger auch "000000000000004028" - ein
	 * Filter auf den angezeigten Text fuende die Haelfte der Zeilen nicht.
	 */
	public onTpaNumberPress(oEvent: Event): void {
		void this._openKeyPopover(oEvent, "TPA", "TpaNumber", "OrderNumber");
	}

	/** Detailsicht zu einer Materialnummer. */
	public onItemNumberPress(oEvent: Event): void {
		void this._openKeyPopover(oEvent, "ITEM", "ItemNumber", "ItemNumber");
	}

	/**
	 * JSON-Payload direkt aus der Meldungstabelle.
	 *
	 * Bis zum 27.08.2026 fuehrte der einzige Weg dorthin ueber das
	 * Verlaufs-Panel im Popover - und genau das war die Dublette, weil es
	 * die Tabelle wiederholte, in der man ohnehin gerade steht. Jetzt haengt
	 * das Symbol an der Zeile selbst und erscheint nur, wo es einen Payload
	 * gibt.
	 */
	public onMessagePayloadPress(oEvent: Event): void {
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const oSource = oEvent.getSource() as Control;
		const oContext = oSource.getBindingContext("mainModel");
		if (!oContext) {
			return;
		}
		this._showPayload(
			(oContext.getProperty("JsonPayload") as string) ?? "",
			(oContext.getProperty("Message") as string) ?? "",
			this.formatter.timestamp((oContext.getProperty("CreatedAtStamp") as string) ?? "")
		);
	}

	public onKeyPopoverClose(): void {
		void this._pKeyPopover?.then((oPopover) => oPopover.close());
	}

	/** Zeigt den JSON_PAYLOAD der angeklickten Logzeile. */
	public onKeyPopoverLogPress(oEvent: Event): void {
		// oEvent.getSource( ) liefert laut Typen EventProvider, dort gibt es
		// weder getBindingContext noch laesst es sich an openBy uebergeben.
		// Die Assertion ist also noetig - tsc belegt das, ESLints Regel
		// no-unnecessary-type-assertion urteilt hier falsch.
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const oItem = oEvent.getSource() as Control;
		const oContext = oItem.getBindingContext("detail");
		const sPayload = (oContext?.getProperty("payload") as string) ?? "";
		if (!sPayload) {
			return;
		}
		this._showPayload(
			sPayload,
			(oContext?.getProperty("message") as string) ?? "",
			(oContext?.getProperty("stamp") as string) ?? ""
		);
	}

	private _showPayload(sPayload: string, sMessage: string, sTitle: string): void {
		if (!sPayload) {
			return;
		}
		const oDetail = this._detailModel();
		oDetail.setProperty("/payload", sPayload);
		oDetail.setProperty("/payloadMessage", sMessage);
		oDetail.setProperty("/payloadTitle", sTitle);

		if (!this._pPayloadDialog) {
			this._pPayloadDialog = Fragment.load({
				id: this.getView()?.getId(),
				name: "zui5_zle_aust_mon.view.fragment.PayloadDialog",
				controller: this
			}) as Promise<Dialog>;
			void this._pPayloadDialog.then((oDialog) => this.getView()?.addDependent(oDialog));
		}
		void this._pPayloadDialog.then((oDialog) => oDialog.open());
	}

	public onPayloadClose(): void {
		void this._pPayloadDialog?.then((oDialog) => oDialog.close());
	}

	/**
	 * Das i18n-Bundle.
	 *
	 * 🔴 MIT RUECKFALL AUF DIE COMPONENT, und das ist kein Guertel-und-
	 * Hosentraeger: waehrend onInit ist das Modell der Component noch NICHT an
	 * die View durchgereicht - getModel( ) liefert dort undefined. Die frueher
	 * einzige Zeile schuetzte per "?." nur getView( ), nicht das Modell, und
	 * lief deshalb in "Cannot read properties of undefined (reading
	 * 'getResourceBundle')".
	 *
	 * Aufgefallen ist es erst, als mit _loadShadowedPicks( ) der erste
	 * Aufrufer WAEHREND onInit dazukam; alle uebrigen laufen nach einer
	 * Benutzeraktion und trafen die Luecke nie.
	 */
	private _bundle(): ResourceBundle {
		const oModel = (this.getView()?.getModel("i18n")
			?? this.getOwnerComponent()?.getModel("i18n")) as ResourceModel | undefined;
		return oModel?.getResourceBundle() as ResourceBundle;
	}

	private _detailModel(): JSONModel {
		let oModel = this.getView()?.getModel("detail") as JSONModel | undefined;
		if (!oModel) {
			oModel = new JSONModel({ log: [], logVisible: false, sap: { available: false, hint: "", header: "", fields: [], rowsHeader: "", rows: [] } });
			this.getView()?.setModel(oModel, "detail");
		}
		return oModel;
	}

	private async _openKeyPopover(
		oEvent: Event,
		sKind: KeyDetailLoader.KeyKind,
		sMainField: string,
		sTpaField: string
	): Promise<void> {
		// oEvent.getSource( ) liefert laut Typen EventProvider, dort gibt es
		// weder getBindingContext noch laesst es sich an openBy uebergeben.
		// Die Assertion ist also noetig - tsc belegt das, ESLints Regel
		// no-unnecessary-type-assertion urteilt hier falsch.
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const oSource = oEvent.getSource() as Control;

		/*
		 * Der Schluessel wird in ALLEN drei Modellen gesucht, weil dieselben
		 * Handler aus drei Tabellen gerufen werden:
		 *   idMsgTable      -> mainModel  (OData, Einzelmeldungen)
		 *   idCascadeTable  -> cascade    (JSON, verdichtete Vorgaenge)
		 *   idTpaTable      -> tpaModel   (OData, Auftragspuffer)
		 *
		 * ⚠ Vorher standen hier nur mainModel und tpaModel. Aus der
		 * Vorgangstabelle fand der Handler damit nichts, sRaw blieb leer und
		 * die Methode stieg still aus - die Links sahen anklickbar aus und
		 * taten nichts. Derselbe Fehlertyp wie bei den leeren Zellen: ein
		 * Zeilenkontext haengt immer an EINEM Modell, und der Name muss
		 * stimmen.
		 *
		 * Die Feldnamen der Vorgangszeilen sind absichtlich die der
		 * Logzeilen, deshalb genuegt sMainField fuer beide.
		 */
		/*
		 * hasLogFields sagt, ob die Zeile die Felder aus ZLE_AUST_APL_LOG
		 * traegt. Der Auftragspuffer (Tpa) hat sie NICHT - dort waere ein
		 * getProperty("Lgnum") ein Zugriff auf eine Eigenschaft, die es in
		 * der Entitaet gar nicht gibt.
		 */
		const aSources: { model: string; field: string; hasLogFields: boolean }[] = [
			{ model: "mainModel", field: sMainField, hasLogFields: true },
			{ model: "cascade", field: sMainField, hasLogFields: true },
			{ model: "tpaModel", field: sTpaField, hasLogFields: false }
		];

		let sRaw = "";
		let sLgnum = "";
		let sBusinessKey = "";
		for (const oSrc of aSources) {
			const oCtx = oSource.getBindingContext(oSrc.model);
			const sValue = (oCtx?.getProperty(oSrc.field) as string) ?? "";
			if (sValue.trim()) {
				sRaw = sValue;
				if (oSrc.hasLogFields) {
					// Seit Michaels Logging-Umbau traegt der Logsatz die
					// Lagernummer selbst - vorher stand dafuer ein hart
					// codiertes "001" im Lookup.
					sLgnum = (oCtx?.getProperty("Lgnum") as string) ?? "";
					sBusinessKey = (oCtx?.getProperty("BusinessKey") as string) ?? "";
				}
				break;
			}
		}

		if (!sRaw) {
			return;
		}

		const oDetail = this._detailModel();
		oDetail.setProperty("/busy", true);
		oDetail.setProperty("/log", []);
		oDetail.setProperty("/logVisible", false);

		await this._openPopover(oSource);

		try {
			/*
			 * SAP ZUERST, und der Log NUR wenn er gebraucht wird.
			 *
			 * Stehen die SAP-Felder, ist das Verlaufs-Panel ausgeblendet -
			 * dann waere ein Ladevorgang dafuer eine Abfrage fuer nichts.
			 * Deshalb hier bewusst nacheinander statt parallel: die
			 * Rueckfallebene kostet nur dann, wenn sie eintritt.
			 */
			const oSapData = await SapLookup.load(
				this.getView()?.getModel("lookupModel") as ODataModel | undefined,
				sKind,
				sRaw,
				this._bundle(),
				sLgnum
			);
			oDetail.setProperty("/sap", oSapData);

			const oBundle = this._bundle();
			oDetail.setProperty("/title",
				oBundle.getText(sKind === "ITEM" ? "popTitleItem" : "popTitleTpa",
					[sKind === "ITEM" ? formatterNormalize(sRaw) : sRaw.trim()]) ?? sRaw);

			if (!oSapData.available) {
				const oDetailData = await KeyDetailLoader.loadKeyDetail(
					this.getView()?.getModel("mainModel") as ODataModel,
					sKind,
					sRaw,
					oBundle,
					sBusinessKey
				);
				oDetail.setProperty("/logHeader", oDetailData.logHeader);
				oDetail.setProperty("/log", oDetailData.log);
				oDetail.setProperty("/logVisible", true);
			}
		} catch {
			oDetail.setProperty("/logHeader", this._bundle().getText("popLoadFailed") ?? "");
			oDetail.setProperty("/logVisible", true);
			oDetail.setProperty("/sap", { available: false, hint: "", header: "", fields: [], rowsHeader: "", rows: [] });
		} finally {
			oDetail.setProperty("/busy", false);
		}
	}

	/**
	 * Umschalten zwischen Einzelmeldungen und Vorgaengen.
	 *
	 * ⚠ KORREKTUR 27.08.2026: die erste Fassung band EINE Tabelle um, von
	 * mainModel>/AppLog auf cascade>/rows, mit der Begruendung "gleiche
	 * Eigenschaftsnamen, also funktionieren alle Spalten weiter". Das war
	 * falsch - die Zellen binden mit Modellpraefix, und in der
	 * Vorgangssicht lag der Zeilenkontext auf "cascade". Alle Spalten
	 * blieben leer ausser "Schritte", der einzigen mit cascade>-Bindung.
	 *
	 * Jetzt haengt jede Tabelle fest an ihrem Modell und wird ueber
	 * visible umgeschaltet - wie die Auftragstabelle auch.
	 */
	public onCascadeToggle(oEvent: Event): void {
		const bPressed = oEvent.getParameter("pressed" as never) as unknown as boolean;
		this.getUiModel().setProperty("/grouped", bPressed);
		this._applyMsgFilter();
	}

	/** Alle Schritte eines Vorgangs - im selben Popover wie die Detailsicht. */
	public onCascadePress(oEvent: Event): void {
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
		const oSource = oEvent.getSource() as Control;
		const oContext = oSource.getBindingContext("cascade");
		const oRow = oContext?.getObject() as CascadeGrouper.CascadeRow | undefined;
		if (!oRow) {
			return;
		}
		const oBundle = this._bundle();
		const oDetail = this._detailModel();

		oDetail.setProperty("/title", oBundle.getText("cascTitle", [String(oRow.StepCount)]) ?? "");
		oDetail.setProperty("/logHeader", oBundle.getText("popLogPanel", [String(oRow.StepCount)]) ?? "");
		oDetail.setProperty("/busy", false);
		oDetail.setProperty("/sap", { available: false, hint: "", header: "", fields: [], rowsHeader: "", rows: [] });
		// Im Kaskaden-Popover IST der Verlauf der Inhalt, nicht die Beigabe.
		oDetail.setProperty("/logVisible", true);
		oDetail.setProperty("/log", (oRow.Steps ?? []).map((oStep) => ({
			stamp:   this.formatter.timestamp(oStep.CreatedAtStamp),
			logType: oStep.LogType ?? "",
			message: oStep.Message ?? "",
			process: oBundle.getText("popAttrProcess", [this.formatter.dashIfEmpty(oStep.HistoryType)]) ?? "",
			http:    oStep.HttpStatus ? (oBundle.getText("popAttrHttp", [String(oStep.HttpStatus)]) ?? "") : "",
			line:    oStep.OrderLineNr ? (oBundle.getText("popAttrLine", [oStep.OrderLineNr]) ?? "") : "",
			payload: oStep.JsonPayload ?? ""
		})));

		void this._openPopover(oSource);
	}

	/**
	 * Laedt die gefilterten Zeilen und verdichtet sie im Browser.
	 *
	 * Serverseitig geht das nicht: ZLE_AUST_C_APPL_LOG traegt kein
	 * @Aggregation.applySupported, es gibt also kein OData-$apply. Dieselbe
	 * Lage wie beim Verlaufs-Chart, deshalb auch dieselbe Obergrenze und
	 * derselbe Umgang damit - wird sie erreicht, sagt es die Kopfzeile.
	 */
	private async _loadCascades(): Promise<void> {
		const oCascade = this._cascadeModel();
		oCascade.setProperty("/busy", true);
		try {
			const oBinding = this.getODataModel("mainModel").bindList(
				"/AppLog",
				undefined,
				[new Sorter("CreatedAtStamp", true)],
				this._msgFilters(),
				{ $select: "LogUuid,CorrUuid,SeqNr,CreatedAtStamp,LogType,HistoryType,Message,"
					+ "ItemNumber,TpaNumber,OrderLineNr,BusinessKey,KeyType,Lgnum,HttpStatus,JsonPayload" }
			);
			const aContexts = await oBinding.requestContexts(0, CascadeGrouper.MAX_ROWS);
			const aRows = aContexts.map((oCtx) => oCtx.getObject() as CascadeGrouper.LogRow);
			const oResult = CascadeGrouper.group(aRows, aRows.length >= CascadeGrouper.MAX_ROWS);

			oCascade.setProperty("/rows", oResult.rows);
			oCascade.setProperty("/sourceCount", oResult.sourceCount);
			oCascade.setProperty("/truncated", oResult.truncated);
			oCascade.setProperty("/summary", this._bundle().getText(
				oResult.truncated ? "cascSummaryCut" : "cascSummary",
				// Meldungen zuerst: diese Zahl entspricht dem, was der
				// Reiter ohne Gruppierung anzeigt - so ist der Bezug
				// erkennbar, statt dass zwei Zahlen unverbunden nebeneinander
				// stehen.
				[String(oResult.sourceCount), String(oResult.rows.length)]
			) ?? "");
		} catch {
			oCascade.setProperty("/rows", []);
			oCascade.setProperty("/summary", this._bundle().getText("popLoadFailed") ?? "");
		} finally {
			oCascade.setProperty("/busy", false);
		}
	}

	/** Erzeugt das Detail-Popover einmalig und oeffnet es am geklickten Element. */
	private async _openPopover(oSource: Control): Promise<void> {
		if (!this._pKeyPopover) {
			this._pKeyPopover = Fragment.load({
				id: this.getView()?.getId(),
				name: "zui5_zle_aust_mon.view.fragment.KeyPopover",
				controller: this
			}) as Promise<Popover>;
			void this._pKeyPopover.then((oPopover) => this.getView()?.addDependent(oPopover));
		}
		const oPopover = await this._pKeyPopover;
		oPopover.openBy(oSource);
	}

	private _cascadeModel(): JSONModel {
		let oModel = this.getView()?.getModel("cascade") as JSONModel | undefined;
		if (!oModel) {
			oModel = new JSONModel({ rows: [], summary: "", truncated: false });
			this.getView()?.setModel(oModel, "cascade");
		}
		return oModel;
	}

	/**
	 * URL -> Modell. Laeuft bei jedem Aufruf der Route, also auch beim
	 * Zurueck-Knopf des Browsers.
	 */
	private _onRouteMatched(oEvent: Event): void {
		const oArgs = (oEvent.getParameter("arguments" as never) ?? {}) as Record<string, unknown>;
		const oQuery = (oArgs["?query"] ?? {}) as Record<string, string>;
		const oUi = this.getUiModel();

		this._bApplyingUrl = true;
		Object.entries(Main.URL_KEYS).forEach(([sKey, sPath]) => {
			const sValue = oQuery[sKey];
			if (sValue === undefined) {
				return;
			}
			if (sPath === "/grouped") {
				oUi.setProperty(sPath, sValue === "1");
			} else if (sPath === "/chartDays") {
				/*
				 * Durchgehend als STRING ablegen. selectedKey des
				 * SegmentedButton ist eine String-Eigenschaft: UI5 wandelt
				 * eine Zahl beim Setzen zwar still um, die Zwei-Wege-Bindung
				 * schreibt beim Klick aber einen String zurueck. Der
				 * Modellwert wechselte damit je nach Herkunft den Typ - genau
				 * die Sorte Unsauberkeit, die spaeter an einem === auffaellt.
				 * Gelesen wird ohnehin ueberall mit Number( ).
				 */
				oUi.setProperty(sPath, String(Number(sValue) || Main.CHART_DAYS));
			} else {
				oUi.setProperty(sPath, sValue);
			}
		});
		this._bApplyingUrl = false;

		this._applyMsgFilter();
		// Kam ein abweichendes Zeitfenster aus der Adresse, muss der Chart
		// nachziehen - _applyMsgFilter betrifft nur die Tabelle.
		if (Number(oUi.getProperty("/chartDays")) !== Main.CHART_DAYS) {
			void this._loadChart();
		}
	}

	/**
	 * Modell -> URL.
	 *
	 * ⚠ replace: true, KEIN neuer Eintrag in der Chronik. Sonst legte jeder
	 * Klick auf einen Reiter einen Verlaufsschritt an, und der
	 * Zurueck-Knopf braeuchte ein Dutzend Betaetigungen, um die App zu
	 * verlassen.
	 *
	 * ⚠ Standardwerte fallen aus der URL heraus. Eine Adresse mit vier
	 * Parametern, von denen drei nichts aussagen, laedt niemanden zum
	 * Weiterschicken ein.
	 */
	private _syncUrl(): void {
		if (this._bApplyingUrl) {
			return;
		}
		const oUi = this.getUiModel();
		const oQuery: Record<string, string> = {};

		const sProcess = oUi.getProperty("/selectedProcess") as string;
		if (sProcess && sProcess !== ProcessAxis.KEY_DEFAULT) {
			oQuery.p = sProcess;
		}
		const sType = oUi.getProperty("/selectedType") as string;
		if (sType) {
			oQuery.t = sType;
		}
		const sSearch = oUi.getProperty("/searchTerm") as string;
		if (sSearch) {
			oQuery.q = sSearch;
		}
		if (oUi.getProperty("/grouped") as boolean) {
			oQuery.g = "1";
		}
		const nDays = Number(oUi.getProperty("/chartDays"));
		if (nDays && nDays !== Main.CHART_DAYS) {
			oQuery.d = String(nDays);
		}

		(this.getOwnerComponent() as UIComponent).getRouter().navTo(
			"RouteMain",
			Object.keys(oQuery).length ? { "?query": oQuery } : {},
			true
		);
	}
}
