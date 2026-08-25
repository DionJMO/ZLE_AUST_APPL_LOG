import DateFormat from "sap/ui/core/format/DateFormat";
import UIComponent from "sap/ui/core/UIComponent";
import Table from "sap/ui/table/Table";
import JSONModel from "sap/ui/model/json/JSONModel";
import VizFrame from "sap/viz/ui5/controls/VizFrame";
import BaseController from "./BaseController";
import * as TableColumnState from "../util/TableColumnState";
import * as LogAggregator from "../model/LogAggregator";
import * as KpiLoader from "../model/KpiLoader";
import * as ChartColors from "../model/ChartColors";

/**
 * @namespace zui5_zle_aust_mon.controller
 */
export default class Main extends BaseController {

	/**
	 * Standardmaessig sichtbare Spaltenanzahl je Tabelle. Der Rest ist
	 * ausgeblendet und laesst sich ueber das Zahnrad im Panel-Header
	 * einblenden.
	 *
	 * Angehoben am 25.08.2026: die Abbruch-Tabelle stand auf 3 und
	 * versteckte damit Position und Prozess - genau die zwei Felder, die
	 * das Backend zusaetzlich in den Meldungstext schreibt. Sie waren
	 * gebaut, nur nicht sichtbar. Die Tabelle der technischen Fehler
	 * versteckte Material und TPA-Nummer, also den einzigen fachlichen
	 * Bezug, den diese Eintraege haben.
	 *
	 * Wer den Spaltendialog schon benutzt hat, hat eine gespeicherte
	 * Auswahl - die gewinnt. Darum wurde der Speicherschluessel in
	 * TableColumnState auf v2 gezogen.
	 */
	private static readonly DEFAULT_VISIBLE: Record<string, number> = {
		idAppLogTable: 5,
		idTpaTable: 8,
		idAbortTable: 7,
		idTechErrorTable: 5,
		idInboundMsgTable: 5,
		idOutboundMsgTable: 5
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

	public onOpenAppLogColumns(): void {
		this._openColumns("idAppLogTable");
	}

	public onOpenTpaColumns(): void {
		this._openColumns("idTpaTable");
	}

	public onOpenAbortColumns(): void {
		this._openColumns("idAbortTable");
	}

	public onOpenTechErrorColumns(): void {
		this._openColumns("idTechErrorTable");
	}

	public onOpenInboundMsgColumns(): void {
		this._openColumns("idInboundMsgTable");
	}

	public onOpenOutboundMsgColumns(): void {
		this._openColumns("idOutboundMsgTable");
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
