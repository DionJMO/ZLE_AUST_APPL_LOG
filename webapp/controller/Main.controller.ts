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
		idMsgTable: 5,
		idTpaTable: 8
	};

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
		const oBinding = this._table("idMsgTable")?.getBinding("rows") as ListBinding | undefined;
		if (!oBinding) {
			return;
		}

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

		oBinding.filter(aFilters.length ? [new Filter({ filters: aFilters, and: true })] : []);
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
}
