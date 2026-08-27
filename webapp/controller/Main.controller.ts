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
		// 6 statt 5: die Spalte "Schritte" sitzt auf Index 1 und wird von
		// restore( ) uebersprungen, belegt aber einen Indexplatz. Ohne die
		// Anhebung fiele die TPA-Nummer aus der Standardauswahl.
		idMsgTable: 6,
		idTpaTable: 8
	};

	/** Detail-Popover und Payload-Dialog werden einmal erzeugt und wiederverwendet. */
	private _pKeyPopover?: Promise<Popover>;
	private _pPayloadDialog?: Promise<Dialog>;

	/** Zeitfenster des Verlaufs-Charts in Tagen. */
	private static readonly CHART_DAYS = 7;

	public onInit(): void {
		this.getView()?.setModel(new JSONModel({ days: [] }), "chart");

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

	public onTypeFilterChange(oEvent: Event): void {
		const oItem = oEvent.getParameter("item" as never) as unknown as { getKey(): string };
		this.getUiModel().setProperty("/selectedType", oItem.getKey());
		this._applyMsgFilter();
	}

	/** Ein Zahnrad fuer beide Tabellen - je nachdem, welcher Reiter offen ist. */
	public onOpenMsgColumns(): void {
		const sProcess = this.getUiModel().getProperty("/selectedProcess") as string;
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

		return aFilters.length ? [new Filter({ filters: aFilters, and: true })] : [];
	}

	private _loadData(): void {
		this._stampRefresh();
		void this._loadChart();
		void this._loadKpis();
	}

	private async _loadChart(): Promise<void> {
		try {
			const oData = await LogAggregator.loadLastDays(
				this.getODataModel("mainModel"),
				Main.CHART_DAYS
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
		const oDetail = this._detailModel();
		oDetail.setProperty("/payload", sPayload);
		oDetail.setProperty("/payloadMessage", (oContext?.getProperty("message") as string) ?? "");
		oDetail.setProperty("/payloadTitle", (oContext?.getProperty("stamp") as string) ?? "");

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

	private _bundle(): ResourceBundle {
		const oModel = this.getView()?.getModel("i18n") as ResourceModel;
		return oModel.getResourceBundle() as ResourceBundle;
	}

	private _detailModel(): JSONModel {
		let oModel = this.getView()?.getModel("detail") as JSONModel | undefined;
		if (!oModel) {
			oModel = new JSONModel({ log: [], logExpanded: true, sap: { available: false, hint: "", header: "", fields: [], rows: [] } });
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
		const oMainContext = oSource.getBindingContext("mainModel");
		const oTpaContext = oSource.getBindingContext("tpaModel");
		const sRaw = (oMainContext
			? (oMainContext.getProperty(sMainField) as string)
			: (oTpaContext?.getProperty(sTpaField) as string)) ?? "";

		if (!sRaw.trim()) {
			return;
		}

		const oDetail = this._detailModel();
		oDetail.setProperty("/busy", true);
		oDetail.setProperty("/log", []);
		oDetail.setProperty("/logExpanded", true);

		await this._openPopover(oSource);

		try {
			const oSap = SapLookup.load(
				this.getView()?.getModel("lookupModel") as ODataModel | undefined,
				sKind,
				sRaw,
				this._bundle()
			);

			const oDetailData = await KeyDetailLoader.loadKeyDetail(
				this.getView()?.getModel("mainModel") as ODataModel,
				sKind,
				sRaw,
				this._bundle()
			);
			Object.keys(oDetailData).forEach((sKey) => {
				oDetail.setProperty("/" + sKey, (oDetailData as unknown as Record<string, unknown>)[sKey]);
			});
			// Phase 2 wird PARALLEL geladen und erst hier erwartet: faellt der
			// Lookup-Service aus, steht Phase 1 trotzdem schon.
			const oSapData = await oSap;
			oDetail.setProperty("/sap", oSapData);

			/*
			 * Stehen die SAP-Felder zur Verfuegung, sind SIE der Grund, warum
			 * jemand das Popover geoeffnet hat - der Verlauf wiederholt im
			 * Wesentlichen die Tabelle dahinter. Also klappt er zu und das
			 * SAP-Panel auf. Ohne SAP-Daten bleibt der Verlauf offen, sonst
			 * waere das Popover leer.
			 */
			oDetail.setProperty("/logExpanded", !oSapData.available);
		} catch {
			oDetail.setProperty("/logHeader", this._bundle().getText("popLoadFailed") ?? "");
			oDetail.setProperty("/sap", { available: false, hint: "", header: "", fields: [], rows: [] });
		} finally {
			oDetail.setProperty("/busy", false);
		}
	}

	/**
	 * Umschalten zwischen Einzelmeldungen und Vorgaengen.
	 *
	 * Die Tabelle wird dabei UMGEBUNDEN: im Normalfall haengt sie an
	 * mainModel>/AppLog (OData, serverseitig gefiltert und geblaettert), in
	 * der Vorgangssicht an cascade>/rows (JSON, im Browser verdichtet).
	 *
	 * ⚠ Die verdichteten Zeilen tragen dieselben Eigenschaftsnamen wie die
	 * OData-Zeilen. Nur deshalb funktionieren alle bestehenden Spalten in
	 * beiden Zustaenden unveraendert weiter - es gibt keinen zweiten
	 * Spaltensatz.
	 */
	public onCascadeToggle(oEvent: Event): void {
		const bPressed = oEvent.getParameter("pressed" as never) as unknown as boolean;
		this.getUiModel().setProperty("/grouped", bPressed);
		this._bindMsgRows(bPressed);
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
		oDetail.setProperty("/subtitle", oBundle.getText("cascSubtitle") ?? "");
		oDetail.setProperty("/logHeader", oBundle.getText("popLogPanel", [String(oRow.StepCount)]) ?? "");
		oDetail.setProperty("/busy", false);
		oDetail.setProperty("/sap", { available: false, hint: "", header: "", fields: [], rows: [] });
		// Im Kaskaden-Popover IST der Verlauf der Inhalt, nicht die Beigabe.
		oDetail.setProperty("/logExpanded", true);
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

	private _bindMsgRows(bGrouped: boolean): void {
		const oTable = this._table("idMsgTable");
		if (!oTable) {
			return;
		}
		if (bGrouped) {
			oTable.bindRows({ path: "cascade>/rows" });
		} else {
			oTable.bindRows({
				path: "mainModel>/AppLog",
				parameters: { $count: true },
				sorter: new Sorter("CreatedAtStamp", true)
			});
		}
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
				[String(oResult.rows.length), String(oResult.sourceCount)]
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
}
